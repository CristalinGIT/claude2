import {
  Game, EV, COLORS, TEAM_COLORS, TEAM_NAMES, DEFAULT_SETTINGS, angleDiff, sideName, sideColor,
} from './game.js';
import { CARD_BY_ID } from './cards.js';
import { hostRoom, joinRoom } from './net.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { sfx, unlockAudio } from './sound.js';

const MAX_HUMANS = 8;
const MAX_TANKS = 12;
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
  settings: { ...DEFAULT_SETTINGS },
  lobby: [],         // [{id, name, color, bot, connId, team}]
  roster: new Map(), // id -> {name, color, bot, team, cards}
  game: null,        // только у хоста
  inGame: false,
  nextId: 1,
  botN: 0,
  snaps: [],
  offset: null,
  lastSend: 0,
  myOffer: null,     // {options, picked}
  lastPhase: null,
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
  $('#btn-leave').addEventListener('click', leave);
  $('#btn-exit').addEventListener('click', () => { if (confirm('Выйти из игры?')) leave(); });
  $('#btn-again').addEventListener('click', hostStartMatch);
  $('#btn-to-lobby').addEventListener('click', hostBackToLobby);

  $('#set-mode').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) hostSetSettings({ mode: v });
  });
  $('#set-teams').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v != null) hostSetSettings({ teams: +v });
  });
  $('#target-minus').addEventListener('click', () => hostStepTarget(-1));
  $('#target-plus').addEventListener('click', () => hostStepTarget(1));
  $('#btn-fill').addEventListener('click', hostFillBots);

  // Кнопки внутри списка команд (создаются динамически).
  $('#teams').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const team = +b.dataset.team;
    if (b.dataset.act === 'join') requestTeam(team);
    if (b.dataset.act === 'bot+') hostAddBot(team);
    if (b.dataset.act === 'bot-') hostRemoveBot(team);
  });

  $('#draft-cards').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-card]');
    if (b) pickCard(b.dataset.card);
  });
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
  initHost(app.net.code);
}

// Одиночная тренировка с ботами — без сети.
function startSolo() {
  goFullscreen();
  app.net = { broadcast() {}, send() {}, kick() {}, close() {} };
  initHost('');
  hostAddBot(0, false);
  hostAddBot(0, false);
  hostAddBot(0, false);
  enterLobby();
}

function initHost(code) {
  app.role = 'host';
  app.code = code;
  app.myId = 0;
  app.nextId = 1;
  app.botN = 0;
  app.lobby = [{ id: 0, name: playerName(), color: COLORS[0], bot: false, connId: null, team: 0 }];
  enterLobby();
}

function freeColor() {
  const used = new Set(app.lobby.map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) ?? COLORS[0];
}

function teamCount(team, humansOnly = false) {
  return app.lobby.filter((p) => p.team === team && (!humansOnly || !p.bot)).length;
}

function smallestTeam() {
  let best = 0;
  for (let t = 1; t < app.settings.teams; t++) {
    if (teamCount(t, true) < teamCount(best, true) ||
        (teamCount(t, true) === teamCount(best, true) && teamCount(t) < teamCount(best))) best = t;
  }
  return best;
}

function hostOnJoin(connId, meta) {
  const humans = app.lobby.filter((p) => !p.bot).length;
  if (humans >= MAX_HUMANS) {
    app.net.send(connId, { t: 'full' });
    setTimeout(() => app.net.kick(connId), 300);
    return;
  }
  const team = app.settings.teams ? smallestTeam() : 0;
  // Освобождаем место, выкидывая бота, если комната забита.
  if (app.lobby.length >= MAX_TANKS) removeBotFrom(team) || removeBotFrom(null);
  const p = {
    id: app.nextId++,
    name: String(meta.name || 'Игрок').slice(0, 14),
    color: freeColor(),
    bot: false,
    connId,
    team,
  };
  app.lobby.push(p);
  app.net.send(connId, { t: 'welcome', id: p.id, code: app.code });
  if (app.inGame) {
    app.game.addTank(p.id, p.name, { color: tankColor(p), team: p.team });
    app.net.send(connId, { t: 'start', settings: app.settings });
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
  if (msg.t === 'pick' && app.game) app.game.pickCard(p.id, String(msg.card));
  if (msg.t === 'team' && !app.inGame) hostMoveToTeam(p, +msg.team);
}

function hostMoveToTeam(p, team) {
  if (!app.settings.teams || !(team >= 0 && team < app.settings.teams)) return;
  p.team = team;
  broadcastLobby();
}

function requestTeam(team) {
  if (app.role === 'host') hostMoveToTeam(app.lobby[0], team);
  else app.net.send({ t: 'team', team });
}

function hostAddBot(team = 0, broadcast = true) {
  if (app.role !== 'host' || app.lobby.length >= MAX_TANKS) return false;
  app.botN++;
  app.lobby.push({
    id: app.nextId++, name: 'Бот ' + app.botN, color: freeColor(), bot: true, connId: null,
    team: app.settings.teams ? team : 0,
  });
  if (broadcast) broadcastLobby();
  return true;
}

function removeBotFrom(team) {
  const bots = app.lobby.filter((p) => p.bot && (team == null || p.team === team));
  if (!bots.length) return false;
  const last = bots[bots.length - 1];
  app.lobby = app.lobby.filter((p) => p !== last);
  return true;
}

function hostRemoveBot(team) {
  if (app.role !== 'host') return;
  if (removeBotFrom(app.settings.teams ? team : null)) broadcastLobby();
}

// Добиваем все команды ботами до размера самой большой.
function hostFillBots() {
  if (app.role !== 'host' || !app.settings.teams) return;
  const n = app.settings.teams;
  let size = 0;
  for (let t = 0; t < n; t++) size = Math.max(size, teamCount(t));
  size = Math.max(size, 1);
  for (let t = 0; t < n; t++) {
    while (teamCount(t) < size && hostAddBot(t, false));
  }
  broadcastLobby();
}

function hostSetSettings(patch) {
  if (app.role !== 'host') return;
  const s = { ...app.settings, ...patch };
  if (patch.teams !== undefined && patch.teams !== app.settings.teams) {
    if (s.teams) {
      // Раскидываем всех по командам заново: людей поровну, ботов следом.
      const humans = app.lobby.filter((p) => !p.bot);
      const bots = app.lobby.filter((p) => p.bot);
      [...humans, ...bots].forEach((p, i) => { p.team = i % s.teams; });
    }
  }
  app.settings = s;
  broadcastLobby();
}

function hostStepTarget(dir) {
  const s = app.settings;
  if (s.mode === 'rounds') hostSetSettings({ roundsToWin: clamp(s.roundsToWin + dir, 1, 15) });
  else hostSetSettings({ killsToWin: clamp(s.killsToWin + dir * 5, 5, 50) });
}

function lobbyPayload() {
  return app.lobby.map(({ id, name, color, bot, team }) => ({ id, name, color, bot, team }));
}

function broadcastLobby() {
  const players = lobbyPayload();
  app.net.broadcast({ t: 'lobby', players, settings: app.settings });
  renderLobby(players, app.settings);
}

function broadcastRoster() {
  const players = app.game.roster();
  app.net.broadcast({ t: 'roster', players });
  setRoster(players);
}

// Цвет танка: в командах — оттенок цвета команды, иначе личный.
function tankColor(p) {
  if (!app.settings.teams) return p.color;
  const mates = app.lobby.filter((x) => x.team === p.team);
  const i = Math.max(0, mates.indexOf(p));
  const shades = [0, 0.28, -0.28, 0.45, -0.42, 0.14, -0.14, 0.6];
  const k = shades[i % shades.length];
  const c = TEAM_COLORS[p.team];
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const mix = (v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

function hostStartMatch() {
  const s = app.settings;
  const sides = new Set(app.lobby.map((p) => (s.teams ? 'T' + p.team : 'P' + p.id)));
  if (sides.size < 2) {
    toast(s.teams ? 'Нужно минимум 2 непустые команды' : 'Нужно минимум 2 участника — добавьте бота');
    return;
  }
  app.game = new Game(s);
  for (const p of app.lobby) {
    app.game.addTank(p.id, p.name, { bot: p.bot, color: tankColor(p), team: s.teams ? p.team : 0 });
  }
  if (s.mode === 'rounds') app.game.placeAll();
  app.net.broadcast({ t: 'start', settings: s });
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
    const phaseBefore = g.phase;
    g.step(TICK);
    acc -= TICK;
    tickN++;

    // Раздаём карточки проигравшим.
    for (const offer of g.takeOffers()) {
      if (offer.id === app.myId) showOffer(offer.options);
      else {
        const p = app.lobby.find((x) => x.id === offer.id);
        if (p?.connId) app.net.send(p.connId, { t: 'draft', options: offer.options });
      }
    }
    if (g.phase !== phaseBefore && g.phase === 'countdown') broadcastRoster();

    if (tickN % SEND_EVERY === 0) {
      const ev = g.takeEvents();
      const snap = g.snapshot();
      app.net.broadcast({ t: 's', tm: Math.round(g.time * 1000), ...snap, ev });
      handleEvents(ev);
    }
  }
  const snap = g.snapshot();
  return interpolate(snap, snap, 0);
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
      app.settings = msg.settings;
      renderLobby(msg.players, msg.settings);
      break;
    case 'roster':
      setRoster(msg.players);
      break;
    case 'start':
      app.settings = msg.settings;
      app.snaps = [];
      app.offset = null;
      enterGame();
      break;
    case 'tolobby':
      enterLobby();
      break;
    case 'draft':
      showOffer(msg.options);
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
  const k = b === a ? 0 : clamp((rt - a.tm) / (b.tm - a.tm), 0, 1);
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
      kills: t[7], deaths: t[8], respawn: t[9], maxHp: t[10], shield: t[11],
      color: app.roster.get(t[0])?.color ?? 0xffffff,
    };
  });
  const prevB = new Map(a.bullets.map((x) => [x[0], x]));
  const bullets = b.bullets.map((x) => {
    const p = prevB.get(x[0]) ?? x;
    return {
      id: x[0], x: lerp(p[1], x[1], k), y: lerp(p[2], x[2], k),
      color: app.roster.get(x[3])?.color, r: x[4] / 100,
    };
  });
  return {
    tanks, bullets,
    phase: b.phase, phaseT: b.phaseT, round: b.round, zone: b.zone,
    scores: b.scores, roundWinner: b.roundWinner, winner: b.winner, waiting: b.waiting,
  };
}

// ---------- Карточки ----------

function showOffer(options) {
  app.myOffer = { options, picked: null };
  renderDraftCards();
  sfx.spawn();
}

function pickCard(cardId) {
  const offer = app.myOffer;
  if (!offer || offer.picked || !offer.options.includes(cardId)) return;
  offer.picked = cardId;
  if (app.role === 'host') app.game.pickCard(app.myId, cardId);
  else app.net.send({ t: 'pick', card: cardId });
  renderDraftCards();
}

function renderDraftCards() {
  const box = $('#draft-cards');
  box.innerHTML = '';
  const offer = app.myOffer;
  if (!offer) return;
  const mine = app.roster.get(app.myId)?.cards ?? [];
  for (const id of offer.options) {
    const c = CARD_BY_ID.get(id);
    const have = mine.filter((x) => x === id).length;
    const b = document.createElement('button');
    b.className = 'card' + (offer.picked === id ? ' picked' : '') + (offer.picked && offer.picked !== id ? ' faded' : '');
    b.dataset.card = id;
    b.disabled = !!offer.picked;
    b.innerHTML = `<span class="card-icon">${c.icon}</span><b>${c.name}</b><span>${c.desc}</span>` +
      (have ? `<small>уже ${have}/${c.max}</small>` : '');
    box.appendChild(b);
  }
}

function cardIcons(ids) {
  return (ids || []).map((id) => CARD_BY_ID.get(id)?.icon ?? '').join('');
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
      case EV.SHIELD:
        renderer.burst(x, y, { count: 16, color: 0x5cc8ff, speed: 5, size: 0.16, life: 0.4, up: 2 });
        sfx.clash();
        break;
      case EV.HEAL:
        renderer.burst(x, y, { count: 8, color: 0x6dff7a, speed: 1.5, size: 0.16, life: 0.6, up: 5 });
        break;
    }
  }
}

function enterLobby() {
  show('lobby');
  app.inGame = false;
  app.myOffer = null;
  input?.setEnabled(false);
  if (renderer) renderer.clear();
  $('#lobby-code').textContent = app.code || '—';
  $('#lobby-code-box').classList.toggle('hidden', !app.code);
  $('#btn-start').classList.toggle('hidden', app.role !== 'host');
  $('#client-wait').classList.toggle('hidden', app.role === 'host');
  if (app.role === 'host') renderLobby(lobbyPayload(), app.settings);
}

function renderLobby(players, settings) {
  const isHost = app.role === 'host';
  for (const b of document.querySelectorAll('#set-mode button')) {
    b.classList.toggle('on', b.dataset.v === settings.mode);
    b.disabled = !isHost;
  }
  for (const b of document.querySelectorAll('#set-teams button')) {
    b.classList.toggle('on', +b.dataset.v === settings.teams);
    b.disabled = !isHost;
  }
  const rounds = settings.mode === 'rounds';
  $('#target-label').textContent = rounds ? 'Раундов до победы' : 'Фрагов до победы';
  $('#target-val').textContent = rounds ? settings.roundsToWin : settings.killsToWin;
  $('#target-minus').disabled = $('#target-plus').disabled = !isHost;
  $('#mode-hint').textContent = rounds
    ? 'Без возрождений: раунд идёт, пока не останется один игрок или одна команда. Проигравшие выбирают карточку усиления.'
    : 'Возрождение после гибели. Побеждает тот, кто первым наберёт нужное число уничтожений.';
  $('#btn-fill').classList.toggle('hidden', !isHost || !settings.teams);

  const box = $('#teams');
  box.innerHTML = '';
  const groups = settings.teams
    ? Array.from({ length: settings.teams }, (_, t) => ({ team: t, name: TEAM_NAMES[t], color: TEAM_COLORS[t] }))
    : [{ team: 0, name: 'Все против всех', color: null }];
  const me = players.find((p) => p.id === app.myId);
  for (const g of groups) {
    const members = settings.teams ? players.filter((p) => p.team === g.team) : players;
    const div = document.createElement('div');
    div.className = 'team';
    if (g.color != null) div.style.borderColor = hex(g.color);
    let head = `<div class="team-head"><b style="color:${g.color != null ? hex(g.color) : 'inherit'}">${g.name}</b>` +
      `<small>${members.length}</small>`;
    if (settings.teams && me && me.team !== g.team) {
      head += `<button data-act="join" data-team="${g.team}">Сюда</button>`;
    }
    head += '</div>';
    const list = members.map((p) => {
      const color = settings.teams ? g.color : p.color;
      return `<li><span class="dot" style="background:${hex(color)}"></span>${escapeHtml(p.name)}` +
        `${p.bot ? ' 🤖' : ''}${p.id === app.myId ? ' <i>(вы)</i>' : ''}</li>`;
    }).join('');
    let bots = '';
    if (isHost) {
      bots = `<div class="bot-row"><button data-act="bot-" data-team="${g.team}">− бот</button>` +
        `<button data-act="bot+" data-team="${g.team}">+ бот</button></div>`;
    }
    div.innerHTML = head + `<ul>${list}</ul>` + bots;
    box.appendChild(div);
  }
  box.classList.toggle('multi', settings.teams > 0);
  $('#player-count').textContent = `${players.length}/${MAX_TANKS}`;
}

function enterGame() {
  show('game');
  app.inGame = true;
  app.myOffer = null;
  app.lastPhase = null;
  $('#end').classList.add('hidden');
  $('#draft').classList.add('hidden');
  $('#hud-code').textContent = app.code ? 'Комната ' + app.code : '';
  if (!renderer) {
    renderer = new Renderer($('#canvas'));
    input = new Input($('#game'), {
      aimFromMouse: (px, py) => renderer.aimDirection(px, py, app.myView),
    });
    window.addEventListener('resize', () => input.reset());
  }
  renderer.clear();
  renderer.resize();
  input.setEnabled(true);
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
  if (view.phase !== app.lastPhase) onPhaseChange(view, app.lastPhase);
  if (now - lastHud > 100) {
    updateHud(view);
    lastHud = now;
  }
}

function onPhaseChange(view, before) {
  app.lastPhase = view.phase;
  if (view.phase !== 'draft') {
    app.myOffer = null;
    $('#draft').classList.add('hidden');
  }
  if (view.phase === 'roundEnd') {
    const w = view.roundWinner;
    if (w != null && mySide() === w) sfx.spawn();
  }
  if (view.phase === 'fight' && before === 'countdown') sfx.shot(true);
}

function mySide() {
  const me = app.roster.get(app.myId);
  if (!me) return null;
  return app.settings.teams ? 'T' + me.team : 'P' + me.id;
}

function updateHud(view) {
  const rounds = app.settings.mode === 'rounds';
  const scores = new Map(view.scores || []);
  const alive = new Map();
  for (const t of view.tanks) {
    const r = app.roster.get(t.id);
    if (!r) continue;
    const side = app.settings.teams ? 'T' + r.team : 'P' + t.id;
    alive.set(side, (alive.get(side) || 0) + (t.alive ? 1 : 0));
  }

  // Табло: стороны по убыванию счёта.
  const board = $('#scoreboard');
  board.innerHTML = '';
  const sides = [...scores.keys()].sort((a, b) => scores.get(b) - scores.get(a));
  const my = mySide();
  for (const side of sides) {
    const chip = document.createElement('div');
    chip.className = 'chip' + (side === my ? ' me' : '') + (rounds && !alive.get(side) ? ' dead' : '');
    chip.style.borderColor = hex(sideColor(side, app.roster));
    const val = scores.get(side);
    chip.textContent = `${sideName(side, app.roster)} ${rounds ? '★' + val : val}`;
    board.appendChild(chip);
  }
  $('#round-info').textContent = rounds
    ? `Раунд ${view.round} · до ${app.settings.roundsToWin} побед`
    : `до ${app.settings.killsToWin} фрагов`;

  // Сообщение по центру.
  const me = app.myView;
  let msg = '';
  let big = false;
  if (view.phase === 'countdown') {
    msg = (rounds ? `Раунд ${view.round}\n` : '') + (view.phaseT > 0 ? view.phaseT : 'В бой!');
    big = true;
  } else if (view.phase === 'roundEnd') {
    const w = view.roundWinner;
    msg = w == null ? 'Ничья!' : (w === my ? 'Раунд ваш! 🎉' : `Раунд за: ${sideName(w, app.roster)}`);
    big = true;
  } else if (view.phase === 'fight' && me && !me.alive) {
    msg = rounds ? 'Вы подбиты — ждём конца раунда' : `Подбит! Возрождение через ${Math.max(1, me.respawn)}…`;
  } else if (view.phase === 'fight' && view.zone > 0 && me?.alive) {
    msg = '⚠ Зона сужается — к центру!';
  }
  const el = $('#center-msg');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
  el.classList.toggle('big', big);

  // Выбор карточек.
  const draft = $('#draft');
  if (view.phase === 'draft') {
    draft.classList.remove('hidden');
    const w = view.roundWinner;
    const offer = app.myOffer;
    $('#draft-title').textContent = w == null ? 'Ничья!' : (w === my ? 'Раунд ваш! 🎉' : `Раунд за: ${sideName(w, app.roster)}`);
    $('#draft-sub').textContent = offer
      ? (offer.picked ? 'Карта выбрана' : 'Выберите усиление')
      : 'Проигравшие выбирают усиления…';
    const waiting = (view.waiting || []).map((id) => app.roster.get(id)?.name).filter(Boolean);
    $('#draft-wait').textContent = waiting.length ? 'Ждём: ' + waiting.join(', ') : '';
    $('#draft-bar').style.width = Math.min(100, (view.phaseT / 20) * 100) + '%';
    const mine = app.roster.get(app.myId)?.cards ?? [];
    $('#my-cards').textContent = mine.length ? 'Ваши карты: ' + cardIcons(mine) : '';
  }

  // Конец матча.
  const end = $('#end');
  if (view.phase === 'matchEnd' && view.winner != null && end.classList.contains('hidden')) {
    const w = view.winner;
    const name = sideName(w, app.roster);
    $('#end-title').textContent = w === my
      ? (app.settings.teams ? `🏆 Ваша команда победила!` : '🏆 Вы победили!')
      : `🏆 Победа: ${name}`;
    $('#end-title').style.color = hex(sideColor(w, app.roster));
    const rows = [...view.tanks].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    $('#end-table').innerHTML = rows.map((t) => {
      const r = app.roster.get(t.id);
      return `<tr><td><span class="dot" style="background:${hex(t.color)}"></span>${escapeHtml(r?.name ?? '?')}</td>` +
        `<td>${t.kills}</td><td>${t.deaths}</td><td class="cards-cell">${cardIcons(r?.cards)}</td></tr>`;
    }).join('');
    $('#end-host').classList.toggle('hidden', app.role !== 'host');
    $('#end-wait').classList.toggle('hidden', app.role === 'host');
    end.classList.remove('hidden');
    input.setEnabled(false);
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
  app.myOffer = null;
  app.settings = { ...DEFAULT_SETTINGS };
  net?.close();
  input?.setEnabled(false);
  if (renderer) renderer.clear();
  app.wakeLock?.release?.().catch(() => {});
  show('menu');
}

function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }
function lerp(a, b, k) { return a + (b - a) * k; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }

// Для отладки из консоли браузера.
window.tankApp = app;

initMenu();
show('menu');
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
