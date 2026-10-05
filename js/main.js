import { Game, EV, COLORS, CFG, angleDiff } from './game.js';
import { hostRoom, joinRoom } from './net.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { sfx, unlockAudio } from './sound.js';

const MAX_PLAYERS = 8;
const TICK = 1 / 60;
const SEND_EVERY = 2; // снимок каждые 2 тика = 30 раз в секунду
const INTERP_MS = 70;

const $ = (sel) => document.querySelector(sel);
const screens = ['menu', 'lobby', 'game'];

const app = {
  role: null,        // 'host' | 'client'
  net: null,
  myId: null,
  code: '',
  lobby: [],         // [{id, name, color, bot, connId}]
  roster: new Map(), // id -> {name, color, bot}
  game: null,        // только у хоста
  inGame: false,
  nextId: 1,
  snaps: [],
  offset: null,
  lastSnap: null,
  lastSend: 0,
  wakeLock: null,
};

let renderer = null;
let input = null;

// ---------- Экраны ----------

function show(name) {
  for (const s of screens) $('#' + s).classList.toggle('hidden', s !== name);
}

function setStatus(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function playerName() {
  const n = $('#name').value.trim().slice(0, 14) || 'Танкист';
  try { localStorage.setItem('tank-name', n); } catch {}
  return n;
}

function initMenu() {
  try { $('#name').value = localStorage.getItem('tank-name') || ''; } catch {}
  $('#code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  });
  $('#btn-host').addEventListener('click', startHost);
  $('#btn-join').addEventListener('click', startJoin);
  $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') startJoin(); });
  $('#btn-solo').addEventListener('click', startSolo);
  $('#btn-start').addEventListener('click', hostStartMatch);
  $('#btn-add-bot').addEventListener('click', () => hostAddBot());
  $('#btn-del-bot').addEventListener('click', hostRemoveBot);
  $('#btn-leave').addEventListener('click', leave);
  $('#btn-exit').addEventListener('click', () => { if (confirm('Выйти из игры?')) leave(); });
  $('#btn-again').addEventListener('click', hostStartMatch);
  $('#btn-to-lobby').addEventListener('click', hostBackToLobby);
}

function goFullscreen() {
  unlockAudio();
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !document.fullscreenElement) {
    Promise.resolve(req.call(el)).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  navigator.wakeLock?.request('screen').then((l) => { app.wakeLock = l; }).catch(() => {});
}

function setBusy(busy) {
  for (const b of document.querySelectorAll('#menu button')) b.disabled = busy;
}

// ---------- Хост ----------

async function startHost() {
  goFullscreen();
  setBusy(true);
  setStatus('Создаём комнату…');
  try {
    app.net = await hostRoom({
      onJoin: hostOnJoin,
      onMessage: hostOnMessage,
      onLeave: hostOnLeave,
      onError: (msg) => toast(msg),
    });
  } catch (e) {
    setStatus(e.message, true);
    setBusy(false);
    return;
  }
  setBusy(false);
  setStatus('');
  app.role = 'host';
  app.code = app.net.code;
  app.myId = 0;
  app.lobby = [{ id: 0, name: playerName(), color: COLORS[0], bot: false, connId: null }];
  enterLobby();
}

// Одиночная тренировка с ботами — без сети.
function startSolo() {
  goFullscreen();
  app.role = 'host';
  app.net = { broadcast() {}, send() {}, kick() {}, close() {} };
  app.code = '';
  app.myId = 0;
  app.lobby = [{ id: 0, name: playerName(), color: COLORS[0], bot: false, connId: null }];
  hostAddBot(false);
  hostAddBot(false);
  hostAddBot(false);
  enterLobby();
}

function freeColor() {
  const used = new Set(app.lobby.map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) ?? COLORS[0];
}

function hostOnJoin(connId, meta) {
  if (app.lobby.filter((p) => !p.bot).length >= MAX_PLAYERS) {
    app.net.send(connId, { t: 'full' });
    setTimeout(() => app.net.kick(connId), 300);
    return;
  }
  // Освобождаем место, выкидывая бота, если комната забита.
  if (app.lobby.length >= MAX_PLAYERS) hostRemoveBot();
  const p = {
    id: app.nextId++,
    name: String(meta.name || 'Игрок').slice(0, 14),
    color: freeColor(),
    bot: false,
    connId,
  };
  app.lobby.push(p);
  app.net.send(connId, { t: 'welcome', id: p.id, code: app.code });
  if (app.inGame) {
    app.game.addTank(p.id, p.name, { color: p.color });
    app.net.send(connId, { t: 'start' });
    broadcastRoster();
    toast(`${p.name} присоединился`);
  } else {
    broadcastLobby();
  }
}

function hostOnLeave(connId) {
  const p = app.lobby.find((x) => x.connId === connId);
  if (!p) return;
  app.lobby = app.lobby.filter((x) => x !== p);
  if (app.inGame) {
    app.game.removeTank(p.id);
    broadcastRoster();
    toast(`${p.name} вышел`);
  } else {
    broadcastLobby();
  }
}

function hostOnMessage(connId, msg) {
  if (!msg || typeof msg !== 'object') return;
  const p = app.lobby.find((x) => x.connId === connId);
  if (!p) return;
  if (msg.t === 'in' && app.game) app.game.setInput(p.id, msg);
}

function hostAddBot(broadcast = true) {
  if (app.lobby.length >= MAX_PLAYERS) return;
  const n = app.lobby.filter((p) => p.bot).length + 1;
  app.lobby.push({ id: app.nextId++, name: 'Бот ' + n, color: freeColor(), bot: true, connId: null });
  if (broadcast) broadcastLobby();
}

function hostRemoveBot() {
  const bots = app.lobby.filter((p) => p.bot);
  if (!bots.length) return;
  const last = bots[bots.length - 1];
  app.lobby = app.lobby.filter((p) => p !== last);
  broadcastLobby();
}

function lobbyPayload() {
  return app.lobby.map(({ id, name, color, bot }) => ({ id, name, color, bot }));
}

function broadcastLobby() {
  const players = lobbyPayload();
  app.net.broadcast({ t: 'lobby', players });
  renderLobby(players);
}

function broadcastRoster() {
  const players = app.game.roster();
  app.net.broadcast({ t: 'roster', players });
  setRoster(players);
}

function hostStartMatch() {
  if (app.lobby.length < 2) {
    toast('Нужно минимум 2 участника — добавьте бота');
    return;
  }
  app.game = new Game();
  for (const p of app.lobby) app.game.addTank(p.id, p.name, { bot: p.bot, color: p.color });
  app.net.broadcast({ t: 'start' });
  broadcastRoster();
  enterGame();
}

function hostBackToLobby() {
  app.game = null;
  app.inGame = false;
  app.net.broadcast({ t: 'tolobby' });
  enterLobby();
}

let acc = 0;
let tickN = 0;

function hostFrame(dt) {
  const g = app.game;
  g.setInput(0, input.read());
  acc = Math.min(acc + dt, 0.25);
  while (acc >= TICK) {
    g.step(TICK);
    acc -= TICK;
    tickN++;
    if (tickN % SEND_EVERY === 0) {
      const ev = g.takeEvents();
      const snap = g.snapshot();
      app.net.broadcast({ t: 's', tm: Math.round(g.time * 1000), ...snap, ev });
      handleEvents(ev);
      app.lastSnap = snap;
    }
  }
  return viewFromGame(g);
}

function viewFromGame(g) {
  const tanks = [];
  for (const t of g.tanks.values()) {
    tanks.push({
      id: t.id, x: t.x, y: t.y, rot: t.rot, tur: t.tur, hp: t.hp,
      alive: t.alive, inv: t.inv > 0, color: t.color,
      kills: t.kills, deaths: t.deaths, respawn: Math.ceil(t.respawnT),
    });
  }
  const bullets = g.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y, color: g.tanks.get(b.owner)?.color }));
  return { tanks, bullets, winner: g.winner };
}

// ---------- Клиент ----------

async function startJoin() {
  const code = $('#code').value.trim().toUpperCase();
  if (code.length !== 4) {
    setStatus('Введите код комнаты из 4 букв', true);
    return;
  }
  goFullscreen();
  setBusy(true);
  setStatus('Подключаемся…');
  try {
    app.net = await joinRoom(code, playerName(), {
      onMessage: clientOnMessage,
      onClose: () => {
        if (app.role !== 'client') return;
        leave();
        setStatus('Связь с хостом потеряна', true);
      },
    });
  } catch (e) {
    setStatus(e.message, true);
    setBusy(false);
    return;
  }
  setBusy(false);
  setStatus('');
  app.role = 'client';
  app.code = code;
}

function clientOnMessage(msg) {
  switch (msg?.t) {
    case 'welcome':
      app.myId = msg.id;
      enterLobby();
      break;
    case 'full':
      leave();
      setStatus('Комната заполнена', true);
      break;
    case 'lobby':
      renderLobby(msg.players);
      break;
    case 'roster':
      setRoster(msg.players);
      break;
    case 'start':
      app.snaps = [];
      app.offset = null;
      enterGame();
      break;
    case 'tolobby':
      enterLobby();
      break;
    case 's':
      clientOnSnap(msg);
      break;
  }
}

function clientOnSnap(msg) {
  const now = performance.now();
  const off = now - msg.tm;
  // Оценка разницы часов: берём минимальную задержку, но медленно подстраиваемся.
  if (app.offset === null || off < app.offset) app.offset = off;
  else app.offset += (off - app.offset) * 0.01;
  app.snaps.push(msg);
  if (app.snaps.length > 30) app.snaps.shift();
  handleEvents(msg.ev);
  app.lastSnap = msg;
}

function clientFrame(now) {
  if (now - app.lastSend > 33) {
    app.net.send({ t: 'in', ...input.read() });
    app.lastSend = now;
  }
  const snaps = app.snaps;
  if (!snaps.length) return null;
  const rt = now - app.offset - INTERP_MS;
  while (snaps.length > 2 && snaps[1].tm <= rt) snaps.shift();
  const a = snaps[0];
  const b = snaps[1] ?? a;
  const k = b === a ? 0 : clamp01((rt - a.tm) / (b.tm - a.tm));
  return interpolate(a, b, k);
}

function interpolate(a, b, k) {
  const prev = new Map(a.tanks.map((t) => [t[0], t]));
  const tanks = b.tanks.map((t) => {
    const p = prev.get(t[0]) ?? t;
    const jump = Math.abs(p[1] - t[1]) + Math.abs(p[2] - t[2]) > 4;
    const kk = jump ? 1 : k;
    return {
      id: t[0],
      x: lerp(p[1], t[1], kk), y: lerp(p[2], t[2], kk),
      rot: p[3] + angleDiff(p[3], t[3]) * kk,
      tur: p[4] + angleDiff(p[4], t[4]) * kk,
      hp: t[5], alive: !!(t[6] & 1), inv: !!(t[6] & 2),
      kills: t[7], deaths: t[8], respawn: t[9],
      color: app.roster.get(t[0])?.color ?? 0xffffff,
    };
  });
  const prevB = new Map(a.bullets.map((x) => [x[0], x]));
  const bullets = b.bullets.map((x) => {
    const p = prevB.get(x[0]) ?? x;
    return { id: x[0], x: lerp(p[1], x[1], k), y: lerp(p[2], x[2], k), color: app.roster.get(x[3])?.color };
  });
  return { tanks, bullets, winner: b.winner };
}

// ---------- Общее ----------

function setRoster(players) {
  app.roster = new Map(players.map((p) => [p.id, p]));
}

function handleEvents(events) {
  if (!events || !renderer) return;
  for (const [type, x, y, id] of events) {
    const color = app.roster.get(id)?.color ?? 0xffffff;
    switch (type) {
      case EV.SHOT:
        renderer.burst(x, y, { count: 4, color: 0xffee88, speed: 3, size: 0.18, life: 0.15, up: 1 });
        sfx.shot(id === app.myId);
        break;
      case EV.BOUNCE:
        renderer.burst(x, y, { count: 4, color: 0xffffff, speed: 3, size: 0.12, life: 0.2, up: 1 });
        sfx.bounce();
        break;
      case EV.HIT:
        renderer.burst(x, y, { count: 10, color, speed: 6, size: 0.2, life: 0.4, up: 3 });
        if (id === app.myId) { renderer.shake = Math.min(1, renderer.shake + 0.35); flashDamage(); }
        sfx.hit();
        break;
      case EV.BOOM:
        renderer.explosion(x, y, color);
        sfx.boom();
        break;
      case EV.CLASH:
        renderer.burst(x, y, { count: 12, color: 0xaaddff, speed: 5, size: 0.15, life: 0.3, up: 2 });
        sfx.clash();
        break;
      case EV.FIZZLE:
        renderer.burst(x, y, { count: 5, color: 0x888899, speed: 2, size: 0.14, life: 0.3, up: 1 });
        break;
      case EV.SPAWN:
        renderer.burst(x, y, { count: 14, color, speed: 4, size: 0.18, life: 0.5, up: 5 });
        if (id === app.myId) sfx.spawn();
        break;
    }
  }
}

function enterLobby() {
  show('lobby');
  app.inGame = false;
  input?.reset();
  if (renderer) renderer.clear();
  $('#lobby-code').textContent = app.code || '—';
  $('#lobby-code-box').classList.toggle('hidden', !app.code);
  $('#host-controls').classList.toggle('hidden', app.role !== 'host');
  $('#client-wait').classList.toggle('hidden', app.role === 'host');
  if (app.role === 'host') renderLobby(lobbyPayload());
}

function renderLobby(players) {
  const list = $('#players');
  list.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = hex(p.color);
    li.append(dot, document.createTextNode(p.name + (p.bot ? ' 🤖' : '') + (p.id === app.myId ? ' (вы)' : '')));
    list.appendChild(li);
  }
  $('#player-count').textContent = `${players.length}/${MAX_PLAYERS}`;
}

function enterGame() {
  show('game');
  app.inGame = true;
  $('#end').classList.add('hidden');
  $('#hud-code').textContent = app.code ? 'Комната ' + app.code : '';
  if (!renderer) {
    renderer = new Renderer($('#canvas'));
    input = new Input($('#game'), {
      aimFromMouse: (px, py) => renderer.aimDirection(px, py, app.myView),
    });
  }
  renderer.clear();
  renderer.resize();
  input.reset();
  input.enabled = true;
}

let lastFrame = performance.now();
let lastHud = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (!app.inGame || !renderer) return;

  const view = app.role === 'host' ? hostFrame(dt) : clientFrame(now);
  if (!view) return;
  app.myView = view.tanks.find((t) => t.id === app.myId);
  renderer.render(view, app.myId, dt, now / 1000);
  if (now - lastHud > 100) {
    updateHud(view);
    lastHud = now;
  }
}

function updateHud(view) {
  const sorted = [...view.tanks].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const board = $('#scoreboard');
  board.innerHTML = '';
  for (const t of sorted) {
    const info = app.roster.get(t.id);
    const chip = document.createElement('div');
    chip.className = 'chip' + (t.id === app.myId ? ' me' : '');
    chip.style.borderColor = hex(t.color);
    chip.textContent = `${info?.name ?? '?'} ${t.kills}`;
    board.appendChild(chip);
  }

  const me = app.myView;
  const msg = $('#center-msg');
  if (me && !me.alive && view.winner == null) {
    msg.textContent = `Подбит! Возрождение через ${Math.max(1, me.respawn)}…`;
    msg.classList.remove('hidden');
  } else {
    msg.classList.add('hidden');
  }

  const end = $('#end');
  if (view.winner != null) {
    if (end.classList.contains('hidden')) {
      const w = app.roster.get(view.winner);
      $('#end-title').textContent = view.winner === app.myId ? '🏆 Вы победили!' : `🏆 Победил ${w?.name ?? '?'}`;
      $('#end-title').style.color = hex(w?.color ?? 0xffffff);
      $('#end-table').innerHTML = sorted.map((t) =>
        `<tr><td><span class="dot" style="background:${hex(t.color)}"></span>${escapeHtml(app.roster.get(t.id)?.name ?? '?')}</td><td>${t.kills}</td><td>${t.deaths}</td></tr>`,
      ).join('');
      $('#end-host').classList.toggle('hidden', app.role !== 'host');
      $('#end-wait').classList.toggle('hidden', app.role === 'host');
      end.classList.remove('hidden');
      input.enabled = false;
      input.reset();
    }
  }
}

let damageTimer = 0;
function flashDamage() {
  const el = $('#damage');
  el.classList.add('on');
  clearTimeout(damageTimer);
  damageTimer = setTimeout(() => el.classList.remove('on'), 120);
}

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2500);
}

function leave() {
  const net = app.net;
  app.role = null;
  app.net = null;
  app.game = null;
  app.inGame = false;
  app.lobby = [];
  app.snaps = [];
  app.nextId = 1;
  net?.close();
  input?.reset();
  if (renderer) renderer.clear();
  app.wakeLock?.release?.().catch(() => {});
  show('menu');
}

function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }
function lerp(a, b, k) { return a + (b - a) * k; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }

// Ставим «Победа до N» в подсказку меню.
$('#kills-to-win').textContent = CFG.KILLS_TO_WIN;

// Для отладки из консоли браузера.
window.tankApp = app;

initMenu();
show('menu');
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
