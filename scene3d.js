// X Rave — 3D sahne (three.js r160)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// S: shared state accessors provided by the main page
export function createScene3D(S) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { return null; }
  if (!renderer.getContext()) return null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const el = renderer.domElement;
  el.id = 'c3';
  el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none';
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04020a);
  const FOG_BASE = 0.022;
  scene.fog = new THREE.FogExp2(0x0a0418, FOG_BASE);
  const cam = new THREE.PerspectiveCamera(48, 1, 0.1, 200);

  // ---------- helpers ----------
  const col = (h, s = 1, l = .5) => new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l);
  function radialTex(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const softTex = radialTex();
  const shadowTex = radialTex('rgba(0,0,0,.85)', 'rgba(0,0,0,0)');
  const basic = (o) => new THREE.MeshBasicMaterial(Object.assign({ toneMapped: false }, o));
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const add = (o) => basic(Object.assign({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }, o));

  // ---------- world mapping ----------
  const wx = x => x * 7.2;
  const wz = z => -1.4 + z * 8.8;
  const fromWorld = (X, Z) => ({ x: clamp(X / 7.2, -.95, .95), z: clamp((Z + 1.4) / 8.8, .1, 1) });

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0x7a5cc0, 0x120822, 1.1));
  const key = new THREE.DirectionalLight(0xc8b8ff, 1.2); key.position.set(2, 8, 12); scene.add(key);
  const boothLight = new THREE.PointLight(0xff2bd6, 8, 14, 1.4); boothLight.position.set(0, 2.2, -2); scene.add(boothLight);

  // ---------- floor ----------
  const COLS = 13, ROWS = 9, TW = 1.3, TD = 1.15;
  const floorBase = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), std({ color: 0x07040e, roughness: .35, metalness: .4 }));
  floorBase.rotation.x = -Math.PI / 2; floorBase.position.set(0, -.01, 2); scene.add(floorBase);
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(TW - .07, .08, TD - .07), basic({ color: 0xffffff }), COLS * ROWS);
  const m4 = new THREE.Matrix4();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    m4.makeTranslation((c - (COLS - 1) / 2) * TW, .04, -2.3 + r * TD);
    tiles.setMatrixAt(r * COLS + c, m4); tiles.setColorAt(r * COLS + c, new THREE.Color(0x111111));
  }
  scene.add(tiles);

  // ---------- back wall & LED screen ----------
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), std({ color: 0x0c0618, roughness: .9 }));
  wall.position.set(0, 9, -9); scene.add(wall);
  const scrC = document.createElement('canvas'); scrC.width = 1024; scrC.height = 300;
  const scrG = scrC.getContext('2d'); const scrT = new THREE.CanvasTexture(scrC); scrT.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(14, 4.1), basic({ map: scrT }));
  screen.position.set(0, 6.5, -8.85); scene.add(screen);
  const scrFrame = new THREE.Mesh(new THREE.BoxGeometry(14.5, 4.6, .3), std({ color: 0x050308, roughness: .5, metalness: .6 }));
  scrFrame.position.set(0, 6.5, -9.05); scene.add(scrFrame);

  // ---------- truss ----------
  const trussMat = std({ color: 0x8e86a8, roughness: .35, metalness: .9 });
  for (const z of [-5.5, 1.5]) for (const y of [11, 11.5]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(24, .08, .08), trussMat); b.position.set(0, y, z); scene.add(b);
  }
  for (let i = -12; i <= 12; i += .5) for (const z of [-5.5, 1.5]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(.04, .55, .04), trussMat); b.position.set(i, 11.25, z); b.rotation.z = .7; scene.add(b);
  }

  // ---------- DJ booth ----------
  const booth = new THREE.Group(); booth.position.set(0, 0, -4.6); booth.scale.setScalar(1.25); scene.add(booth);
  const dark = std({ color: 0x150d24, roughness: .45, metalness: .5 });
  const riser = new THREE.Mesh(new THREE.BoxGeometry(9, .7, 3.6), std({ color: 0x0b0714, roughness: .6, metalness: .3 }));
  riser.position.y = .35; booth.add(riser);
  const edgeMats = [];
  function neonBar(w, h, d, x, y, z) { const m = basic({ color: 0xff2bd6 }); edgeMats.push(m); const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); booth.add(b); return b; }
  neonBar(9.05, .06, .06, 0, .7, 1.8); neonBar(9.05, .06, .06, 0, .02, 1.8);
  // stairs
  for (let i = 0; i < 2; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.6, .23, .4), dark); s.position.set(3.6, .12 + i * .23, 2 + (1 - i) * .4); booth.add(s); }
  // console body (slightly trapezoid via scale)
  const body = new THREE.Mesh(new THREE.BoxGeometry(6, 1.3, 1.4), dark); body.position.set(0, 1.35, .7); booth.add(body);
  const frontC = document.createElement('canvas'); frontC.width = 1024; frontC.height = 220;
  const frontG = frontC.getContext('2d'); const frontT = new THREE.CanvasTexture(frontC); frontT.colorSpace = THREE.SRGBColorSpace;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 1.22), basic({ map: frontT }));
  front.position.set(0, 1.35, 1.41); booth.add(front);
  neonBar(6.05, .05, .05, 0, 2.0, 1.42); neonBar(6.05, .05, .05, 0, .7, 1.42);
  neonBar(.05, 1.3, .05, -3.01, 1.35, 1.42); neonBar(.05, 1.3, .05, 3.01, 1.35, 1.42);
  const top = new THREE.Mesh(new THREE.BoxGeometry(6.3, .09, 1.7), std({ color: 0x1b1428, roughness: .3, metalness: .7 }));
  top.position.set(0, 2.05, .65); booth.add(top);
  // decks
  const platters = [], armMats = [];
  for (const sx of [-1, 1]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.75, .14, 1.35), std({ color: 0x202024, roughness: .4, metalness: .6 }));
    base.position.set(sx * 1.85, 2.16, .65); booth.add(base);
    const pl = new THREE.Group(); pl.position.set(sx * 1.85 - .1, 2.25, .65); booth.add(pl);
    const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(.58, .58, .03, 40), std({ color: 0x0a0a0a, roughness: .25, metalness: .3 })); pl.add(vinyl);
    const lblm = basic({ color: 0xff2bd6 }); armMats.push(lblm);
    const lab = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .035, 24), lblm); pl.add(lab);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(.5, .036, .025), basic({ color: 0xffffff })); stripe.position.x = .3; pl.add(stripe);
    platters.push(pl);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.04, .04, .8), std({ color: 0xcccccc, metalness: 1, roughness: .2 }));
    arm.position.set(sx * 1.85 + .6, 2.3, .5); arm.rotation.y = .5; booth.add(arm);
  }
  // mixer
  const mixer = new THREE.Mesh(new THREE.BoxGeometry(1.1, .18, 1.2), std({ color: 0x18181c, roughness: .4, metalness: .6 }));
  mixer.position.set(0, 2.18, .65); booth.add(mixer);
  const leds = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 7; j++) {
    const m = basic({ color: 0x222222 }); const b = new THREE.Mesh(new THREE.BoxGeometry(.07, .03, .06), m);
    b.position.set(-.2 + i * .4, 2.28, .25 + j * .1); booth.add(b); leds.push({ m, j });
  }
  for (let i = 0; i < 6; i++) { const k = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .06, 10), basic({ color: 0xdddddd })); k.position.set(-.35 + (i % 3) * .35, 2.3, .95 + Math.floor(i / 3) * .15); booth.add(k); }
  // laptop
  const lap = new THREE.Group(); lap.position.set(0, 2.12, -.35); booth.add(lap);
  const lapBase = new THREE.Mesh(new THREE.BoxGeometry(.9, .03, .6), std({ color: 0xb8b8c0, metalness: 1, roughness: .3 })); lap.add(lapBase);
  const lapScr = new THREE.Mesh(new THREE.BoxGeometry(.9, .58, .02), std({ color: 0xb8b8c0, metalness: 1, roughness: .3 }));
  lapScr.position.set(0, .29, -.3); lapScr.rotation.x = -.25; lap.add(lapScr);
  const lapGlowM = basic({ color: 0x22f3ff }); const lapGlow = new THREE.Mesh(new THREE.PlaneGeometry(.82, .5), lapGlowM);
  lapGlow.position.set(0, .29, -.288); lapGlow.rotation.x = -.25; lapGlow.rotation.y = Math.PI; lap.add(lapGlow);

  // ---------- speakers ----------
  const woofers = [], spRings = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(sx * 7.4, 0, -4.2); g.rotation.y = -sx * .25; scene.add(g);
    for (let b = 0; b < 3; b++) {
      const h = b === 0 ? 1.7 : 1.25, y = b === 0 ? .85 : 1.7 + (b - 1) * 1.27 + .63;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, h - .04, 1.4), std({ color: 0x0d0b12, roughness: .7, metalness: .2 }));
      cab.position.y = y; g.add(cab);
      const n = b === 0 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const r = b === 0 ? .62 : .38, cx = n === 1 ? 0 : (k ? .45 : -.45);
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(r, r * .55, .25, 32, 1, true), std({ color: 0x1a1722, roughness: .8, side: THREE.DoubleSide }));
        cone.rotation.x = Math.PI / 2; cone.position.set(cx, y, .7); g.add(cone);
        const dust = new THREE.Mesh(new THREE.SphereGeometry(r * .3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: 0x0a090d, roughness: .5 }));
        dust.rotation.x = Math.PI / 2; dust.position.set(cx, y, .6); g.add(dust);
        woofers.push({ cone, dust, base: .7, big: b === 0 });
        const rm = basic({ color: 0x22f3ff }); spRings.push(rm);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, .025, 8, 40), rm); ring.position.set(cx, y, .71); g.add(ring);
      }
    }
  }

  // ---------- moving heads (spot lights + visible beams + floor pools) ----------
  const heads = [];
  const beamGeo = new THREE.ConeGeometry(1, 1, 24, 1, true); beamGeo.translate(0, -.5, 0); beamGeo.rotateX(-Math.PI / 2);
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  const NH = 4;
  for (let i = 0; i < NH; i++) {
    const x = -6 + i * 4, pos = new THREE.Vector3(x, 10.9, i % 2 ? 1.5 : -5.5);
    const fix = new THREE.Mesh(new THREE.CylinderGeometry(.22, .3, .45, 16), std({ color: 0x1a1a1a, metalness: .7, roughness: .4 }));
    fix.position.copy(pos); scene.add(fix);
    const sp = new THREE.SpotLight(0xffffff, 380, 34, .3, .55, 1.2); sp.position.copy(pos); scene.add(sp); scene.add(sp.target);
    const bm = add({ color: 0xffffff, opacity: .07, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(beamGeo, bm); scene.add(beam);
    const pm = add({ map: softTex, color: 0xffffff, opacity: .55 });
    const pool = new THREE.Mesh(poolGeo, pm); pool.rotation.x = -Math.PI / 2; pool.scale.set(3, 3, 1); scene.add(pool);
    heads.push({ pos, sp, beam, bm, pool, pm, ph: i * 1.7 });
  }

  // ---------- lasers ----------
  const laserGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true); laserGeo.translate(0, .5, 0); laserGeo.rotateX(Math.PI / 2);
  const lasers = [];
  const emitters = [new THREE.Vector3(0, 4.2, -6.2), new THREE.Vector3(-8, 10.6, -5.5), new THREE.Vector3(8, 10.6, -5.5)];
  for (let i = 0; i < 18; i++) {
    const core = new THREE.Mesh(laserGeo, add({ color: 0x00ff66, opacity: .9 }));
    const glow = new THREE.Mesh(laserGeo, add({ color: 0x00ff66, opacity: .12 }));
    scene.add(core); scene.add(glow); lasers.push({ core, glow, e: emitters[i % 3], i });
  }
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  function aim(mesh, from, to, r) { mesh.position.copy(from); mesh.lookAt(to); const len = from.distanceTo(to); mesh.scale.set(r, r, len); }

  // ---------- haze & fog machine sprites ----------
  const haze = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.SpriteMaterial({ map: softTex, color: 0x8844ff, transparent: true, opacity: .05, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m); s.position.set(rnd(-10, 10), rnd(.8, 3), rnd(-5, 8)); s.scale.setScalar(rnd(5, 9)); scene.add(s);
    haze.push({ s, m, v: rnd(-.25, .25), h: rnd(0, 360) });
  }
  const smoke = [];
  for (let i = 0; i < 46; i++) {
    const m = new THREE.SpriteMaterial({ map: softTex, color: 0xe2d8f8, transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
    smoke.push({ s, m, v: new THREE.Vector3() });
  }
  let smokeStart = -1;

  // ---------- sparks ----------
  const SPN = 260, spPos = new Float32Array(SPN * 3), spVel = new Float32Array(SPN * 3), spLife = new Float32Array(SPN);
  const spGeo = new THREE.BufferGeometry(); spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  const spMat = new THREE.PointsMaterial({ size: .14, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: false });
  const sparks = new THREE.Points(spGeo, spMat); scene.add(sparks);
  for (let i = 0; i < SPN; i++) spPos[i * 3 + 1] = -100;
  let lastBurstBar = -1;
  function burst() {
    for (let i = 0; i < SPN; i++) {
      spPos[i * 3] = rnd(-3, 3); spPos[i * 3 + 1] = 2.5; spPos[i * 3 + 2] = -4;
      spVel[i * 3] = rnd(-5, 5); spVel[i * 3 + 1] = rnd(5, 11); spVel[i * 3 + 2] = rnd(0, 6); spLife[i] = rnd(1.4, 2.6);
    }
  }

  // ---------- avatars ----------
  const G = {
    thigh: new THREE.CapsuleGeometry(.075, .32, 4, 10), shin: new THREE.CapsuleGeometry(.065, .32, 4, 10),
    shoe: new THREE.BoxGeometry(.13, .09, .27), torsoM: new THREE.CapsuleGeometry(.17, .34, 6, 14), torsoF: new THREE.CapsuleGeometry(.135, .26, 6, 14),
    skirt: new THREE.CylinderGeometry(.15, .32, .5, 18, 1, true), neck: new THREE.CylinderGeometry(.06, .06, .12, 10),
    head: new THREE.SphereGeometry(.155, 22, 16), hairCap: new THREE.SphereGeometry(.163, 22, 14, 0, Math.PI * 2, 0, Math.PI * .52),
    hairBack: new THREE.CapsuleGeometry(.12, .22, 4, 12), pony: new THREE.SphereGeometry(.08, 12, 10),
    shades: new THREE.BoxGeometry(.25, .055, .05), upper: new THREE.CapsuleGeometry(.055, .24, 4, 10), fore: new THREE.CapsuleGeometry(.05, .22, 4, 10),
    hand: new THREE.SphereGeometry(.055, 10, 8), stick: new THREE.CylinderGeometry(.022, .022, .26, 8), band: new THREE.TorusGeometry(.175, .022, 8, 26),
    phones: new THREE.TorusGeometry(.17, .025, 8, 24, Math.PI), cup: new THREE.CylinderGeometry(.07, .07, .06, 16),
    shadow: new THREE.PlaneGeometry(1, 1), ring: new THREE.TorusGeometry(.55, .035, 8, 40), arrow: new THREE.ConeGeometry(.16, .32, 16),
  };
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false });
  function makeAvatar(d, opts = {}) {
    const seed = d.seed || 1;
    const neon = new THREE.Color(S.NEON[seed % S.NEON.length]), neon2 = new THREE.Color(S.NEON[(seed >> 3) % S.NEON.length]);
    const skin = new THREE.Color(S.SKIN[(seed >> 5) % S.SKIN.length]), hair = new THREE.Color(S.HAIR[(seed >> 7) % S.HAIR.length]);
    const M = {
      outfit: std({ color: neon, roughness: .45, metalness: .1, emissive: neon, emissiveIntensity: .18 }),
      pants: std({ color: 0x1a1730, roughness: .7 }), skin: std({ color: skin, roughness: .6 }), hair: std({ color: hair, roughness: .55 }),
      shoe: std({ color: 0xf2f2f2, roughness: .5 }), shades: basic({ color: neon2.clone().multiplyScalar(.9) }),
      glow: basic({ color: neon2 }), dark: std({ color: 0x111111, roughness: .4, metalness: .5 }),
    };
    const root = new THREE.Group();
    const sh = new THREE.Mesh(G.shadow, shadowMat); sh.rotation.x = -Math.PI / 2; sh.position.y = .09; sh.scale.set(.9, .9, 1); root.add(sh);
    const hip = new THREE.Group(); hip.position.y = .93; root.add(hip);
    const fem = d.g === 'k';
    const legs = [];
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(sx * .1, 0, 0); hip.add(leg);
      const th = new THREE.Mesh(G.thigh, fem ? M.skin : M.pants); th.position.y = -.22; leg.add(th);
      const knee = new THREE.Group(); knee.position.y = -.44; leg.add(knee);
      const shin = new THREE.Mesh(G.shin, fem ? M.skin : M.pants); shin.position.y = -.21; knee.add(shin);
      const shoe = new THREE.Mesh(G.shoe, M.shoe); shoe.position.set(0, -.44, .05); knee.add(shoe);
      legs.push({ leg, knee });
    }
    const torso = new THREE.Group(); hip.add(torso);
    if (fem) {
      const sk = new THREE.Mesh(G.skirt, M.outfit); sk.position.y = -.05; torso.add(sk);
      const t = new THREE.Mesh(G.torsoF, M.outfit); t.position.y = .32; torso.add(t);
    } else {
      const t = new THREE.Mesh(G.torsoM, M.outfit); t.position.y = .3; torso.add(t);
    }
    const band = new THREE.Mesh(G.band, M.glow); band.rotation.x = Math.PI / 2; band.position.y = fem ? .2 : .12; band.scale.setScalar(fem ? .85 : 1); torso.add(band);
    const neck = new THREE.Mesh(G.neck, M.skin); neck.position.y = .6; torso.add(neck);
    const head = new THREE.Group(); head.position.y = .78; torso.add(head);
    head.add(new THREE.Mesh(G.head, M.skin));
    const cap = new THREE.Mesh(G.hairCap, M.hair); cap.rotation.x = -.25; cap.position.y = .01; head.add(cap);
    if (fem) {
      const hb = new THREE.Mesh(G.hairBack, M.hair); hb.position.set(0, -.1, -.08); head.add(hb);
      const p = new THREE.Mesh(G.pony, M.hair); p.position.set(0, .1, -.17); head.add(p);
    }
    const shd = new THREE.Mesh(G.shades, M.shades); shd.position.set(0, .02, .135); head.add(shd);
    if (opts.dj) {
      const ph = new THREE.Mesh(G.phones, M.dark); ph.position.y = .02; head.add(ph);
      for (const sx of [-1, 1]) { const c = new THREE.Mesh(G.cup, M.dark); c.rotation.z = Math.PI / 2; c.position.set(sx * .17, 0, 0); head.add(c); }
    }
    const arms = [];
    for (const sx of [-1, 1]) {
      const sh2 = new THREE.Group(); sh2.position.set(sx * (fem ? .19 : .23), .52, 0); torso.add(sh2);
      const up = new THREE.Mesh(G.upper, fem ? M.skin : M.outfit); up.position.y = -.15; sh2.add(up);
      const el2 = new THREE.Group(); el2.position.y = -.3; sh2.add(el2);
      const fo = new THREE.Mesh(G.fore, M.skin); fo.position.y = -.14; el2.add(fo);
      const hd = new THREE.Mesh(G.hand, M.skin); hd.position.y = -.3; el2.add(hd);
      const st = new THREE.Mesh(G.stick, M.glow); st.position.set(0, -.33, .06); st.rotation.x = 1.3; el2.add(st);
      arms.push({ sh: sh2, el: el2, stick: st });
    }
    const av = { root, hip, torso, head, legs, arms, M, seed, style: seed % 4, face: rnd(-.45, .45), ring: null, dj: !!opts.dj };
    if (d.me) {
      const rm = basic({ color: 0x22f3ff, transparent: true, opacity: .55 });
      const ring = new THREE.Mesh(G.ring, rm); ring.rotation.x = -Math.PI / 2; ring.position.y = .1; root.add(ring);
      const arrow = new THREE.Mesh(G.arrow, basic({ color: 0x22f3ff, transparent: true, opacity: 0 })); arrow.rotation.x = Math.PI; arrow.position.y = 2.3; root.add(arrow);
      av.ring = ring; av.ringM = rm; av.arrow = arrow;
    }
    // label
    const lab = document.createElement('div'); lab.className = 'n3';
    const bub = document.createElement('div'); bub.className = 'b3';
    const nm = document.createElement('div'); nm.className = 't3' + (d.me ? ' me' : '');
    lab.appendChild(bub); lab.appendChild(nm); S.labels.appendChild(lab);
    av.lab = lab; av.bub = bub; av.nm = nm; av.g = d.g;
    return av;
  }
  function disposeAvatar(av) {
    scene.remove(av.root); av.lab.remove();
    for (const k in av.M) av.M[k].dispose();
  }

  // DJ avatar
  const djAv = makeAvatar({ seed: 7 * 7919, g: 'e' }, { dj: true });
  djAv.root.position.set(0, .875, -5.25); djAv.root.scale.setScalar(1.4); djAv.root.children[0].visible = false; scene.add(djAv.root);
  djAv.lab.remove();
  for (const a of djAv.arms) a.stick.visible = false;

  const avatars = new Map();

  function poseAvatar(av, d, t, beatPh, sec, now, walking) {
    const ph = beatPh * Math.PI * 2 * (av.style === 1 ? 2 : 1) + (av.seed % 7) * .3;
    const brk = sec === 'break';
    const bounce = Math.abs(Math.sin(beatPh * Math.PI * 4 + av.seed % 3)) * (brk ? .35 : 1);
    const em = d.e && Date.now() - (d.et || 0) < 3500 ? d.e : '';
    let jump = 0; if (em === 'jump') { const jt = (Date.now() - d.et) % 600 / 600; jump = Math.sin(jt * Math.PI) * .55; }
    if (av.style === 3 && !brk && !walking) jump = Math.max(jump, Math.max(0, Math.sin(beatPh * Math.PI * 8)) * .12);
    av.hip.position.y = .93 - bounce * .07 + jump;
    av.root.children[0].scale.setScalar(.9 - jump * .5);
    // legs
    const [L, R] = av.legs;
    if (walking) {
      const w = Math.sin(t * 9); L.leg.rotation.x = w * .5; R.leg.rotation.x = -w * .5; L.knee.rotation.x = Math.max(0, -w) * .7; R.knee.rotation.x = Math.max(0, w) * .7;
    } else if (av.style === 1 && !brk) {
      const k = Math.sin(ph); L.leg.rotation.x = -Math.max(0, k) * .7; R.leg.rotation.x = -Math.max(0, -k) * .7;
      L.knee.rotation.x = Math.max(0, k) * .9; R.knee.rotation.x = Math.max(0, -k) * .9;
      L.leg.rotation.z = -.08; R.leg.rotation.z = .08;
    } else {
      L.leg.rotation.x = R.leg.rotation.x = -bounce * .32; L.knee.rotation.x = R.knee.rotation.x = bounce * .62;
      L.leg.rotation.z = -.05; R.leg.rotation.z = .05;
    }
    // torso / head
    av.torso.rotation.y = Math.sin(ph * .5) * .28; av.torso.rotation.x = bounce * .08;
    av.head.rotation.x = -.1 + bounce * .22; av.head.rotation.z = Math.sin(ph * .5) * .1;
    // arms
    const [A, B] = av.arms; // A left (x-), B right (x+)
    const pump = Math.sin(ph) * .5 + .5;
    const set = (a, z, x, e) => { a.sh.rotation.set(x, 0, z); a.el.rotation.set(e, 0, 0); };
    if (av.dj) {
      set(A, -.35, -.9 + Math.sin(t * 8) * .08, -1.0);
      const up = (now / 2000 | 0) % 3 === 0 && sec === 'drop';
      if (up) set(B, 2.5 + pump * .4, 0, -.2); else set(B, .35, -.9 - Math.sin(t * 7) * .1, -1.1);
    } else if (em === 'hands' || em === 'hey' || (brk && av.style !== 2)) {
      set(A, -(2.65 + pump * .25), 0, -.15); set(B, 2.65 + (1 - pump) * .25, 0, -.15);
    } else if (walking) {
      const w = Math.sin(t * 9); set(A, -.12, -w * .5, -.3); set(B, .12, w * .5, -.3);
    } else if (av.style === 0) {
      set(A, -.35, -.3, -.9); set(B, 2.0 + pump * .9, -.2, -(1 - pump) * 1.3);
    } else if (av.style === 1) {
      set(A, -.3, -.7 - Math.sin(ph) * .4, -1.4); set(B, .3, -.7 + Math.sin(ph) * .4, -1.4);
    } else if (av.style === 2) {
      const sw = Math.sin(t * 3 + av.seed) * .35; set(A, -2.4 + sw, 0, -.3); set(B, 2.4 + sw, 0, -.3);
    } else {
      set(A, -(1.2 + pump * 1.4), 0, -.6); set(B, 1.2 + (1 - pump) * 1.4, 0, -.6);
    }
    const sticks = av.style === 2 || em === 'laser' || (d.mc || 0) > 10;
    for (const a of av.arms) a.stick.visible = !av.dj && sticks;
  }

  // ---------- labels css ----------
  const st = document.createElement('style');
  st.textContent = `#lbl3{position:fixed;inset:0;pointer-events:none;z-index:3;overflow:hidden}
.n3{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:4px;will-change:transform;transform-origin:50% 100%}
.t3{font:700 12px 'Space Grotesk',sans-serif;color:#fff;background:rgba(6,2,16,.55);padding:2px 7px;border-radius:7px;white-space:nowrap;text-shadow:0 1px 2px #000}
.t3.me{color:#22f3ff;background:rgba(34,243,255,.2)}
.b3{display:none;font:500 13px 'Space Grotesk',sans-serif;color:#14082a;background:rgba(255,255,255,.94);padding:5px 10px;border-radius:12px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative}
.b3:after{content:'';position:absolute;left:50%;bottom:-6px;margin-left:-6px;border:6px solid transparent;border-bottom:0;border-top-color:rgba(255,255,255,.94)}
#flash3{position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:2}`;
  document.head.appendChild(st);
  const flash = document.createElement('div'); flash.id = 'flash3';

  // ---------- composer ----------
  let composer = null, bloom = null, lastSlow = null;
  function setupComposer() {
    if (S.slow()) { composer = null; return; }
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, cam));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .55, .45, .62);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    resize();
  }
  function resize() {
    const W = innerWidth, H = innerHeight, slow = S.slow();
    renderer.setPixelRatio(slow ? 1 : Math.min(devicePixelRatio || 1, 1.75));
    renderer.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(W, H); }
  }
  addEventListener('resize', resize);

  // ---------- picking ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  el.addEventListener('pointerdown', e => {
    if (!S.started()) return;
    ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    if (ray.ray.intersectPlane(plane, tmpV)) { const p = fromWorld(tmpV.x, tmpV.z); S.moveMe(p.x, p.z); }
  });

  // ---------- canvases ----------
  let scrTick = 0, frontKey = '';
  function drawScreen(sec, hue, energy, kickEnv, tSec, spec) {
    const g = scrG, Wc = scrC.width, Hc = scrC.height;
    g.fillStyle = '#000'; g.fillRect(0, 0, Wc, Hc);
    const nb = 56, bw = Wc / nb;
    for (let i = 0; i < nb; i++) {
      const v = spec ? spec[Math.floor(i * spec.length * .7 / nb)] / 255 : clamp(.25 + .6 * energy * (Math.sin(i * .6 + tSec * 4) * .5 + .5) * (.4 + kickEnv), 0, 1);
      const h = v * Hc; g.fillStyle = `hsl(${(hue + i * 6) % 360},100%,${42 + v * 22}%)`; g.fillRect(i * bw + 2, Hc - h, bw - 4, h);
    }
    g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 0; y < Hc; y += 4) g.fillRect(0, y, Wc, 1);
    const txt = sec === 'build' ? 'DROP GELİYOR' : sec === 'break' ? 'ELLER HAVAYA' : (S.cfg().screenText || 'RAVE').toLocaleUpperCase('tr');
    g.save(); g.font = `900 ${Math.min(120, Wc * 1.6 / Math.max(6, txt.length))}px Unbounded, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = `hsl(${hue},100%,60%)`; g.shadowBlur = 30; g.fillStyle = '#fff'; g.fillText(txt, Wc / 2, Hc * .45 + Math.sin(tSec * 2) * 4); g.restore();
    scrT.needsUpdate = true;
  }
  function drawFront(label, sub, hue) {
    const k = label + '|' + sub + '|' + (hue / 20 | 0); if (k === frontKey) return; frontKey = k;
    const g = frontG, Wc = frontC.width, Hc = frontC.height;
    const gr = g.createLinearGradient(0, 0, 0, Hc); gr.addColorStop(0, '#1c1230'); gr.addColorStop(1, '#07040e'); g.fillStyle = gr; g.fillRect(0, 0, Wc, Hc);
    g.strokeStyle = `hsla(${hue},100%,60%,.35)`; g.lineWidth = 2; for (let x = -Hc; x < Wc; x += 26) { g.beginPath(); g.moveTo(x, Hc); g.lineTo(x + Hc, 0); g.stroke(); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${Math.min(84, Wc * 1.5 / Math.max(8, label.length))}px Unbounded, sans-serif`;
    g.shadowColor = `hsl(${(hue + 180) % 360},100%,60%)`; g.shadowBlur = 28; g.fillStyle = '#fff'; g.fillText(label, Wc / 2, Hc * .42);
    g.shadowBlur = 0; g.font = `500 30px 'Space Grotesk', sans-serif`; g.fillStyle = 'rgba(255,255,255,.75)'; g.fillText(sub, Wc / 2, Hc * .8);
    frontT.needsUpdate = true;
  }

  // ---------- main render ----------
  let lastT = performance.now(), camZoom = 1;
  const camTarget = new THREE.Vector3(0, 2.1, -1);
  function render(now) {
    if (S.slow() !== lastSlow) { lastSlow = S.slow(); setupComposer(); resize(); }
    if (!flash.isConnected) { el.after(flash); }
    const dt = Math.min(.05, (now - lastT) / 1000); lastT = now;
    const B = S.beat(now);
    const { bar, s16, sec, beatPh, kickEnv, energy, tSec, hue, laserOn, frac } = B;

    // camera
    camZoom += (S.zoomT() - camZoom) * .06;
    const portrait = innerWidth < innerHeight;
    const far = (1 / camZoom - 1) * 1.6 + 1; const pz = portrait ? 1.55 : 1;
    cam.fov = portrait ? 62 : 48;
    cam.position.set(Math.sin(tSec * .12) * 1.6, (5.6 + kickEnv * .05) * far * (portrait ? 1.15 : 1), 13.5 * far * pz);
    cam.lookAt(camTarget); cam.updateProjectionMatrix();

    // floor tiles
    const tc = new THREE.Color();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const pat = sec === 'break' ? (Math.sin(c * .8 + r * .6 + tSec * 1.5) * .5 + .5) * .35
        : ((c + r + Math.floor(S.curStep() / 2)) % 3 === 0 ? 1 : ((c * 7 + r * 3 + bar) % 5 === 0 ? .7 : .1)) * (.35 + kickEnv * .65) * energy;
      tc.setHSL(((hue + c * 18 + r * 12) % 360) / 360, .95, .025 + pat * .36);
      tiles.setColorAt(r * COLS + c, tc);
    }
    tiles.instanceColor.needsUpdate = true;

    // booth
    const hc = col(hue), hc2 = col(hue + 180);
    edgeMats.forEach((m, i) => m.color.copy(i % 2 ? hc2 : hc).multiplyScalar(.6 + kickEnv * .9));
    armMats.forEach((m, i) => m.color.copy(col(hue + i * 60)));
    platters[0].rotation.y -= dt * 3.4; platters[1].rotation.y -= dt * 3.1;
    leds.forEach(({ m, j }) => { const on = Math.random() < .25 + kickEnv * .6 * (1 - j / 9); m.color.setHex(on ? (j < 4 ? 0x2bff5a : j < 6 ? 0xffd21f : 0xff3030) : 0x1a1a1a); });
    lapGlowM.color.copy(col(hue + 120, .8, .55));
    boothLight.color.copy(hc); boothLight.intensity = 6 + kickEnv * 18;
    const cfg = S.cfg(); const manual = cfg.djMode === 'manual'; const topD = manual ? null : S.topDj();
    drawFront(S.djLabel(manual ? cfg.djName : topD ? topD.n : cfg.djName), manual ? (cfg.djSub || 'şu an kabinde 🎧') : topD ? `👑 en iyi dansçı · 💬 ${topD.mc} mesaj` : 'en iyi dansçı kabine çıkar', hue);
    poseAvatar(djAv, { e: '', et: 0, mc: 0 }, tSec, beatPh, sec, now, false);
    djAv.root.position.y = .875 + Math.abs(Math.sin(beatPh * Math.PI * 4)) * .03;

    // screen (30fps)
    if ((scrTick++ & 1) === 0) drawScreen(sec, hue, energy, kickEnv, tSec, S.spectrum());

    // speakers
    woofers.forEach(w => { const k = w.big ? kickEnv * .22 : kickEnv * .08; w.cone.position.z = w.base + k * .4; w.dust.position.z = w.base - .1 + k * .5; });
    spRings.forEach((m, i) => m.color.copy(col(hue + i * 30)).multiplyScalar(.3 + kickEnv));

    // moving heads
    heads.forEach((h, i) => {
      const t = tSec * (laserOn ? 1.2 : .45) + h.ph;
      const tx = Math.sin(t) * 6.5, tz = 3 + Math.cos(t * 1.3) * 4;
      h.sp.target.position.set(tx, 0, tz);
      const c = sec === 'break' ? col(hue + i * 90, .7, .6) : col(hue + i * 90);
      h.sp.color.copy(c); h.sp.intensity = (sec === 'break' ? 260 : 300 + kickEnv * 260);
      tmpV.set(tx, 0, tz); aim(h.beam, h.pos, tmpV, 1); const len = h.pos.distanceTo(tmpV); h.beam.scale.set(len * .14, len * .14, len);
      h.bm.color.copy(c); h.bm.opacity = (S.fogging(now) ? .13 : .035) * (sec === 'break' ? 1.2 : 1);
      h.pool.position.set(tx, .1, tz); h.pm.color.copy(c); h.pm.opacity = .22 + kickEnv * .2;
    });

    // lasers
    const nL = S.slow() ? (laserOn ? 6 : 3) : (laserOn ? 18 : Math.round(4 + energy * 6));
    const lasersVisible = sec !== 'break' || laserOn;
    lasers.forEach(L => {
      const vis = lasersVisible && L.i < nL; L.core.visible = L.glow.visible = vis; if (!vis) return;
      const a = Math.sin(tSec * (laserOn ? 2.2 : .9) + L.i * 1.7) * .9;
      const b2 = Math.cos(tSec * (laserOn ? 1.7 : .6) + L.i * 2.3);
      tmpV2.set(L.e.x + Math.sin(a + (L.i % 3 === 1 ? .6 : L.i % 3 === 2 ? -.6 : 0)) * 28, L.e.y - 9 - b2 * 6, L.e.z + 26);
      aim(L.core, L.e, tmpV2, .018); aim(L.glow, L.e, tmpV2, .09);
      const c = laserOn ? col(hue + L.i * 25) : col([120, 300, 180][L.i % 3]);
      L.core.material.color.copy(c); L.glow.material.color.copy(c);
      L.core.material.opacity = (laserOn ? .95 : .7) * (.6 + kickEnv * .4); L.glow.material.opacity = S.fogging(now) ? .3 : .1;
    });

    // haze
    haze.forEach(h => { h.s.position.x += h.v * dt; if (h.s.position.x > 12) h.s.position.x = -12; if (h.s.position.x < -12) h.s.position.x = 12; h.m.color.copy(col(hue + h.h, .8, .5)); h.m.opacity = S.slow() ? 0 : .035 + kickEnv * .02; });

    // fog machine
    const fogA = S.fogAmount(now);
    if (fogA > 0 && smokeStart < 0) {
      smokeStart = now;
      smoke.forEach((p, i) => { p.s.visible = true; p.s.position.set(rnd(-6, 6) + (i % 2 ? -3 : 3) * 0, rnd(.3, 2.5), rnd(-4.5, 7)); p.v.set(rnd(-.8, .8), rnd(.05, .35), rnd(.2, 1.4)); p.s.scale.setScalar(rnd(3, 6)); });
    }
    if (fogA <= 0 && smokeStart >= 0) { smokeStart = -1; smoke.forEach(p => { p.s.visible = false; }); }
    if (smokeStart >= 0) smoke.forEach(p => { p.s.position.addScaledVector(p.v, dt); p.s.scale.multiplyScalar(1 + dt * .18); p.m.opacity = .28 * fogA; p.m.color.copy(col(hue, .35, .82)); });
    scene.fog.density = FOG_BASE + fogA * .045; scene.fog.color.copy(col(hue, .4, .05 + fogA * .25));

    // sparks on drop
    if (sec === 'drop' && bar % 28 === 0 && s16 === 0 && bar !== lastBurstBar) { lastBurstBar = bar; burst(); }
    for (let i = 0; i < SPN; i++) {
      if (spLife[i] <= 0) continue; spLife[i] -= dt;
      spVel[i * 3 + 1] -= 9.8 * dt;
      spPos[i * 3] += spVel[i * 3] * dt; spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt; spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
      if (spLife[i] <= 0 || spPos[i * 3 + 1] < 0) { spPos[i * 3 + 1] = -100; spLife[i] = 0; }
    }
    spGeo.attributes.position.needsUpdate = true; spMat.color.copy(col(hue + 40, 1, .7));

    // dancers
    const seen = new Set();
    const showMe = S.showMe(now);
    for (const [k, d] of S.dancers()) {
      seen.add(k);
      let av = avatars.get(k);
      if (av && av.g !== d.g) { disposeAvatar(av); avatars.delete(k); av = null; }
      if (!av) { av = makeAvatar(d); avatars.set(k, av); scene.add(av.root); av.root.position.set(wx(d.x), 0, wz(d.z)); }
      const sp = d.me ? .07 : .05;
      const ox = d.x, oz = d.z; d.x += (d.tx - d.x) * sp; d.z += (d.tz - d.z) * sp;
      const mvx = d.x - ox, mvz = d.z - oz, walking = Math.hypot(mvx, mvz) > .0015;
      av.root.position.set(wx(d.x), 0, wz(d.z));
      const want = walking ? Math.atan2(mvx * 7.2, mvz * 8.8) : av.face;
      let dr = want - av.root.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); av.root.rotation.y += dr * .12;
      poseAvatar(av, d, tSec, beatPh, sec, now, walking);
      if (av.ring) {
        av.ringM.opacity = .35 + kickEnv * .3 + (showMe > 0 ? .5 : 0);
        av.ring.scale.setScalar(1 + (showMe > 0 ? (1 - showMe) * 1.2 : 0));
        av.arrow.material.opacity = showMe; av.arrow.position.y = 2.4 + Math.sin(now / 120) * .12;
      }
      // label
      tmpV.set(av.root.position.x, 2.05 + av.hip.position.y - .93, av.root.position.z).project(cam);
      if (tmpV.z > 1 || tmpV.z < -1) { av.lab.style.display = 'none'; continue; }
      av.lab.style.display = '';
      const dist = cam.position.distanceTo(av.root.position);
      const s = clamp(13 / dist, .55, 1.15);
      const X = (tmpV.x + 1) / 2 * innerWidth, Y = (1 - tmpV.y) / 2 * innerHeight;
      av.lab.style.transform = `translate(${X}px,${Y}px) translate(-50%,-100%) scale(${s})`;
      av.lab.style.zIndex = String(1000 - Math.round(dist * 10));
      if (av.nm.textContent !== d.n) av.nm.textContent = d.n;
      const showB = d.m && Date.now() - (d.mt || 0) < 5500;
      av.bub.style.display = showB ? 'block' : 'none';
      if (showB && av.bub.textContent !== d.m) av.bub.textContent = d.m;
    }
    for (const [k, av] of avatars) if (!seen.has(k)) { disposeAvatar(av); avatars.delete(k); }

    // strobe flash
    let fl = 0;
    if ((sec === 'drop' && s16 % 4 === 0 && frac < .35 && bar % 2 === 0) || (laserOn && s16 % 2 === 0 && frac < .25)) fl = S.slow() ? .08 : .14;
    if (sec === 'build') { const p = ((bar % 28) - 24 + s16 / 16) / 4; fl = Math.max(fl, p * p * .12 * (s16 % 2 ? 0 : 1)); }
    flash.style.opacity = fl;

    if (composer) { bloom.strength = .5 + kickEnv * .25 + fogA * .15; composer.render(); } else renderer.render(scene, cam);
  }

  return {
    el, render, resize,
    mount(labelsEl, canvas2d) { canvas2d.after(el); canvas2d.style.display = 'none'; el.after(flash); setupComposer(); resize(); lastSlow = S.slow(); },
  };
}
