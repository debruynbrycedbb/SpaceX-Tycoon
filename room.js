/* Starlink Launch Tycoon — launch control room.
   A walkable room built from the control room model. It sits beside the launch pad, shows the game on its
   screens, and draws the outside world (from view3d.js) through its window. It never changes game rules:
   it reads window.Game and presses the same buttons the 2D panels do. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ctx } from 'tycoon/view3d';

const { V, renderer, composer, renderPass, scene, ground, sky, skyMat, starMat, fog, sun, hemi, smoke, fire, SUN_GROUND, ROCKET_Y, SETS } = ctx;
const host = document.getElementById('scene'), canvas = document.getElementById('gl'), note = document.getElementById('loadNote');
const promptEl = document.getElementById('roomPrompt'), keysEl = document.getElementById('roomKeys');
const Room = window.Room = { available: false, active: false, docked: false, locked: false, undock, tp, interact: () => interact(), player: null };

// ---------- layout (room-local metres; the model's window end is at z = -19.7) ----------
const C = 0.53;                                    // the room's centre line
const ROOM_POS = new THREE.Vector3(-C, 50, 329.7); // a control tower: the window is 310 m from the pad and 50 m up, so the whole pad sits in view
const EYE = 1.68, CELL = 0.25, GX0 = -5.5, GZ0 = -19.875;
// Walkable floor, sampled from the model. Letters are floor height in 0.1 m steps (d = 0), spaces are blocked.
const GRID = `                                                 |       dd                                d       |       ddddddddddddddddddddddddddddddddddd       |      dddddddddddddddddddddddddddddddddddde      |      ddddddddddddddddddddddddddddddddddddd      |     d   dddddeeeeeeeeeeeeeeeeeeeeeddddd   d     |     d   dddddeeeeeeeeeeeeeeeeeeeeeedddd   dd    |    dd  dddddeeeeeeeeeeeeeeeeeeeeeeeddddd  dd    |     d eddddeeeeeeeeeeeeeeeeeeeeeeeeedddde d     |    ddddddddeeeeeeeeeeeeeeeeeeeeeeeeeddddddde    |    ddddddddee        eeeee        eeddddddde    |    ddddddddee        eeeee        eeddddddde    |    ddddddddee        eeeee        eeddddddde    |    d    dddee        eeeee        eedddd   e    |    dd   dddee   eee  eeeee  eee   eedddd   e    |    d   ddddee   eeeeeeeeeeeeeeee  eedddd   e    |    dd  ddddeeeeeeeeeeeeeeeedeeeeeeeeddddd  e    |    d    ddddeeeeeeeeee    edeeeeeeeeddd   de    |    d    ddddeeeeeeeeee    edeeeeeeeddddd   e    |    d    dddddeeeeeeeee    edeeeeeedddddd d e    |    dddddddddddddddddee    edddddddddddddddde    |    ddddddddddddddddd        ddddddddddddddde    |    dddddddddddddddddd      dddddddddddddddde    |    dddddddddddddddddddddddddddddddddddddddde    |     d ddddddddddddddddddddddddddddddddddd d     |     d ddddddddddddddddddddddddddddddddddd e     |       ddddddddddddddddddddddddddddddddddd       |       ddddddddddddddddddddddddddddddddddd       |        ddddddddddddddddddddddddddddddddd        |         dddddddddcddddddddddddcdddddddd         |           ddddddcccddddddddddccddddddd          |                  cccddddddddcc                  |        d         ccbcddddddcbc         dd       |        d         ccbcccadccbac         dd       |        d         ccabbcaacbbac         dd       |        d      d  ccaaaaaabaaac  d      dd       |        d      ddcccaaaaaaaaaaccdd      dd       |        d     dddcccaaaaaaaaaaccddd     dd       |        d      ddcccaaaaaaaaaaccdd      dd       |        d      ddcccaaaaaaaaaaccdd      dd       |        d      dd ccaaaaaaaaaac  d      dd       |        d   ddddd  caaaaaaaaaa  ddddd   dd       |        d    ddddd  aaaaaaaaa  ddddd    dd       |        d    dddddd  aaaaaaaa dddddd    dd       |        d   dddddddd aaaaaaa dddddddd   dd       |        d      ddddd aaaaaaa ddddd      dd       |        d      ddddd aaaaaaa ddddd      dd       |        d      ddddd abaaaba ddddd      dd       |        d   dddddddd bbcaacb dddddddd   dd       |        d      ddddd cccddcc ddddd      dd       |        d      ddddd cdddddd ddddd      dd       |        d      ddddd ddddddd ddddd      dd       |        d   dddddddd ddddddd dddddddd   dd       |        d    ddddddd ddddddd ddddddd    dd       |     ddddd   dedd    ddddddd     ded   ddddd     |     dddddddddddddddddddddddddddddddddddddddd    |    ddddddddddddddddddddddddddddddddddddddddd    |    ddddddddddddddddddddddddddddddddddddddddd    |    ddddddddddddddddddddddddddddddddddddddddd    |    ddddddddddddddddddddddddddddddddddddddddd    |    ddddddddddddddddddddddddddddddddddddddddd    |     ddddddddddd      dddddd     dddddddddddd    |          dddddddddddddddddddddddddddd           |          d ddeddd    ddddd    dddedd            |          ddddddd      ddd      dddddd           |          dddddd                 ddddd           |          dd                         d           |          dd                         d           |           d                         d           |           d                         d           |           ddddd                 ddddd           |           dddddd               dddddd           |           ddddddddd         ddddddddd           |           ddddddddd         ddddddddd           |           d dddd  d             ddd d           |           d ddd                 ddd d           |           d  dd                 ddd d           |               ddd             ddd               |                                                 |                                                 `.split('|');
function floorAt(x, z) {
  const c = Math.round((x - GX0) / CELL), r = Math.round((z - GZ0) / CELL), row = GRID[r];
  if (!row || c < 0 || c >= row.length) return null;
  if (r >= 31 && r <= 53 && (c < 10 || c > 39)) return null; // gaps behind the side consoles
  const ch = row[c]; return ch === ' ' ? null : (ch.charCodeAt(0) - 100) * 0.1;
}

// Places you can walk up to and use. `tab` opens that panel; the launch console presses the button.
const STATIONS = [
  { id: 'launch',   key: '1', label: 'Launch console',        pos: [C, 1.0, -19.0],   stand: [C, -18.3],    yaw: 0, ly: 0.66 },
  { id: 'payload',  key: '2', label: 'Payload and flight plan', pos: [-1.1, 1.0, -16.9], stand: [-1.1, -15.95], yaw: 0, tab: 'launch', ly: 1.34 },
  { id: 'fleet',    key: '3', label: 'Fleet console',         pos: [2.16, 1.0, -16.9], stand: [2.16, -15.95], yaw: 0, tab: 'fleet', ly: 1.34 },
  { id: 'upgrades', key: '4', label: 'Upgrades console',      pos: [5.0, 1.0, -15.9],  stand: [4.2, -15.9],   yaw: -Math.PI / 2, tab: 'upgrades', ly: 2.36 },
  { id: 'orbit',    key: '5', label: 'Constellation hologram', pos: [C, 1.1, -3.3],     stand: [C, -4.55],     yaw: Math.PI, tab: 'orbit', ly: 2.62 },
];

// ---------- cameras and passes: the far world first, then the room on top with its own depth range ----------
const eyeFar = new THREE.PerspectiveCamera(68, 1.5, 4, 90000);
const eyeNear = new THREE.PerspectiveCamera(68, 1.5, 0.06, 80); eyeNear.layers.set(1);
const roomPass = new RenderPass(scene, eyeNear); roomPass.clear = false; roomPass.clearDepth = true; roomPass.enabled = false;
composer.insertPass(roomPass, 1);
const FEED_W = 768, FEED_H = 432;
const feedRT = new THREE.WebGLRenderTarget(FEED_W, FEED_H, { type: THREE.HalfFloatType, samples: 2 });
const roomGroup = new THREE.Group(); roomGroup.position.copy(ROOM_POS); scene.add(roomGroup);
const inRoom = o => { o.traverse(c => c.layers.set(1)); roomGroup.add(o); return o; };
const player = { x: C, z: -13.6, y: EYE, yaw: 0, pitch: -0.02, vx: 0, vz: 0 };
const keys = {}; Room.player = player;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- the room model: keep one themed half, mirror it, and merge it into a few big meshes ----------
function buildRoom(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(), M = new THREE.Matrix4();
  const mirror = new THREE.Matrix4().makeTranslation(2 * C, 0, 0).multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  const groups = new Map(), info = { main: new THREE.Box3() };
  const push = (o, matrix, flipped) => {
    const isScreen = /^SCREEN_/.test(o.material.name), zone = box.getCenter(new THREE.Vector3()).z < -13.5 ? 0 : box.max.z < -6.3 ? 1 : 2;
    const key = o.material.uuid + ':' + zone;
    const g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) {
      const a = g.attributes[k];
      if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      else if (a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array)) { // plain floats so everything can be merged
        const f = new THREE.Float32BufferAttribute(a.count * a.itemSize, a.itemSize);
        for (let i = 0; i < a.count; i++) { f.setX(i, a.getX(i)); f.setY(i, a.getY(i)); if (a.itemSize > 2) f.setZ(i, a.getZ(i)); }
        g.setAttribute(k, f);
      }
    }
    g.applyMatrix4(matrix);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (flipped) {
      const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
      if (isScreen && g.attributes.uv) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); } // keep screen art readable
    }
    if (!groups.has(key)) groups.set(key, { material: o.material, geos: [] });
    groups.get(key).geos.push(g);
  };
  root.traverse(o => {
    if (!o.isMesh) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    const name = o.material.name;
    if (name === 'WINDOW') { info.window = box.clone(); return; }
    if (name === 'MAINSCREEN') { info.main.union(box); return; }
    if (name === 'HOLOTABLE') { info.table = box.clone(); return; }
    const keep = box.max.x <= C + 0.03, drop = box.min.x >= C - 0.03;
    if (drop && !keep) return;                 // the light-themed half is replaced by a mirror of the dark half
    push(o, o.matrixWorld, false);
    if (keep) push(o, M.multiplyMatrices(mirror, o.matrixWorld), true);
  });
  const art = [0, 1, 2, 3].map(consoleArt);
  let tris = 0, n = 0;
  for (const { material, geos } of groups.values()) {
    const mat = roomMaterial(material, art, n++);
    const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    const list = merged ? [merged] : geos;
    for (const g of list) { tris += g.index.count / 3; const m = new THREE.Mesh(g, mat); m.matrixAutoUpdate = false; inRoom(m); }
    if (merged && geos.length > 1) geos.forEach(g => g.dispose());
  }
  Room.stats = { meshes: roomGroup.children.length, tris };
  return info;
}
function roomMaterial(src, art, n) {
  const name = src.name;
  if (name === 'SCREEN_22') return new THREE.MeshStandardMaterial({ color: 0xaab0bb, roughness: 0.55 });                 // seat shells
  if (name === 'SCREEN_19') return new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.6 });
  if (/^SCREEN_/.test(name)) return new THREE.MeshBasicMaterial({ map: art[n % art.length], color: new THREE.Color(1.15, 1.15, 1.15) });
  src.envMapIntensity = 0.07; src.side = THREE.FrontSide;
  return src;
}

// ---------- drawing helpers for screens ----------
const COL = { bg: '#040b1c', panel: '#0a1836', line: '#24509a', text: '#e3ecff', dim: '#7e94c9', good: '#5fe08a', warn: '#ffd966', bad: '#ff6464', flame: '#ffb347', cyan: '#5ad8ff' };
const PX = '"Press Start 2P", monospace', BODY = 'VT323, monospace';
function mkCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { c, g: c.getContext('2d'), tex, w, h };
}
function T(g, s, x, y, size, color = COL.text, font = BODY, align = 'left') { g.font = `${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillText(s, x, y); }
function bar(g, x, y, w, h, frac, color = COL.flame) { g.fillStyle = '#02060f'; g.fillRect(x, y, w, h); g.strokeStyle = COL.line; g.lineWidth = 2; g.strokeRect(x, y, w, h); g.fillStyle = color; g.fillRect(x + 2, y + 2, Math.max(0, Math.min(1, frac)) * (w - 4), h - 4); }
function board(d, title, accent = COL.cyan) {
  const { g, w, h } = d; g.fillStyle = COL.bg; g.fillRect(0, 0, w, h);
  g.fillStyle = COL.panel; g.fillRect(0, 0, w, 54); g.fillStyle = accent; g.fillRect(0, 54, w, 4);
  g.strokeStyle = COL.line; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  T(g, title, 22, 38, 20, accent, PX);
}
function wrap(g, s, max) { const out = []; let line = ''; for (const word of String(s).split(' ')) { const t = line ? line + ' ' + word : word; if (g.measureText(t).width > max && line) { out.push(line); line = word; } else line = t; } if (line) out.push(line); return out; }
function rng(seed) { let s = seed * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
// Original console graphics for the model's built-in monitors.
function consoleArt(seed) {
  const d = mkCanvas(512, 256), g = d.g, r = rng(seed + 3), acc = [COL.cyan, COL.flame, COL.good, '#b58bff'];
  g.fillStyle = '#030a18'; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = 'rgba(60,120,220,.25)'; g.lineWidth = 1;
  for (let x = 0; x <= 512; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  for (let y = 0; y <= 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  for (let i = 0; i < 4; i++) {
    const x = 10 + i * 126, c = acc[Math.floor(r() * acc.length)], kind = Math.floor(r() * 4);
    g.strokeStyle = c; g.lineWidth = 2; g.strokeRect(x, 10, 116, 236); g.fillStyle = c; g.fillRect(x, 10, 116, 14);
    if (kind === 0) for (let k = 0; k < 9; k++) { g.fillStyle = k % 3 ? 'rgba(120,170,255,.55)' : c; g.fillRect(x + 8, 36 + k * 22, 20 + r() * 86, 10); }
    else if (kind === 1) { g.beginPath(); for (let k = 0; k <= 20; k++) { const yy = 150 - Math.sin(k * 0.7 + seed) * 40 * r() - r() * 30; k ? g.lineTo(x + 8 + k * 5, yy) : g.moveTo(x + 8, yy); } g.stroke(); for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(120,170,255,.5)'; g.fillRect(x + 8, 190 + k * 10, 30 + r() * 70, 5); } }
    else if (kind === 2) { g.beginPath(); g.arc(x + 58, 100, 40, 0, 6.3); g.stroke(); g.beginPath(); g.arc(x + 58, 100, 28, -1.6, -1.6 + r() * 5.5); g.lineWidth = 8; g.stroke(); for (let k = 0; k < 6; k++) { g.fillStyle = k % 2 ? c : 'rgba(120,170,255,.5)'; g.fillRect(x + 8 + k * 17, 170, 12, 20 + r() * 50); } }
    else for (let k = 0; k < 24; k++) { g.fillStyle = r() > 0.6 ? c : 'rgba(90,140,230,.35)'; g.fillRect(x + 8 + (k % 4) * 26, 36 + Math.floor(k / 4) * 34, 20, 24); }
  }
  d.tex.wrapS = d.tex.wrapT = THREE.RepeatWrapping; d.tex.needsUpdate = true; return d.tex;
}

// ---------- live dashboards ----------
const A = () => Game.api, S = () => Game.S;
const stateColor = c => ({ good: COL.good, warn: COL.warn, bad: COL.bad, flame: COL.flame }[c] || COL.text);
const DRAW = {
  mission(d) {
    const I = Game.info(), g = d.g; board(d, 'MISSION STATUS', COL.flame);
    T(g, I.tag || '', 24, 96, 34); T(g, I.count || '', d.w - 24, 100, 30, COL.flame, PX, 'right');
    A().stageList().forEach((s, i) => {
      const y = 122 + i * 50, col = { active: COL.flame, done: COL.good, warn: COL.warn, fail: COL.bad }[s.c] || COL.dim;
      g.fillStyle = col; g.fillRect(24, y + 6, 14, 26);
      T(g, `${i + 1}. ${s.n}`, 52, y + 30, 32, s.c ? COL.text : COL.dim); T(g, s.note, d.w - 190, y + 30, 30, col, BODY, 'right');
      if (s.p !== null) bar(g, d.w - 176, y + 8, 152, 22, s.p, col);
    });
  },
  ready(d) {
    const L = A().launchState(), p = L.pad, o = A().odds(p), g = d.g, manual = p.mode === 'manual';
    board(d, `LAUNCH READINESS · PAD ${p.id}`, L.ok ? COL.good : COL.warn);
    const rows = [
      ['Booster', L.booster ? `B${L.booster.id} on the pad` : 'none on the pad', !!L.booster],
      ['Payload', `${L.n} of ${L.cap} loaded`, L.n > 0],
      ['Pad', p.state === 'idle' ? 'clear' : p.state === 'prep' ? 'countdown' : 'launching', p.state === 'idle'],
      ['Control', manual ? 'Manual: you fly' : 'Autopilot', true],
      ['Landing', p.site === 'ship' ? 'Drone ship' : 'Landing zone', true],
      ['Odds', `launch ${A().pct(o.launch)}  ${manual ? '' : 'landing ' + A().pct(o.land)}`, true],
    ];
    rows.forEach((r, i) => { const y = 104 + i * 42; T(g, r[0], 24, y, 32, COL.dim); T(g, r[1], 190, y, 32, r[2] ? COL.text : COL.warn); });
    g.fillStyle = L.ok ? '#0e3a22' : '#3a2a0a'; g.fillRect(24, d.h - 92, d.w - 48, 68); g.strokeStyle = L.ok ? COL.good : COL.warn; g.lineWidth = 4; g.strokeRect(24, d.h - 92, d.w - 48, 68);
    T(g, L.ok ? 'GO FOR LAUNCH' : 'NO GO', 44, d.h - 44, 26, L.ok ? COL.good : COL.warn, PX);
    T(g, L.ok ? 'Press the launch button' : L.why, d.w - 40, d.h - 46, 28, COL.text, BODY, 'right');
  },
  economy(d) {
    const s = S(), g = d.g, a = A(), inc = a.income(); board(d, 'COMPANY', COL.warn);
    T(g, 'Cash', 24, 100, 30, COL.dim); T(g, a.money(s.cash), 24, 142, 30, COL.warn, PX);
    T(g, 'Income', 290, 100, 30, COL.dim); T(g, a.money(inc) + '/s', 290, 142, 30, COL.good, PX);
    T(g, 'Satellites', 560, 100, 30, COL.dim); T(g, a.int(a.sum(s.orbit)), 560, 142, 30, COL.text, PX);
    T(g, `Lifetime earnings ${a.money(s.lifetime)}   Flights ${s.flights}   Landings ${s.stats.landings}`, 24, 196, 30, COL.dim);
    const next = Game.TIERS[s.unlocked];
    if (next) { T(g, `Next tier: ${next.name} at ${a.money(next.unlock)}`, 24, 244, 30); bar(g, 24, 256, d.w - 48, 24, s.lifetime / next.unlock, COL.good); }
    else T(g, 'All satellite tiers unlocked', 24, 244, 30, COL.good);
    T(g, `Launch failures ${s.stats.failures}   Boosters lost ${s.stats.boostersLost}   Satellites lost ${s.stats.lostSats}`, 24, 330, 30, COL.dim);
    T(g, `Time in business ${a.clockStr(s.clock)}`, 24, 372, 30, COL.dim);
  },
  fleet(d) {
    const s = S(), g = d.g, a = A(); board(d, `FLEET · ${s.boosters.length} BOOSTERS · ${s.pads.length} PADS`);
    if (!s.boosters.length) T(g, 'No boosters. Buy one at the fleet console.', 24, 110, 32, COL.warn);
    s.boosters.slice(0, 6).forEach((b, i) => {
      const y = 104 + i * 44, [label, cls] = Game.B_LABEL[b.state], timed = b.dur > 0 && b.t > 0 && ['returning', 'refueling', 'repairing', 'transit'].includes(b.state);
      T(g, `B${b.id}`, 24, y, 32); T(g, label + (timed ? ' ' + a.secs(b.t) : ''), 100, y, 32, stateColor(cls)); T(g, `${b.flights} flights`, d.w - 190, y, 28, COL.dim, BODY, 'right');
      if (timed) bar(g, d.w - 176, y - 22, 152, 20, 1 - b.t / b.dur);
    });
    const py = d.h - 60; g.fillStyle = COL.line; g.fillRect(24, py - 30, d.w - 48, 2);
    T(g, s.pads.map(p => `Pad ${p.id}: ${p.state === 'idle' ? (p.booster ? 'ready' : 'empty') : p.state === 'prep' ? 'countdown' : 'launching'}`).join('    '), 24, py + 8, 30, COL.text);
  },
  log(d) {
    const s = S(), g = d.g; board(d, 'EVENT FEED');
    let y = 96; g.font = `28px ${BODY}`;
    for (const e of s.log) {
      const lines = wrap(g, e.msg, d.w - 150).slice(0, 2), col = { good: COL.good, bad: COL.bad, warn: COL.warn, money: COL.warn }[e.type] || COL.text;
      if (y + lines.length * 28 > d.h - 14) break;
      T(g, A().clockStr(e.t), 22, y, 28, COL.dim); lines.forEach((l, i) => T(g, l, 122, y + i * 28, 28, col)); y += lines.length * 28 + 8;
    }
  },
  orbit(d) {
    const s = S(), g = d.g, a = A(); board(d, 'CONSTELLATION', COL.cyan);
    let y = 100, any = false;
    s.orbit.forEach((n, i) => { if (!n || y > d.h - 80) return; any = true; g.fillStyle = Game.TIERS[i].color; g.fillRect(24, y - 20, 18, 18); T(g, Game.TIERS[i].name, 56, y, 30); T(g, a.int(n), d.w - 250, y, 30, COL.text, BODY, 'right'); T(g, a.money(n * Game.TIERS[i].income) + '/s', d.w - 24, y, 30, COL.good, BODY, 'right'); y += 36; });
    if (!any) T(g, 'Nothing in orbit yet. Launch your first payload.', 24, 110, 30, COL.dim);
    g.fillStyle = COL.line; g.fillRect(24, d.h - 70, d.w - 48, 2);
    T(g, `${a.int(a.sum(s.orbit))} satellites`, 24, d.h - 28, 34); T(g, a.money(a.income()) + '/s', d.w - 24, d.h - 28, 34, COL.good, BODY, 'right');
  },
  ticker(d) {
    const I = Game.info(), g = d.g, a = A(), L = a.launchState(); g.fillStyle = '#030814'; g.fillRect(0, 0, d.w, d.h); g.fillStyle = COL.flame; g.fillRect(0, d.h - 6, d.w, 6);
    if (I.m) { T(g, I.count || '', 40, 70, 52, COL.flame, PX); T(g, `${(I.tag || '').toUpperCase()}   ${I.cap || ''}`, 420, 68, 56, COL.text); }
    else T(g, `PAD ${L.pad.id} ${L.ok ? 'GO FOR LAUNCH' : 'STANDING BY'}   ·   ${L.n}/${L.cap} SATELLITES LOADED   ·   INCOME ${a.money(a.income())}/s   ·   ${a.int(a.sum(S().orbit))} IN ORBIT`, 40, 68, 56, L.ok ? COL.good : COL.text);
  },
  feedLabel(d) {
    const I = lastInfo || Game.info(), g = d.g; g.fillStyle = '#030814'; g.fillRect(0, 0, d.w, d.h);
    const cam = { orbit: 'CONSTELLATION VIEW', pad: 'PAD CAMERA', ignite: 'PAD CAMERA', ascent: 'TRACKING CAMERA', failed: 'TRACKING CAMERA', coast: 'STAGE CAMERA', deploy: 'PAYLOAD CAMERA', deorbit: 'UPPER STAGE CAMERA', return: 'BOOSTER CAMERA', landing: 'LANDING CAMERA', landed: 'LANDING CAMERA', mlanding: 'LANDING CAMERA' }[I.key] || 'CAMERA';
    g.fillStyle = Math.floor(performance.now() / 600) % 2 ? COL.bad : '#5a1a1a'; g.beginPath(); g.arc(26, 28, 9, 0, 6.3); g.fill();
    T(g, 'LIVE', 46, 38, 30, COL.bad); T(g, cam, 120, 38, 30, COL.cyan); T(g, I.cap || '', d.w - 16, 38, 28, COL.text, BODY, 'right');
  },
};
const boards = {};   // name -> canvas record
function screen(name, w, h, cw, chh, pos, rotY, tilt = 0) {
  const d = boards[name] = mkCanvas(cw, chh);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: d.tex, color: new THREE.Color(1.1, 1.1, 1.1) }));
  m.position.set(...pos); m.rotation.set(tilt, rotY, 0, 'YXZ'); inRoom(m); d.mesh = m; return m;
}
let boardTurn = 0, lastInfo = null;
function updateBoards() {
  const names = Object.keys(boards), name = names[boardTurn++ % names.length], d = boards[name];
  DRAW[name](d); d.tex.needsUpdate = true;
  if (name !== 'ticker' && name !== 'feedLabel') { DRAW.feedLabel(boards.feedLabel); boards.feedLabel.tex.needsUpdate = true; }
}

// ---------- props: glass, launch console, hologram, lights, the building outside ----------
let button, cover, statusLamp, holo, holoPts, holoColors, padStack, labels = [], feedScreens = [];
const std = (color, roughness = 0.6, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.12 });
function buildProps(info) {
  const win = info.window, table = info.table;
  // window glass
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(win.max.x - win.min.x, win.max.y - win.min.y), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.75, 1), transparent: true, opacity: 0.06, depthWrite: false }));
  glass.position.set((win.min.x + win.max.x) / 2, (win.min.y + win.max.y) / 2, win.min.z + 0.02); inRoom(glass);
  Room.window = win;

  // lighting: dim and cool, so the screens and the view outside carry the room
  inRoom(new THREE.HemisphereLight(0xb9ccff, 0x1a2238, 1.0));
  const key = new THREE.DirectionalLight(0xdfe8ff, 0.55); key.position.set(0.3, 1, 0.45); inRoom(key); inRoom(key.target);
  for (const [x, y, z, power, color] of [[C, 1.9, -17.8, 2.2, 0x9fd0ff], [C, 1.7, -3.0, 2.6, 0x6fc4ff]]) {
    const l = new THREE.PointLight(color, power, 9, 1.4); l.position.set(x, y, z); inRoom(l);
  }

  // launch console: pedestal, covered button, status lamp
  const ped = new THREE.Group(); ped.position.set(C, 0.1, -19.02);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.46), std(0x1a1f2b, 0.5, 0.5)); base.position.y = 0.4; ped.add(base);
  const deck = new THREE.Group(); deck.position.set(0, 0.84, 0.04); deck.rotation.x = 0.38; ped.add(deck);
  deck.add(new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.05, 0.62), std(0x2a3142, 0.4, 0.6)));
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 32), new THREE.MeshStandardMaterial({ color: 0xd8b02a, roughness: 0.5 })); ring.position.y = 0.04; deck.add(ring);
  button = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.08, 32), new THREE.MeshStandardMaterial({ color: 0xc81818, emissive: 0xff2a1a, emissiveIntensity: 0.6, roughness: 0.35 })); button.position.y = 0.085; deck.add(button);
  cover = new THREE.Group(); cover.position.set(0, 0.03, -0.2); deck.add(cover);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.42), new THREE.MeshStandardMaterial({ color: 0xff5540, transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false })); lid.position.set(0, 0.1, 0.2); cover.add(lid);
  statusLamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.05), new THREE.MeshBasicMaterial({ color: 0x33ff88 })); statusLamp.position.set(0, 0.035, 0.27); deck.add(statusLamp);
  const plate = mkCanvas(512, 96); plate.g.fillStyle = '#0a0d14'; plate.g.fillRect(0, 0, 512, 96); T(plate.g, 'LAUNCH', 256, 66, 44, COL.flame, PX, 'center'); plate.tex.needsUpdate = true;
  const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.15), new THREE.MeshBasicMaterial({ map: plate.tex })); pm.position.set(0, 0.55, 0.235); ped.add(pm);
  inRoom(ped);

  // hologram table and the Earth above it
  const tx = (table.min.x + table.max.x) / 2, tz = (table.min.z + table.max.z) / 2, ty = table.max.y;
  const top = mkCanvas(512, 256), tg = top.g; tg.fillStyle = '#020812'; tg.fillRect(0, 0, 512, 256); tg.strokeStyle = 'rgba(70,170,255,.5)'; tg.lineWidth = 1;
  for (let x = 0; x <= 512; x += 32) { tg.beginPath(); tg.moveTo(x, 0); tg.lineTo(x, 256); tg.stroke(); } for (let y = 0; y <= 256; y += 32) { tg.beginPath(); tg.moveTo(0, y); tg.lineTo(512, y); tg.stroke(); }
  for (const r of [40, 70, 100]) { tg.strokeStyle = 'rgba(90,216,255,.9)'; tg.lineWidth = r === 100 ? 4 : 2; tg.beginPath(); tg.arc(256, 128, r, 0, 6.3); tg.stroke(); } top.tex.needsUpdate = true;
  const topMesh = new THREE.Mesh(new THREE.PlaneGeometry(table.max.x - table.min.x, table.max.z - table.min.z), new THREE.MeshBasicMaterial({ map: top.tex })); topMesh.rotation.x = -Math.PI / 2; topMesh.position.set(tx, ty + 0.004, tz); inRoom(topMesh);
  holo = new THREE.Group(); holo.position.set(tx, ty + 1.0, tz);
  let earthTex = null; ctx.parts().earthHolder.traverse(o => { if (o.isMesh && o.material.map && !o.material.transparent && !earthTex) earthTex = o.material.map; });
  const R = 0.6;
  const globeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { map: { value: earthTex }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform sampler2D map; uniform float time; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vec3 tex = texture2D(map, vUv).rgb; float land = smoothstep(0.02, 0.22, max(tex.r, tex.g) - tex.b * 0.75);
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float scan = 0.88 + 0.12 * sin(vUv.y * 420.0 - time * 2.5);
        vec3 col = mix(vec3(0.02, 0.1, 0.32), vec3(0.3, 0.95, 1.1), land) * scan + vec3(0.2, 0.7, 1.2) * fres;
        gl_FragColor = vec4(col, clamp(0.42 + land * 0.45 + fres * 0.5, 0.0, 0.95)); }`,
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), globeMat); holo.add(globe); holo.userData = { globe, mat: globeMat, R };
  for (const [inc, node] of [[0.3, 0], [0.75, 1.3], [1.15, 2.6]]) {
    const ringGeo = new THREE.BufferGeometry().setFromPoints([...Array(97).keys()].map(i => new THREE.Vector3(Math.cos(i / 96 * 6.2832) * R * 1.22, 0, Math.sin(i / 96 * 6.2832) * R * 1.22)));
    const ln = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0x3aa8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); ln.rotation.set(inc, node, 0, 'YXZ'); holo.add(ln);
  }
  const MAXP = 600, pg = new THREE.BufferGeometry(); holoColors = new Float32Array(MAXP * 3);
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3)); pg.setAttribute('color', new THREE.BufferAttribute(holoColors, 3)); pg.setDrawRange(0, 0);
  holoPts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.02, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); holoPts.frustumCulled = false; holo.add(holoPts);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.95, 0.12, 1.0, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.45, 1), transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); cone.position.y = -0.5; holo.add(cone);
  inRoom(holo);

  // screens
  const main = info.main, my = (main.min.y + main.max.y) / 2, mh = 1.26, mw = mh * 16 / 9;
  feedScreens.push(feedPlane(mw, mh, [C - mw / 2 - 0.06, my + 0.05, main.max.z - 0.62], Math.PI));
  screen('feedLabel', mw, mw * 56 / 768, 768, 56, [C - mw / 2 - 0.06, my + 0.05 - mh / 2 - 0.11, main.max.z - 0.62], Math.PI);
  screen('mission', mw, mh, 768, 432, [C + mw / 2 + 0.06, my + 0.05, main.max.z - 0.62], Math.PI);
  screen('ticker', 6.9, 0.337, 2048, 100, [C, win.max.y + 0.27, win.min.z + 0.12], 0);
  screen('ready', 1.0, 0.5625, 768, 432, [C - 4.3, 1.74, -18.38], 0.913);            // floating above the model's side monitors
  feedScreens.push(feedPlane(1.0, 0.5625, [C + 4.3, 1.74, -18.38], -0.913));
  screen('economy', 1.9, 1.07, 768, 432, [C - 3.05, 2.12, -9.6], Math.PI / 2, 0.22);
  screen('fleet', 1.9, 1.07, 768, 432, [C + 3.05, 2.12, -9.6], -Math.PI / 2, 0.22);
  screen('log', 1.5, 0.844, 768, 432, [C + 4.72, 1.75, -15.9], -Math.PI / 2);
  screen('orbit', 1.1, 0.619, 768, 432, [tx, ty + 0.34, tz - 0.78], Math.PI, 0.5);

  // floating labels so stations are easy to find
  for (const s of STATIONS) {
    const d = mkCanvas(512, 96), g = d.g; g.fillStyle = 'rgba(4,11,28,.82)'; g.fillRect(0, 0, 512, 96); g.strokeStyle = COL.cyan; g.lineWidth = 4; g.strokeRect(2, 2, 508, 92);
    T(g, s.key, 20, 64, 34, COL.flame, PX); T(g, s.label.toUpperCase(), 76, 62, 40, COL.text); d.tex.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.178), new THREE.MeshBasicMaterial({ map: d.tex, transparent: true, depthWrite: false }));
    m.position.set(s.pos[0], s.ly, s.pos[2] + (s.id === 'launch' ? 0.33 : 0)); m.scale.setScalar(s.id === 'launch' ? 1 : 0.8); if (s.id === 'launch') m.rotation.x = -0.5; inRoom(m); if (s.id !== 'launch') labels.push(m);
  }

  // the building the room sits on, seen from the pad cameras
  const wallMat = std(0xb9bec6, 0.8, 0), h = ROOM_POS.y - 0.8;
  const tower = new THREE.Mesh(new THREE.BoxGeometry(15, h, 22), wallMat); tower.position.set(0, h / 2, ROOM_POS.z - 8.6); ground.add(tower);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(13.4, 4.6, 20.6), std(0xe4e7ec, 0.6, 0)); hull.position.set(0, h + 2.3, ROOM_POS.z - 9.9); ground.add(hull);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 1.6), std(0x0d1b33, 0.15, 0.6)); strip.rotation.y = Math.PI; strip.position.set(0, ROOM_POS.y + 1.35, ROOM_POS.z - 20.25); ground.add(strip);

  // a rocket waiting on the pad when no flight is in progress
  const { booster, upper, sepY } = ctx.parts();
  padStack = new THREE.Group(); const b = booster.clone(true), u = upper.clone(true);
  b.position.set(0, ROCKET_Y, 0); b.quaternion.identity(); u.position.set(0, ROCKET_Y + sepY, 0); u.quaternion.identity(); b.visible = u.visible = true;
  padStack.add(b, u); padStack.traverse(o => { if (o.isLight) o.intensity = 0; if (o.isMesh && o.material.isShaderMaterial) o.visible = false; }); padStack.visible = false; ground.add(padStack);
}
function feedPlane(w, h, pos, rotY) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: feedRT.texture })); m.position.set(...pos); m.rotation.y = rotY; return inRoom(m);
}
function updateHolo(time, dt) {
  const { globe, mat, R } = holo.userData, orbit = Game.S.orbit, total = orbit.reduce((a, b) => a + b, 0), MAX = 600;
  mat.uniforms.time.value = time; globe.rotation.y = time * 0.12;
  const pos = holoPts.geometry.attributes.position, col = new THREE.Color(); let k = 0;
  orbit.forEach((n, i) => { const c = total <= MAX ? n : n ? Math.max(1, Math.round(n / total * MAX)) : 0; col.set(Game.TIERS[i].color); for (let j = 0; j < c && k < MAX; j++, k++) holoColors.set([col.r, col.g, col.b], k * 3); });
  const v = new THREE.Vector3(), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < k; i++) {
    const ring = i % 9, r = R * (1.12 + (ring % 3) * 0.07), th = i * 2.39996 + time * (0.22 + ring * 0.02) * (ring % 2 ? 1 : -1);
    v.set(Math.cos(th) * r, 0, Math.sin(th) * r).applyAxisAngle(AX, 0.25 + ring * 0.14).applyAxisAngle(AY, ring * 2.1); pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true; holoPts.geometry.attributes.color.needsUpdate = true; holoPts.geometry.setDrawRange(0, k);
}

// Debug helper: what is under a screen point (x, y from -1 to 1)? Used to line props up with the model.
Room.pick = (nx, ny) => {
  const rc = new THREE.Raycaster(); rc.layers.set(1); rc.setFromCamera(new THREE.Vector2(nx, ny), eyeNear);
  eyeNear.updateMatrixWorld(true); rc.setFromCamera(new THREE.Vector2(nx, ny), eyeNear);
  const h = rc.intersectObjects(roomGroup.children.filter(o => o.isMesh && o.material.isMeshStandardMaterial && o.geometry.index && o.geometry.index.count > 600), false)[0]; if (!h) return null;
  const p = h.point.clone().sub(ROOM_POS), n = h.face ? h.face.normal : { x: 0, y: 0, z: 0 };
  return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), n: [n.x, n.y, n.z].map(v => +v.toFixed(2)), mat: h.object.material.name || h.object.material.type };
};

// ---------- moving around ----------
function tp(x, z, yaw = player.yaw, pitch = 0) { player.x = x; player.z = z; player.yaw = yaw; player.pitch = pitch; player.vx = player.vz = 0; const f = floorAt(x, z); if (f !== null) player.y = f + EYE; }
function move(dt) {
  if (Room.docked || Game.ui.game) { player.vx = player.vz = 0; return; }
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const turn = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0); player.yaw -= turn * 1.9 * dt;
  const speed = keys.ShiftLeft || keys.ShiftRight ? 5.2 : 3.1, sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  let wx = (-sy * f + cy * s), wz = (-cy * f - sy * s); const len = Math.hypot(wx, wz); if (len > 1) { wx /= len; wz /= len; }
  const k = Math.min(1, dt * 10); player.vx = lerp(player.vx, wx * speed, k); player.vz = lerp(player.vz, wz * speed, k);
  const nx = player.x + player.vx * dt, nz = player.z + player.vz * dt, here = floorAt(player.x, player.z) ?? 0;
  const ok = (x, z) => { const h = floorAt(x, z); return h !== null && Math.abs(h - here) <= 0.45; };
  if (ok(nx, player.z)) player.x = nx; else player.vx = 0;
  if (ok(player.x, nz)) player.z = nz; else player.vz = 0;
  const fl = floorAt(player.x, player.z); if (fl !== null) player.y = lerp(player.y, fl + EYE, Math.min(1, dt * 9));
}
function look(dx, dy) { player.yaw -= dx * 0.0023; player.pitch = Math.max(-1.25, Math.min(1.25, player.pitch - dy * 0.0023)); }
function nearest() {
  let best = null, bd = 2.3;
  for (const s of STATIONS) {
    const dx = s.pos[0] - player.x, dz = s.pos[2] - player.z, d = Math.hypot(dx, dz); if (d > bd) continue;
    const facing = (-Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz) / Math.max(0.01, d); if (facing < 0.25 && d > 0.9) continue;
    best = s; bd = d;
  }
  return best;
}
let pressT = 0;
function interact() {
  if (!Room.active || Game.ui.game) return;
  if (Room.docked) { undock(); return; }
  const s = nearest(); if (!s) return;
  if (s.id === 'launch') { const L = A().launchState(); if (L.ok) { pressT = 1; Game.act('launch'); } else Game.act('noop'); return; }
  dock(s.tab);
}
function dock(tab) { Game.act('tab', tab); Room.docked = true; document.body.classList.add('docked'); if (document.pointerLockElement) document.exitPointerLock(); }
function undock() { if (!Room.docked) return; Room.docked = false; document.body.classList.remove('docked'); }

document.addEventListener('keydown', e => {
  if (!Room.active || (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
  keys[e.code] = true;
  if (e.code === 'KeyE' && !e.repeat) { interact(); if (!Room.docked && !document.pointerLockElement && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) {} } e.preventDefault(); }
  else if (e.code === 'Escape') undock();
  else if (!Room.docked && !Game.ui.game && /^Digit[1-5]$/.test(e.code)) { const s = STATIONS[+e.code.slice(5) - 1]; tp(s.stand[0], s.stand[1], s.yaw, -0.05); }
  if (!Room.docked && /^Arrow/.test(e.code)) e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let drag = null;
canvas.addEventListener('pointerdown', e => {
  if (!Room.active || Room.docked || Game.ui.game) return;
  if (document.pointerLockElement === canvas) { interact(); return; }
  drag = { x: e.clientX, y: e.clientY };
  if (canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) {} }
});
window.addEventListener('pointerup', () => { drag = null; });
document.addEventListener('mousemove', e => {
  if (!Room.active || Room.docked || Game.ui.game) return;
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY);
  else if (drag) { look(-(e.clientX - drag.x) * 1.4, -(e.clientY - drag.y) * 1.4); drag.x = e.clientX; drag.y = e.clientY; }
});
document.addEventListener('pointerlockchange', () => { Room.locked = document.pointerLockElement === canvas; });

// ---------- per-frame: the room takes over drawing when it is active ----------
function setActive(on) {
  if (on === Room.active) return; Room.active = on;
  document.body.classList.toggle('room', on);
  if (!on) { undock(); if (document.pointerLockElement) document.exitPointerLock(); roomPass.enabled = false; renderPass.camera = ctx.camera; }
}
const padBusy = () => Game.S.pads.some(p => p.booster && p.state === 'idle');
V.roomInfo = I => (Room.active && I.key === 'orbit' && padBusy()) ? { key: 'pad', view: 'orbit', p: 0, m: { id: -9 }, ship: false, tag: I.tag, cap: 'Vehicle on the pad', count: '', idle: true } : I;
let feedTick = 0;
V.roomFrame = (I, dt, time) => {
  setActive(Room.available && !Game.S.roomOff && window.innerWidth >= 900);
  if (!Room.active || Game.ui.game) { roomPass.enabled = false; renderPass.camera = ctx.camera; return false; } // manual landing is flown full screen
  lastInfo = I; move(dt);
  const { booster, upper, strongPivot, earthHolder } = ctx.parts(), set = SETS[I.key] || 'globe', live = set === 'ground';

  // 1. the camera feed, as the mission cameras see it
  if (feedTick++ % 2 === 0) {
    ctx.setPuffScale(FEED_H, ctx.camera.fov); const a = ctx.camera.aspect; ctx.camera.aspect = FEED_W / FEED_H; ctx.camera.updateProjectionMatrix();
    renderer.setRenderTarget(feedRT); renderer.clear(); renderer.render(scene, ctx.camera); renderer.setRenderTarget(null);
    ctx.camera.aspect = a; ctx.camera.updateProjectionMatrix();
  }

  // 2. the world as seen from the window: always the launch site, whatever the feed is showing
  ground.visible = true; ctx.space.visible = ctx.globe.visible = earthHolder.visible = false;
  scene.fog = fog; fog.density = 4.5e-5; skyMat.uniforms.space.value = 0; starMat.opacity = 0;
  sun.position.copy(SUN_GROUND); sun.intensity = 1.8; hemi.intensity = 0.45;
  if (!live) booster.visible = upper.visible = false;
  smoke.points.visible = fire.points.visible = live;
  const onPad = ['pad', 'ignite', 'ascent'].includes(I.key);
  padStack.visible = !onPad && padBusy(); strongPivot.visible = onPad || padStack.visible; if (padStack.visible) strongPivot.rotation.z = 0.012;

  // 3. the room itself
  updateBoards(); updateHolo(time, dt);
  const L = A().launchState(), near = nearest();
  cover.rotation.x = lerp(cover.rotation.x, near && near.id === 'launch' ? -2.7 : 0, Math.min(1, dt * 7));
  pressT = Math.max(0, pressT - dt * 2.5); button.position.y = 0.085 - 0.045 * Math.sin(Math.min(1, pressT) * Math.PI);
  button.material.emissiveIntensity = L.ok ? 0.7 + 0.5 * Math.sin(time * 5) : 0.15; statusLamp.material.color.set(L.ok ? 0x33ff88 : I.m && !I.idle ? 0xffb347 : 0xff4444);
  const w = host.clientWidth, h = host.clientHeight, world = eyeFar.position.set(player.x, player.y, player.z).add(ROOM_POS);
  if (Room.debugCam) { world.fromArray(Room.debugCam.pos).add(ROOM_POS); player.yaw = Room.debugCam.yaw; player.pitch = Room.debugCam.pitch || 0; }
  for (const cam of [eyeFar, eyeNear]) { cam.position.copy(world); cam.rotation.set(player.pitch, player.yaw, 0, 'YXZ'); if (cam.aspect !== w / h) { cam.aspect = w / h; cam.updateProjectionMatrix(); } }
  for (const m of labels) m.lookAt(world);
  sky.position.copy(world); ctx.stars.position.copy(world);
  ctx.setPuffScale(renderer.domElement.height, eyeFar.fov);
  renderPass.camera = eyeFar; roomPass.enabled = true;
  composer.render();
  renderPass.camera = ctx.camera; smoke.points.visible = fire.points.visible = true;

  // 4. prompts
  let msg = '';
  if (!Room.docked) {
    if (near && near.id === 'launch') msg = L.ok ? `<b>E</b> Press the launch button: ${L.n} satellite${L.n === 1 ? '' : 's'} from Pad ${L.pad.id}` : `Launch console: ${L.why}`;
    else if (near) msg = `<b>E</b> Use the ${near.label.toLowerCase()}`;
    else if (!Room.locked) msg = 'Click the view to look around';
  }
  if (promptEl.innerHTML !== msg) promptEl.innerHTML = msg;
  const help = Room.docked ? '' : 'WASD move · mouse look · E use · 1 to 5 jump to a console · Esc frees the mouse';
  if (keysEl.textContent !== help) keysEl.textContent = help;
  return true;
};

// ---------- loading ----------
ctx.ready.then(() => {
  note.textContent = 'Loading the control room';
  new GLTFLoader().load('assets/models/controlroom.glb', gltf => {
    try {
      const info = buildRoom(gltf.scene); buildProps(info); tp(C, -13.6, 0, -0.03);
      const fonts = document.fonts ? Promise.all([document.fonts.load('20px "Press Start 2P"'), document.fonts.load('30px VT323')]).catch(() => {}) : Promise.resolve();
      fonts.then(() => { note.textContent = ''; Room.available = true; });
    } catch (e) { console.warn('Control room unavailable, staying on the dashboard.', e); note.textContent = ''; Room.error = String(e && e.stack || e); }
  }, p => { if (p.total) note.textContent = `Loading the control room ${Math.round(p.loaded / p.total * 100)}%`; }, e => { console.warn('Control room model failed to load.', e); note.textContent = ''; Room.error = String(e); });
});
