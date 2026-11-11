/* Starlink Launch Tycoon — prototype. All balance numbers live in the CONFIG block below. */
(() => {
'use strict';

// ====================== CONFIG (tweak balance here) ======================
const TIERS = [
  { name: 'Starlink V1',                income: 1,   price: 100,     unlock: 0,       color: '#9fd0ff' },
  { name: 'Starlink V1.5',              income: 2,   price: 250,     unlock: 1500,    color: '#7ef0c0' },
  { name: 'Starlink V2 Mini',           income: 5,   price: 750,     unlock: 6000,    color: '#ffe066' },
  { name: 'Starlink V2',                income: 10,  price: 2000,    unlock: 25000,   color: '#ff9a4d' },
  { name: 'Starlink Direct-to-Cell',    income: 20,  price: 6000,    unlock: 100000,  color: '#ff6b8b' },
  { name: 'Starlink High-Capacity',     income: 40,  price: 18000,   unlock: 400000,  color: '#c58bff' },
  { name: 'Starlink Advanced',          income: 80,  price: 55000,   unlock: 1.5e6,   color: '#6be0ff' },
  { name: 'Starlink Laser Network',     income: 160, price: 170000,  unlock: 5e6,     color: '#ff5df0' },
  { name: 'Starlink Next Generation',   income: 320, price: 500000,  unlock: 1.6e7,   color: '#b6ff5d' },
  { name: 'Starlink Mega-Constellation',income: 640, price: 1500000, unlock: 5e7,     color: '#ffffff' },
];
const BASE = {
  prep: 8, ascent: 8, coast: 8, deploy: 4, deorbit: 6,   // seconds
  recovery: 30, refuel: 60, refuelCost: 60,
  capacity: 10,
  repairCost: 600, repairTime: 90,
  boosterPrice: 1500, boosterGrowth: 1.5, maxBoosters: 12,
  padPrice: 5000, padGrowth: 4, maxPads: 6,
  launchFail: 0.03, landFail: 0.07, deployFail: 0.04,
};
const GLOBAL_UPS = {
  guidance: { name: 'Guidance computers', desc: '-30% launch failure chance', costs: [2000, 10000, 50000] },
  legs:     { name: 'Landing legs',       desc: '-35% landing failure chance', costs: [1500, 8000, 40000] },
  crew:     { name: 'Experienced crews',  desc: '-35% deployment failure chance', costs: [1000, 6000, 30000] },
  fairing:  { name: 'Extended fairing',   desc: '+2 satellites per launch', costs: [3000, 12000, 48000, 200000, 800000] },
};
const PAD_UPS = {
  prep:     { name: 'Prep crew',      desc: '-20% prep time',     costs: [500, 2000, 8000] },
  fuel:     { name: 'Fuel pumps',     desc: '-20% refuel time',   costs: [800, 3000, 12000] },
  recovery: { name: 'Recovery ops',   desc: '-15% recovery time', costs: [800, 3000, 12000] },
  safety:   { name: 'Safety systems', desc: '-20% launch failure', costs: [1000, 4000, 16000] },
};
const B_LABEL = {
  ready: ['Ready', 'good'], onpad: ['On pad', 'flame'], flight: ['In flight', 'flame'],
  returning: ['Returning', 'warn'], landed: ['Landed · needs fuel', 'warn'],
  refueling: ['Refueling', 'warn'], damaged: ['Needs repair', 'bad'], repairing: ['Repairing', 'warn'],
};
const SAVE_KEY = 'starlink-launch-tycoon-v1';
const SPEED = Math.max(1, Math.min(60, Number(new URLSearchParams(location.search).get('speed')) || 1));
const OFFLINE_CAP = 8 * 3600;

// ====================== STATE ======================
const zeros = () => TIERS.map(() => 0);
function newState() {
  const inv = zeros(); inv[0] = 10;
  return {
    v: 1, cash: 0, lifetime: 0, flights: 0, clock: 0, unlocked: 1,
    inv, orbit: zeros(),
    boosters: [{ id: 1, state: 'ready', t: 0, dur: 0, flights: 0, refuelDur: BASE.refuel, mission: null }],
    pads: [{ id: 1, state: 'idle', booster: null, payload: zeros(), up: { prep: 0, fuel: 0, recovery: 0, safety: 0 } }],
    up: { guidance: 0, legs: 0, crew: 0, fairing: 0 },
    missions: [], log: [],
    nextBooster: 2, nextPad: 2, nextMission: 1,
    autoRefuel: true, muted: false, bailouts: 0,
    stats: { deployed: 0, lostSats: 0, landings: 0, boostersLost: 0, failures: 0 },
    lastSeen: Date.now(),
  };
}
let S = newState();
const ui = { tab: 'launch', pad: 1, focus: null, summary: null, quiet: false, lastView: '', lastIncome: 0 };

// ====================== HELPERS ======================
const $ = s => document.querySelector(s);
const sum = a => a.reduce((x, y) => x + y, 0);
const pad = id => S.pads.find(p => p.id === +id);
const booster = id => S.boosters.find(b => b.id === +id);
const income = () => S.orbit.reduce((t, n, i) => t + n * TIERS[i].income, 0);
const capacity = () => BASE.capacity + 2 * S.up.fairing;
const padPrep = p => BASE.prep * Math.pow(0.8, p.up.prep);
const padRefuel = p => BASE.refuel * Math.pow(0.8, p.up.fuel);
const padRecovery = p => BASE.recovery * Math.pow(0.85, p.up.recovery);
const boosterCost = () => Math.round(BASE.boosterPrice * Math.pow(BASE.boosterGrowth, S.boosters.length));
const padCost = () => Math.round(BASE.padPrice * Math.pow(BASE.padGrowth, S.pads.length - 1));
function odds(p) {
  if (S.flights === 0) return { launch: 1, land: 1, deploy: 1, first: true };
  return {
    launch: 1 - BASE.launchFail * Math.pow(0.7, S.up.guidance) * Math.pow(0.8, p.up.safety),
    land: 1 - BASE.landFail * Math.pow(0.65, S.up.legs),
    deploy: 1 - BASE.deployFail * Math.pow(0.65, S.up.crew),
  };
}
function money(n) {
  n = Math.floor(n + 1e-6);
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e7) return '$' + (n / 1e6).toFixed(2) + 'M';
  return '$' + n.toLocaleString('en-US');
}
const int = n => Math.floor(n).toLocaleString('en-US');
const pct = x => (x >= 0.9995 ? '100' : (x * 100).toFixed(1)) + '%';
function secs(t) { t = Math.max(0, Math.ceil(t)); return t >= 60 ? Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') : t + 's'; }
function clockStr(t) { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function log(msg, type = 'info') {
  S.log.unshift({ t: S.clock, msg, type });
  if (S.log.length > 60) S.log.length = 60;
}
const payloadText = pl => pl.map((n, i) => n ? `${n}× ${TIERS[i].name}` : '').filter(Boolean).join(', ');
const payloadIncome = pl => pl.reduce((t, n, i) => t + n * TIERS[i].income, 0);

// ====================== SOUND (tiny synth, no assets) ======================
const Sfx = {
  ctx: null,
  ok() { return !S.muted && !ui.quiet && this.ctx; },
  init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  tone(f, dur, type = 'square', vol = 0.06, to = null, delay = 0) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, freq = 400, vol = 0.25) {
    if (!this.ok()) return;
    const c = this.ctx, n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; f.type = 'lowpass'; f.frequency.setValueAtTime(freq, c.currentTime); f.frequency.exponentialRampToValueAtTime(Math.max(60, freq / 5), c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    src.connect(f).connect(g).connect(c.destination); src.start();
  },
  click() { this.tone(660, 0.05, 'square', 0.03); },
  buy() { this.tone(880, 0.07, 'square', 0.04); this.tone(1320, 0.09, 'square', 0.04, null, 0.06); },
  deny() { this.tone(160, 0.12, 'sawtooth', 0.04); },
  count() { this.tone(520, 0.08, 'square', 0.04); },
  liftoff() { this.noise(5, 900, 0.3); this.tone(70, 4, 'sawtooth', 0.05, 40); },
  sep() { this.tone(300, 0.15, 'triangle', 0.06, 150); },
  deploy() { [660, 880, 990, 1320].forEach((f, i) => this.tone(f, 0.12, 'square', 0.05, null, i * 0.1)); },
  land() { this.noise(1.2, 300, 0.2); this.tone(440, 0.12, 'square', 0.05, null, 0.9); this.tone(660, 0.2, 'square', 0.05, null, 1.02); },
  boom() { this.noise(1.8, 1400, 0.4); this.tone(110, 1.2, 'sawtooth', 0.07, 30); },
  unlock() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, 'square', 0.05, null, i * 0.11)); },
};
function fx(kind) { if (ui.quiet) return; const el = $('#sceneFx'); el.className = ''; void el.offsetWidth; el.className = kind; }
function pop(text, bad) { if (ui.quiet) return; const el = $('#scenePop'); el.textContent = text; el.className = ''; void el.offsetWidth; el.className = 'go' + (bad ? ' bad' : ''); }

// ====================== ACTIONS ======================
function loaded(p) { return sum(p.payload); }
function spend(cost) { if (S.cash + 1e-6 < cost) { Sfx.deny(); return false; } S.cash -= cost; return true; }

const ACT = {
  tab(x) { ui.tab = x; Sfx.click(); },
  selpad(x) { ui.pad = +x; Sfx.click(); },
  mute() { S.muted = !S.muted; if (!S.muted) { Sfx.init(); Sfx.click(); } },
  buy(x) { const [i, n] = x.split(':').map(Number); if (i >= S.unlocked) return; if (spend(TIERS[i].price * n)) { S.inv[i] += n; Sfx.buy(); } },
  load(x) {
    const [i, d] = x.split(':').map(Number), p = pad(ui.pad); if (!p || p.state !== 'idle') return;
    if (d > 0) { const n = Math.min(d, S.inv[i], capacity() - loaded(p)); S.inv[i] -= n; p.payload[i] += n; }
    else { const n = Math.min(-d, p.payload[i]); S.inv[i] += n; p.payload[i] -= n; }
    Sfx.click();
  },
  fill(x) {
    const i = +x, p = pad(ui.pad); if (!p || p.state !== 'idle') return;
    const f = fillPlan(p, i); if (f.total < 1) { Sfx.deny(); return; }
    S.cash -= f.cost; S.inv[i] += f.buy; S.inv[i] -= f.total; p.payload[i] += f.total; Sfx.buy();
  },
  launch() { launch(ui.pad); },
  refuel(x) { startRefuel(booster(x), true); },
  repair(x) { const b = booster(x); if (b && b.state === 'damaged' && spend(BASE.repairCost)) { b.state = 'repairing'; b.t = b.dur = BASE.repairTime; log(`Booster B${b.id} sent for repairs (${money(BASE.repairCost)}).`); Sfx.buy(); } },
  auto() { S.autoRefuel = !S.autoRefuel; Sfx.click(); },
  buybooster() {
    if (S.boosters.length >= BASE.maxBoosters) return;
    if (spend(boosterCost())) { const b = addBooster(); log(`New booster B${b.id} delivered and fueled.`, 'good'); Sfx.buy(); }
  },
  buypad() {
    if (S.pads.length >= BASE.maxPads) return;
    if (spend(padCost())) { const p = { id: S.nextPad++, state: 'idle', booster: null, payload: zeros(), up: { prep: 0, fuel: 0, recovery: 0, safety: 0 } }; S.pads.push(p); ui.pad = p.id; log(`Launch pad ${p.id} is operational.`, 'good'); Sfx.buy(); }
  },
  gup(k) { const u = GLOBAL_UPS[k], l = S.up[k]; if (l < u.costs.length && spend(u.costs[l])) { S.up[k]++; log(`Upgrade: ${u.name} level ${S.up[k]}.`, 'good'); Sfx.buy(); } },
  pup(x) { const [id, k] = x.split(':'), p = pad(id), u = PAD_UPS[k]; if (!p) return; const l = p.up[k]; if (l < u.costs.length && spend(u.costs[l])) { p.up[k]++; log(`Pad ${p.id}: ${u.name} level ${p.up[k]}.`, 'good'); Sfx.buy(); } },
  dismiss() { ui.summary = null; },
  reset() { if (confirm('Erase your save and start a new company?')) { localStorage.removeItem(SAVE_KEY); S = newState(); ui.pad = 1; ui.summary = null; ui.focus = null; log('New company founded. 10 satellites are waiting in the warehouse.'); } },
};
function fillPlan(p, i) {
  const room = capacity() - loaded(p), fromInv = Math.min(S.inv[i], room);
  const buy = Math.max(0, Math.min(room - fromInv, Math.floor((S.cash + 1e-6) / TIERS[i].price)));
  return { total: fromInv + buy, buy, cost: buy * TIERS[i].price, room };
}
function addBooster() { const b = { id: S.nextBooster++, state: 'ready', t: 0, dur: 0, flights: 0, refuelDur: BASE.refuel, mission: null }; S.boosters.push(b); return b; }
function startRefuel(b, manual) {
  if (!b || b.state !== 'landed') return;
  if (S.cash + 1e-6 < BASE.refuelCost) { if (manual) Sfx.deny(); return; }
  S.cash -= BASE.refuelCost; b.state = 'refueling'; b.t = b.dur = b.refuelDur || BASE.refuel;
  log(`Booster B${b.id} refueling (${money(BASE.refuelCost)}, ${secs(b.dur)}).`);
  if (manual) Sfx.buy();
}

function launch(pid) {
  const p = pad(pid); if (!p || p.state !== 'idle') return;
  const b = booster(p.booster), n = loaded(p);
  if (!b || n < 1) { Sfx.deny(); return; }
  const o = odds(p);
  const m = {
    id: S.nextMission++, pad: p.id, booster: b.id, payload: p.payload.slice(), count: n, t: 0,
    prep: padPrep(p), ascent: BASE.ascent, recovery: padRecovery(p), refuel: padRefuel(p),
    launchOK: Math.random() < o.launch, failAt: 0.35 + Math.random() * 0.5, boosterSurvives: Math.random() < 0.5,
    landOK: Math.random() < o.land, lost: zeros(),
    liftoff: false, sep: false, deploying: false, deployed: false, disposed: false, landDone: false, landed: false,
    over: false, hold: 0, summarized: false, closed: false, turn: '', lastCount: 99,
  };
  if (Math.random() >= o.deploy) {
    let k = Math.random() < 0.25 ? n : Math.max(1, Math.round(n * (0.2 + Math.random() * 0.3)));
    const bag = []; m.payload.forEach((c, i) => { for (let j = 0; j < c; j++) bag.push(i); });
    while (k-- > 0 && bag.length) m.lost[bag.splice(Math.floor(Math.random() * bag.length), 1)[0]]++;
  }
  p.payload = zeros(); p.state = 'prep';
  S.flights++; b.flights++; b.mission = m.id;
  S.missions.push(m); ui.focus = m.id; ui.summary = null;
  log(`Flight ${m.id}: countdown started on Pad ${p.id} with booster B${b.id} — ${payloadText(m.payload)}.`);
  Sfx.count();
}

// ====================== SIMULATION ======================
function tickMission(m, dt) {
  if (m.closed) return;
  if (m.hold > 0) m.hold -= dt;
  const p = pad(m.pad), b = booster(m.booster);
  if (!m.over) {
    m.t += dt;
    if (!m.liftoff) {
      const r = Math.ceil(m.prep - m.t);
      if (r !== m.lastCount && r > 0 && r <= 3) Sfx.count();
      m.lastCount = r;
      if (m.t >= m.prep) {
        m.liftoff = true; if (p) p.state = 'ascent'; if (b) b.state = 'flight';
        log(`Flight ${m.id}: liftoff from Pad ${m.pad}!`, 'good'); Sfx.liftoff(); fx('flash');
      }
    }
    if (m.liftoff && !m.sep) {
      if (!m.launchOK && m.t >= m.prep + m.ascent * m.failAt) {
        m.over = true; m.hold = 4; S.stats.failures++; S.stats.lostSats += m.count;
        if (p) { p.state = 'idle'; p.booster = null; }
        if (b) {
          b.mission = null;
          if (m.boosterSurvives) { b.state = 'damaged'; b.t = 0; m.turn = 'damaged'; }
          else { S.boosters = S.boosters.filter(x => x !== b); S.stats.boostersLost++; m.turn = 'lost'; }
        }
        log(`Flight ${m.id}: LAUNCH FAILURE. Payload of ${m.count} satellites lost. Booster B${m.booster} ${m.boosterSurvives ? 'recovered but needs repair' : 'destroyed'}.`, 'bad');
        Sfx.boom(); fx('boom'); pop('ANOMALY', true);
        summarize(m);
      } else if (m.t >= m.prep + m.ascent) {
        m.sep = true; if (p) { p.state = 'idle'; p.booster = null; }
        if (b) { b.state = 'returning'; b.t = b.dur = m.recovery; b.refuelDur = m.refuel; }
        log(`Flight ${m.id}: stage separation. Booster B${m.booster} is flying back; upper stage continues to orbit.`); Sfx.sep();
      }
    }
    if (m.sep) {
      const T = m.t - m.prep - m.ascent;
      if (!m.deploying && T >= BASE.coast) { m.deploying = true; log(`Flight ${m.id}: orbit reached. Releasing payload.`); }
      if (!m.deployed && T >= BASE.coast + BASE.deploy) {
        m.deployed = true;
        const before = income(); let ok = 0, lost = 0;
        m.payload.forEach((c, i) => { const good = c - m.lost[i]; S.orbit[i] += good; ok += good; lost += m.lost[i]; });
        S.stats.deployed += ok; S.stats.lostSats += lost;
        const gain = income() - before;
        if (lost === 0) { log(`Flight ${m.id}: all ${ok} satellites online. Income +${money(gain)}/s → ${money(income())}/s.`, 'money'); Sfx.deploy(); pop(`+${money(gain)}/s`); }
        else if (ok > 0) { log(`Flight ${m.id}: partial deployment — ${ok} online, ${lost} failed to activate. Income +${money(gain)}/s → ${money(income())}/s.`, 'warn'); Sfx.deploy(); pop(`+${money(gain)}/s`); }
        else { log(`Flight ${m.id}: DEPLOYMENT FAILURE. All ${lost} satellites failed to activate.`, 'bad'); Sfx.deny(); pop('DEPLOY FAILED', true); }
      }
      if (!m.disposed && T >= BASE.coast + BASE.deploy + BASE.deorbit) { m.disposed = true; log(`Flight ${m.id}: upper stage deorbited and burned up.`); }
    }
  }
  if (!m.summarized && m.landDone && m.disposed) summarize(m);
  // close once the booster is back in service (or gone)
  if (m.over && m.hold <= 0) m.closed = true;
  else if (!m.over && m.landDone && m.disposed) {
    if (!m.landed) { m.turn = 'lost'; if (m.hold <= 0) m.closed = true; }
    else if (!b || !['landed', 'refueling'].includes(b.state)) { m.turn = 'done'; if (m.hold <= 0) m.closed = true; }
  }
}
function landBooster(b) {
  const m = S.missions.find(x => x.id === b.mission);
  const ok = m ? m.landOK : true;
  b.mission = null;
  if (m) { m.landDone = true; m.landed = ok; m.hold = 4; }
  if (ok) {
    b.state = 'landed'; b.t = 0; S.stats.landings++;
    log(`Booster B${b.id} has landed${m ? ' — Flight ' + m.id : ''}.`, 'good');
    if (m && focusMission() === m) { Sfx.land(); pop('TOUCHDOWN'); }
  } else {
    S.boosters = S.boosters.filter(x => x !== b); S.stats.boostersLost++;
    log(`Booster B${b.id} was lost on landing${m ? ' — Flight ' + m.id : ''}. A replacement costs ${money(boosterCost())}.`, 'bad');
    if (m && focusMission() === m) { Sfx.boom(); fx('boom'); pop('BOOSTER LOST', true); }
  }
}
function tickBooster(b, dt) {
  if (b.state === 'returning' || b.state === 'refueling' || b.state === 'repairing') {
    b.t -= dt;
    if (b.t <= 0) {
      if (b.state === 'returning') landBooster(b);
      else { const was = b.state; b.state = 'ready'; b.t = 0; log(`Booster B${b.id} is ${was === 'refueling' ? 'refueled' : 'repaired'} and ready.`, 'good'); }
    }
  }
  if (b.state === 'landed' && S.autoRefuel) startRefuel(b, false);
}
function summarize(m) {
  m.summarized = true;
  const delivered = m.payload.map((c, i) => c - m.lost[i]), ok = sum(delivered), lost = m.count - ok;
  const rows = [];
  if (m.over) {
    rows.push(['bad', 'Launch failed during ascent']);
    rows.push(['bad', `Payload lost: ${m.count} satellites`]);
    rows.push([m.boosterSurvives ? 'warn' : 'bad', m.boosterSurvives ? `Booster B${m.booster} recovered, needs repair` : `Booster B${m.booster} destroyed`]);
  } else {
    rows.push(['ok', 'Launch successful']);
    rows.push(lost === 0 ? ['ok', `Deployed ${ok}/${m.count} satellites · +${money(payloadIncome(delivered))}/s`]
      : ok > 0 ? ['warn', `Deployed ${ok}/${m.count} · ${lost} failed · +${money(payloadIncome(delivered))}/s`]
      : ['bad', `Deployment failed · ${lost} satellites lost`]);
    rows.push(m.landed ? ['ok', `Booster B${m.booster} landed · reusable`] : ['bad', `Booster B${m.booster} lost on landing`]);
    rows.push(['ok', 'Upper stage safely disposed']);
  }
  rows.push(['ok', `Fleet income now ${money(income())}/s`]);
  if (!ui.quiet) ui.summary = { id: m.id, rows, until: performance.now() + 14000 };
}
function assignBoosters() {
  for (const p of S.pads) {
    if (p.state === 'idle' && !p.booster) {
      const b = S.boosters.find(x => x.state === 'ready');
      if (b) { b.state = 'onpad'; p.booster = b.id; }
    }
  }
}
function checkUnlocks() {
  while (S.unlocked < TIERS.length && S.lifetime >= TIERS[S.unlocked].unlock) {
    const t = TIERS[S.unlocked++];
    log(`New satellite tier unlocked: ${t.name} — ${money(t.income)}/s each for ${money(t.price)}.`, 'good');
    Sfx.unlock();
  }
}
// Keep early failures recoverable: if the company has no income and no way to fly, investors step in.
function checkBailout() {
  if (income() > 0) return;
  if (S.missions.some(m => !m.closed && !m.over && !(m.deployed && m.landDone))) return;
  if (S.boosters.some(b => ['refueling', 'repairing', 'returning', 'flight'].includes(b.state))) return;
  const sats = sum(S.inv) + S.pads.reduce((t, p) => t + loaded(p), 0);
  const usable = S.boosters.some(b => b.state === 'ready' || b.state === 'onpad');
  let need = sats > 0 ? 0 : TIERS[0].price;
  if (!usable) need += S.boosters.some(b => b.state === 'landed') ? BASE.refuelCost : S.boosters.some(b => b.state === 'damaged') ? BASE.repairCost : boosterCost();
  if (need === 0 || S.cash >= need) return;
  S.bailouts++;
  if (sats === 0) S.inv[0] += 10;
  if (!usable) { const b = S.boosters.find(x => x.state === 'landed' || x.state === 'damaged'); if (b) { b.state = 'ready'; b.t = 0; } else addBooster(); }
  log('Investors believe in the mission: a flight-ready booster and 10 Starlink V1 satellites have been provided to get you flying again.', 'good');
}
let bailAcc = 0;
function step(dt) {
  S.clock += dt;
  const inc = income() * dt; S.cash += inc; S.lifetime += inc;
  for (const m of S.missions) tickMission(m, dt);
  for (const b of S.boosters.slice()) tickBooster(b, dt);
  assignBoosters();
  checkUnlocks();
  bailAcc += dt; if (bailAcc >= 1) { bailAcc = 0; checkBailout(); }
  if (S.missions.length > 8) { const closed = S.missions.filter(m => m.closed); while (closed.length > 2) { const x = closed.shift(); S.missions.splice(S.missions.indexOf(x), 1); } }
}
function advance(total) {
  while (total > 1e-9) { const d = Math.min(total, total > 5 ? 1 : 0.1); step(d); total -= d; }
}

// ====================== SCENE ======================
function focusMission() {
  const live = S.missions.filter(m => !m.closed && (m.hold > 0 || (!m.over && !(m.landDone && m.disposed))));
  return live.find(m => m.id === ui.focus) || live[live.length - 1] || null;
}
function sceneInfo() {
  const m = focusMission();
  if (!m) return { view: 'orbit', tag: `${int(sum(S.orbit))} satellites in orbit`, cap: '', count: '' };
  const tag = `Flight ${m.id} · Pad ${m.pad}`;
  if (m.over) return { view: 'flight', dur: m.ascent * 0.5, tag, cap: 'Launch failure — vehicle lost during ascent', count: '' };
  if (!m.liftoff) {
    const r = m.prep - m.t;
    return r <= 3 ? { view: 'ignite', tag, cap: 'Ignition sequence start', count: 'T-' + Math.ceil(r) }
      : { view: 'orbit', tag, cap: 'Prepare: payload loaded · fueling · pad and booster checks', count: 'T-' + Math.ceil(r) };
  }
  const a = m.t - m.prep;
  if (!m.sep) return a < m.ascent * 0.5
    ? { view: 'liftoff', dur: m.ascent * 0.5, tag, cap: 'Liftoff!', count: 'T+' + Math.floor(a) }
    : { view: 'flight', dur: m.ascent * 0.5, tag, cap: 'Max-Q passed · heading downrange', count: 'T+' + Math.floor(a) };
  const T = m.t - m.prep - m.ascent, b = booster(m.booster), end = BASE.coast + BASE.deploy + BASE.deorbit;
  const ret = !m.landDone && b && b.state === 'returning' ? b.t : null;
  if (T < BASE.coast) return { view: 'coast', dur: BASE.coast, tag, cap: 'Stage separation · second stage burning to orbit', count: 'T+' + Math.floor(a) };
  if (T < BASE.coast + BASE.deploy) return { view: 'deploy', dur: BASE.deploy, tag, cap: `Deploying ${m.count} satellites`, count: '' };
  if (m.landDone) return { view: 'landing', dur: 10, tag, cap: m.landed ? `Touchdown! Booster B${m.booster} is safe` : `Booster B${m.booster} lost on landing`, count: '' };
  if (T >= end && ret !== null && ret <= 10) return { view: 'landing', dur: Math.max(2, ret), tag, cap: `Booster B${m.booster} landing burn`, count: secs(ret) };
  if (T < end) return { view: 'deorbit', dur: BASE.deorbit, tag, cap: 'Upper stage deorbiting — burning up in the atmosphere', count: '' };
  return { view: 'orbit', tag, cap: `Booster B${m.booster} returning to the launch site`, count: ret !== null ? secs(ret) : '' };
}
function renderScene() {
  const s = sceneInfo(), el = $('#scene');
  if (s.view !== ui.lastView) {
    ui.lastView = s.view;
    el.style.setProperty('--dur', (s.dur || 4) + 's');
    el.dataset.view = s.view;
  }
  setText('#sceneTag', s.tag); setText('#sceneCount', s.count); setText('#sceneCaption', s.cap);
  const sm = $('#summary');
  if (ui.summary && performance.now() > ui.summary.until) ui.summary = null;
  if (ui.summary) {
    sm.hidden = false;
    setHTML(sm, `<h4>Flight ${ui.summary.id} summary</h4>` + ui.summary.rows.map(r => `<div class="sum-row ${r[0]}"><b>${r[0] === 'ok' ? 'OK' : r[0] === 'warn' ? '!!' : 'XX'}</b><span>${esc(r[1])}</span></div>`).join('') + `<button class="btn btn-small" data-act="dismiss">Continue</button>`);
  } else sm.hidden = true;
  if (s.view === 'orbit' || s.view === 'deorbit') drawOrbit();
}
const cv = $('#orbitCanvas'), cx2 = cv.getContext('2d');
function drawOrbit() {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (!W || !H) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  cx2.clearRect(0, 0, W, H);
  const total = sum(S.orbit); if (!total) return;
  const MAX = 160, list = [];
  if (total <= MAX) S.orbit.forEach((n, i) => { for (let j = 0; j < n; j++) list.push(i); });
  else S.orbit.forEach((n, i) => { const k = n ? Math.max(1, Math.round(n / total * MAX)) : 0; for (let j = 0; j < k; j++) list.push(i); });
  const ex = W * 0.498, ey = H * 0.479, R = W * 0.262, u = Math.max(2, Math.round(W / 420)), t = performance.now() / 1000;
  const rings = [[0.32, 0.07, -0.08], [0.36, 0.11, 0.55], [0.40, 0.09, -0.6], [0.34, 0.15, 1.15], [0.43, 0.06, 0.2]];
  list.forEach((tier, k) => {
    const g = rings[k % rings.length], th = k * 2.39996 + t * (0.16 + (k % rings.length) * 0.03) * (k % 2 ? 1 : -1);
    const a = W * g[0], b = W * g[1], c = Math.cos(g[2]), s = Math.sin(g[2]);
    const px = a * Math.cos(th), py = b * Math.sin(th);
    const x = ex + px * c - py * s, y = ey + px * s + py * c;
    if (Math.sin(th) < 0 && Math.hypot(x - ex, y - ey) < R) return; // behind the planet
    const X = Math.round(x), Y = Math.round(y);
    cx2.fillStyle = '#3d6bd6'; cx2.fillRect(X - 3 * u, Y, 2 * u, u); cx2.fillRect(X + 2 * u, Y, 2 * u, u);
    cx2.fillStyle = TIERS[tier].color; cx2.fillRect(X - u, Y - u / 2, 2 * u, 2 * u);
  });
}

// ====================== DOM RENDER ======================
function setText(sel, t) { const el = $(sel); if (el.textContent !== t) el.textContent = t; }
function morph(o, n) {
  if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) { o.replaceWith(n.cloneNode(true)); return; }
  if (o.nodeType === 3) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
  if (o.nodeType !== 1) return;
  for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
  for (const a of [...n.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  morphKids(o, n);
}
function morphKids(o, n) {
  const oc = [...o.childNodes], nc = [...n.childNodes];
  for (let i = 0; i < nc.length; i++) { if (i < oc.length) morph(oc[i], nc[i]); else o.appendChild(nc[i].cloneNode(true)); }
  for (let i = nc.length; i < oc.length; i++) oc[i].remove();
}
// Patches the DOM in place so buttons are never swapped out mid-click.
function setHTML(el, html) {
  if (el._h === html) return; el._h = html;
  const t = document.createElement(el.tagName); t.innerHTML = html; morphKids(el, t);
}
const bar = (frac, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, frac * 100)).toFixed(0)}%"></i></div>`;
const btn = (label, act, arg, on = true, cls = '') => `<button class="btn ${cls}" data-act="${act}"${arg !== undefined && arg !== null ? ` data-arg="${arg}"` : ''}${on ? '' : ' disabled'}>${label}</button>`;

function stageList() {
  const names = ['Prepare', 'Launch', 'Booster recovery', 'Satellite deployment', 'Upper-stage disposal', 'Turnaround'];
  const st = names.map(n => ({ n, c: '', note: '—', p: null }));
  const m = focusMission() || S.missions[S.missions.length - 1];
  if (!m) { st[0].note = 'Awaiting first flight'; return st; }
  const b = booster(m.booster), set = (i, c, note, p = null) => { st[i].c = c; st[i].note = note; st[i].p = p; };
  if (!m.liftoff) { set(0, 'active', 'T-' + secs(m.prep - m.t), m.t / m.prep); return st; }
  set(0, 'done', 'Go for launch');
  if (m.over) { set(1, 'fail', 'Vehicle lost'); set(2, m.boosterSurvives ? 'warn' : 'fail', m.boosterSurvives ? 'Damaged' : 'Destroyed'); set(3, 'fail', 'Payload lost'); set(5, m.boosterSurvives ? 'warn' : 'fail', m.boosterSurvives ? 'Needs repair' : 'No booster'); return st; }
  if (!m.sep) { set(1, 'active', 'Ascent', (m.t - m.prep) / m.ascent); return st; }
  set(1, 'done', 'Stage sep');
  const T = m.t - m.prep - m.ascent;
  if (!m.landDone) set(2, 'active', b ? secs(b.t) + ' to landing' : 'Returning', b && b.dur ? 1 - b.t / b.dur : 0);
  else set(2, m.landed ? 'done' : 'fail', m.landed ? 'Landed' : 'Booster lost');
  const ok = m.count - sum(m.lost);
  if (!m.deployed) set(3, 'active', m.deploying ? 'Releasing' : 'Climbing to orbit', T / (BASE.coast + BASE.deploy));
  else set(3, ok === m.count ? 'done' : ok > 0 ? 'warn' : 'fail', `${ok}/${m.count} online`);
  if (m.deployed) { if (!m.disposed) set(4, 'active', 'Deorbit burn', (T - BASE.coast - BASE.deploy) / BASE.deorbit); else set(4, 'done', 'Burned up'); }
  if (m.landDone) {
    if (!m.landed) set(5, 'fail', 'No booster');
    else if (m.turn === 'done' || !b) set(5, 'done', 'Ready to fly');
    else if (b.state === 'landed') set(5, 'warn', `Needs fuel ${money(BASE.refuelCost)}`);
    else if (b.state === 'refueling') set(5, 'active', 'Refuel ' + secs(b.t), 1 - b.t / b.dur);
    else set(5, 'done', 'Ready to fly');
  }
  return st;
}
function renderStages() {
  setHTML($('#stages'), stageList().map((s, i) => `<li class="stage ${s.c}"><span class="stage-name">${i + 1}. ${s.n}</span>${s.p !== null ? bar(s.p) : ''}<span class="stage-note">${esc(s.note)}</span></li>`).join(''));
}
function renderFeed() {
  setHTML($('#feed'), S.log.map(e => `<li><time>${clockStr(e.t)}</time><span class="${e.type}">${esc(e.msg)}</span></li>`).join(''));
}
function hint() {
  const p = S.pads[0], inc = income();
  if (S.flights === 0) return loaded(p) === 0
    ? 'Welcome, Chief. Your Falcon 9 is on the pad. Load your 10 satellites: press MAX on Starlink V1 below.'
    : 'Payload aboard. Press LAUNCH. The booster is already fueled, so the first flight is free.';
  if (S.flights === 1 && inc === 0) return 'Watch the stages. Income starts the moment the satellites deploy.';
  if (S.flights === 1) return `Income is flowing at ${money(inc)}/s. Buy more satellites while the booster flies back and refuels.`;
  return '';
}
function panelLaunch() {
  let p = pad(ui.pad); if (!p) { ui.pad = S.pads[0].id; p = S.pads[0]; }
  const b = booster(p.booster), cap = capacity(), n = loaded(p), o = odds(p), idle = p.state === 'idle', h = hint();
  let html = h ? `<div class="hint">${esc(h)}</div>` : '';
  if (S.pads.length > 1) html += `<div class="padchips">${S.pads.map(x => btn(`Pad ${x.id}${x.state !== 'idle' ? ' ·busy' : x.booster ? '' : ' ·empty'}`, 'selpad', x.id, true, 'btn-small ' + (x.id === p.id ? 'btn-on' : ''))).join('')}</div>`;
  const padState = p.state === 'prep' ? ['Countdown', 'flame'] : p.state === 'ascent' ? ['Launching', 'flame'] : b ? ['Ready', 'good'] : ['Waiting for booster', 'warn'];
  const wait = S.boosters.filter(x => ['returning', 'landed', 'refueling', 'repairing'].includes(x.state)).sort((x, y) => x.t - y.t)[0];
  html += `<div class="card">
    <div class="row spread"><span class="title">Launch pad ${p.id}</span><span class="badge ${padState[1]}">${padState[0]}</span></div>
    <div class="small dim" style="margin-top:6px">${b ? `Falcon 9 with booster B${b.id} · ${b.flights} flight${b.flights === 1 ? '' : 's'} flown` : wait ? `No booster on pad. B${wait.id}: ${B_LABEL[wait.state][0].toLowerCase()}${wait.t > 0 ? ' · ' + secs(wait.t) : ''}` : 'No booster available. Buy one in the Fleet tab.'}</div>
    <div class="odds small">
      <div><span class="dim">Launch</span><b class="${o.launch > 0.985 ? 'good' : 'warn'}">${pct(o.launch)}</b></div>
      <div><span class="dim">Landing</span><b class="${o.land > 0.96 ? 'good' : 'warn'}">${pct(o.land)}</b></div>
      <div><span class="dim">Deployment</span><b class="${o.deploy > 0.975 ? 'good' : 'warn'}">${pct(o.deploy)}</b></div>
    </div>
    <div class="small dim" style="margin-top:6px">${o.first ? 'First flight: every system triple-checked. Later flights carry real risk.' : 'Success chances for this flight. Improve them in the Upgrades and Fleet tabs.'}</div>
  </div>`;
  html += `<h3>Payload · ${n}/${cap} loaded${n ? ` · +${money(payloadIncome(p.payload))}/s` : ''}</h3>${bar(n / cap, 'blue')}<div style="height:8px"></div>`;
  const can = idle && b && n > 0;
  const why = !idle ? (p.state === 'prep' ? 'Countdown in progress' : 'Rocket is clearing the tower') : !b ? 'Waiting for a ready booster' : n < 1 ? 'Load at least 1 satellite' : '';
  html += btn(can ? `Launch · ${n} sat${n === 1 ? '' : 's'}` : 'Launch', 'launch', null, !!can, 'btn-launch');
  html += `<div class="launch-note small dim">${why || `Prep ${secs(padPrep(p))} · booster back in ${secs(padRecovery(p))} · refuel ${secs(padRefuel(p))} for ${money(BASE.refuelCost)}`}</div>`;
  html += `<div style="height:12px"></div>`;
  for (let i = 0; i < S.unlocked; i++) {
    const t = TIERS[i], f = fillPlan(p, i), room = cap - n;
    html += `<div class="card tier">
      <div class="row"><span class="swatch" style="background:${t.color}"></span><span class="title grow">${t.name}</span><span class="good num">+${money(t.income)}/s</span><span class="warn num">${money(t.price)}</span></div>
      <div class="tier-ctl"><span class="lbl dim">Warehouse <span class="count">${int(S.inv[i])}</span></span>
        ${btn('Buy 1', 'buy', i + ':1', S.cash >= t.price, 'btn-small btn-buy')}${btn('Buy 10', 'buy', i + ':10', S.cash >= t.price * 10, 'btn-small btn-buy')}
        ${btn(f.buy ? `Fill pad ${money(f.cost)}` : 'Fill pad', 'fill', i, idle && f.total > 0, 'btn-small btn-buy')}</div>
      <div class="tier-ctl"><span class="lbl dim">On rocket <span class="count">${p.payload[i]}</span></span>
        ${btn('−', 'load', i + ':-1', idle && p.payload[i] > 0, 'btn-small btn-sq')}${btn('+', 'load', i + ':1', idle && S.inv[i] > 0 && room > 0, 'btn-small btn-sq')}
        ${btn('Max', 'load', i + ':999', idle && S.inv[i] > 0 && room > 0, 'btn-small')}${btn('Clear', 'load', i + ':-999', idle && p.payload[i] > 0, 'btn-small btn-ghost')}</div>
    </div>`;
  }
  if (S.unlocked < TIERS.length) {
    const t = TIERS[S.unlocked];
    html += `<div class="card small"><div class="row spread"><span class="dim">Next tier: ${t.name} (+${money(t.income)}/s)</span><span class="num">${money(S.lifetime)} / ${money(t.unlock)}</span></div>${bar(S.lifetime / t.unlock, 'green')}<div class="dim" style="margin-top:4px">Unlocks from lifetime earnings.</div></div>`;
  }
  return html;
}
function panelOrbit() {
  const total = sum(S.orbit), inc = income();
  let rows = '';
  S.orbit.forEach((n, i) => { if (n > 0) rows += `<tr><td><span class="swatch" style="display:inline-block;background:${TIERS[i].color}"></span> ${TIERS[i].name}</td><td>${int(n)}</td><td>${money(TIERS[i].income)}/s</td><td class="good">${money(n * TIERS[i].income)}/s</td></tr>`; });
  if (!rows) rows = `<tr><td colspan="4" class="dim">Nothing in orbit yet. Launch your first payload.</td></tr>`;
  const st = S.stats;
  return `<h3>Active constellation</h3>
    <table class="orbit"><thead><tr><th>Tier</th><th>Active</th><th>Each</th><th>Income</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td><td>${int(total)}</td><td></td><td>${money(inc)}/s</td></tr></tfoot></table>
    <h3>Company record</h3>
    <div class="card kv"><span class="dim">Lifetime earnings</span><span class="num warn">${money(S.lifetime)}</span>
      <span class="dim">Flights launched</span><span class="num">${int(S.flights)}</span>
      <span class="dim">Satellites deployed</span><span class="num">${int(st.deployed)}</span>
      <span class="dim">Satellites lost</span><span class="num">${int(st.lostSats)}</span>
      <span class="dim">Booster landings</span><span class="num">${int(st.landings)}</span>
      <span class="dim">Boosters lost</span><span class="num">${int(st.boostersLost)}</span>
      <span class="dim">Launch failures</span><span class="num">${int(st.failures)}</span>
      <span class="dim">Time in business</span><span class="num">${clockStr(S.clock)}</span></div>`;
}
function panelFleet() {
  let html = `<h3>Boosters · ${S.boosters.length}/${BASE.maxBoosters}</h3>`;
  if (!S.boosters.length) html += `<div class="card warn">No boosters left. Buy a replacement to keep flying.</div>`;
  for (const b of S.boosters) {
    const [label, cls] = B_LABEL[b.state], timed = ['returning', 'refueling', 'repairing'].includes(b.state);
    const onPad = S.pads.find(p => p.booster === b.id);
    html += `<div class="card"><div class="row spread"><span class="title">Booster B${b.id}</span><span class="badge ${cls}">${label}${timed ? ' ' + secs(b.t) : ''}</span></div>
      <div class="row spread small" style="margin-top:6px"><span class="dim">${b.flights} flight${b.flights === 1 ? '' : 's'}${onPad ? ' · Pad ' + onPad.id : ''}</span>
      ${b.state === 'landed' ? btn(`Refuel ${money(BASE.refuelCost)}`, 'refuel', b.id, S.cash >= BASE.refuelCost, 'btn-small btn-buy') : ''}
      ${b.state === 'damaged' ? btn(`Repair ${money(BASE.repairCost)}`, 'repair', b.id, S.cash >= BASE.repairCost, 'btn-small btn-buy') : ''}</div>
      ${timed ? `<div style="margin-top:6px">${bar(b.dur ? 1 - b.t / b.dur : 0)}</div>` : ''}</div>`;
  }
  html += `<div class="row" style="margin:8px 0 4px">${S.boosters.length < BASE.maxBoosters ? btn(`Buy booster ${money(boosterCost())}`, 'buybooster', null, S.cash >= boosterCost(), 'btn-buy') : '<span class="dim">Booster hangar is full.</span>'}
    ${btn(`Auto-refuel: ${S.autoRefuel ? 'on' : 'off'}`, 'auto', null, true, S.autoRefuel ? 'btn-on' : '')}</div>
    <div class="small dim">A spare booster lets you launch again while another is returning or refueling.</div>`;
  html += `<h3>Launch pads · ${S.pads.length}/${BASE.maxPads}</h3>`;
  for (const p of S.pads) {
    html += `<div class="card"><div class="row spread"><span class="title">Pad ${p.id}</span><span class="small dim">Prep ${secs(padPrep(p))} · recovery ${secs(padRecovery(p))} · refuel ${secs(padRefuel(p))}</span></div><div class="upgrid">`;
    for (const k in PAD_UPS) {
      const u = PAD_UPS[k], l = p.up[k], max = l >= u.costs.length;
      html += `<button class="btn btn-small" data-act="pup" data-arg="${p.id}:${k}"${max || S.cash < u.costs[l] ? ' disabled' : ''}>${u.name} <span class="pips">${'■'.repeat(l)}${'□'.repeat(u.costs.length - l)}</span><span>${u.desc} · ${max ? 'maxed' : money(u.costs[l])}</span></button>`;
    }
    html += `</div></div>`;
  }
  html += `<div class="row" style="margin:8px 0 4px">${S.pads.length < BASE.maxPads ? btn(`Build launch pad ${money(padCost())}`, 'buypad', null, S.cash >= padCost(), 'btn-buy') : '<span class="dim">All pad sites are built.</span>'}</div>
    <div class="small dim">Each pad is an independent launch slot. Every active launch needs both a pad and a ready booster.</div>`;
  return html;
}
function panelUpgrades() {
  let html = `<h3>Operations</h3>`;
  for (const k in GLOBAL_UPS) {
    const u = GLOBAL_UPS[k], l = S.up[k], max = l >= u.costs.length;
    html += `<div class="card"><div class="row spread"><span class="title">${u.name}</span><span class="pips">${'■'.repeat(l)}${'□'.repeat(u.costs.length - l)}</span></div>
      <div class="row spread small" style="margin-top:6px"><span class="dim">${u.desc} per level</span>${max ? '<span class="good">Maxed</span>' : btn(`Upgrade ${money(u.costs[l])}`, 'gup', k, S.cash >= u.costs[l], 'btn-small btn-buy')}</div></div>`;
  }
  html += `<div class="small dim">Per-pad upgrades for prep, refuel and recovery times are in the Fleet tab.</div><h3>Satellite tiers</h3>`;
  TIERS.forEach((t, i) => {
    const open = i < S.unlocked, next = i === S.unlocked;
    html += `<div class="card small"><div class="row"><span class="swatch" style="background:${open ? t.color : '#34406e'}"></span><span class="grow ${open ? '' : 'dim'}">T${i + 1} · ${t.name}</span><span class="${open ? 'good' : 'dim'} num">+${money(t.income)}/s</span><span class="${open ? 'warn' : 'dim'} num">${money(t.price)}</span></div>
      ${open ? '' : `<div class="dim" style="margin-top:4px">Unlocks at ${money(t.unlock)} lifetime earnings</div>${next ? bar(S.lifetime / t.unlock, 'green') : ''}`}</div>`;
  });
  return html;
}
const PANELS = { launch: ['Launch', panelLaunch], orbit: ['Orbit', panelOrbit], fleet: ['Fleet', panelFleet], upgrades: ['Upgrades', panelUpgrades] };
function renderPanels() {
  const alertFleet = S.boosters.some(b => b.state === 'damaged' || (b.state === 'landed' && !S.autoRefuel)) || !S.boosters.length;
  setHTML($('#tabs'), Object.keys(PANELS).map(k => `<button class="tab ${ui.tab === k ? 'on' : ''}" role="tab" aria-selected="${ui.tab === k}" data-act="tab" data-arg="${k}">${PANELS[k][0]}${k === 'fleet' && alertFleet ? ' !' : ''}</button>`).join(''));
  setHTML($('#panel'), PANELS[ui.tab][1]());
}
function renderTop() {
  const inc = income();
  setText('#statCash', money(S.cash)); setText('#statIncome', money(inc) + '/s'); setText('#statSats', int(sum(S.orbit)));
  if (inc !== ui.lastIncome) { if (inc > ui.lastIncome && !ui.quiet) { const el = $('#statIncome'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } ui.lastIncome = inc; }
  setText('#muteBtn', S.muted ? 'Sound off' : 'Sound on');
}
function renderAll() { renderTop(); renderScene(); renderStages(); renderFeed(); renderPanels(); }

// ====================== SAVE / LOAD ======================
let noSave = false;
function save() { if (noSave) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
    const d = JSON.parse(raw); if (!d || d.v !== 1) return false;
    const base = newState();
    S = Object.assign(base, d);
    S.stats = Object.assign(newState().stats, d.stats); S.up = Object.assign(newState().up, d.up);
    for (const k of ['inv', 'orbit']) { while (S[k].length < TIERS.length) S[k].push(0); }
    return true;
  } catch (e) { return false; }
}

// ====================== BOOT / LOOP ======================
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  Sfx.init();
  const f = ACT[el.dataset.act]; if (f) { f(el.dataset.arg); renderAll(); }
});
if (load()) {
  const away = Math.min(OFFLINE_CAP, Math.max(0, (Date.now() - S.lastSeen) / 1000));
  if (away > 2) {
    const before = S.lifetime; ui.quiet = true; advance(away); ui.quiet = false;
    const earned = S.lifetime - before;
    log(`Welcome back. Your constellation earned ${money(earned)} while you were away (${clockStr(away)}).`, 'money');
  }
  ui.pad = S.pads[0].id;
} else {
  log('Company founded. 1 Falcon 9, 1 launch pad and 10 Starlink V1 satellites are ready.');
}
ui.lastIncome = income();
let last = performance.now(), saveAcc = 0, uiAcc = 1;
function tick(now) {
  const dt = Math.min(OFFLINE_CAP, (now - last) / 1000); last = now;
  if (dt <= 0) return;
  if (dt > 3) ui.quiet = true; // long gap (sleeping tab): catch up silently
  advance(dt * SPEED); ui.quiet = false; S.lastSeen = Date.now(); // wall-clock time the simulation has reached
  saveAcc += dt; uiAcc += dt;
  renderTop(); renderScene(); renderStages();
  if (uiAcc >= 0.2) { uiAcc = 0; renderFeed(); renderPanels(); }
  if (saveAcc >= 5) { saveAcc = 0; save(); }
}
function frame(now) { tick(now); requestAnimationFrame(frame); }
renderAll();
requestAnimationFrame(frame);
// Browsers pause animation frames in background tabs; this slower timer keeps the company running there.
setInterval(() => { const now = performance.now(); if (now - last > 400) tick(now); }, 500);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);
// Small hook for balancing and testing from the browser console.
window.__tycoon = { get state() { return S; }, advance, save, reset() { noSave = true; localStorage.removeItem(SAVE_KEY); location.reload(); } };
})();
