/* Starlink Launch Tycoon — 3D mission view.
   Reads the game state through window.Game and draws it. It never changes game state,
   so if this file fails to load the game carries on with the 2D art. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const V = window.View3D = { ready: false, force: null };
const host = document.getElementById('scene'), canvas = document.getElementById('gl'), note = document.getElementById('loadNote');

// ---------- layout of the world (metres) ----------
const ROCKET_Y = 5.2;                           // top of the launch mount
const LZ = new THREE.Vector3(420, 0, -260);     // landing zone on shore, in view of the control room
const SHIP = new THREE.Vector3(9000, 0, 800);   // drone ship out at sea
const UP = new THREE.Vector3(0, 1, 0);
const SUN_GROUND = new THREE.Vector3(-0.5, 0.3, 0.81).normalize();
const SUN_SPACE = new THREE.Vector3(-0.35, 0.7, 0.62).normalize();
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 1, b) => b === undefined ? (Math.random() * 2 - 1) * a : a + Math.random() * (b - a);

let renderer, composer, bloom, scene, camera, sun, hemi;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) { note.textContent = ''; throw e; }
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
scene = new THREE.Scene();
renderer.setClearColor(0x000004, 1); // no scene.background: the control room draws the world and the room as two passes
camera = new THREE.PerspectiveCamera(42, 1.5, 2, 90000);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.86, 0.68), 1.8); scene.add(sun, sun.target);
hemi = new THREE.HemisphereLight(0x8fb0ff, 0x4d4338, 0.45); scene.add(hemi);
const fog = new THREE.FogExp2(new THREE.Color(0.36, 0.47, 0.72).convertLinearToSRGB().getHex(), 4.5e-5);

composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.75, 2.4);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const ground = new THREE.Group(), space = new THREE.Group(), globe = new THREE.Group(), actors = new THREE.Group();
scene.add(ground, space, globe, actors);

// ---------- procedural textures ----------
function hash(x, y) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}
function fbm(x, y, oct) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2.03; } return s; }
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function pixelTex(size, fn, srgb = true) {
  return canvasTex(size, size, (g) => {
    const img = g.createImageData(size, size), d = img.data, c = [0, 0, 0];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { fn(x / size, y / size, c); const i = (y * size + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, srgb);
}
const std = (color, roughness = 0.9, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

// ---------- sky, stars ----------
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0.012, 0.075, 0.36) }, horizon: { value: new THREE.Color(0.36, 0.47, 0.72) }, sunDir: { value: SUN_GROUND }, space: { value: 0 } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 top, horizon, sunDir; uniform float space; varying vec3 vDir;
    void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.0);
      vec3 c = mix(horizon, top, pow(h + 1e-4, 0.36));
      float s = max(dot(d, sunDir), 0.0);
      c += vec3(1.0, 0.5, 0.2) * pow(s, 6.0) * 0.5 * (1.0 - h) + vec3(1.0, 0.62, 0.3) * pow(s, 40.0) * 0.7 + vec3(1.0, 0.9, 0.75) * pow(s, 1400.0) * 14.0;
      c = mix(c, horizon * 0.9, smoothstep(0.0, -0.06, d.y));
      gl_FragColor = vec4(c * (1.0 - space), 1.0); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 32, 16), skyMat); sky.renderOrder = -10; sky.frustumCulled = false; ground.add(sky);
const starGeo = new THREE.BufferGeometry();
{
  const n = 2600, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = new THREE.Vector3(rnd(1), rnd(1), rnd(1)).normalize().multiplyScalar(50000); p.set([v.x, v.y, v.z], i * 3); }
  starGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
}
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
const stars = new THREE.Points(starGeo, starMat); stars.frustumCulled = false; stars.renderOrder = -9; scene.add(stars);

// ---------- ground: coast, launch pad, landing zone, drone ship ----------
function buildGround() {
  const landTex = pixelTex(1024, (u, v, c) => {
    const n = fbm(u * 16, v * 16, 5), n2 = fbm(u * 5 + 40, v * 5 + 9, 3), n3 = fbm(u * 90, v * 90, 2);
    let r = lerp(40, 96, n), g = lerp(62, 110, n), b = lerp(34, 60, n);
    if (n2 > 0.56) { const k = Math.min(1, (n2 - 0.56) * 6); r = lerp(r, 120, k); g = lerp(g, 108, k); b = lerp(b, 76, k); }  // dry scrub
    if (n < 0.4) { const k = Math.min(1, (0.4 - n) * 5); r = lerp(r, 24, k); g = lerp(g, 44, k); b = lerp(b, 26, k); }       // tree cover
    const d = 0.9 + n3 * 0.2; r *= d; g *= d; b *= d;
    if (u > 0.985) { const k = Math.min(1, (u - 0.985) / 0.008); r = lerp(r, 206, k); g = lerp(g, 188, k); b = lerp(b, 150, k); } // beach
    c[0] = r; c[1] = g; c[2] = b;
  });
  const land = new THREE.Mesh(new THREE.PlaneGeometry(30000, 44000), new THREE.MeshStandardMaterial({ map: landTex, roughness: 1 }));
  land.rotation.x = -Math.PI / 2; land.position.set(760 - 15000, 0, 0); ground.add(land);
  const waveTex = pixelTex(256, (u, v, c) => { const n = fbm(u * 24, v * 24, 4) * 255; c[0] = c[1] = c[2] = n; }, false);
  waveTex.wrapS = waveTex.wrapT = THREE.RepeatWrapping; waveTex.repeat.set(700, 700);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(160000, 160000), new THREE.MeshStandardMaterial({ color: 0x0c3358, roughness: 0.3, metalness: 0.15, bumpMap: waveTex, bumpScale: 3 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -5; ground.add(sea);

  // launch complex
  const pad = new THREE.Group(); ground.add(pad);
  const concrete = std(0x8d8a84, 0.95), dark = std(0x2c2e33, 0.8), white = std(0xe9e9e6, 0.6), steel = std(0x9aa0a8, 0.5, 0.6);
  const add = (geo, mat, x, y, z, parent = pad) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  add(new THREE.CylinderGeometry(105, 105, 0.6, 56), concrete, 0, 0.3, 0);
  add(new THREE.BoxGeometry(17, ROCKET_Y - 0.6, 17), dark, 0, 0.6 + (ROCKET_Y - 0.6) / 2, 0);
  add(new THREE.BoxGeometry(15, 1.2, 80), dark, 0, 0.7, -52);
  for (const [x, z] of [[78, 78], [-78, 78], [78, -78], [-78, -78]]) { add(new THREE.CylinderGeometry(0.7, 1.9, 100, 8), steel, x, 50, z); add(new THREE.CylinderGeometry(0.12, 0.3, 26, 6), white, x, 113, z); }
  add(new THREE.CylinderGeometry(1.8, 2.2, 46, 12), white, -64, 23, -70); add(new THREE.SphereGeometry(8, 20, 14), white, -64, 50, -70);
  add(new THREE.SphereGeometry(8, 24, 16), white, -150, 8.4, -150, ground); add(new THREE.SphereGeometry(8, 24, 16), white, -172, 8.4, -140, ground);
  const tank = add(new THREE.CylinderGeometry(4.5, 4.5, 30, 20), white, -120, 5, -160, ground); tank.rotation.z = Math.PI / 2;
  add(new THREE.BoxGeometry(70, 20, 38), white, -210, 10, 60, ground); add(new THREE.BoxGeometry(72, 1.2, 40), dark, -210, 20.6, 60, ground);
  add(new THREE.BoxGeometry(120, 0.3, 14), dark, -150, 0.25, 60, ground);

  // landing zone
  const markTex = (bg, ring) => canvasTex(512, 512, (g, w) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, w);
    g.strokeStyle = '#f2f2ee'; g.lineWidth = 12; g.beginPath(); g.arc(w / 2, w / 2, w * ring, 0, 7); g.stroke();
    g.fillStyle = '#3b3c40'; g.beginPath(); g.arc(w / 2, w / 2, w * ring * 0.52, 0, 7); g.fill();
    g.strokeStyle = '#f2f2ee'; g.lineWidth = 22; g.lineCap = 'butt'; const k = w * ring * 0.3;
    g.beginPath(); g.moveTo(w / 2 - k, w / 2 - k); g.lineTo(w / 2 + k, w / 2 + k); g.moveTo(w / 2 + k, w / 2 - k); g.lineTo(w / 2 - k, w / 2 + k); g.stroke();
  });
  const R = Game.FLIGHT.land.padR, lz = new THREE.Mesh(new THREE.CircleGeometry(R / 0.7 * 0.5 / 0.5, 56), new THREE.MeshStandardMaterial({ map: markTex('#7d7a74', 0.35), roughness: 0.95 }));
  lz.rotation.x = -Math.PI / 2; lz.position.set(LZ.x, 0.35, LZ.z); ground.add(lz);

  // drone ship
  ship = new THREE.Group(); ship.position.copy(SHIP); ground.add(ship);
  add(new THREE.BoxGeometry(96, 6, 54), std(0x1b1d22, 0.7), 0, -3.05, 0, ship);
  const deckTex = canvasTex(1024, 576, (g, w, h) => {
    g.fillStyle = '#2f3237'; g.fillRect(0, 0, w, h); g.strokeStyle = '#d8b02a'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
    const r = Game.FLIGHT.land.shipR / 96 * w; g.strokeStyle = '#f2f2ee'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, h / 2, r, 0, 7); g.stroke();
    g.lineWidth = 20; const k = r * 0.45; g.beginPath(); g.moveTo(w / 2 - k, h / 2 - k); g.lineTo(w / 2 + k, h / 2 + k); g.moveTo(w / 2 + k, h / 2 - k); g.lineTo(w / 2 - k, h / 2 + k); g.stroke();
  });
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(96, 54), new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 })); deck.rotation.x = -Math.PI / 2; deck.position.y = 0.02; ship.add(deck);
  for (const [x, z] of [[-42, -22], [42, -22], [-42, 22], [42, 22]]) add(new THREE.BoxGeometry(9, 5, 7), white, x, 2.5, z, ship);

  // helpers for the manual landing
  targetRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 0.7), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  targetRing.rotation.x = -Math.PI / 2; targetRing.visible = false; ground.add(targetRing);
  shadow = new THREE.Mesh(new THREE.CircleGeometry(7, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.visible = false; ground.add(shadow);
  beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 3000, 8, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.6, 0.55), transparent: true, opacity: 0.25, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  beam.visible = false; ground.add(beam);
}
let ship, targetRing, shadow, beam;

// ---------- particles ----------
class Puffs {
  constructor(n, additive) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.age = new Float32Array(n).fill(1e9); this.life = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n); this.drag = new Float32Array(n); this.rise = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4)); g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 500 } },
      vertexShader: 'attribute vec4 aCol; attribute float aSize; uniform float uScale; varying vec4 vCol; void main(){ vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(1.0, -mv.z); gl_Position = aSize > 0.0 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0); }',
      fragmentShader: 'varying vec4 vCol; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.15, d) * vCol.a; if (a < 0.003) discard; gl_FragColor = vec4(vCol.rgb, a); }',
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 6 : 5; scene.add(this.points);
  }
  emit(p, vx, vy, vz, life, s0, s1, r, g, b, a, drag = 0.6, rise = 0) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.col.set([r, g, b, 0], i * 4);
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a; this.drag[i] = drag; this.rise[i] = rise; this.size[i] = s0;
  }
  update(dt) {
    const { n, pos, vel, age, life, size, col } = this;
    for (let i = 0; i < n; i++) {
      if (age[i] >= life[i]) { if (size[i] !== 0) size[i] = 0; continue; }
      age[i] += dt; const k = Math.min(1, age[i] / life[i]), d = Math.exp(-this.drag[i] * dt), j = i * 3;
      vel[j] *= d; vel[j + 1] = vel[j + 1] * d + this.rise[i] * dt; vel[j + 2] *= d;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      size[i] = k >= 1 ? 0 : lerp(this.s0[i], this.s1[i], Math.sqrt(k));
      col[i * 4 + 3] = this.a0[i] * Math.pow(1 - k, 1.4) * Math.min(1, k * 10);
    }
    const a = this.points.geometry.attributes; a.position.needsUpdate = a.aCol.needsUpdate = a.aSize.needsUpdate = true;
  }
  clear() { this.age.fill(1e9); this.size.fill(0); }
}
const smoke = new Puffs(900, false), fire = new Puffs(500, true);
const P = new THREE.Vector3(), Q = new THREE.Vector3(), W = new THREE.Vector3();
function explode(at, k = 1) {
  for (let i = 0; i < 110; i++) { W.set(rnd(1), rnd(1), rnd(1)).normalize().multiplyScalar(rnd(15, 95) * k); fire.emit(at, W.x, W.y, W.z, rnd(0.5, 1.7), 8 * k, rnd(26, 60) * k, 7, rnd(2.2, 4), 0.8, 0.9, 1.6, 6); }
  for (let i = 0; i < 80; i++) { W.set(rnd(1), rnd(1) * 0.7 + 0.3, rnd(1)).normalize().multiplyScalar(rnd(8, 50) * k); smoke.emit(at, W.x, W.y, W.z, rnd(2.5, 5), 10 * k, rnd(40, 90) * k, 0.16, 0.14, 0.13, 0.7, 0.9, 3); }
}
function groundSmoke(at, power, spread = 1, warm = 1) {
  const n = Math.round(power * 5 + Math.random());
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, sp = rnd(18, 60) * spread;
    P.set(at.x + Math.cos(a) * 4, at.y + rnd(0.5, 3), at.z + Math.sin(a) * 4);
    const l = rnd(0.72, 0.98);
    smoke.emit(P, Math.cos(a) * sp, rnd(2, 14), Math.sin(a) * sp, rnd(3, 6.5), 6 * spread, rnd(26, 52) * spread, l, l * lerp(0.95, 0.86, warm), l * lerp(0.92, 0.72, warm), 0.38, 1.1, 2.4);
  }
}

// ---------- flames ----------
function makeFlame(r0, r1, core, edge) {
  const g = new THREE.CylinderGeometry(r0, r1, 1, 24, 6, true); g.translate(0, -0.5, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { time: { value: 0 }, power: { value: 1 }, core: { value: new THREE.Color(...core) }, edge: { value: new THREE.Color(...edge) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float time, power; uniform vec3 core, edge; varying vec2 vUv;
      void main(){ float v = 1.0 - vUv.y; float f = 0.82 + 0.18 * sin(time * 61.0 + v * 26.0) * sin(time * 37.0 + vUv.x * 31.0);
        float w = clamp(1.0 - v, 0.0, 1.0); float a = pow(w, 1.7) * f * power; vec3 c = mix(edge, core, pow(w, 3.5));
        gl_FragColor = vec4(c * a * 1.7, 1.0); }`,
  });
  const grp = new THREE.Group(), outer = new THREE.Mesh(g, mat), inner = new THREE.Mesh(g, mat);
  inner.scale.set(0.5, 0.6, 0.5); grp.add(outer, inner); grp.userData.mat = mat; grp.visible = false;
  const light = new THREE.PointLight(new THREE.Color(...edge), 0, 900, 1.6); light.position.y = -12; grp.add(light); grp.userData.light = light;
  return grp;
}
function setFlame(f, power, len, wide, time) {
  f.visible = power > 0.01; if (!f.visible) { f.userData.light.intensity = 0; return; }
  f.userData.mat.uniforms.power.value = power; f.userData.mat.uniforms.time.value = time;
  f.scale.set(wide, len * (0.94 + 0.06 * Math.sin(time * 47)), wide); f.userData.light.intensity = power * 60000 / Math.max(1, len * 0.05) * (f.userData.lightK || 1);
}

// ---------- models ----------
let booster, upper, fairA, fairB, legs = [], boosterFlame, upperFlame, payload, slabs = [], strong, strongPivot, earthHolder, satInst = [], globeSats, sepY = 48, fairY = 9, stackTopY = 15;
const dummy = new THREE.Object3D(), QX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2), QI = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
const tune = m => { if (m.isMesh && m.material) { m.material.envMapIntensity = 0.32; } };

function setupRocket(gltf) {
  const root = gltf.scene, holder = new THREE.Group(); holder.add(root); scene.add(holder); holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), s = 70 / (box.max.y - box.min.y), c = box.getCenter(new THREE.Vector3());
  holder.scale.setScalar(s); holder.position.set(-c.x * s, -box.min.y * s, -c.z * s); holder.updateMatrixWorld(true);
  root.traverse(tune);
  const find = n => root.getObjectByName(n), wy = n => find(n).getWorldPosition(new THREE.Vector3()).y;
  sepY = wy('Second_Stage'); fairY = wy('Fairing') - sepY;
  booster = new THREE.Group(); upper = new THREE.Group(); upper.position.y = sepY; actors.add(booster, upper); actors.updateMatrixWorld(true);
  fairA = new THREE.Group(); fairB = new THREE.Group(); fairA.position.y = fairB.position.y = fairY; upper.add(fairA, fairB); upper.updateMatrixWorld(true);
  const nozzleY = new THREE.Box3().setFromObject(find('Second_Stage')).min.y - sepY;
  booster.attach(find('First_Stage')); upper.attach(find('Second_Stage')); fairA.attach(find('Fairing_1')); fairB.attach(find('Fairing_2'));
  for (let i = 1; i <= 4; i++) {
    const leg = booster.getObjectByName('Landing_Leg_' + i); if (!leg) continue;
    const wp = leg.getWorldPosition(new THREE.Vector3()), pivot = new THREE.Group(); pivot.position.copy(wp); booster.add(pivot); booster.updateMatrixWorld(true); pivot.attach(leg);
    legs.push({ pivot, axis: new THREE.Vector3().crossVectors(UP, new THREE.Vector3(wp.x, 0, wp.z).normalize()).normalize() });
  }
  scene.remove(holder);
  boosterFlame = makeFlame(1.75, 0.5, [3.0, 2.3, 1.4], [2.6, 0.85, 0.18]); boosterFlame.position.y = 0.6; booster.add(boosterFlame);
  upperFlame = makeFlame(1.25, 5.5, [0.55, 0.7, 1.1], [0.22, 0.2, 0.42]); upperFlame.userData.lightK = 0.03; upperFlame.position.y = nozzleY + 0.4; upper.add(upperFlame);
  // the satellite stack that sits inside the fairing
  payload = new THREE.Group(); payload.position.y = fairY + 0.4; upper.add(payload);
  const slabMat = std(0x30333a, 0.45, 0.7), slabGeo = new THREE.BoxGeometry(1.45, 0.24, 2.9);
  for (let i = 0; i < 22; i++) for (const x of [-0.78, 0.78]) { const m = new THREE.Mesh(slabGeo, slabMat); m.position.set(x, 0.14 + i * 0.29, 0); payload.add(m); slabs.push(m); }
  add(new THREE.CylinderGeometry(0.25, 0.25, 7.2, 8), std(0x8a8f99, 0.4, 0.8), payload, 0, 3.6, 1.6); add(new THREE.CylinderGeometry(0.25, 0.25, 7.2, 8), std(0x8a8f99, 0.4, 0.8), payload, 0, 3.6, -1.6);
  stackTopY = fairY + 7;
}
function add(geo, mat, parent, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; }
function setupStrongback(gltf) {
  const root = gltf.scene; root.traverse(tune); root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), s = 62 / (box.max.y - box.min.y);
  strong = new THREE.Group(); strong.add(root); root.scale.setScalar(s); root.position.y = -box.min.y * s;
  strong.rotation.y = Math.PI; // clamp arms face the rocket
  strongPivot = new THREE.Group(); strongPivot.add(strong); strongPivot.position.set(box.min.x * s - 1.95, ROCKET_Y - 4, 0); ground.add(strongPivot);
  V.strong = { strong, strongPivot, root };
}
function setupStarlink(gltf) {
  const root = gltf.scene; root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh) return; o.material.envMapIntensity = 1.1;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    const im = new THREE.InstancedMesh(g, o.material, 24); im.count = 0; im.frustumCulled = false; space.add(im); satInst.push(im);
  });
}
function setupEarth(gltf) {
  const root = gltf.scene; root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), r = (box.max.y - box.min.y) / 2 / 1.036;
  root.traverse(o => { if (o.isMesh) { o.material.envMapIntensity = 0; o.material.side = THREE.FrontSide; if (o.material.transparent) o.material.depthWrite = false; } });
  const inner = new THREE.Group(); inner.add(root); root.position.sub(c); inner.scale.setScalar(1 / r);
  earthHolder = new THREE.Group(); earthHolder.add(inner); scene.add(earthHolder);
  // markers for the constellation view
  const g = new THREE.BoxGeometry(1.5, 0.5, 4.4), m = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  globeSats = new THREE.InstancedMesh(g, m, 700); globeSats.count = 0; globeSats.frustumCulled = false; globe.add(globeSats);
}

// ---------- per-frame helpers ----------
function placeStack(pos, quat) {
  booster.position.copy(pos); booster.quaternion.copy(quat);
  upper.position.set(0, sepY, 0).applyQuaternion(quat).add(pos); upper.quaternion.copy(quat);
}
function setLegs(k) { for (const l of legs) l.pivot.quaternion.setFromAxisAngle(l.axis, 2.05 * k); }
function setFairing(q) {
  fairA.visible = fairB.visible = q < 0.999;
  fairA.position.set(q * 26, fairY - q * 30, 0); fairA.rotation.set(0, 0, -q * 1.3);
  fairB.position.set(-q * 26, fairY - q * 30, 0); fairB.rotation.set(0, 0, q * 1.3);
}
function ascentPos(t, out) { const h = 4 * t * t + 0.6 * Math.pow(t, 5), x = 0.9 * Math.pow(t, 5) * sm(2.5, 8, t); return out.set(x, ROCKET_Y + h, 0); }
let colorSig = '';
function updateGlobeSats(time) {
  const orbit = Game.S.orbit, total = orbit.reduce((a, b) => a + b, 0), MAX = 700, sig = orbit.join(',');
  if (sig !== colorSig) {
    colorSig = sig; let k = 0; const col = new THREE.Color();
    orbit.forEach((n, i) => { const c = total <= MAX ? n : n ? Math.max(1, Math.round(n / total * MAX)) : 0; col.set(Game.TIERS[i].color).multiplyScalar(2.2); for (let j = 0; j < c && k < MAX; j++) globeSats.setColorAt(k++, col); });
    globeSats.count = k; if (globeSats.instanceColor) globeSats.instanceColor.needsUpdate = true;
  }
  const n = globeSats.count, RINGS = 9;
  for (let i = 0; i < n; i++) {
    const ring = i % RINGS, inc = 0.25 + ring * 0.14, node = ring * 2.1, r = 112 + (ring % 3) * 6, th = i * 2.39996 + time * (0.05 + ring * 0.004) * (ring % 2 ? 1 : -1);
    dummy.position.set(Math.cos(th) * r, 0, Math.sin(th) * r).applyAxisAngle(V_X, inc).applyAxisAngle(UP, node);
    dummy.lookAt(0, 0, 0); dummy.updateMatrix(); globeSats.setMatrixAt(i, dummy.matrix);
  }
  globeSats.instanceMatrix.needsUpdate = true;
}
const V_X = new THREE.Vector3(1, 0, 0), V_Z = new THREE.Vector3(0, 0, 1);
function setSats(n, fn) { // fn(i, dummy) returns false to hide
  for (const im of satInst) im.count = n;
  for (let i = 0; i < n; i++) {
    dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
    if (fn(i, dummy) === false) dummy.scale.setScalar(0);
    dummy.updateMatrix(); for (const im of satInst) im.setMatrixAt(i, dummy.matrix);
  }
  for (const im of satInst) im.instanceMatrix.needsUpdate = true;
}
const SETS = { orbit: 'globe', pad: 'ground', ignite: 'ground', ascent: 'ground', failed: 'ground', return: 'ground', landing: 'ground', landed: 'ground', mlanding: 'ground', coast: 'space', deploy: 'space', deorbit: 'space' };
const prev = { key: '', mid: -1, set: '' }, lastPos = new THREE.Vector3(0, 60, 0), prevNozzle = new THREE.Vector3(), look = new THREE.Vector3(), camGoal = new THREE.Vector3();
let keyT = 0, shake = 0, spaceK = 0, flag = false, flameK = 0;

function update(I, dt, time) {
  const key = SETS[I.key] ? I.key : 'orbit', m = I.m || {}, set = SETS[key], changed = key !== prev.key || m.id !== prev.mid;
  if (changed) {
    if (set !== prev.set || key === 'pad' || key === 'return') { smoke.clear(); fire.clear(); }
    prev.key = key; prev.mid = m.id; prev.set = set; keyT = 0; flag = false; prevNozzle.set(0, -1e6, 0);
  } else keyT += dt;
  const p = I.p || 0, site = I.ship ? SHIP : LZ, legLift = 1.9;
  ground.visible = set === 'ground'; space.visible = set === 'space'; globe.visible = set === 'globe';
  earthHolder.visible = set !== 'ground'; scene.fog = set === 'ground' ? fog : null;
  booster.visible = upper.visible = false; strongPivot.visible = false; targetRing.visible = shadow.visible = beam.visible = false; payload.visible = true;
  ship.position.x = SHIP.x; shake = 0; spaceK = set === 'ground' ? 0 : 1;
  let bf = 0, bl = 40, bw = 1, uf = 0, fov = 42;
  for (const im of satInst) im.count = 0;
  sun.position.copy(set === 'ground' ? SUN_GROUND : SUN_SPACE); sun.intensity = set === 'ground' ? 1.8 : 2.2; hemi.intensity = set === 'ground' ? 0.45 : 0.06;
  camera.near = set === 'globe' ? 1 : 2; camera.far = 90000;

  if (key === 'orbit') {
    earthHolder.position.set(0, 0, 0); earthHolder.scale.setScalar(100); earthHolder.rotation.set(0.25, time * 0.02, 0);
    const az = time * 0.035; camera.position.set(Math.sin(az) * 335, 95, Math.cos(az) * 335); look.set(0, 0, 0); fov = 40;
    sun.position.set(Math.sin(az + 0.6), 0.4, Math.cos(az + 0.6)).normalize(); hemi.intensity = 0.2; sun.intensity = 3.2;
    updateGlobeSats(time);
  } else if (key === 'pad' || key === 'ignite') {
    booster.visible = upper.visible = strongPivot.visible = true; setLegs(0); setFairing(0);
    placeStack(P.set(0, ROCKET_Y, 0), QI); strongPivot.rotation.z = 0.012;
    if (key === 'pad') {
      const az = Math.sin(time * 0.11) * 0.42; camera.position.set(Math.sin(az) * 128, 9, Math.cos(az) * 128); look.set(0, 39, 0); fov = 38;
      if (Math.random() < 0.5) { P.set(1.9, rnd(24, 44), rnd(1)); smoke.emit(P, rnd(4, 9), rnd(-1, 1), rnd(2), rnd(1.5, 3), 0.8, rnd(5, 9), 1, 1, 1, 0.3, 0.5, 0.5); }
    } else {
      camera.position.set(22, 10, 118); look.set(0, 22, 0); fov = 34; bf = sm(0, 0.8, p); bl = 14 + 22 * p; shake = 0.25 * p;
      groundSmoke(P.set(0, 1, 0), 0.8 * p, 0.45);
    }
    lastPos.set(0, 40, 0);
  } else if (key === 'ascent') {
    const u = I.u !== undefined ? I.u : p, t = u * 8;
    booster.visible = upper.visible = strongPivot.visible = true; setLegs(0); setFairing(0);
    ascentPos(t, P); ascentPos(t + 0.04, Q); W.copy(Q).sub(P); if (W.lengthSq() < 1e-8) W.copy(UP); W.normalize();
    qa.setFromUnitVectors(UP, W); placeStack(P, qa);
    strongPivot.rotation.z = 0.012 + 0.2 * sm(0, 0.14, u);
    spaceK = sm(0.5, 1.05, u) * 0.94; bf = 1; bl = 62 + 170 * sm(0.15, 1, u); bw = 1 + 2.4 * spaceK;
    Q.copy(W).multiplyScalar(32).add(P); lastPos.copy(Q);
    if (u < 0.42) {
      camera.position.set(60, 6, 300); look.copy(Q); fov = lerp(40, 15, sm(0.08, 0.42, u)); shake = 0.45 * (1 - sm(0, 0.4, u));
      groundSmoke(Q.set(0, 1, 0), 3.2 * (1 - sm(0.12, 0.34, u)), 1.25);
    } else {
      const D = lerp(150, 300, sm(0.42, 1, u)); camera.position.set(Q.x - 0.3 * D, Q.y - 0.2 * D, Q.z + 0.92 * D); look.copy(Q); fov = 40; shake = 0.12;
    }
    // exhaust trail, filled in along the path so it stays continuous at speed
    Q.copy(W).multiplyScalar(-bl * 0.55).add(P);
    if (prevNozzle.y > -1e5 && u > 0.1) {
      const n = Math.min(14, 2 + Math.floor(prevNozzle.distanceTo(Q) / 14)), k = 1 + 3 * sm(0.3, 1, u), l = 0.93;
      for (let i = 0; i < n; i++) { camGoal.lerpVectors(prevNozzle, Q, (i + Math.random()) / n); smoke.emit(camGoal, rnd(5) - W.x * 20, rnd(5) - W.y * 20, rnd(5), rnd(2.4, 4.2), 9 * k, rnd(26, 44) * k, l, l * 0.92, l * 0.84, 0.42 * (1 - spaceK * 0.75), 0.4, 0); }
    }
    prevNozzle.copy(Q);
  } else if (key === 'failed') {
    if (!flag) { flag = true; explode(lastPos, 1.6); }
    look.copy(lastPos); spaceK = 0.2; fov = camera.fov;
  } else if (key === 'coast' || key === 'deploy' || key === 'deorbit') {
    earthHolder.scale.setScalar(2600); earthHolder.position.set(0, -2600 - 52, 0); earthHolder.rotation.set(0.4, 1.2, time * 0.012 + 2.2);
    upper.visible = true; upper.position.set(0, 0, 0); upper.quaternion.copy(QX);
    const count = Math.min(m.count || 10, satInst.length ? 22 : 0), topX = stackTopY, dur = Game.BASE.deploy;
    if (key === 'coast') {
      booster.visible = p < 0.8; setLegs(0);
      qa.setFromAxisAngle(V_Z, 2.5 * sm(0.12, 0.95, p)); booster.quaternion.copy(QX).multiply(qa);
      booster.position.set(-sepY - 30 * p - 620 * p * p, -150 * p * p, 60 * p * p); bf = p > 0.5 && p < 0.78 ? 0.7 : 0; bl = 30; bw = 0.6;
      uf = sm(0.05, 0.14, p); setFairing(sm(0.5, 0.86, p));
      if (!flag) { flag = true; for (let i = 0; i < 30; i++) { P.set(rnd(1.5), rnd(1.5), rnd(1.5)); smoke.emit(P, rnd(14), rnd(14), rnd(14), rnd(0.8, 1.6), 1.5, rnd(8, 16), 1, 1, 1, 0.35, 1.2, 0); } }
      const az = 0.95 - 1.15 * p, D = 88; camera.position.set(12 + Math.sin(az) * D, 34 - 8 * p, Math.cos(az) * D); look.set(10 - 14 * (1 - p), -7, 0); fov = 42;
    } else if (key === 'deploy') {
      setFairing(1);
      const out = i => p - (i / count) * 0.72;
      slabs.forEach((s, i) => { s.visible = out(Math.floor(i / slabs.length * count)) <= 0; });
      setSats(count, (i, d) => {
        const tau = out(i) * dur; if (tau <= 0) return false;
        d.position.set(topX + 2 + 8.5 * tau + i * 0.35, Math.sin(i * 2.4) * 1.5 * tau, Math.cos(i * 1.9) * 1.7 * tau);
        d.rotation.set(tau * 0.22 * (i % 2 ? 1 : -1), i * 0.7 + tau * 0.12, -Math.PI / 2 + Math.sin(i) * 0.3);
      });
      camera.position.set(64 + 8 * p, 26, 44); look.set(30, -5, 0); fov = 44;
    } else {
      setFairing(1); payload.visible = false;
      setSats(count, (i, d) => {
        const tau = (1 - (i / count) * 0.72) * dur + p * Game.BASE.deorbit;
        d.position.set(topX + 2 + 8.5 * tau + i * 0.35, Math.sin(i * 2.4) * 1.5 * tau, Math.cos(i * 1.9) * 1.7 * tau);
        d.rotation.set(tau * 0.22 * (i % 2 ? 1 : -1), i * 0.7 + tau * 0.12, -Math.PI / 2 + Math.sin(i) * 0.3);
      });
      const fall = sm(0.5, 1, p);
      qa.setFromAxisAngle(V_Z, Math.PI * sm(0, 0.3, p)); upper.quaternion.copy(QX).multiply(qa);
      upper.position.set(-70 * fall, -90 * fall * fall, 0);
      uf = sm(0.3, 0.36, p) * (1 - sm(0.52, 0.58, p));
      const heat = sm(0.6, 0.92, p);
      if (heat > 0 && p < 0.93) for (let i = 0; i < 1 + heat * 5; i++) { P.set(rnd(3), rnd(3), rnd(3)).add(upper.position); fire.emit(P, 30 + rnd(8), 22 + rnd(8), rnd(8), rnd(0.4, 1.0), 4 + 6 * heat, 1, 7, 2.8 + rnd(0.6), 0.7, 0.6 * heat, 0.3, 0); }
      if (p >= 0.93) { upper.visible = false; if (!flag) { flag = true; explode(upper.position, 0.5); } }
      camera.position.set(-36, 38, 96); look.copy(upper.position).multiplyScalar(0.8); look.y -= 8; fov = 44;
    }
  } else if (key === 'return') {
    booster.visible = true; setLegs(0);
    const ret = I.ret || 0, h = 2500 + ret * 105;
    P.set(site.x + Math.sin(time * 0.6) * 4, h, site.z); booster.position.copy(P); booster.quaternion.copy(QI);
    bf = ret > 13 && ret < 19 ? 0.85 : 0; bl = 34; bw = 0.6; spaceK = 0.12;
    camera.position.set(P.x + 75, P.y + 85, P.z + 120); look.set(P.x, P.y + 4, P.z); fov = 44;
  } else if (key === 'landing' || key === 'landed') {
    const lost = key === 'landed' && m.landQ === 'lost', hard = key === 'landed' && m.landQ === 'hard';
    const pp = key === 'landed' ? 1 : p, h = 900 * Math.pow(1 - pp, 2.3), lk = sm(0.55, 0.82, pp);
    booster.visible = !lost; setLegs(lk); P.set(site.x, h + legLift * lk, site.z); booster.position.copy(P);
    booster.quaternion.setFromAxisAngle(V_Z, hard ? 0.09 : 0);
    bf = key === 'landing' && pp > 0.18 ? 1 : 0; bl = 26; bw = 0.5;
    if (bf && h < 110) groundSmoke(Q.set(site.x, 0.5, site.z), 2 * (1 - h / 110), 0.7, I.ship ? 0 : 0.6);
    if (key === 'landed' && !flag) { flag = true; if (lost) explode(Q.set(site.x, 14, site.z), 1.3); else groundSmoke(Q.set(site.x, 0.5, site.z), 2.5, 0.5, 0.4); }
    if (lost && Math.random() < 0.5) { Q.set(site.x + rnd(6), 4, site.z + rnd(6)); smoke.emit(Q, rnd(3), rnd(8, 16), rnd(3), rnd(3, 5), 8, rnd(28, 46), 0.13, 0.12, 0.11, 0.6, 0.3, 2); }
    camera.position.set(site.x + 150 - 30 * (key === 'landed' ? p : 0), 13, site.z + 205); look.set(site.x, 12 + h * 0.62, site.z); fov = 40;
  } else if (key === 'mlanding') {
    const g = Game.ui.game;
    if (g) {
      const tx = site.x + g.padX, crash = g.done && g.result === 'crash', lk = 1 - sm(130, 360, g.y);
      if (I.ship) ship.position.x = tx;
      booster.visible = !crash; setLegs(lk);
      booster.position.set(site.x + g.x, g.y + legLift * lk, site.z); booster.quaternion.setFromAxisAngle(V_Z, -g.ang);
      flameK = lerp(flameK, g.burning ? 1 : 0, Math.min(1, dt * 14)); bf = flameK; bl = 30; bw = 0.52;
      if (g.burning && g.y < 90) groundSmoke(Q.set(site.x + g.x, 0.5, site.z), 2 * (1 - g.y / 90), 0.7, I.ship ? 0 : 0.6);
      if (g.done && !flag) { flag = true; Q.set(site.x + g.x, 12, site.z); if (crash) explode(Q, 1.3); else groundSmoke(Q.setY(0.5), 2.5, 0.5, 0.4); }
      targetRing.visible = !g.done; targetRing.position.set(tx, I.ship ? 0.5 : 0.8, site.z); targetRing.scale.setScalar(g.padR); targetRing.material.opacity = 0.55 + 0.35 * Math.sin(time * 6);
      shadow.visible = !crash && Math.abs(g.x - g.padX) < (I.ship ? 46 : 5000); shadow.position.set(site.x + g.x, I.ship ? 0.45 : 0.75, site.z); shadow.material.opacity = 0.5 * (1 - sm(0, 700, g.y)) + 0.08; shadow.scale.setScalar(1 + g.y / 220);
      beam.visible = !g.done; beam.position.set(tx, 1500, site.z); beam.material.opacity = 0.2 + 0.08 * Math.sin(time * 5);
      // Stay close enough to read the booster; the guide beam shows where the target is until the pad comes into view.
      const off = Math.abs(g.x - g.padX), D = Math.max(Math.min(560, 185 + g.y * 0.45), off * 0.95 + 150), cx = site.x + (g.x + g.padX) / 2;
      const ly = Math.max(g.y + 30 - D * 0.16, D * 0.2);
      camGoal.set(cx, ly + D * 0.04 + 4, site.z + D);
      if (keyT < 0.05) camera.position.copy(camGoal); else camera.position.lerp(camGoal, Math.min(1, dt * 8));
      look.set(cx, ly, site.z); fov = 46; shake = g.burning ? 0.06 : 0;
    }
  }

  // shared finishing touches
  if (key !== 'failed') { camera.fov = fov; }
  if (shake) camera.position.add(W.set(rnd(shake), rnd(shake), rnd(shake)));
  camera.lookAt(look); camera.updateProjectionMatrix();
  setFlame(boosterFlame, booster.visible ? bf : 0, bl, bw, time); setFlame(upperFlame, upper.visible ? uf : 0, 30, 1, time);
  skyMat.uniforms.space.value = spaceK; starMat.opacity = set === 'ground' ? spaceK * spaceK : 1;
  fog.density = 4.5e-5 * (1 - spaceK);
  sky.position.copy(camera.position); stars.position.copy(camera.position);
}

// ---------- sizing and main loop ----------
let vw = 0, vh = 0;
function resize() {
  const w = host.clientWidth, h = host.clientHeight; if (!w || !h || (w === vw && h === vh)) return;
  vw = w; vh = h; const pr = Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2);
  renderer.setPixelRatio(pr); renderer.setSize(w, h, false); composer.setPixelRatio(pr); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
let last = performance.now(), clock = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || !V.ready) return;
  const dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
  resize();
  let I = V.force ? Object.assign({ p: 0, ship: false, m: { id: -5, count: 12, landQ: 'ok' } }, V.force) : Game.info();
  if (V.roomInfo) I = V.roomInfo(I);
  update(I, dt, clock);
  if (V.cam) { camera.position.fromArray(V.cam.pos); camera.fov = V.cam.fov || 40; camera.lookAt(look.fromArray(V.cam.look)); camera.updateProjectionMatrix(); sky.position.copy(camera.position); } // debug camera
  smoke.update(dt); fire.update(dt);
  if (V.roomFrame && V.roomFrame(I, dt, clock)) return; // the control room drew this frame
  setPuffScale(renderer.domElement.height, camera.fov);
  composer.render();
}
function setPuffScale(pixelHeight, fov) { smoke.mat.uniforms.uScale.value = fire.mat.uniforms.uScale.value = pixelHeight / (2 * Math.tan(fov * Math.PI / 360)); }

// ---------- shared with the control room (room.js) ----------
let readyResolve;
export const ctx = {
  THREE, V, renderer, composer, renderPass, scene, camera, ground, space, globe, actors, sky, skyMat, stars, starMat, fog, sun, hemi, smoke, fire,
  SUN_GROUND, ROCKET_Y, LZ, SETS, setPuffScale,
  parts: () => ({ booster, upper, strongPivot, earthHolder, sepY, boosterFlame, upperFlame }),
  ready: new Promise(r => { readyResolve = r; }),
};

// ---------- loading ----------
const manager = new THREE.LoadingManager();
manager.onProgress = (url, done, total) => { note.textContent = `Loading 3D models ${Math.round(done / total * 100)}%`; };
const loader = new GLTFLoader(manager), get = name => new Promise((res, rej) => loader.load(`assets/models/${name}.glb`, res, undefined, rej));
note.textContent = 'Loading 3D models';
Promise.all([get('falcon9'), get('strongback'), get('starlink'), get('earth')]).then(([falcon, sb, sat, earth]) => {
  buildGround(); setupRocket(falcon); setupStrongback(sb); setupStarlink(sat); setupEarth(earth);
  resize(); note.textContent = ''; V.ready = true; V.three = { THREE, scene, camera, booster, upper, legs };
  readyResolve();
}).catch(e => { console.warn('3D view unavailable, using 2D art.', e); note.textContent = ''; V.error = String(e); });
requestAnimationFrame(frame);
