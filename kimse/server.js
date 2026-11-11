'use strict';
/*
  Kimse — rastgele anonim sesli sohbet sunucusu (bağımlılık yok, sadece Node 18+)

  Çalıştır:   ADMIN_KEY=uzun-gizli-bir-sifre node server.js
  Site:       http://localhost:3000
  Moderasyon: http://localhost:3000/admin

  Ortam değişkenleri:
    PORT         varsayılan 3000
    ADMIN_KEY    moderasyon paneli şifresi (boşsa panel kapalıdır)
    PROXY_HOPS   sunucunun önündeki güvenilir proxy sayısı. Boş bırakılırsa:
                 bağlantı özel bir ağdan geliyorsa 1, değilse 0 kabul edilir.
                 Yanlış ayarlanırsa herkes aynı IP görünür; yasaklamadan önce
                 paneldeki IP'lerin farklı olduğunu kontrol et.
    ICE_SERVERS  JSON; TURN eklemek için. Örn:
                 [{"urls":"stun:stun.l.google.com:19302"},
                  {"urls":"turn:turn.ornek.com:3478","username":"u","credential":"p"}]
    DATA_FILE    şikayet ve yasak kayıtlarının dosyası (varsayılan ./data.json)
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const MAX_SESSIONS_PER_IP = 4;
const REASONS = ['taciz', 'hakaret', 'tehdit', 'resit-degil', 'diger'];

let ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
try { if (process.env.ICE_SERVERS) ICE = JSON.parse(process.env.ICE_SERVERS); } catch (e) {
  console.error('ICE_SERVERS okunamadı, varsayılan kullanılıyor');
}

/* ---------- kalıcı veri ---------- */
let data = { bans: {}, reports: [] };
try { data = Object.assign(data, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (e) {}
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(data), (err) => { if (err) console.error('kayıt hatası', err.message); });
  }, 200);
}

/* ---------- IP ---------- */
function normIp(ip) { return String(ip || '').replace(/^::ffff:/, '').trim(); }
function isPrivate(ip) {
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^f[cd]/i.test(ip) || /^fe80/i.test(ip)) return true;
  const m = ip.match(/^(\d+)\.(\d+)\./);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}
function clientIp(req) {
  const remote = normIp(req.socket.remoteAddress);
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(normIp).filter(Boolean);
  let hops = process.env.PROXY_HOPS !== undefined && process.env.PROXY_HOPS !== ''
    ? parseInt(process.env.PROXY_HOPS, 10) || 0
    : (isPrivate(remote) && xff.length ? 1 : 0);
  if (hops > 0 && xff.length) return xff[Math.max(0, xff.length - hops)];
  return remote;
}

/* ---------- oturumlar ve eşleştirme ---------- */
const sessions = new Map(); // id -> oturum
let waiting = [];           // bekleyen oturum id'leri

function send(s, event, payload) {
  if (s && s.res && !s.res.writableEnded) s.res.write('event: ' + event + '\ndata: ' + JSON.stringify(payload || {}) + '\n\n');
}
function unpair(s) {
  const p = s.partner && sessions.get(s.partner);
  s.partner = null;
  if (p && p.partner === s.id) { p.partner = null; send(p, 'left'); }
}
function drop(s, event) {
  if (!sessions.has(s.id)) return;
  unpair(s);
  waiting = waiting.filter((id) => id !== s.id);
  sessions.delete(s.id);
  clearTimeout(s.attachT);
  if (s.res && !s.res.writableEnded) { if (event) send(s, event); s.res.end(); }
}
function find(s) {
  unpair(s);
  waiting = waiting.filter((id) => id !== s.id && sessions.has(id));
  const otherId = waiting.shift();
  const o = otherId && sessions.get(otherId);
  if (!o) { waiting.push(s.id); return; }
  s.partner = o.id; o.partner = s.id;
  const now = Date.now();
  s.last = { id: o.id, nick: o.nick, ip: o.ip, at: now };
  o.last = { id: s.id, nick: s.nick, ip: s.ip, at: now };
  send(s, 'matched', { nick: o.nick, initiator: true });
  send(o, 'matched', { nick: s.nick, initiator: false });
}
function cleanNick(v) {
  return String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

/* ---------- http yardımcıları ---------- */
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let buf = '', over = false;
    req.on('data', (c) => { buf += c; if (buf.length > 65536) { over = true; req.destroy(); } });
    req.on('end', () => { if (over) return resolve(null); try { resolve(JSON.parse(buf || '{}')); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
function auth(body) {
  const s = body && sessions.get(String(body.id || ''));
  return s && s.secret === body.secret ? s : null;
}
function isAdmin(req) {
  if (!ADMIN_KEY) return false;
  const a = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function file(res, name, type) {
  fs.readFile(path.join(__dirname, 'public', name), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('yok'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

/* ---------- yönlendirme ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const ip = clientIp(req);

  if (req.method === 'GET') {
    if (p === '/') return file(res, 'index.html', 'text/html; charset=utf-8');
    if (p === '/admin') return file(res, 'admin.html', 'text/html; charset=utf-8');

    if (p === '/api/events') {
      const s = sessions.get(url.searchParams.get('id') || '');
      if (!s || s.secret !== url.searchParams.get('secret') || s.res) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
      });
      res.write('retry: 600000\n\n');
      s.res = res; clearTimeout(s.attachT);
      send(s, 'ready');
      req.on('close', () => drop(s));
      return;
    }

    if (p === '/api/admin/reports') {
      if (!isAdmin(req)) return json(res, ADMIN_KEY ? 401 : 503, { error: 'yetki yok' });
      const counts = {};
      data.reports.forEach((r) => { counts[r.targetIp] = (counts[r.targetIp] || 0) + 1; });
      return json(res, 200, {
        online: sessions.size,
        reports: data.reports.slice().reverse().map((r) => Object.assign({}, r, {
          targetReportCount: counts[r.targetIp], targetBanned: !!data.bans[r.targetIp]
        })),
        bans: Object.keys(data.bans).map((k) => Object.assign({ ip: k }, data.bans[k]))
      });
    }
    res.writeHead(404); return res.end('yok');
  }

  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  const body = await readBody(req);
  if (!body) return json(res, 400, { error: 'geçersiz istek' });

  if (p === '/api/session') {
    if (data.bans[ip]) return json(res, 403, { error: 'banned' });
    const nick = cleanNick(body.nick);
    if (nick.length < 2) return json(res, 400, { error: 'nick' });
    let n = 0; sessions.forEach((s) => { if (s.ip === ip) n++; });
    if (n >= MAX_SESSIONS_PER_IP) return json(res, 429, { error: 'limit' });
    const s = {
      id: crypto.randomBytes(9).toString('hex'), secret: crypto.randomBytes(18).toString('hex'),
      nick, ip, res: null, partner: null, last: null, reported: new Set()
    };
    s.attachT = setTimeout(() => { if (!s.res) drop(s); }, 15000);
    sessions.set(s.id, s);
    return json(res, 200, { id: s.id, secret: s.secret, nick, iceServers: ICE });
  }

  if (p === '/api/admin/ban' || p === '/api/admin/unban') {
    if (!isAdmin(req)) return json(res, ADMIN_KEY ? 401 : 503, { error: 'yetki yok' });
    const target = normIp(body.ip);
    if (!target) return json(res, 400, { error: 'ip' });
    if (p === '/api/admin/ban') {
      data.bans[target] = { at: Date.now(), note: String(body.note || '').slice(0, 200) };
      Array.from(sessions.values()).forEach((s) => { if (s.ip === target) drop(s, 'banned'); });
    } else delete data.bans[target];
    save();
    return json(res, 200, { ok: true });
  }

  const s = auth(body);
  if (!s) return json(res, 401, { error: 'oturum yok' });

  if (p === '/api/find') { find(s); return json(res, 200, { ok: true }); }

  if (p === '/api/leave') {
    unpair(s); waiting = waiting.filter((id) => id !== s.id);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/signal') {
    const o = s.partner && sessions.get(s.partner);
    if (o && o.partner === s.id) send(o, 'signal', body.data);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/report') {
    const t = s.last;
    if (!t || Date.now() - t.at > 60 * 60 * 1000) return json(res, 400, { error: 'şikayet edilecek kimse yok' });
    if (s.reported.has(t.id)) return json(res, 200, { ok: true, already: true });
    s.reported.add(t.id);
    data.reports.push({
      at: Date.now(), reason: REASONS.includes(body.reason) ? body.reason : 'diger',
      targetNick: t.nick, targetIp: t.ip, reporterNick: s.nick, reporterIp: s.ip
    });
    if (data.reports.length > 5000) data.reports = data.reports.slice(-5000);
    save();
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: 'yok' });
});

setInterval(() => { sessions.forEach((s) => { if (s.res && !s.res.writableEnded) s.res.write(': ping\n\n'); }); }, 20000);

server.listen(PORT, () => {
  console.log('Kimse çalışıyor: http://localhost:' + PORT);
  if (!ADMIN_KEY) console.log('UYARI: ADMIN_KEY tanımlı değil, moderasyon paneli kapalı.');
});
