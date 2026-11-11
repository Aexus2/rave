/* Yankı v2 — 250 kişilik sesli odalar + senkron YouTube
 * Giriş: Supabase Auth (Google, X)   Ses + anlık veri: LiveKit   Yetki: Vercel /api
 */
(() => {
"use strict";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
};
const CATS = [
  { id: "sohbet", label: "💬 Sohbet" }, { id: "muzik", label: "🎧 Müzik" }, { id: "film", label: "🎬 Film / Video" },
  { id: "gece", label: "🌙 Gece vardiyası" }, { id: "oyun", label: "🎮 Oyun" },
];
const catLabel = (id) => (CATS.find((c) => c.id === id) || CATS[0]).label;
const ROLE_TR = { host: "Oda sahibi", mod: "Yardımcı", dj: "DJ", speaker: "Konuşmacı", listener: "Dinleyici" };
const ROLE_ORDER = { host: 0, mod: 1, dj: 2, speaker: 3, listener: 4 };
const LISTENER_RENDER_LIMIT = 120;

let CFG = null, sb = null, session = store.get("oda_session"), me = JSON.parse(store.get("oda_me") || "null");

/* ---------------- yardımcılar ---------------- */
function color(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 60% 45%)`; }
function initials(n) { return esc((n || "?").replace(/\(misafir\)/, "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()); }
function avatar(id, name, url) {
  const fb = `<div class="av" style="background:${color(id)}">${initials(name)}</div>`;
  if (!url) return fb;
  return `<img class="av" src="${esc(url)}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML=this.dataset.fb" data-fb="${esc(fb)}">`;
}
let toastT;
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add("hidden"), 2800); }
function show(id) { ["#login", "#lobby", "#room"].forEach((s) => $(s).classList.toggle("hidden", s !== id)); }
function modal(id, on) { $(id).classList.toggle("hidden", !on); }
document.querySelectorAll(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) m.classList.add("hidden"); }));

async function api(path, data) {
  const r = await fetch(path, data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session, ...data }) } : {});
  let j = {}; try { j = await r.json(); } catch {}
  if (r.status === 401 && data) { logout(true); throw new Error(j.error || "Oturum süresi doldu"); }
  if (!r.ok) throw new Error(j.error || "Bağlantı hatası");
  return j;
}
function sessionValid(tok) {
  try { const p = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p.exp * 1000 > Date.now() + 60000; } catch { return false; }
}
function parseYouTube(s) {
  s = (s || "").trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1, 12);
    if (u.searchParams.get("v")) return u.searchParams.get("v").slice(0, 11);
    const m = u.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return m[2];
  } catch {}
  return null;
}
async function ytTitle(id) {
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 3000);
    const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id), { signal: ctl.signal });
    if (r.ok) return (await r.json()).title;
  } catch {}
  return "YouTube videosu";
}
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/* ---------------- GİRİŞ ---------------- */
async function boot() {
  const hm = location.hash.match(/^#r-([a-z0-9-]+)$/);
  if (hm) store.set("oda_pending", hm[1]);
  try { CFG = await (await fetch("/api/config")).json(); } catch { CFG = { ready: false }; }
  if (!CFG.ready) {
    show("#login");
    $("#setupWarn").classList.remove("hidden");
    $("#setupWarn").textContent = "Sunucu ayarları eksik: Vercel'de LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET ortam değişkenlerini gir (README'ye bak).";
    return;
  }
  $("#guestBtn").classList.toggle("hidden", !CFG.allowGuest);
  if (CFG.supabaseUrl && window.supabase) {
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } });
  }
  $("#googleBtn").disabled = $("#xBtn").disabled = !sb;
  if (session && sessionValid(session) && me) return afterLogin();
  if (sb) {
    const { data } = await sb.auth.getSession();
    if (data && data.session) return exchange({ supabaseToken: data.session.access_token });
  }
  show("#login");
}
async function exchange(payload) {
  try {
    const r = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    session = j.session; me = j.user;
    store.set("oda_session", session); store.set("oda_me", JSON.stringify(me));
    afterLogin();
  } catch (e) { show("#login"); toast("Giriş yapılamadı: " + e.message); }
}
function afterLogin() {
  try { history.replaceState(null, "", location.pathname); } catch {}
  const pending = store.get("oda_pending"); store.set("oda_pending", null);
  startLobby();
  if (pending) joinRoom({ room: pending }); else show("#lobby");
}
async function oauth(provider) {
  if (!sb) return toast("Supabase ayarlı değil");
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } });
  if (error) toast(error.message);
}
$("#googleBtn").addEventListener("click", () => oauth("google"));
$("#xBtn").addEventListener("click", () => oauth("x"));
$("#guestBtn").addEventListener("click", () => { modal("#nameModal", true); setTimeout(() => $("#nameInput").focus(), 50); });
$("#nameForm").addEventListener("submit", (e) => { e.preventDefault(); modal("#nameModal", false); exchange({ guestName: $("#nameInput").value }); });
async function logout(expired) {
  if (lk) await leaveRoom(true);
  session = null; me = null; store.set("oda_session", null); store.set("oda_me", null);
  stopLobby();
  if (sb) await sb.auth.signOut().catch(() => {});
  show("#login");
  if (expired) toast("Oturum süresi doldu, tekrar giriş yap.");
}

/* ---------------- LOBİ ---------------- */
let lobbyTimer = null, lobbyRooms = [], catFilter = "hepsi";
function startLobby() { stopLobby(); refreshLobby(); lobbyTimer = setInterval(() => { if (!$("#lobby").classList.contains("hidden")) refreshLobby(); }, 8000); renderLobby(); }
function stopLobby() { clearInterval(lobbyTimer); lobbyTimer = null; }
async function refreshLobby() { try { lobbyRooms = (await api("/api/rooms")).rooms || []; } catch {} renderLobby(); }
function renderLobby() {
  $("#meBtn").innerHTML = me ? avatar(me.id, me.name, me.avatar) : "";
  const total = lobbyRooms.reduce((a, r) => a + r.count, 0);
  $("#onlineCount").textContent = `${total} kişi odalarda`;
  $("#filters").innerHTML = [{ id: "hepsi", label: "Hepsi" }, ...CATS].map((c) => `<button class="chip ${catFilter === c.id ? "on" : ""}" data-cat="${c.id}">${c.label}</button>`).join("");
  const rooms = lobbyRooms.filter((r) => catFilter === "hepsi" || r.cat === catFilter);
  $("#roomList").innerHTML = rooms.length ? rooms.map((r) => `
    <div class="room-card" data-room="${esc(r.id)}">
      <div class="rc-top"><span>${catLabel(r.cat)}</span><span class="live">● CANLI</span></div>
      <div class="rc-title">${esc(r.title)}</div>
      ${r.now ? `<div class="rc-now">▶ ${esc(r.now)}</div>` : ""}
      <div class="rc-people"><span>👥 ${r.count} kişi · ${esc(r.host)} açtı</span></div>
    </div>`).join("")
    : `<div class="empty"><div class="big-emoji">🌙</div><div>Şu an açık oda yok.</div><div class="small">İlk odayı sen aç, diğerleri gelsin.</div></div>`;
}
$("#filters").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) { catFilter = b.dataset.cat; renderLobby(); } });
$("#roomList").addEventListener("click", (e) => { const c = e.target.closest("[data-room]"); if (c) joinRoom({ room: c.dataset.room }); });
$("#meBtn").addEventListener("click", () => {
  $("#actionSheet").innerHTML = `
    <div class="act-head">${avatar(me.id, me.name, me.avatar)}<div><div style="font-weight:600">${esc(me.name)}</div><div class="muted small">${me.id.startsWith("g_") ? "Misafir hesabı" : "Giriş yapıldı"}</div></div></div>
    <div class="act-list"><button class="btn danger" id="logoutBtn">Çıkış yap</button><button class="btn ghost" data-close>Kapat</button></div>`;
  $("#actionSheet").onclick = (e) => { if (e.target.id === "logoutBtn") { modal("#actionModal", false); logout(); } };
  modal("#actionModal", true);
});
let pickedCat = "sohbet";
$("#createBtn").addEventListener("click", () => {
  $("#catPicker").innerHTML = CATS.map((c) => `<button type="button" class="chip ${pickedCat === c.id ? "on" : ""}" data-c="${c.id}">${c.label}</button>`).join("");
  $("#roomTitle").value = ""; modal("#createModal", true); setTimeout(() => $("#roomTitle").focus(), 50);
});
$("#catPicker").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; pickedCat = b.dataset.c; $("#catPicker").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b)); });
$("#createForm").addEventListener("submit", (e) => {
  e.preventDefault(); modal("#createModal", false);
  joinRoom({ create: { title: $("#roomTitle").value.trim() || "Oda", cat: pickedCat } });
});

/* ---------------- ODA ---------------- */
const LK = () => window.LivekitClient;
let lk = null, roomName = null, state = null, offset = 0, joining = false;
let player = null, playerReady = false, loadedId = null, unlocked = false, localMuted = false, ytFailed = false;
const speaking = new Set();
let timers = [], lastReact = 0, chatUnread = 0;

const roleOf = (id) => (!state ? "listener" : id === state.hostId ? "host" : state.roles[id] || "listener");
const myRole = () => roleOf(me.id);
const canControl = (r = myRole()) => ["host", "mod", "dj"].includes(r);
const canManage = (r = myRole()) => ["host", "mod"].includes(r);
const canSpeak = (r = myRole()) => r !== "listener";
const serverNow = () => Date.now() + offset;
function expectedPos() { const p = state && state.play; return !p || !p.id ? 0 : p.pos + (p.playing ? (serverNow() - p.at) / 1000 : 0); }

function members() {
  if (!lk) return [];
  const list = [lk.localParticipant, ...lk.remoteParticipants.values()];
  return list.map((p) => {
    let md = {}; try { md = JSON.parse(p.metadata || "{}"); } catch {}
    return { id: p.identity, name: p.name || p.identity, avatar: md.avatar, hand: !!(p.attributes && p.attributes.hand), mic: p.isMicrophoneEnabled, joinedAt: p.joinedAt ? +p.joinedAt : 0, local: p === lk.localParticipant };
  });
}
// Kalabalık odada her işi herkes yapmasın: sadece en eski 3 kişi "nöbetçi"
function isSentinel() {
  const ms = members().sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  return ms.slice(0, 3).some((m) => m.id === me.id) || canControl();
}

async function joinRoom(req) {
  if (joining) return; joining = true;
  if (lk) await leaveRoom(true);
  show("#room");
  $("#roomTitleText").textContent = "Bağlanıyor…"; $("#roomSub").textContent = "";
  $("#stage").innerHTML = `<div class="muted small">Odaya bağlanılıyor…</div>`; $("#listeners").innerHTML = "";
  $("#chatList").innerHTML = ""; $("#chat").classList.add("hidden");
  try {
    if (!LK()) throw new Error("Ses kütüphanesi yüklenemedi");
    const t0 = Date.now();
    const j = await api("/api/join", req);
    offset = j.serverNow - Math.round((t0 + Date.now()) / 2);
    roomName = j.room; state = j.state;
    const L = LK();
    lk = new L.Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    wireRoom(L);
    await lk.connect(j.url, j.token);
    try { history.replaceState(null, "", "#r-" + roomName); } catch {}
    unlocked = false; loadedId = null; speaking.clear();
    $("#unlockBtn").classList.remove("hidden");
    sysMsg(req.create ? "Odayı açtın. 🔗 ile linki paylaş, millet gelsin." : "Odaya girdin.");
    loadYT();
    timers.push(setInterval(syncPlayer, 1000));
    timers.push(setInterval(hostWatch, 6000));
    renderRoom();
  } catch (e) {
    toast(e.message || "Odaya girilemedi");
    if (lk) { try { await lk.disconnect(); } catch {} lk = null; }
    show("#lobby"); refreshLobby();
  } finally { joining = false; }
}

function wireRoom(L) {
  const E = L.RoomEvent;
  const rr = () => scheduleRender();
  lk.on(E.ParticipantConnected, rr).on(E.ParticipantDisconnected, rr).on(E.ParticipantAttributesChanged, rr)
    .on(E.TrackMuted, rr).on(E.TrackUnmuted, rr).on(E.LocalTrackPublished, rr).on(E.LocalTrackUnpublished, rr)
    .on(E.TrackPublished, rr).on(E.TrackUnpublished, rr).on(E.ParticipantMetadataChanged, rr);
  lk.on(E.RoomMetadataChanged, (md) => { try { adopt(JSON.parse(md)); } catch {} });
  lk.on(E.ActiveSpeakersChanged, (sp) => {
    speaking.clear(); sp.forEach((p) => speaking.add(p.identity));
    document.querySelectorAll(".person").forEach((el) => el.classList.toggle("speaking", speaking.has(el.dataset.uid)));
  });
  lk.on(E.TrackSubscribed, (track) => { if (track.kind === "audio") { const el = track.attach(); $("#audios").appendChild(el); } });
  lk.on(E.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));
  lk.on(E.AudioPlaybackStatusChanged, () => { if (!lk.canPlaybackAudio) $("#unlockBtn").classList.remove("hidden"); });
  lk.on(E.ParticipantPermissionsChanged, (_prev, p) => { if (p === lk.localParticipant) scheduleRender(); });
  lk.on(E.DataReceived, (payload, participant, _kind, topic) => {
    let m; try { m = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }
    const name = participant ? participant.name : "?";
    if (topic === "chat") addChat(name, m.text);
    else if (topic === "react") floatEmoji(m.e, name);
    else if (topic === "sys") sysMsg(m.text);
  });
  lk.on(E.Disconnected, (reason) => {
    const removed = L.DisconnectReason && reason === L.DisconnectReason.PARTICIPANT_REMOVED;
    if (lk) { cleanupRoom(); show("#lobby"); refreshLobby(); toast(removed ? "Odadan çıkarıldın." : "Oda bağlantısı kapandı."); }
  });
}

function adopt(st) {
  if (!st || st.app !== "yanki" || (state && st.v < state.v)) return;
  const old = state ? myRole() : null;
  state = st;
  const nr = myRole();
  if (state.banned.includes(me.id)) return;
  if (old && old !== nr) {
    toast(`Rolün: ${ROLE_TR[nr]}`);
    if (nr !== "listener") setHand(false);
    if (nr === "listener" && lk.localParticipant.isMicrophoneEnabled) lk.localParticipant.setMicrophoneEnabled(false).catch(() => {});
  }
  renderRoom(); syncPlayer(true);
}
async function act(action, extra) {
  try { const j = await api("/api/action", { room: roomName, action, ...extra }); if (j.state) adopt(j.state); return j; }
  catch (e) { toast(e.message); }
}
let hostMissingSince = 0, hostJitter = 0;
async function hostWatch() {
  if (!state || !lk) return;
  if (members().some((m) => m.id === state.hostId)) { hostMissingSince = 0; return; }
  if (!hostMissingSince) { hostMissingSince = Date.now(); hostJitter = 15000 + Math.random() * 15000; }
  // önce en eski 3 kişi dener; olmazsa 15-30 sn sonra herhangi biri (sunucu tek kişiyi seçer)
  if (isSentinel() || Date.now() - hostMissingSince > hostJitter) {
    const j = await act("claim");
    if (j && !j.skipped) sendData("sys", { text: `Oda sahibi ayrıldı. Yönetim ${state.hostName} kişisine geçti.` }, true);
  }
}
function cleanupRoom() {
  timers.forEach(clearInterval); timers = [];
  try { player && player.stopVideo(); } catch {}
  loadedId = null; state = null; roomName = null; lk = null;
  $("#audios").innerHTML = "";
  try { history.replaceState(null, "", location.pathname); } catch {}
}
async function leaveRoom(silent) {
  const r = lk; cleanupRoom();
  if (r) { try { await r.disconnect(); } catch {} }
  if (!silent) { show("#lobby"); refreshLobby(); }
}
function sendData(topic, obj, alsoLocal) {
  if (!lk) return;
  lk.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(obj)), { reliable: true, topic }).catch(() => {});
  if (alsoLocal && topic === "sys") sysMsg(obj.text);
}

/* ---------------- Oda arayüzü ---------------- */
let renderQueued = false;
function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderRoom(); }); }
function renderRoom() {
  if (!lk || !state) return;
  const st = state, ctl = canControl(), mgr = canManage(), r = myRole();
  const ms = members();
  $("#roomTitleText").textContent = st.title;
  $("#roomSub").textContent = `${catLabel(st.cat)} · ${ms.length} kişi`;

  const p = st.play;
  $("#playerEmpty").classList.toggle("hidden", !!p.id && !ytFailed);
  $("#emptyHint").textContent = ytFailed ? "YouTube yüklenemedi." : ctl ? "Aşağıdan bir YouTube linki ekle." : "Oda sahibi ya da DJ bir şey açınca burada başlayacak.";
  $("#nowTitle").textContent = p.id ? `${p.playing ? "▶" : "❚❚"} ${p.title}` : "";
  $("#controls").classList.toggle("hidden", !ctl || !p.id);
  $("#seek").classList.toggle("hidden", !ctl || !p.id);
  $("#playBtn").textContent = p.playing ? "❚❚" : "▶";
  $("#addForm").classList.toggle("hidden", !ctl);
  $("#queueCount").textContent = st.queue.length ? `${st.queue.length} video` : "";
  $("#queue").innerHTML = st.queue.length ? st.queue.map((q, i) => `
    <div class="q-item"><img src="${thumb(q.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div style="flex:1;min-width:0"><div class="q-t">${esc(q.title)}</div><div class="q-by">${esc(q.by)} ekledi</div></div>
      ${ctl ? `<button class="q-x" data-qi="${i}" title="Sıradan çıkar">✕</button>` : ""}</div>`).join("") : `<div class="muted small">Sıra boş.</div>`;

  const people = ms.map((m) => ({ ...m, role: roleOf(m.id) }));
  const stage = people.filter((x) => x.role !== "listener").sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt - b.joinedAt);
  const lis = people.filter((x) => x.role === "listener").sort((a, b) => (b.hand - a.hand) || (b.local - a.local) || a.joinedAt - b.joinedAt);
  const card = (x) => `
    <div class="person ${speaking.has(x.id) ? "speaking" : ""}" data-uid="${esc(x.id)}">
      ${x.hand ? `<span class="hand">✋</span>` : ""}
      ${avatar(x.id, x.name, x.avatar)}
      ${x.role !== "listener" ? `<span class="badge">${x.mic ? "🎙️" : "🔇"}</span>` : ""}
      <div class="nm">${esc(x.name)}${x.local ? " (sen)" : ""}</div>
      <div class="rl">${x.role !== "listener" ? ROLE_TR[x.role] : ""}</div>
    </div>`;
  $("#stage").innerHTML = stage.map(card).join("") || `<div class="muted small">Sahnede kimse yok.</div>`;
  $("#listeners").innerHTML = lis.slice(0, LISTENER_RENDER_LIMIT).map(card).join("") || `<div class="muted small">Henüz dinleyici yok.</div>`;
  const more = lis.length - LISTENER_RENDER_LIMIT;
  $("#moreListeners").classList.toggle("hidden", more <= 0);
  $("#moreListeners").textContent = `+${more} dinleyici daha`;
  $("#listenerCount").textContent = lis.length ? `${lis.length}` : "";
  const hands = lis.filter((x) => x.hand).length;
  $("#handsChip").classList.toggle("hidden", !(mgr && hands));
  $("#handsChip").textContent = `✋ ${hands} kişi söz istiyor`;

  const micOn = lk.localParticipant.isMicrophoneEnabled;
  const mic = $("#micBtn");
  mic.classList.toggle("hidden", !canSpeak(r));
  mic.classList.toggle("on", micOn); mic.classList.toggle("off", !micOn);
  mic.querySelector(".bb-txt").textContent = micOn ? "Mikrofon açık" : "Mikrofon kapalı";
  const myHand = !!(lk.localParticipant.attributes && lk.localParticipant.attributes.hand);
  const hb = $("#handBtn");
  hb.classList.toggle("hidden", canSpeak(r));
  hb.classList.toggle("on", myHand);
  hb.querySelector(".bb-txt").textContent = myHand ? "Söz istendi" : "Söz iste";
}

$("#leaveBtn").addEventListener("click", () => leaveRoom());
$("#shareBtn").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#r-" + roomName;
  try { await navigator.clipboard.writeText(url); toast("Oda linki kopyalandı"); } catch { toast(url); }
});
$("#queue").addEventListener("click", (e) => { const b = e.target.closest("[data-qi]"); if (b) act("remove", { index: +b.dataset.qi }); });
$("#addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = parseYouTube($("#addInput").value);
  if (!id) return toast("Geçerli bir YouTube linki değil");
  $("#addInput").value = "";
  const title = await ytTitle(id);
  const wasEmpty = !state.play.id;
  const j = await act("add", { id, title });
  if (j && !wasEmpty) toast("Sıraya eklendi");
});
$("#playBtn").addEventListener("click", () => act("toggle"));
$("#skipBtn").addEventListener("click", () => act("skip"));
$("#backBtn").addEventListener("click", () => act("seek", { pos: Math.max(0, expectedPos() - 10) }));
$("#fwdBtn").addEventListener("click", () => act("seek", { pos: expectedPos() + 10 }));
$("#seek").addEventListener("change", (e) => { let d = 0; try { d = player.getDuration() || 0; } catch {} if (d) act("seek", { pos: (+e.target.value / 100) * d }); });
$("#localMuteBtn").addEventListener("click", () => {
  localMuted = !localMuted;
  try { localMuted ? player.mute() : player.unMute(); } catch {}
  $("#localMuteBtn").textContent = localMuted ? "🔇 Video sende kısık (aç)" : "🔈 Videoyu sadece bende kıs";
});

/* kişi işlemleri */
$("#room").addEventListener("click", (e) => { const el = e.target.closest(".person"); if (el && state) openActions(el.dataset.uid); });
$("#handsChip").addEventListener("click", () => { const f = members().find((m) => m.hand); if (f) openActions(f.id); });
function openActions(uid) {
  const m = members().find((x) => x.id === uid); if (!m) return;
  const tr = roleOf(uid), mr = myRole(), acts = [];
  if (uid === me.id) { if (!canSpeak()) acts.push(["hand", m.hand ? "✋ Söz isteğini geri çek" : "✋ Söz iste"]); }
  else if (canManage(mr) && tr !== "host" && !(mr === "mod" && tr === "mod")) {
    if (tr === "listener") acts.push(["speaker", "🎙️ Sahneye al (konuşmacı)"]);
    if (tr !== "dj") acts.push(["dj", "🎧 DJ yap (video/müzik yönetir)"]);
    if (mr === "host" && tr !== "mod") acts.push(["mod", "🛡️ Yardımcı yap"]);
    if (tr !== "listener") acts.push(["listener", "⬇️ Dinleyiciye al"]);
    if (tr !== "listener" && m.mic) acts.push(["mute", "🔇 Mikrofonunu kapat"]);
    if (mr === "host") acts.push(["host", "👑 Oda sahipliğini devret"]);
    acts.push(["kick", "🚫 Odadan çıkar"]);
  }
  $("#actionSheet").innerHTML = `
    <div class="act-head">${avatar(uid, m.name, m.avatar)}<div><div style="font-weight:600">${esc(m.name)}${m.local ? " (sen)" : ""}</div><div class="muted small">${ROLE_TR[tr]}${m.hand ? " · ✋ söz istiyor" : ""}</div></div></div>
    <div class="act-list">${acts.map(([k, t]) => `<button class="btn ${k === "kick" ? "danger" : ""}" data-act="${k}">${t}</button>`).join("") || `<div class="muted small">Bu kişi için yapabileceğin bir şey yok.</div>`}
    <button class="btn ghost" data-close>Kapat</button></div>`;
  $("#actionSheet").onclick = async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    modal("#actionModal", false);
    const a = b.dataset.act;
    if (a === "hand") return setHand(!m.hand);
    if (a === "mute") return act("mute", { target: uid });
    if (a === "kick") { if (await act("kick", { target: uid })) sendData("sys", { text: `${m.name} odadan çıkarıldı.` }, true); return; }
    if (a === "host") { if (await act("host", { target: uid, targetName: m.name })) sendData("sys", { text: `Oda sahipliği ${m.name} kişisine geçti.` }, true); return; }
    if (await act("role", { target: uid, role: a })) sendData("sys", { text: `${m.name} artık ${ROLE_TR[a].toLowerCase()}.` }, true);
  };
  modal("#actionModal", true);
}

/* ---------------- alt bar ---------------- */
$("#micBtn").addEventListener("click", async () => {
  if (!canSpeak()) return toast("Konuşmak için söz iste.");
  const on = !lk.localParticipant.isMicrophoneEnabled;
  try { await lk.localParticipant.setMicrophoneEnabled(on); } catch (e) { toast(on ? "Mikrofon açılamadı (izin ver)" : "Mikrofon kapatılamadı"); }
  renderRoom();
});
$("#handBtn").addEventListener("click", () => setHand(!(lk.localParticipant.attributes || {}).hand));
async function setHand(on) {
  if (!lk) return;
  try { await lk.localParticipant.setAttributes({ hand: on ? "1" : "" }); if (on) toast("Söz istedin, yöneticiler görecek."); } catch { toast("Söz isteği gönderilemedi"); }
  scheduleRender();
}
$("#reactBtn").addEventListener("click", () => $("#reactPicker").classList.toggle("hidden"));
$("#reactPicker").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  $("#reactPicker").classList.add("hidden");
  if (Date.now() - lastReact < 1000) return; lastReact = Date.now();
  sendData("react", { e: b.textContent }); floatEmoji(b.textContent, me.name);
});
$("#chatBtn").addEventListener("click", () => { $("#chat").classList.remove("hidden"); chatUnread = 0; $("#chatDot").classList.add("hidden"); scrollChat(); });
$("#chatClose").addEventListener("click", () => $("#chat").classList.add("hidden"));
$("#chatForm").addEventListener("submit", (e) => {
  e.preventDefault(); const t = $("#chatInput").value.trim().slice(0, 300); if (!t) return;
  $("#chatInput").value = ""; sendData("chat", { text: t }); addChat(me.name, t);
});
function addChat(name, text) {
  const el = document.createElement("div"); el.className = "msg";
  el.innerHTML = `<b>${esc(name)}</b>${esc(text)}`;
  $("#chatList").appendChild(el);
  while ($("#chatList").children.length > 200) $("#chatList").firstChild.remove();
  if ($("#chat").classList.contains("hidden")) { chatUnread++; $("#chatDot").classList.remove("hidden"); }
  scrollChat();
}
function sysMsg(t) { const el = document.createElement("div"); el.className = "msg sys"; el.textContent = t; $("#chatList").appendChild(el); scrollChat(); }
function scrollChat() { const l = $("#chatList"); l.scrollTop = l.scrollHeight; }
function floatEmoji(e, name) {
  if ($("#floaters").children.length > 25) return;
  const f = document.createElement("div"); f.className = "floater";
  f.style.left = (15 + Math.random() * 70) + "%";
  f.innerHTML = `${esc(e)}<small>${esc(name || "")}</small>`;
  $("#floaters").appendChild(f); setTimeout(() => f.remove(), 2700);
}

/* ---------------- YouTube ---------------- */
let ytLoading = false;
function loadYT() {
  if (player || ytLoading) return;
  ytLoading = true;
  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player("yt", {
      width: "100%", height: "100%",
      playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, origin: location.origin },
      events: {
        onReady: () => { playerReady = true; syncPlayer(true); },
        onStateChange: (e) => {
          if (!state) return;
          const p = state.play;
          if (e.data === 0 && p.id && isSentinel()) act("ended", { id: p.id });
          if (e.data === 1 && canControl() && p.title === "YouTube videosu") {
            try { const d = player.getVideoData(); if (d && d.title && d.video_id === p.id) act("title", { id: p.id, title: d.title }); } catch {}
          }
        },
        onError: (e) => {
          if (!state || !canControl()) return;
          if ([100, 101, 150, 2, 5].includes(e.data)) { toast("Bu video gömülü oynatılamıyor, sıradakine geçiliyor."); act("skip"); }
        },
      },
    });
  };
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  s.onerror = () => { ytFailed = true; renderRoom(); };
  document.head.appendChild(s);
}
function syncPlayer(force) {
  if (!state || !playerReady || !unlocked) return;
  const p = state.play;
  try {
    if (!p.id) { if (loadedId) { player.stopVideo(); loadedId = null; } return; }
    if (loadedId !== p.id) {
      loadedId = p.id;
      const start = Math.max(0, expectedPos());
      if (p.playing) player.loadVideoById({ videoId: p.id, startSeconds: start }); else player.cueVideoById({ videoId: p.id, startSeconds: start });
      return;
    }
    const ps = player.getPlayerState();
    if (ps === 0 && p.playing) return;
    const exp = expectedPos(), cur = player.getCurrentTime() || 0;
    if (Math.abs(cur - exp) > (force ? 0.8 : 2)) player.seekTo(exp, true);
    if (p.playing && ps !== 1 && ps !== 3) player.playVideo();
    if (!p.playing && ps === 1) player.pauseVideo();
    const d = player.getDuration();
    if (d && document.activeElement !== $("#seek")) $("#seek").value = Math.min(100, (cur / d) * 100);
  } catch {}
}
$("#unlockBtn").addEventListener("click", async () => {
  unlocked = true; $("#unlockBtn").classList.add("hidden");
  if (lk) { try { await lk.startAudio(); } catch {} }
  syncPlayer(true);
});

boot();
})();
