// X Rave — online bağlantı: MQTT 3.1.1 / WebSocket üzerinden hafif "oda" (sunucu gerekmez)
export function createMqttRoom({ prefix, cid, brokers, onStatus }) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  let ws = null, connected = false, bi = 0, buf = new Uint8Array(0), pid = 1, ping = null, retry = 0, emitT = null, started = false;
  let lastState = null, peersCb = null, lbCb = null;
  const peers = new Map(); // cid -> {s, t}
  const P = prefix.endsWith('/') ? prefix : prefix + '/';

  const str = s => { const b = enc.encode(s); const o = new Uint8Array(2 + b.length); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; };
  const cat = (...a) => { let n = 0; for (const x of a) n += x.length; const o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
  const remLen = n => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; o.push(b); } while (n > 0); return Uint8Array.from(o); };
  const pkt = (h, body) => cat(Uint8Array.of(h), remLen(body.length), body);
  const send = p => { if (ws && ws.readyState === 1) { try { ws.send(p); } catch (e) {} } };

  function publish(topic, payload, retain = false) {
    if (!connected) return;
    send(pkt(0x30 | (retain ? 1 : 0), cat(str(topic), enc.encode(payload))));
  }
  function subscribe(filter) {
    send(pkt(0x82, cat(Uint8Array.of(pid >> 8, pid & 255), str(filter), Uint8Array.of(0))));
    pid = (pid % 65000) + 1;
  }
  function emitSoon() {
    if (emitT) return;
    emitT = setTimeout(() => { emitT = null; peersCb && peersCb([...peers.values()].map(v => ({ presence: v.s }))); }, 120);
  }
  function handle(topic, msg) {
    if (topic.startsWith(P + 'p/')) {
      const c = topic.slice(P.length + 2);
      if (!c || c === cid) return;
      if (!msg) { if (peers.delete(c)) emitSoon(); return; }
      if (msg.length > 4000) return;
      let s; try { s = JSON.parse(msg); } catch (e) { return; }
      if (!s || typeof s !== 'object' || s.cid !== c) return;
      if (!peers.has(c) && peers.size >= 150) return;
      peers.set(c, { s, t: Date.now() }); emitSoon();
    } else if (topic.startsWith(P + 'lb/')) {
      const u = topic.slice(P.length + 3);
      if (!u || msg.length > 2000) return;
      let v = null; if (msg) { try { v = JSON.parse(msg); } catch (e) { return; } }
      lbCb && lbCb(u, v);
    }
  }
  function parse() {
    while (buf.length >= 2) {
      let mul = 1, len = 0, i = 1, b;
      do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
      if (buf.length < i + len) return;
      const type = buf[0] >> 4, flags = buf[0] & 15, body = buf.subarray(i, i + len);
      buf = buf.slice(i + len);
      if (type === 2) { if (body[1] === 0) onConnack(); else { try { ws.close(); } catch (e) {} } }
      else if (type === 3) {
        const tl = (body[0] << 8) | body[1]; const topic = dec.decode(body.subarray(2, 2 + tl));
        let p = 2 + tl; if ((flags >> 1) & 3) p += 2;
        handle(topic, dec.decode(body.subarray(p)));
      }
    }
  }
  function onConnack() {
    connected = true; retry = 0; onStatus && onStatus('live');
    subscribe(P + 'p/+'); subscribe(P + 'lb/+');
    clearInterval(ping); ping = setInterval(() => send(Uint8Array.of(0xC0, 0)), 20000);
    if (lastState) publish(P + 'p/' + cid, lastState);
  }
  function connectOnce() {
    const url = brokers[bi % brokers.length];
    onStatus && onStatus('connecting', url);
    let sock;
    try { sock = new WebSocket(url, ['mqtt']); } catch (e) { bi++; setTimeout(connectOnce, 800); return; }
    ws = sock; buf = new Uint8Array(0); sock.binaryType = 'arraybuffer';
    const to = setTimeout(() => { if (!connected && ws === sock) { try { sock.close(); } catch (e) {} } }, 7000);
    sock.onopen = () => {
      const flags = 0x02 | 0x04; // clean session + will
      const body = cat(str('MQTT'), Uint8Array.of(4, flags, 0, 45), str('xr_' + cid + '_' + Math.random().toString(36).slice(2, 6)), str(P + 'p/' + cid), Uint8Array.of(0, 0));
      send(pkt(0x10, body));
    };
    sock.onmessage = e => { if (ws !== sock) return; buf = cat(buf, new Uint8Array(e.data)); parse(); };
    const down = () => {
      clearTimeout(to); if (sock._dead) return; sock._dead = true; if (ws !== sock) return;
      const was = connected; connected = false; clearInterval(ping); onStatus && onStatus('down');
      if (!was) bi++; retry = Math.min(retry + 1, 8);
      setTimeout(connectOnce, was ? 1000 : Math.min(500 * retry, 4000));
    };
    sock.onclose = down; sock.onerror = down;
  }
  // heartbeat + expiry
  setInterval(() => { if (connected && lastState) publish(P + 'p/' + cid, lastState); }, 5000);
  setInterval(() => { const now = Date.now(); let ch = false; for (const [c, v] of peers) if (now - v.t > 16000) { peers.delete(c); ch = true; } if (ch) emitSoon(); }, 3000);

  return {
    start() { if (!started) { started = true; connectOnce(); } },
    presence(state) { lastState = JSON.stringify(state); publish(P + 'p/' + cid, lastState); },
    onPeers(cb) { peersCb = cb; },
    onLb(cb) { lbCb = cb; },
    publishLb(uid, obj) { publish(P + 'lb/' + uid, JSON.stringify(obj), true); },
    leave() { publish(P + 'p/' + cid, ''); },
    get connected() { return connected; },
  };
}
