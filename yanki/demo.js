/* Yankı — DENEME MODU
 * Sunucu (Vercel /api) ve LiveKit'i tarayıcının içinde taklit eder.
 * Aynı tarayıcıdaki sekmeler aynı "sunucuyu" paylaşır (localStorage + BroadcastChannel).
 * Gerçek ses yok; mikrofon sadece durum olarak gösterilir.
 */
(() => {
"use strict";
const bus = new BroadcastChannel("yanki-demo");
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
const rnd = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const unb64 = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
const tok = (o) => `x.${b64(o)}.demo`;
const read = (t) => { try { const p = unb64(String(t).split(".")[1]); return p.exp && p.exp * 1000 < Date.now() ? null : p; } catch { return null; } };
const HB_TTL = 8000;

/* ---------- "sunucu" deposu ---------- */
const rooms = () => LS.get("yd_rooms", {});
const saveRooms = (r) => LS.set("yd_rooms", r);
function parts(room) {
  const all = LS.get("yd_parts_" + room, {}), now = Date.now(); let pruned = false;
  for (const k in all) if (now - all[k].hb > HB_TTL) { delete all[k]; pruned = true; }
  if (pruned) LS.set("yd_parts_" + room, all);
  return all;
}
const saveParts = (room, p) => { LS.set("yd_parts_" + room, p); bus.postMessage({ t: "parts", room }); };
function getState(room) { const r = rooms()[room]; return r ? JSON.parse(r.metadata) : null; }
function saveState(room, st) { st.v = (st.v || 0) + 1; const r = rooms(); r[room].metadata = JSON.stringify(st); saveRooms(r); bus.postMessage({ t: "meta", room }); return st; }

const roleOf = (st, id) => (id === st.hostId ? "host" : st.roles[id] || "listener");
const isCtl = (r) => ["host", "mod", "dj"].includes(r), isMgr = (r) => ["host", "mod"].includes(r);
const curPos = (p, t) => (p.id ? p.pos + (p.playing ? (t - p.at) / 1000 : 0) : 0);
class Fail extends Error { constructor(c, m) { super(m); this.code = c; } }
const fail = (c, m) => { throw new Fail(c, m); };
const ROLES = ["mod", "dj", "speaker", "listener"];

const API = {
  config: () => ({ ready: true, allowGuest: true, supabaseUrl: "", livekitUrl: "demo", maxRoom: 250, demo: true }),
  session(b) {
    const name = String(b.guestName || "").trim().slice(0, 20); if (!name) fail(400, "İsim gerekli");
    const user = { id: "g_" + rnd(6), name: name + " (misafir)", avatar: "" };
    return { session: tok({ sub: user.id, name: user.name, exp: Math.floor(Date.now() / 1000) + 43200 }), user };
  },
  rooms() {
    const out = [];
    for (const [name, r] of Object.entries(rooms())) {
      const st = JSON.parse(r.metadata), n = Object.keys(parts(name)).length;
      if (!n) { if (Date.now() - r.created > 30000) { const all = rooms(); delete all[name]; saveRooms(all); } continue; }
      out.push({ id: name, title: st.title, cat: st.cat, host: st.hostName, now: st.play.id ? st.play.title : "", count: n });
    }
    return { rooms: out.sort((a, b) => b.count - a.count) };
  },
  join(b) {
    const u = read(b.session); if (!u) fail(401, "Oturum geçersiz");
    let name, st;
    if (b.create) {
      name = "oda-" + rnd(4);
      st = { app: "yanki", v: 1, title: String(b.create.title || "Oda").slice(0, 40), cat: b.create.cat || "sohbet", hostId: u.sub, hostName: u.name, roles: {}, banned: [], queue: [], play: { id: null, title: "", playing: false, pos: 0, at: Date.now() } };
      const r = rooms(); r[name] = { metadata: JSON.stringify(st), created: Date.now() }; saveRooms(r);
    } else {
      name = String(b.room || ""); st = getState(name);
      if (!st) fail(404, "Oda bulunamadı ya da kapanmış");
      if (st.banned.includes(u.sub)) fail(403, "Bu odadan çıkarıldın");
    }
    const canPublish = roleOf(st, u.sub) !== "listener";
    return { room: name, url: "demo", token: tok({ sub: u.sub, name: u.name, room: name, canPublish, exp: Math.floor(Date.now() / 1000) + 21600 }), state: st, serverNow: Date.now(), me: { id: u.sub, name: u.name } };
  },
  action(b) {
    const u = read(b.session); if (!u) fail(401, "Oturum geçersiz");
    const name = String(b.room || ""), st = getState(name); if (!st) fail(404, "Oda yok");
    const me = roleOf(st, u.sub), t = Date.now();
    const needCtl = () => { if (!isCtl(me)) fail(403, "Bunu sadece oda sahibi, yardımcı ya da DJ yapabilir"); };
    const needMgr = () => { if (!isMgr(me)) fail(403, "Bunu sadece oda sahibi ya da yardımcı yapabilir"); };
    const freeze = () => { st.play.pos = curPos(st.play, t); st.play.at = t; };
    const next = () => { const n = st.queue.shift(); st.play = n ? { id: n.id, title: n.title, playing: true, pos: 0, at: t } : { id: null, title: "", playing: false, pos: 0, at: t }; };
    const target = String(b.target || ""), tRole = target ? roleOf(st, target) : null;
    const canTouch = () => { needMgr(); if (!target || target === u.sub) fail(400, "Geçersiz kişi"); if (tRole === "host") fail(403, "Oda sahibine dokunamazsın"); if (me === "mod" && tRole === "mod") fail(403, "Yardımcılar birbirine dokunamaz"); };
    const setPublish = (id, can) => { const p = parts(name); if (p[id]) { p[id].canPublish = can; if (!can) p[id].mic = false; saveParts(name, p); } };
    const ok = (extra) => ({ ok: true, state: st, serverNow: t, ...extra });
    switch (b.action) {
      case "toggle": needCtl(); freeze(); st.play.playing = !st.play.playing; break;
      case "seek": needCtl(); if (!st.play.id) break; st.play.pos = Math.max(0, +b.pos || 0); st.play.at = t; break;
      case "add": {
        needCtl(); const id = String(b.id || ""); if (!/^[\w-]{11}$/.test(id)) fail(400, "Geçersiz video");
        const item = { id, title: String(b.title || "YouTube videosu").slice(0, 120), by: u.name };
        if (!st.play.id) st.play = { id, title: item.title, playing: true, pos: 0, at: t }; else st.queue.push(item);
        break;
      }
      case "remove": needCtl(); st.queue.splice(+b.index, 1); break;
      case "skip": needCtl(); next(); break;
      case "ended": if (st.play.id !== b.id || t - st.play.at < 15000) return ok({ skipped: true }); next(); break;
      case "title": needCtl(); if (st.play.id === b.id) st.play.title = String(b.title || "").slice(0, 120); break;
      case "role": {
        canTouch(); const r = String(b.role); if (!ROLES.includes(r)) fail(400, "Geçersiz rol");
        if (r === "mod" && me !== "host") fail(403, "Yardımcıyı sadece oda sahibi atar");
        if (r === "listener") delete st.roles[target]; else st.roles[target] = r;
        setPublish(target, r !== "listener"); break;
      }
      case "mute": { canTouch(); const p = parts(name); if (p[target]) { p[target].mic = false; saveParts(name, p); } return ok(); }
      case "kick": {
        canTouch(); delete st.roles[target]; if (!st.banned.includes(target)) st.banned.push(target);
        saveState(name, st); const p = parts(name); delete p[target]; saveParts(name, p);
        bus.postMessage({ t: "removed", room: name, to: target }); return ok();
      }
      case "host":
        if (me !== "host") fail(403, "Sadece oda sahibi devredebilir"); if (!target || target === u.sub) fail(400, "Geçersiz kişi");
        delete st.roles[target]; st.roles[u.sub] = "mod"; st.hostId = target; st.hostName = String(b.targetName || "").slice(0, 30) || st.hostName;
        setPublish(target, true); break;
      case "claim": {
        const ps = Object.values(parts(name));
        if (ps.some((p) => p.identity === st.hostId)) return ok({ skipped: true });
        const order = (p) => ({ mod: 0, dj: 1, speaker: 2 }[st.roles[p.identity]] ?? 3);
        const heir = ps.filter((p) => !st.banned.includes(p.identity)).sort((a, c) => order(a) - order(c) || a.joinedAt - c.joinedAt)[0];
        if (!heir) return ok({ skipped: true });
        delete st.roles[heir.identity]; st.hostId = heir.identity; st.hostName = heir.name; setPublish(heir.identity, true); break;
      }
      default: fail(400, "Bilinmeyen işlem");
    }
    saveState(name, st);
    return ok();
  },
};

/* ---------- fetch yönlendirme ---------- */
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) {
    const fn = API[url.pathname.slice(5)];
    let b = {}; try { b = init && init.body ? JSON.parse(init.body) : {}; } catch {}
    const res = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { "Content-Type": "application/json" } });
    if (!fn) return res(404, { error: "yok" });
    try { return res(200, fn(b)); } catch (e) { return res(e.code || 500, { error: e.message }); }
  }
  return realFetch(input, init);
};

/* ---------- sahte LiveKit ---------- */
const RoomEvent = { ParticipantConnected: "pc", ParticipantDisconnected: "pd", ParticipantAttributesChanged: "pa", TrackMuted: "tm", TrackUnmuted: "tu", LocalTrackPublished: "ltp", LocalTrackUnpublished: "ltu", TrackPublished: "tp", TrackUnpublished: "tun", ParticipantMetadataChanged: "pm", RoomMetadataChanged: "rm", ActiveSpeakersChanged: "as", TrackSubscribed: "ts", TrackUnsubscribed: "tus", AudioPlaybackStatusChanged: "aps", ParticipantPermissionsChanged: "pp", DataReceived: "dr", Disconnected: "dc" };
const DisconnectReason = { CLIENT_INITIATED: 1, PARTICIPANT_REMOVED: 4 };
class P { constructor(d) { this.upd(d); } upd(d) { this.identity = d.identity; this.name = d.name; this.metadata = d.metadata || "{}"; this.attributes = { ...d.attributes }; this.joinedAt = new Date(d.joinedAt); this.isMicrophoneEnabled = !!d.mic; } }
class Room {
  constructor() { this.h = {}; this.remoteParticipants = new Map(); this.canPlaybackAudio = true; this.metadata = ""; }
  on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
  emit(e, ...a) { (this.h[e] || []).forEach((f) => { try { f(...a); } catch (err) { console.error(err); } }); }
  async connect(_url, token) {
    const g = read(token); if (!g) throw new Error("Geçersiz anahtar");
    this.g = g; this.name = g.room;
    const p = parts(g.room);
    p[g.sub] = { identity: g.sub, name: g.name, metadata: "{}", attributes: {}, joinedAt: Date.now(), mic: false, canPublish: g.canPublish, hb: Date.now() };
    saveParts(g.room, p);
    const self = this;
    this.localParticipant = new P(p[g.sub]);
    const mine = (fn) => { const all = parts(g.room); if (!all[g.sub]) return; fn(all[g.sub]); all[g.sub].hb = Date.now(); saveParts(g.room, all); };
    Object.assign(this.localParticipant, {
      async setMicrophoneEnabled(on) {
        const all = parts(g.room); if (on && !(all[g.sub] && all[g.sub].canPublish)) throw new Error("Yetki yok");
        mine((x) => { x.mic = on; }); self.localParticipant.isMicrophoneEnabled = on;
        self.emit(on ? RoomEvent.LocalTrackPublished : RoomEvent.LocalTrackUnpublished);
      },
      async setAttributes(a) { mine((x) => Object.assign(x.attributes, a)); Object.assign(self.localParticipant.attributes, a); self.emit(RoomEvent.ParticipantAttributesChanged, a, self.localParticipant); },
      async publishData(data, opt) { bus.postMessage({ t: "data", room: g.room, from: g.sub, name: g.name, topic: opt.topic, payload: Array.from(data) }); },
    });
    this.onBus = (e) => {
      const m = e.data; if (!m || m.room !== g.room) return;
      if (m.t === "data") { const rp = this.remoteParticipants.get(m.from); this.emit(RoomEvent.DataReceived, new Uint8Array(m.payload), rp || { name: m.name }, 0, m.topic); }
      else if (m.t === "removed" && m.to === g.sub) this.end(DisconnectReason.PARTICIPANT_REMOVED);
      else this.refresh();
    };
    bus.addEventListener("message", this.onBus);
    this.hbT = setInterval(() => { mine(() => {}); this.refresh(); }, 2000);
    this.unload = () => this.disconnect();
    addEventListener("pagehide", this.unload);
    this.refresh();
  }
  refresh() {
    if (this.closed) return;
    const g = this.g, all = parts(g.room), meRec = all[g.sub];
    if (!meRec) { const st = getState(g.room); return this.end(st && st.banned.includes(g.sub) ? DisconnectReason.PARTICIPANT_REMOVED : DisconnectReason.CLIENT_INITIATED); }
    const lp = this.localParticipant, before = lp.isMicrophoneEnabled;
    lp.joinedAt = new Date(meRec.joinedAt); lp.isMicrophoneEnabled = meRec.mic;
    if (before !== lp.isMicrophoneEnabled) this.emit(RoomEvent.TrackMuted);
    const seen = new Set();
    for (const d of Object.values(all)) {
      if (d.identity === g.sub) continue; seen.add(d.identity);
      const ex = this.remoteParticipants.get(d.identity);
      if (!ex) { const p = new P(d); this.remoteParticipants.set(d.identity, p); this.emit(RoomEvent.ParticipantConnected, p); }
      else { const b = JSON.stringify([ex.attributes, ex.isMicrophoneEnabled]); ex.upd(d); if (b !== JSON.stringify([ex.attributes, ex.isMicrophoneEnabled])) this.emit(RoomEvent.ParticipantAttributesChanged, {}, ex); }
    }
    for (const [k, p] of this.remoteParticipants) if (!seen.has(k)) { this.remoteParticipants.delete(k); this.emit(RoomEvent.ParticipantDisconnected, p); }
    const r = rooms()[g.room];
    if (r && r.metadata !== this.metadata) { this.metadata = r.metadata; this.emit(RoomEvent.RoomMetadataChanged, r.metadata); }
    this.emit(RoomEvent.ActiveSpeakersChanged, [lp, ...this.remoteParticipants.values()].filter((p) => p.isMicrophoneEnabled));
  }
  end(reason) { if (this.closed) return; this.cleanup(); this.emit(RoomEvent.Disconnected, reason); }
  cleanup() { this.closed = true; clearInterval(this.hbT); bus.removeEventListener("message", this.onBus); removeEventListener("pagehide", this.unload); }
  async startAudio() {}
  async disconnect() {
    if (this.closed) return; this.cleanup();
    const all = parts(this.g.room); delete all[this.g.sub]; saveParts(this.g.room, all);
  }
}
window.LivekitClient = { Room, RoomEvent, DisconnectReason };

/* ---------- deneme modu şeridi ---------- */
addEventListener("DOMContentLoaded", () => {
  const d = document.createElement("div");
  d.className = "demo-banner";
  d.innerHTML = "🧪 <b>Deneme modu</b> · Aynı tarayıcıda 2. sekme açıp başka kullanıcı ol. Sesli konuşma gerçek sürümde.";
  document.body.prepend(d);
});
})();
