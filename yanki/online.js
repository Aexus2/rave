/* Yankı — ONLINE DENEME MODU (hesapsız, farklı telefonlar arası)
 * Bağlantı: ücretsiz, herkese açık MQTT sunucuları (WebSocket)
 * Oda durumu: oda sahibinin telefonu yönetir (yetki kontrolü orada yapılır)
 * Ses: WebRTC, telefondan telefona (küçük odalar için, ~10 kişi)
 * Gerçek sürümde bunların yerini Vercel + LiveKit alır; app.js aynı kalır.
 */
(() => {
"use strict";
const BROKERS = window.__YK_BROKERS || ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt", "wss://test.mosquitto.org:8081/mqtt"];
const PFX = "yanki-ax2/v1/";
const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }, { urls: "stun:global.stun.twilio.com:3478" }];
const enc = new TextEncoder(), dec = new TextDecoder();
const rnd = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const unb64 = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
const tok = (o) => `x.${b64(o)}.demo`;
const read = (t) => { try { const p = unb64(String(t).split(".")[1]); return p.exp && p.exp * 1000 < Date.now() ? null : p; } catch { return null; } };
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };

/* ================= MQTT 3.1.1 istemcisi ================= */
class Mqtt {
  constructor({ will, onConnect, onMessage }) {
    Object.assign(this, { will, onConnect, onMessage, ws: null, connected: false, bi: 0, buf: new Uint8Array(0), pid: 1, retry: 0, closed: false, subs: new Set() });
    this.connectOnce();
  }
  static str(s) { const b = enc.encode(s); const o = new Uint8Array(2 + b.length); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; }
  static cat(...a) { let n = 0; for (const x of a) n += x.length; const o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; }
  static pkt(h, body) { const o = []; let n = body.length; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; o.push(b); } while (n > 0); return Mqtt.cat(Uint8Array.of(h), Uint8Array.from(o), body); }
  send(p) { if (this.ws && this.ws.readyState === 1) { try { this.ws.send(p); } catch {} } }
  publish(topic, payload, retain = false) { if (!this.connected) return false; this.send(Mqtt.pkt(0x30 | (retain ? 1 : 0), Mqtt.cat(Mqtt.str(topic), enc.encode(payload)))); return true; }
  subscribe(f) { this.subs.add(f); if (this.connected) this._sub(f); }
  unsubscribe(f) { this.subs.delete(f); if (this.connected) { this.send(Mqtt.pkt(0xa2, Mqtt.cat(Uint8Array.of(this.pid >> 8, this.pid & 255), Mqtt.str(f)))); this.pid = (this.pid % 65000) + 1; } }
  _sub(f) { this.send(Mqtt.pkt(0x82, Mqtt.cat(Uint8Array.of(this.pid >> 8, this.pid & 255), Mqtt.str(f), Uint8Array.of(0)))); this.pid = (this.pid % 65000) + 1; }
  parse() {
    while (this.buf.length >= 2) {
      let mul = 1, len = 0, i = 1, b;
      do { if (i >= this.buf.length) return; b = this.buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
      if (this.buf.length < i + len) return;
      const type = this.buf[0] >> 4, flags = this.buf[0] & 15, body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      if (type === 2) { if (body[1] === 0) this.ack(); else { try { this.ws.close(); } catch {} } }
      else if (type === 3) {
        const tl = (body[0] << 8) | body[1]; const topic = dec.decode(body.subarray(2, 2 + tl));
        let p = 2 + tl; if ((flags >> 1) & 3) p += 2;
        try { this.onMessage(topic, dec.decode(body.subarray(p))); } catch (e) { console.error(e); }
      }
    }
  }
  ack() {
    this.connected = true; this.retry = 0;
    for (const f of this.subs) this._sub(f);
    clearInterval(this.ping); this.ping = setInterval(() => this.send(Uint8Array.of(0xc0, 0)), 20000);
    this.onConnect && this.onConnect();
  }
  connectOnce() {
    if (this.closed) return;
    const url = BROKERS[this.bi % BROKERS.length];
    let sock; try { sock = new WebSocket(url, ["mqtt"]); } catch { this.bi++; setTimeout(() => this.connectOnce(), 800); return; }
    this.ws = sock; this.buf = new Uint8Array(0); sock.binaryType = "arraybuffer";
    const to = setTimeout(() => { if (!this.connected && this.ws === sock) { try { sock.close(); } catch {} } }, 7000);
    sock.onopen = () => {
      const cid = "yk_" + rnd(6);
      let flags = 0x02, tail = new Uint8Array(0);
      if (this.will) { flags |= 0x04 | (this.will.retain ? 0x20 : 0); tail = Mqtt.cat(Mqtt.str(this.will.topic), Mqtt.str(this.will.payload || "")); }
      this.send(Mqtt.pkt(0x10, Mqtt.cat(Mqtt.str("MQTT"), Uint8Array.of(4, flags, 0, 45), Mqtt.str(cid), tail)));
    };
    sock.onmessage = (e) => { if (this.ws !== sock) return; this.buf = Mqtt.cat(this.buf, new Uint8Array(e.data)); this.parse(); };
    const down = () => {
      clearTimeout(to); if (sock._dead) return; sock._dead = true; if (this.ws !== sock) return;
      const was = this.connected; this.connected = false; clearInterval(this.ping);
      if (this.closed) return;
      if (!was) this.bi++; this.retry = Math.min(this.retry + 1, 8);
      setTimeout(() => this.connectOnce(), was ? 1000 : Math.min(500 * this.retry, 4000));
    };
    sock.onclose = down; sock.onerror = down;
  }
  close() { this.closed = true; clearInterval(this.ping); try { this.send(Uint8Array.of(0xe0, 0)); this.ws.close(); } catch {} }
}

/* ================= Lobi bağlantısı ================= */
const lobbyRooms = new Map(); // id -> {title,cat,host,now,count,ts}
const waiters = new Map();     // topic -> [resolve]
let lobbyReady;
const lobbyReadyP = new Promise((r) => (lobbyReady = r));
const lobby = new Mqtt({
  onConnect: () => lobbyReady(),
  onMessage: (topic, msg) => {
    if (topic.startsWith(PFX + "l/")) { const id = topic.slice(PFX.length + 2); const v = J(msg); if (v) lobbyRooms.set(id, v); else lobbyRooms.delete(id); }
    const w = waiters.get(topic); if (w) { waiters.delete(topic); w.forEach((f) => f(msg)); }
  },
});
lobby.subscribe(PFX + "l/+");
function fetchRetained(topic, ms = 5000) {
  return new Promise((resolve) => {
    const arr = waiters.get(topic) || []; arr.push(resolve); waiters.set(topic, arr);
    lobby.subscribe(topic);
    setTimeout(() => { if (waiters.has(topic)) { waiters.delete(topic); resolve(null); } lobby.unsubscribe(topic); }, ms);
  });
}

/* ================= Yetki mantığı (sunucudakinin aynısı) ================= */
const roleOf = (st, id) => (id === st.hostId ? "host" : st.roles[id] || "listener");
const isCtl = (r) => ["host", "mod", "dj"].includes(r), isMgr = (r) => ["host", "mod"].includes(r);
const curPos = (p, t) => (p.id ? p.pos + (p.playing ? (t - p.at) / 1000 : 0) : 0);
class Fail extends Error { constructor(c, m) { super(m); this.code = c; } }
const fail = (c, m) => { throw new Fail(c, m); };
const ROLES = ["mod", "dj", "speaker", "listener"];
function heirOf(st, members) {
  const order = (p) => ({ mod: 0, dj: 1, speaker: 2 }[st.roles[p.identity]] ?? 3);
  return members.filter((p) => !st.banned.includes(p.identity)).sort((a, c) => order(a) - order(c) || a.joinedAt - c.joinedAt || (a.identity < c.identity ? -1 : 1))[0];
}
// st'yi değiştirir; { changed, effects } döner
function applyAction(st, members, user, b, t) {
  const me = roleOf(st, user.id), fx = [];
  const needCtl = () => { if (!isCtl(me)) fail(403, "Bunu sadece oda sahibi, yardımcı ya da DJ yapabilir"); };
  const needMgr = () => { if (!isMgr(me)) fail(403, "Bunu sadece oda sahibi ya da yardımcı yapabilir"); };
  const freeze = () => { st.play.pos = curPos(st.play, t); st.play.at = t; };
  const next = () => { const n = st.queue.shift(); st.play = n ? { id: n.id, title: n.title, playing: true, pos: 0, at: t } : { id: null, title: "", playing: false, pos: 0, at: t }; };
  const target = String(b.target || ""), tRole = target ? roleOf(st, target) : null;
  const canTouch = () => { needMgr(); if (!target || target === user.id) fail(400, "Geçersiz kişi"); if (tRole === "host") fail(403, "Oda sahibine dokunamazsın"); if (me === "mod" && tRole === "mod") fail(403, "Yardımcılar birbirine dokunamaz"); };
  switch (b.action) {
    case "toggle": needCtl(); freeze(); st.play.playing = !st.play.playing; break;
    case "seek": needCtl(); if (!st.play.id) return { changed: false }; st.play.pos = Math.max(0, +b.pos || 0); st.play.at = t; break;
    case "add": {
      needCtl(); const id = String(b.id || ""); if (!/^[\w-]{11}$/.test(id)) fail(400, "Geçersiz video");
      const item = { id, title: String(b.title || "YouTube videosu").slice(0, 120), by: user.name };
      if (!st.play.id) st.play = { id, title: item.title, playing: true, pos: 0, at: t };
      else { if (st.queue.length >= 50) fail(400, "Sıra dolu"); st.queue.push(item); }
      break;
    }
    case "remove": needCtl(); st.queue.splice(+b.index, 1); break;
    case "skip": needCtl(); next(); break;
    case "ended": if (st.play.id !== b.id || t - st.play.at < 15000) return { changed: false }; next(); break;
    case "title": needCtl(); if (st.play.id !== b.id) return { changed: false }; st.play.title = String(b.title || "").slice(0, 120); break;
    case "role": {
      canTouch(); const r = String(b.role); if (!ROLES.includes(r)) fail(400, "Geçersiz rol");
      if (r === "mod" && me !== "host") fail(403, "Yardımcıyı sadece oda sahibi atar");
      if (r === "listener") delete st.roles[target]; else st.roles[target] = r;
      break;
    }
    case "mute": canTouch(); fx.push({ t: "mute", to: target }); return { changed: false, effects: fx };
    case "kick": canTouch(); delete st.roles[target]; if (!st.banned.includes(target)) st.banned.push(target); fx.push({ t: "kick", to: target }); break;
    case "host":
      if (me !== "host") fail(403, "Sadece oda sahibi devredebilir"); if (!target || target === user.id) fail(400, "Geçersiz kişi");
      delete st.roles[target]; st.roles[user.id] = "mod"; st.hostId = target; st.hostName = String(b.targetName || "").slice(0, 30) || st.hostName;
      break;
    case "claim": return { changed: false }; // telefonlar arası modda varis kendiliğinden devralır
    default: fail(400, "Bilinmeyen işlem");
  }
  return { changed: true, effects: fx };
}

/* ================= Sahte "sunucu" (/api) ================= */
let current = null; // bağlı oda
const API = {
  async config() { return { ready: true, allowGuest: true, supabaseUrl: "", livekitUrl: "mqtt", maxRoom: 12, demo: true }; },
  async session(b) {
    const name = String(b.guestName || "").trim().slice(0, 20); if (!name) fail(400, "İsim gerekli");
    const user = { id: "g_" + rnd(6), name, avatar: "" };
    return { session: tok({ sub: user.id, name: user.name, exp: Math.floor(Date.now() / 1000) + 43200 }), user };
  },
  async rooms() {
    await Promise.race([lobbyReadyP, new Promise((r) => setTimeout(r, 2500))]);
    await new Promise((r) => setTimeout(r, 300));
    const now = Date.now(), out = [];
    for (const [id, r] of lobbyRooms) if (now - r.ts < 40000 && r.count > 0) out.push({ id, ...r });
    return { rooms: out.sort((a, b) => b.count - a.count) };
  },
  async join(b) {
    const u = read(b.session); if (!u) fail(401, "Oturum geçersiz");
    let name, st;
    if (b.create) {
      name = "oda-" + rnd(4);
      st = { app: "yanki", v: 1, title: String(b.create.title || "Oda").slice(0, 40), cat: b.create.cat || "sohbet", hostId: u.sub, hostName: u.name, roles: {}, banned: [], queue: [], play: { id: null, title: "", playing: false, pos: 0, at: Date.now() } };
    } else {
      name = String(b.room || "");
      await Promise.race([lobbyReadyP, new Promise((r) => setTimeout(r, 4000))]);
      st = J(await fetchRetained(PFX + "r/" + name + "/s", 5000));
      if (!st || st.app !== "yanki") fail(404, "Oda bulunamadı ya da kapanmış");
      if (st.banned.includes(u.sub)) fail(403, "Bu odadan çıkarıldın");
    }
    return { room: name, url: "mqtt", token: tok({ sub: u.sub, name: u.name, room: name, exp: Math.floor(Date.now() / 1000) + 21600 }), state: st, initial: st, serverNow: Date.now(), me: { id: u.sub, name: u.name } };
  },
  async action(b) {
    const u = read(b.session); if (!u) fail(401, "Oturum geçersiz");
    if (!current || !current.state || current.name !== b.room) fail(404, "Oda yok");
    if (b.action === "claim") return { ok: true, skipped: true };
    const user = { id: u.sub, name: u.name }, t = Date.now();
    if (current.state.hostId === user.id) {
      const st = JSON.parse(JSON.stringify(current.state));
      const r = applyAction(st, current.memberRecs(), user, b, t);
      current.commit(st, r);
      return { ok: true, state: current.state, serverNow: t };
    }
    // oda sahibine ilet; önce kendimiz kontrol edelim ki hata anında görünsün
    applyAction(JSON.parse(JSON.stringify(current.state)), current.memberRecs(), user, b, t);
    current.pub("a", { ...b, session: undefined, from: user.id, fromName: user.name });
    return { ok: true, serverNow: t };
  },
};
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) {
    const fn = API[url.pathname.slice(5)];
    let b = {}; try { b = init && init.body ? JSON.parse(init.body) : {}; } catch {}
    const res = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { "Content-Type": "application/json" } });
    if (!fn) return res(404, { error: "yok" });
    try { return res(200, await fn(b)); } catch (e) { return res(e.code || 500, { error: e.message }); }
  }
  return realFetch(input, init);
};

/* ================= LiveKit yerine geçen oda istemcisi ================= */
const RoomEvent = { ParticipantConnected: "pc", ParticipantDisconnected: "pd", ParticipantAttributesChanged: "pa", TrackMuted: "tm", TrackUnmuted: "tu", LocalTrackPublished: "ltp", LocalTrackUnpublished: "ltu", TrackPublished: "tp", TrackUnpublished: "tun", ParticipantMetadataChanged: "pm", RoomMetadataChanged: "rm", ActiveSpeakersChanged: "as", TrackSubscribed: "ts", TrackUnsubscribed: "tus", AudioPlaybackStatusChanged: "aps", ParticipantPermissionsChanged: "pp", DataReceived: "dr", Disconnected: "dc" };
const DisconnectReason = { CLIENT_INITIATED: 1, PARTICIPANT_REMOVED: 4 };
const PRES_TTL = 20000;

class P {
  constructor(d) { this.upd(d); }
  upd(d) { this.identity = d.identity; this.name = d.name; this.metadata = "{}"; this.attributes = { ...(d.attributes || {}) }; this.joinedAt = new Date(d.joinedAt); this.isMicrophoneEnabled = !!d.mic; this.t = Date.now(); }
}

class Room {
  constructor() { this.h = {}; this.remoteParticipants = new Map(); this.canPlaybackAudio = true; this.metadata = ""; this.peers = new Map(); this.audioEls = new Map(); this.levels = new Map(); }
  on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
  emit(e, ...a) { (this.h[e] || []).forEach((f) => { try { f(...a); } catch (err) { console.error(err); } }); }
  pub(k, obj, retain) { return this.mq && this.mq.publish(this.P + k, typeof obj === "string" ? obj : JSON.stringify(obj), retain); }
  memberRecs() { return [{ identity: this.me.id, joinedAt: this.joinedAt }, ...[...this.remoteParticipants.values()].map((p) => ({ identity: p.identity, name: p.name, joinedAt: +p.joinedAt }))]; }

  async connect(_url, token) {
    const g = read(token); if (!g) throw new Error("Geçersiz anahtar");
    this.me = { id: g.sub, name: g.name }; this.name = g.room; this.P = PFX + "r/" + g.room + "/";
    this.joinedAt = Date.now(); this.attrs = {}; this.mic = false;
    const init = window.__ykInitialState; window.__ykInitialState = null;
    this.state = init; this.metadata = init ? JSON.stringify(init) : "";
    current = this;
    const self = this;
    this.localParticipant = { identity: g.sub, name: g.name, metadata: "{}", attributes: {}, joinedAt: new Date(this.joinedAt), isMicrophoneEnabled: false,
      setMicrophoneEnabled: (on) => self.setMic(on),
      setAttributes: async (a) => { Object.assign(self.attrs, a); self.localParticipant.attributes = { ...self.attrs }; self.presence(); self.emit(RoomEvent.ParticipantAttributesChanged, a, self.localParticipant); },
      publishData: async (data, opt) => { self.pub("d", { from: g.sub, name: g.name, topic: opt.topic, text: dec.decode(data) }); },
    };
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("Bağlantı kurulamadı, internetini kontrol et")), 12000);
      this.mq = new Mqtt({
        will: { topic: this.P + "p/" + g.sub, payload: "", retain: true },
        onConnect: () => {
          clearTimeout(to);
          if (this.state && this.state.hostId === g.sub) this.publishState();
          this.presence(); resolve();
        },
        onMessage: (topic, msg) => this.onMsg(topic, msg),
      });
      ["s", "p/+", "d", "a", "x", "w/" + g.sub].forEach((k) => this.mq.subscribe(this.P + k));
    });
    this.timers = [
      setInterval(() => this.presence(), 5000),
      setInterval(() => this.housekeeping(), 3000),
      setInterval(() => this.speakers(), 250),
    ];
    this.unload = () => this.disconnect();
    addEventListener("pagehide", this.unload);
    this.emit(RoomEvent.ActiveSpeakersChanged, []);
  }

  presence() { this.pub("p/" + this.me.id, { identity: this.me.id, name: this.me.name, joinedAt: this.joinedAt, attributes: this.attrs, mic: this.mic, hb: Date.now() }, true); }
  publishState() {
    this.pub("s", this.state, true);
    this.lobbyTick(true);
  }
  lobbyTick(force) {
    if (!this.state || this.state.hostId !== this.me.id) return;
    if (!force && Date.now() - (this.lastLobby || 0) < 10000) return;
    this.lastLobby = Date.now();
    const st = this.state;
    lobby.publish(PFX + "l/" + this.name, JSON.stringify({ title: st.title, cat: st.cat, host: st.hostName, now: st.play.id ? st.play.title : "", count: 1 + this.remoteParticipants.size, ts: Date.now() }), true);
  }
  commit(st, r) {
    if (r && r.changed) { st.v = (this.state.v || 0) + 1; this.setState(st); this.publishState(); }
    for (const fx of (r && r.effects) || []) this.pub("x", fx);
  }
  setState(st) {
    const old = this.state; this.state = st; this.metadata = JSON.stringify(st);
    if (st.banned.includes(this.me.id)) return this.end(DisconnectReason.PARTICIPANT_REMOVED);
    if (roleOf(st, this.me.id) === "listener" && this.mic) this.setMic(false);
    this.emit(RoomEvent.RoomMetadataChanged, this.metadata);
    if (!old || JSON.stringify(old.roles) !== JSON.stringify(st.roles) || old.hostId !== st.hostId) this.ensurePeers();
  }

  onMsg(topic, msg) {
    if (this.closed || !topic.startsWith(this.P)) return;
    const k = topic.slice(this.P.length);
    if (k === "s") { const st = J(msg); if (st && st.app === "yanki" && (!this.state || st.v >= this.state.v)) this.setState(st); return; }
    if (k.startsWith("p/")) {
      const id = k.slice(2); if (id === this.me.id) return;
      const d = J(msg);
      const ex = this.remoteParticipants.get(id);
      if (!d) { if (ex) { this.remoteParticipants.delete(id); this.closePeer(id); this.emit(RoomEvent.ParticipantDisconnected, ex); } return; }
      if (Date.now() - d.hb > PRES_TTL) return;
      if (!ex) { const p = new P(d); this.remoteParticipants.set(id, p); this.emit(RoomEvent.ParticipantConnected, p); this.ensurePeers(); if (this.state && this.state.hostId === this.me.id) this.lobbyTick(true); }
      else { const b = JSON.stringify([ex.attributes, ex.isMicrophoneEnabled]); ex.upd(d); if (b !== JSON.stringify([ex.attributes, ex.isMicrophoneEnabled])) this.emit(RoomEvent.ParticipantAttributesChanged, {}, ex); }
      return;
    }
    const m = J(msg); if (!m) return;
    if (k === "d") { if (m.from !== this.me.id) this.emit(RoomEvent.DataReceived, enc.encode(m.text), this.remoteParticipants.get(m.from) || { name: m.name }, 0, m.topic); return; }
    if (k === "a") {
      if (!this.state || this.state.hostId !== this.me.id || m.from === this.me.id) return;
      const st = JSON.parse(JSON.stringify(this.state));
      try { this.commit(st, applyAction(st, this.memberRecs(), { id: m.from, name: m.fromName }, m, Date.now())); } catch {}
      return;
    }
    if (k === "x") {
      if (m.to !== this.me.id) return;
      if (m.t === "mute") { this.setMic(false); }
      if (m.t === "kick") this.end(DisconnectReason.PARTICIPANT_REMOVED);
      return;
    }
    if (k === "w/" + this.me.id) this.onRtc(m);
  }

  housekeeping() {
    const now = Date.now();
    for (const [id, p] of this.remoteParticipants) if (now - p.t > PRES_TTL) { this.remoteParticipants.delete(id); this.closePeer(id); this.emit(RoomEvent.ParticipantDisconnected, p); }
    const st = this.state; if (!st) return;
    // oda sahibi yoksa: herkes aynı varisi hesaplar, sadece o devralır
    const hostHere = st.hostId === this.me.id || this.remoteParticipants.has(st.hostId);
    if (hostHere) this.hostMissing = 0;
    else {
      this.hostMissing = this.hostMissing || now;
      if (now - this.hostMissing > 8000) {
        const heir = heirOf(st, this.memberRecs());
        if (heir && heir.identity === this.me.id) {
          const ns = JSON.parse(JSON.stringify(st));
          delete ns.roles[this.me.id]; ns.hostId = this.me.id; ns.hostName = this.me.name; ns.v = st.v + 1;
          this.setState(ns); this.publishState();
          this.pub("d", { from: this.me.id, name: this.me.name, topic: "sys", text: JSON.stringify({ text: `Oda sahibi ayrıldı. Yönetim ${this.me.name} kişisine geçti.` }) });
        }
        this.hostMissing = 0;
      }
    }
    this.lobbyTick(false);
    this.voiceWatchdog();
  }

  /* ---------- ses ---------- */
  onStage(id) { return this.state && roleOf(this.state, id) !== "listener"; }
  wantPeer(id) { return this.remoteParticipants.size < 10 || this.onStage(id) || this.onStage(this.me.id); }
  ensurePeers() {
    for (const id of this.remoteParticipants.keys()) {
      const want = this.wantPeer(id);
      if (want && !this.peers.has(id) && this.me.id < id) this.createPeer(id, true);
      if (!want && this.peers.has(id)) this.closePeer(id);
    }
  }
  voiceWatchdog() {
    const now = Date.now();
    for (const id of this.remoteParticipants.keys()) {
      if (this.me.id > id || !this.wantPeer(id)) continue;
      const p = this.peers.get(id);
      if (!p) this.createPeer(id, true);
      else if (p.pc.connectionState !== "connected" && now - p.created > 12000) { this.closePeer(id); this.createPeer(id, true); }
    }
  }
  rtc(to, k, d) { this.pub("w/" + to, { from: this.me.id, k, d }); }
  createPeer(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, sender: null, ice: [], created: Date.now() };
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => { if (e.candidate) this.rtc(id, "ice", e.candidate.toJSON()); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      let el = this.audioEls.get(id);
      if (!el) { el = document.createElement("audio"); el.autoplay = true; el.setAttribute("playsinline", ""); this.audioEls.set(id, el); }
      el.srcObject = stream;
      const track = { kind: "audio", attach: () => el, detach: () => [el] };
      peer.track = track;
      this.emit(RoomEvent.TrackSubscribed, track);
      el.play().catch(() => { this.canPlaybackAudio = false; this.emit(RoomEvent.AudioPlaybackStatusChanged); });
      this.addLevel(id, stream);
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") this.closePeer(id); };
    if (initiator) {
      const tr = pc.addTransceiver("audio", { direction: "sendrecv" });
      peer.sender = tr.sender; if (this.micTrack) tr.sender.replaceTrack(this.micTrack).catch(() => {});
      (async () => { try { const o = await pc.createOffer(); await pc.setLocalDescription(o); this.rtc(id, "offer", pc.localDescription.toJSON()); } catch (e) { console.warn(e); } })();
    }
    return peer;
  }
  closePeer(id) {
    const p = this.peers.get(id); if (!p) return;
    try { p.pc.close(); } catch {}
    if (p.track) this.emit(RoomEvent.TrackUnsubscribed, p.track);
    this.audioEls.delete(id); this.peers.delete(id); this.levels.delete(id);
  }
  async onRtc(m) {
    try {
      if (m.k === "offer") {
        if (this.peers.has(m.from)) this.closePeer(m.from);
        const peer = this.createPeer(m.from, false), pc = peer.pc;
        await pc.setRemoteDescription(m.d);
        const tr = pc.getTransceivers()[0];
        if (tr) { tr.direction = "sendrecv"; peer.sender = tr.sender; if (this.micTrack) await tr.sender.replaceTrack(this.micTrack); }
        const a = await pc.createAnswer(); await pc.setLocalDescription(a);
        this.rtc(m.from, "answer", pc.localDescription.toJSON());
        for (const c of peer.ice.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (m.k === "answer") {
        const peer = this.peers.get(m.from); if (!peer || peer.pc.signalingState !== "have-local-offer") return;
        await peer.pc.setRemoteDescription(m.d);
        for (const c of peer.ice.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
      } else if (m.k === "ice") {
        const peer = this.peers.get(m.from); if (!peer) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(m.d).catch(() => {}); else peer.ice.push(m.d);
      }
    } catch (e) { console.warn("rtc", e); }
  }
  async setMic(on) {
    if (on) {
      if (!this.state || roleOf(this.state, this.me.id) === "listener") throw new Error("Yetki yok");
      if (!this.micTrack) {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        this.micTrack = this.micStream.getAudioTracks()[0];
        this.addLevel(this.me.id, this.micStream);
        for (const p of this.peers.values()) if (p.sender) p.sender.replaceTrack(this.micTrack).catch(() => {});
      }
    }
    if (this.micTrack) this.micTrack.enabled = on;
    this.mic = on; this.localParticipant.isMicrophoneEnabled = on;
    this.presence();
    this.emit(on ? RoomEvent.LocalTrackPublished : RoomEvent.LocalTrackUnpublished);
  }
  ctx() { if (!this.ac) { try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (this.ac && this.ac.state === "suspended") this.ac.resume().catch(() => {}); return this.ac; }
  addLevel(id, stream) { const ac = this.ctx(); if (!ac) return; try { const s = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 512; s.connect(an); this.levels.set(id, { an, buf: new Uint8Array(an.frequencyBinCount) }); } catch {} }
  speakers() {
    const out = [];
    for (const [id, l] of this.levels) {
      l.an.getByteFrequencyData(l.buf); let s = 0; for (let i = 0; i < l.buf.length; i++) s += l.buf[i];
      if (s / l.buf.length > 14 && (id !== this.me.id || this.mic)) out.push(id === this.me.id ? this.localParticipant : this.remoteParticipants.get(id) || { identity: id });
    }
    const key = out.map((p) => p.identity).sort().join(",");
    if (key !== this.lastSpk) { this.lastSpk = key; this.emit(RoomEvent.ActiveSpeakersChanged, out); }
  }
  async startAudio() {
    this.ctx(); let ok = true;
    for (const el of this.audioEls.values()) { try { await el.play(); } catch { ok = false; } }
    this.canPlaybackAudio = ok;
  }

  end(reason) { if (this.closed) return; this.cleanup(); this.emit(RoomEvent.Disconnected, reason); }
  cleanup() {
    if (this.closed) return; this.closed = true;
    (this.timers || []).forEach(clearInterval);
    removeEventListener("pagehide", this.unload);
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    if (this.mq) {
      this.pub("p/" + this.me.id, "", true);
      if (this.state && this.state.hostId === this.me.id && this.remoteParticipants.size === 0) { lobby.publish(PFX + "l/" + this.name, "", true); }
      const mq = this.mq; setTimeout(() => mq.close(), 300);
    }
    if (current === this) current = null;
  }
  async disconnect() { this.cleanup(); }
}
// join yanıtındaki ilk durumu odaya aktar (oda sahibi ilk yayını yapabilsin)
const origFetch = window.fetch;
window.fetch = async (input, init) => {
  const r = await origFetch(input, init);
  const u = typeof input === "string" ? input : input.url;
  if (u.endsWith("/api/join") && r.ok) { const j = await r.clone().json(); window.__ykInitialState = j.initial; }
  return r;
};
window.LivekitClient = { Room, RoomEvent, DisconnectReason };

addEventListener("DOMContentLoaded", () => {
  const d = document.createElement("div");
  d.className = "demo-banner";
  d.innerHTML = "🧪 <b>Deneme sürümü</b> · Hesapsız, farklı telefonlardan girilebilir. Küçük odalar için (≈10 kişi).";
  document.body.prepend(d);
});
})();
