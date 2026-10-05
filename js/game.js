// Симуляция игры. Работает только на устройстве хоста.
import { MAP, CELL, isSolid, emptyCells } from './map.js';
import { botThink } from './bot.js';
import { statsFromCards, rollCards, CARD_BY_ID } from './cards.js';

export const CFG = {
  TANK_R: 0.75,
  TANK_SPEED: 6.5,
  TURN_SPEED: 10,
  BULLET_SPEED: 15,
  BULLET_R: 0.18,
  BULLET_LIFE: 2.6,
  FIRE_CD: 0.45,
  RESPAWN: 2.5,
  INVULN: 1.5,
  COUNTDOWN: 3,
  ROUND_END: 2.5,
  DRAFT_TIME: 20,
  ZONE_START: 45,
  ZONE_SHRINK: 30,
  ZONE_MIN: 3,
  ZONE_TICK: 1.5,
};

// Типы событий, которые уходят клиентам (звук и эффекты).
export const EV = { SHOT: 1, BOUNCE: 2, HIT: 3, BOOM: 4, CLASH: 5, SPAWN: 6, FIZZLE: 7, SHIELD: 8, HEAL: 9 };

export const COLORS = [
  0xff4d4d, 0x4da6ff, 0x5ce65c, 0xffd23f,
  0xc77dff, 0xff8c42, 0x2ee6d6, 0xff6fb5,
  0xa0e05a, 0x8c9bff, 0xffa3a3, 0xd9d9d9,
];

export const TEAM_COLORS = [0xff4d4d, 0x4da6ff, 0x5ce65c, 0xffd23f];
export const TEAM_NAMES = ['Красные', 'Синие', 'Зелёные', 'Жёлтые'];

export const DEFAULT_SETTINGS = { mode: 'rounds', teams: 0, roundsToWin: 5, killsToWin: 10 };

export class Game {
  constructor(settings) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.tanks = new Map();
    this.bullets = [];
    this.events = [];
    this.nextBulletId = 1;
    this.time = 0;
    this.phase = 'countdown';
    this.phaseT = CFG.COUNTDOWN;
    this.fightT = 0;
    this.round = 1;
    this.wins = new Map();       // ключ стороны -> выигранные раунды
    this.roundWinner = undefined; // ключ стороны, null — ничья
    this.winner = null;          // ключ стороны-победителя матча
    this.offers = new Map();     // id танка -> предложенные карты
    this.newOffers = [];         // для рассылки игрокам
    this.zone = 0;
  }

  get rounds() { return this.settings.mode === 'rounds'; }
  get teams() { return this.settings.teams > 0; }

  // Ключ стороны: номер команды или id игрока.
  sideOf(t) { return this.teams ? 'T' + t.team : 'P' + t.id; }

  isEnemy(a, b) { return a !== b && (!this.teams || a.team !== b.team); }

  addTank(id, name, { bot = false, color = COLORS[id % COLORS.length], team = 0 } = {}) {
    const t = {
      id, name, color, bot, team,
      x: 0, y: 0, vx: 0, vy: 0, rot: 0, tur: 0,
      cards: [], s: statsFromCards([]),
      hp: 3, shield: 0, alive: false, respawnT: 0, cd: 0, inv: 0, regenT: 0, zoneT: 0,
      kills: 0, deaths: 0,
      input: { mx: 0, my: 0, ax: 0, ay: 0, fire: false },
      brain: bot ? {} : null,
    };
    this.tanks.set(id, t);
    // В режиме раундов опоздавшие ждут следующего раунда.
    if (!this.rounds || this.phase === 'countdown') {
      this.spawn(t);
    } else {
      t.respawnT = Infinity;
    }
    return t;
  }

  removeTank(id) {
    this.tanks.delete(id);
    this.offers.delete(id);
  }

  setInput(id, input) {
    const t = this.tanks.get(id);
    if (!t || t.bot) return;
    t.input.mx = clamp(+input.mx || 0, -1, 1);
    t.input.my = clamp(+input.my || 0, -1, 1);
    t.input.ax = clamp(+input.ax || 0, -1, 1);
    t.input.ay = clamp(+input.ay || 0, -1, 1);
    t.input.fire = !!input.fire;
  }

  resetTank(t) {
    t.s = statsFromCards(t.cards);
    t.hp = t.s.maxHp;
    t.shield = t.s.shieldMax;
    t.vx = t.vy = 0;
    t.alive = true;
    t.cd = 0.3;
    t.regenT = 0;
    t.zoneT = 0;
    t.rot = t.tur = Math.atan2(MAP.h * CELL / 2 - t.y, MAP.w * CELL / 2 - t.x);
  }

  // Появление в свободной клетке, максимально далёкой от врагов.
  spawn(t) {
    const others = [...this.tanks.values()].filter((o) => o !== t && o.alive && this.isEnemy(t, o));
    let best = null;
    let bestScore = -Infinity;
    for (const c of emptyCells()) {
      const x = (c.col + 0.5) * CELL;
      const y = (c.row + 0.5) * CELL;
      let d = 50;
      for (const o of others) d = Math.min(d, Math.hypot(o.x - x, o.y - y));
      const score = d + Math.random() * 3;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    t.x = best.x; t.y = best.y;
    this.resetTank(t);
    t.inv = this.rounds ? 0 : CFG.INVULN;
    this.events.push([EV.SPAWN, r2(t.x), r2(t.y), t.id]);
  }

  // Расстановка в начале раунда: команды — в своих углах, остальные — подальше друг от друга.
  placeAll() {
    for (const t of this.tanks.values()) t.alive = false;
    const list = [...this.tanks.values()];
    if (!this.teams) {
      for (const t of shuffle(list)) this.spawn(t);
      return;
    }
    const W = MAP.w * CELL, H = MAP.h * CELL;
    const anchors = this.settings.teams === 2
      ? [[0, H / 2], [W, H / 2]]
      : [[0, 0], [W, H], [W, 0], [0, H]];
    const used = new Set();
    for (let team = 0; team < this.settings.teams; team++) {
      const [ax, ay] = anchors[team];
      const cells = emptyCells()
        .map((c) => ({ c, d: Math.hypot((c.col + 0.5) * CELL - ax, (c.row + 0.5) * CELL - ay) }))
        .sort((a, b) => a.d - b.d);
      for (const t of list.filter((x) => x.team === team)) {
        const pick = cells.find(({ c }) => !used.has(c.row * MAP.w + c.col));
        used.add(pick.c.row * MAP.w + pick.c.col);
        t.x = (pick.c.col + 0.5) * CELL;
        t.y = (pick.c.row + 0.5) * CELL;
        this.resetTank(t);
        t.inv = 0;
        this.events.push([EV.SPAWN, r2(t.x), r2(t.y), t.id]);
      }
    }
  }

  step(dt) {
    this.time += dt;
    this.phaseT -= dt;

    switch (this.phase) {
      case 'countdown':
        if (this.phaseT <= 0) { this.phase = 'fight'; this.fightT = 0; }
        break;
      case 'fight':
        this.fightT += dt;
        this.updateZone();
        break;
      case 'roundEnd':
        if (this.phaseT <= 0) this.endRound();
        break;
      case 'draft':
        if (this.phaseT <= 0 || [...this.offers.values()].every((o) => o.picked)) this.finishDraft();
        break;
      case 'matchEnd':
        return;
    }

    const frozen = this.phase === 'countdown' || this.phase === 'draft';
    for (const t of this.tanks.values()) {
      if (!t.alive) {
        if (!this.rounds) {
          t.respawnT -= dt;
          if (t.respawnT <= 0) this.spawn(t);
        }
        continue;
      }
      if (frozen) continue;
      if (t.bot) botThink(this, t, dt);
      this.stepTank(t, dt);
    }
    if (!frozen) {
      this.separateTanks();
      this.stepBullets(dt);
    }

    if (this.phase === 'fight' && this.rounds) this.checkRoundOver();
  }

  updateZone() {
    if (!this.rounds || this.fightT < CFG.ZONE_START) { this.zone = 0; return; }
    const W = MAP.w * CELL, H = MAP.h * CELL;
    const full = Math.hypot(W, H) / 2;
    const k = Math.min(1, (this.fightT - CFG.ZONE_START) / CFG.ZONE_SHRINK);
    this.zone = full + (CFG.ZONE_MIN - full) * k;
  }

  checkRoundOver() {
    const sides = new Set();
    for (const t of this.tanks.values()) if (t.alive) sides.add(this.sideOf(t));
    if (sides.size > 1) return;
    const winner = sides.size === 1 ? [...sides][0] : null;
    this.roundWinner = winner;
    this.zone = 0;
    if (winner !== null) this.wins.set(winner, (this.wins.get(winner) || 0) + 1);
    this.phase = 'roundEnd';
    this.phaseT = CFG.ROUND_END;
  }

  endRound() {
    this.bullets = [];
    this.zone = 0;
    const w = this.roundWinner;
    if (w !== null && this.wins.get(w) >= this.settings.roundsToWin) {
      this.winner = w;
      this.phase = 'matchEnd';
      return;
    }
    // Карты получают все, кто не на стороне победителя (при ничьей — все).
    this.offers.clear();
    this.newOffers = [];
    for (const t of this.tanks.values()) {
      if (w !== null && this.sideOf(t) === w) continue;
      const options = rollCards(t.cards, 3);
      if (!options.length) continue;
      const offer = { options, picked: null };
      this.offers.set(t.id, offer);
      if (t.bot) this.pickCard(t.id, options[Math.floor(Math.random() * options.length)]);
      else this.newOffers.push({ id: t.id, options });
    }
    if (!this.offers.size) { this.nextRound(); return; }
    this.phase = 'draft';
    this.phaseT = CFG.DRAFT_TIME;
  }

  pickCard(id, cardId) {
    const offer = this.offers.get(id);
    const t = this.tanks.get(id);
    if (!offer || !t || offer.picked || !offer.options.includes(cardId)) return false;
    offer.picked = cardId;
    t.cards.push(cardId);
    return true;
  }

  finishDraft() {
    // Кто не успел — получает случайную карту из предложенных.
    for (const [id, offer] of this.offers) {
      if (!offer.picked) this.pickCard(id, offer.options[Math.floor(Math.random() * offer.options.length)]);
    }
    this.offers.clear();
    this.nextRound();
  }

  nextRound() {
    this.round++;
    this.roundWinner = undefined;
    this.bullets = [];
    this.placeAll();
    this.phase = 'countdown';
    this.phaseT = CFG.COUNTDOWN;
  }

  takeOffers() {
    const o = this.newOffers;
    this.newOffers = [];
    return o;
  }

  stepTank(t, dt) {
    const inp = t.input;
    let mx = inp.mx, my = inp.my;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const px = t.x, py = t.y;
    const speed = CFG.TANK_SPEED * t.s.speed;
    t.x += mx * speed * dt;
    t.y += my * speed * dt;
    resolveWalls(t);
    t.vx = (t.x - px) / dt;
    t.vy = (t.y - py) / dt;

    if (m > 0.15) t.rot = turnTowards(t.rot, Math.atan2(my, mx), CFG.TURN_SPEED * dt);
    if (Math.hypot(inp.ax, inp.ay) > 0.2) t.tur = Math.atan2(inp.ay, inp.ax);

    t.cd -= dt;
    t.inv = Math.max(0, t.inv - dt);

    if (t.s.regen && t.hp < t.s.maxHp) {
      t.regenT += dt;
      if (t.regenT >= t.s.regen) {
        t.regenT = 0;
        t.hp++;
        this.events.push([EV.HEAL, r2(t.x), r2(t.y), t.id]);
      }
    } else {
      t.regenT = 0;
    }

    // Вне зоны танк получает урон.
    if (this.zone > 0) {
      const cx = MAP.w * CELL / 2, cy = MAP.h * CELL / 2;
      if (Math.hypot(t.x - cx, t.y - cy) > this.zone) {
        t.zoneT += dt;
        if (t.zoneT >= CFG.ZONE_TICK) {
          t.zoneT = 0;
          this.damage(t, null, 1, true);
          if (!t.alive) return;
        }
      } else {
        t.zoneT = 0;
      }
    }

    const canFire = this.phase === 'fight' || this.phase === 'roundEnd';
    if (inp.fire && t.cd <= 0 && canFire) this.fire(t);
  }

  fire(t) {
    const s = t.s;
    t.cd = CFG.FIRE_CD * s.cdMul;
    t.inv = 0;
    const spread = 0.17;
    const off = CFG.TANK_R * 0.6;
    for (let i = 0; i < s.shots; i++) {
      const a = t.tur + (i - (s.shots - 1) / 2) * spread;
      const dx = Math.cos(a), dy = Math.sin(a);
      this.bullets.push({
        id: this.nextBulletId++,
        owner: t.id,
        team: t.team,
        x: t.x + dx * off, y: t.y + dy * off,
        vx: dx * CFG.BULLET_SPEED * s.bSpeed, vy: dy * CFG.BULLET_SPEED * s.bSpeed,
        r: CFG.BULLET_R * s.bSize,
        dmg: s.damage,
        maxBounces: s.bounces,
        homing: s.homing,
        split: s.split,
        life: CFG.BULLET_LIFE,
        bounces: 0,
      });
    }
    const dx = Math.cos(t.tur), dy = Math.sin(t.tur);
    this.events.push([EV.SHOT, r2(t.x + dx * 1.1), r2(t.y + dy * 1.1), t.id]);
  }

  separateTanks() {
    const list = [...this.tanks.values()].filter((t) => t.alive);
    const minD = CFG.TANK_R * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 1e-4) { dx = 1; dy = 0; d = 1; }
        const push = (minD - d) / 2;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
        resolveWalls(a); resolveWalls(b);
      }
    }
  }

  stepBullets(dt) {
    const SUB = 3;
    const h = dt / SUB;
    const spawned = [];
    for (const b of this.bullets) {
      b.life -= dt;
      if (b.homing) this.steer(b, dt);
      for (let s = 0; s < SUB && !b.dead; s++) {
        b.x += b.vx * h;
        if (isSolid(b.x, b.y)) { b.x -= b.vx * h; b.vx = -b.vx; this.bounce(b, spawned); }
        b.y += b.vy * h;
        if (!b.dead && isSolid(b.x, b.y)) { b.y -= b.vy * h; b.vy = -b.vy; this.bounce(b, spawned); }
        if (!b.dead) this.bulletHits(b);
      }
      if (b.life <= 0 && !b.dead) {
        b.dead = true;
        this.events.push([EV.FIZZLE, r2(b.x), r2(b.y), 0]);
      }
    }

    // Пули сталкиваются друг с другом и обе исчезают.
    const live = this.bullets.filter((b) => !b.dead);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], c = live[j];
        if (a.dead || c.dead || a.owner === c.owner) continue;
        const d = (a.r + c.r) * 1.2;
        if (Math.abs(a.x - c.x) < d && Math.abs(a.y - c.y) < d) {
          a.dead = c.dead = true;
          this.events.push([EV.CLASH, r2((a.x + c.x) / 2), r2((a.y + c.y) / 2), 0]);
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead).concat(spawned);
  }

  // Самонаведение: плавно поворачиваем пулю к ближайшему врагу впереди.
  steer(b, dt) {
    const owner = this.tanks.get(b.owner);
    let best = null, bestD = 9;
    for (const t of this.tanks.values()) {
      if (!t.alive || t.id === b.owner || (owner && !this.isEnemy(owner, t))) continue;
      const dx = t.x - b.x, dy = t.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > bestD) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if ((dx * b.vx + dy * b.vy) / (d * sp) < 0.2) continue;
      best = t; bestD = d;
    }
    if (!best) return;
    const cur = Math.atan2(b.vy, b.vx);
    const want = Math.atan2(best.y - b.y, best.x - b.x);
    const a = cur + clamp(angleDiff(cur, want), -1, 1) * Math.min(1, 2.4 * b.homing * dt);
    const sp = Math.hypot(b.vx, b.vy);
    b.vx = Math.cos(a) * sp;
    b.vy = Math.sin(a) * sp;
  }

  bounce(b, spawned) {
    b.bounces++;
    if (b.bounces > b.maxBounces) {
      b.dead = true;
      this.events.push([EV.FIZZLE, r2(b.x), r2(b.y), 0]);
      return;
    }
    this.events.push([EV.BOUNCE, r2(b.x), r2(b.y), 0]);
    if (b.split) {
      // Осколки: пуля расходится на две под углом.
      b.split = false;
      const a = Math.atan2(b.vy, b.vx);
      const sp = Math.hypot(b.vx, b.vy);
      const twin = { ...b, id: this.nextBulletId++, dead: false };
      b.vx = Math.cos(a - 0.3) * sp; b.vy = Math.sin(a - 0.3) * sp;
      twin.vx = Math.cos(a + 0.3) * sp; twin.vy = Math.sin(a + 0.3) * sp;
      spawned.push(twin);
    }
  }

  bulletHits(b) {
    for (const t of this.tanks.values()) {
      if (!t.alive) continue;
      const own = t.id === b.owner;
      // Свою пулю можно словить только после рикошета (и без «Резиновой брони»).
      if (own && (b.bounces === 0 || t.s.selfImmune)) continue;
      // Пули союзников пролетают сквозь своих.
      if (!own && this.teams && t.team === b.team) continue;
      const hitD = CFG.TANK_R + b.r;
      const dx = t.x - b.x, dy = t.y - b.y;
      if (dx * dx + dy * dy > hitD * hitD) continue;
      b.dead = true;
      if (t.inv > 0 || this.phase === 'roundEnd') {
        this.events.push([EV.FIZZLE, r2(b.x), r2(b.y), 0]);
        return;
      }
      this.damage(t, b.owner, b.dmg);
      return;
    }
  }

  damage(t, attackerId, amount, ignoreShield = false) {
    if (t.shield > 0 && !ignoreShield) {
      t.shield--;
      this.events.push([EV.SHIELD, r2(t.x), r2(t.y), t.id]);
      return;
    }
    t.hp -= amount;
    this.events.push([EV.HIT, r2(t.x), r2(t.y), t.id]);

    const attacker = this.tanks.get(attackerId);
    if (attacker && attacker !== t && attacker.alive && attacker.s.vampire && attacker.hp < attacker.s.maxHp) {
      attacker.hp++;
      this.events.push([EV.HEAL, r2(attacker.x), r2(attacker.y), attacker.id]);
    }

    if (t.hp > 0) return;
    t.hp = 0;
    t.alive = false;
    t.deaths++;
    t.respawnT = CFG.RESPAWN;
    this.events.push([EV.BOOM, r2(t.x), r2(t.y), t.id]);
    if (attacker && attacker !== t) {
      attacker.kills++;
    } else if (attacker === t && !this.rounds) {
      t.kills = Math.max(0, t.kills - 1);
    }
    if (!this.rounds) this.checkFragWin();
  }

  checkFragWin() {
    const score = this.scores();
    for (const [side, v] of score) {
      if (v >= this.settings.killsToWin) {
        this.winner = side;
        this.phase = 'matchEnd';
        return;
      }
    }
  }

  // Счёт сторон: раунды или фраги (в командах — сумма фрагов).
  scores() {
    const m = new Map();
    for (const t of this.tanks.values()) {
      const side = this.sideOf(t);
      if (!m.has(side)) m.set(side, 0);
      if (!this.rounds) m.set(side, m.get(side) + t.kills);
    }
    if (this.rounds) for (const [side, w] of this.wins) if (m.has(side)) m.set(side, w);
    return m;
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // Компактный снимок состояния для отправки по сети.
  snapshot() {
    const tanks = [];
    for (const t of this.tanks.values()) {
      tanks.push([
        t.id, r2(t.x), r2(t.y), r2(t.rot), r2(t.tur), t.hp,
        (t.alive ? 1 : 0) | (t.inv > 0 ? 2 : 0),
        t.kills, t.deaths,
        t.alive || this.rounds ? 0 : Math.max(0, Math.ceil(t.respawnT)),
        t.s.maxHp, t.shield,
      ]);
    }
    const bullets = this.bullets.map((b) => [b.id, r2(b.x), r2(b.y), b.owner, Math.round(b.r * 100)]);
    const waiting = [];
    for (const [id, o] of this.offers) if (!o.picked) waiting.push(id);
    return {
      tanks, bullets,
      phase: this.phase,
      phaseT: Math.max(0, Math.ceil(this.phaseT)),
      round: this.round,
      zone: r2(this.zone),
      scores: [...this.scores()],
      roundWinner: this.roundWinner,
      winner: this.winner,
      waiting,
    };
  }

  roster() {
    return [...this.tanks.values()].map((t) => ({
      id: t.id, name: t.name, color: t.color, bot: t.bot, team: t.team, cards: t.cards,
    }));
  }
}

// Выталкивает круг танка из стен.
export function resolveWalls(t) {
  const R = CFG.TANK_R;
  for (let iter = 0; iter < 3; iter++) {
    const c0 = Math.floor((t.x - R) / CELL), c1 = Math.floor((t.x + R) / CELL);
    const r0 = Math.floor((t.y - R) / CELL), r1 = Math.floor((t.y + R) / CELL);
    let moved = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!MAP.solid(c, r)) continue;
        const nx = clamp(t.x, c * CELL, (c + 1) * CELL);
        const ny = clamp(t.y, r * CELL, (r + 1) * CELL);
        const dx = t.x - nx, dy = t.y - ny;
        const d = Math.hypot(dx, dy);
        if (d >= R) continue;
        if (d < 1e-6) {
          // Центр внутри стены — выталкиваем к ближайшей грани.
          const cx = (c + 0.5) * CELL, cy = (r + 0.5) * CELL;
          if (Math.abs(t.x - cx) > Math.abs(t.y - cy)) t.x = t.x > cx ? (c + 1) * CELL + R : c * CELL - R;
          else t.y = t.y > cy ? (r + 1) * CELL + R : r * CELL - R;
        } else {
          t.x = nx + (dx / d) * R;
          t.y = ny + (dy / d) * R;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

export function sideName(side, roster) {
  if (side == null) return '';
  if (side[0] === 'T') return TEAM_NAMES[+side.slice(1)];
  return roster.get(+side.slice(1))?.name ?? '?';
}

export function sideColor(side, roster) {
  if (side == null) return 0xffffff;
  if (side[0] === 'T') return TEAM_COLORS[+side.slice(1)];
  return roster.get(+side.slice(1))?.color ?? 0xffffff;
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function r2(v) { return Math.round(v * 100) / 100; }

export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnTowards(a, target, maxStep) {
  const d = angleDiff(a, target);
  return Math.abs(d) <= maxStep ? target : a + Math.sign(d) * maxStep;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export { CARD_BY_ID };
