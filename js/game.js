// Симуляция игры. Работает только на устройстве хоста.
import { MAP, CELL, isSolid, emptyCells } from './map.js';
import { botThink } from './bot.js';

export const CFG = {
  TANK_R: 0.75,
  TANK_SPEED: 6.5,
  TURN_SPEED: 10,
  BULLET_SPEED: 15,
  BULLET_R: 0.18,
  BULLET_LIFE: 2.6,
  BOUNCES: 1,
  FIRE_CD: 0.45,
  HP: 3,
  RESPAWN: 2.5,
  INVULN: 1.5,
  KILLS_TO_WIN: 10,
};

// Типы событий, которые уходят клиентам (звук и эффекты).
export const EV = { SHOT: 1, BOUNCE: 2, HIT: 3, BOOM: 4, CLASH: 5, SPAWN: 6, FIZZLE: 7 };

export const COLORS = [
  0xff4d4d, 0x4da6ff, 0x5ce65c, 0xffd23f,
  0xc77dff, 0xff8c42, 0x2ee6d6, 0xff6fb5,
];

export class Game {
  constructor() {
    this.tanks = new Map();
    this.bullets = [];
    this.events = [];
    this.nextBulletId = 1;
    this.time = 0;
    this.winner = null;
  }

  addTank(id, name, { bot = false, color } = {}) {
    if (color == null) {
      const used = new Set([...this.tanks.values()].map((t) => t.color));
      color = COLORS.find((c) => !used.has(c)) ?? COLORS[id % COLORS.length];
    }
    const t = {
      id, name, color, bot,
      x: 0, y: 0, vx: 0, vy: 0, rot: 0, tur: 0,
      hp: CFG.HP, alive: false, respawnT: 0, cd: 0, inv: 0,
      kills: 0, deaths: 0,
      input: { mx: 0, my: 0, ax: 0, ay: 0, fire: false },
      brain: bot ? {} : null,
    };
    this.tanks.set(id, t);
    this.spawn(t);
    return t;
  }

  removeTank(id) {
    this.tanks.delete(id);
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

  // Появление в свободной клетке, максимально далёкой от врагов.
  spawn(t) {
    const others = [...this.tanks.values()].filter((o) => o !== t && o.alive);
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
    t.x = best.x; t.y = best.y; t.vx = 0; t.vy = 0;
    t.rot = t.tur = Math.atan2(MAP.h * CELL / 2 - t.y, MAP.w * CELL / 2 - t.x);
    t.hp = CFG.HP;
    t.alive = true;
    t.inv = CFG.INVULN;
    t.cd = 0.3;
    this.events.push([EV.SPAWN, r2(t.x), r2(t.y), t.id]);
  }

  step(dt) {
    if (this.winner !== null) return;
    this.time += dt;

    for (const t of this.tanks.values()) {
      if (!t.alive) {
        t.respawnT -= dt;
        if (t.respawnT <= 0) this.spawn(t);
        continue;
      }
      if (t.bot) botThink(this, t, dt);
      this.stepTank(t, dt);
    }
    this.separateTanks();
    this.stepBullets(dt);
  }

  stepTank(t, dt) {
    const inp = t.input;
    let mx = inp.mx, my = inp.my;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const px = t.x, py = t.y;
    t.x += mx * CFG.TANK_SPEED * dt;
    t.y += my * CFG.TANK_SPEED * dt;
    resolveWalls(t);
    t.vx = (t.x - px) / dt;
    t.vy = (t.y - py) / dt;

    if (m > 0.15) t.rot = turnTowards(t.rot, Math.atan2(my, mx), CFG.TURN_SPEED * dt);
    if (Math.hypot(inp.ax, inp.ay) > 0.2) t.tur = Math.atan2(inp.ay, inp.ax);

    t.cd -= dt;
    t.inv = Math.max(0, t.inv - dt);
    if (inp.fire && t.cd <= 0) this.fire(t);
  }

  fire(t) {
    t.cd = CFG.FIRE_CD;
    // Стрельба снимает неуязвимость после возрождения.
    t.inv = 0;
    const dx = Math.cos(t.tur), dy = Math.sin(t.tur);
    const off = CFG.TANK_R * 0.6;
    this.bullets.push({
      id: this.nextBulletId++,
      owner: t.id,
      x: t.x + dx * off, y: t.y + dy * off,
      vx: dx * CFG.BULLET_SPEED, vy: dy * CFG.BULLET_SPEED,
      life: CFG.BULLET_LIFE,
      bounces: 0,
    });
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
    for (const b of this.bullets) {
      b.life -= dt;
      for (let s = 0; s < SUB && !b.dead; s++) {
        b.x += b.vx * h;
        if (isSolid(b.x, b.y)) { b.x -= b.vx * h; b.vx = -b.vx; this.bounce(b); }
        b.y += b.vy * h;
        if (isSolid(b.x, b.y)) { b.y -= b.vy * h; b.vy = -b.vy; this.bounce(b); }
        if (!b.dead) this.bulletHits(b);
      }
      if (b.life <= 0 && !b.dead) {
        b.dead = true;
        this.events.push([EV.FIZZLE, r2(b.x), r2(b.y), 0]);
      }
    }

    // Пули сталкиваются друг с другом и обе исчезают.
    const live = this.bullets.filter((b) => !b.dead);
    const clashD = CFG.BULLET_R * 2.4;
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], c = live[j];
        if (a.dead || c.dead) continue;
        if (Math.abs(a.x - c.x) < clashD && Math.abs(a.y - c.y) < clashD) {
          a.dead = c.dead = true;
          this.events.push([EV.CLASH, r2((a.x + c.x) / 2), r2((a.y + c.y) / 2), 0]);
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  bounce(b) {
    b.bounces++;
    if (b.bounces > CFG.BOUNCES) {
      b.dead = true;
      this.events.push([EV.FIZZLE, r2(b.x), r2(b.y), 0]);
    } else {
      this.events.push([EV.BOUNCE, r2(b.x), r2(b.y), 0]);
    }
  }

  bulletHits(b) {
    const hitD = CFG.TANK_R + CFG.BULLET_R;
    for (const t of this.tanks.values()) {
      if (!t.alive) continue;
      // Свою пулю можно словить только после рикошета.
      if (t.id === b.owner && b.bounces === 0) continue;
      const dx = t.x - b.x, dy = t.y - b.y;
      if (dx * dx + dy * dy > hitD * hitD) continue;
      b.dead = true;
      if (t.inv > 0) {
        this.events.push([EV.FIZZLE, r2(b.x), r2(b.y), 0]);
        return;
      }
      this.damage(t, b.owner);
      return;
    }
  }

  damage(t, attackerId) {
    t.hp--;
    this.events.push([EV.HIT, r2(t.x), r2(t.y), t.id]);
    if (t.hp > 0) return;
    t.alive = false;
    t.deaths++;
    t.respawnT = CFG.RESPAWN;
    t.killedBy = attackerId;
    this.events.push([EV.BOOM, r2(t.x), r2(t.y), t.id]);
    const killer = this.tanks.get(attackerId);
    if (killer && killer !== t) {
      killer.kills++;
      if (killer.kills >= CFG.KILLS_TO_WIN) this.winner = killer.id;
    } else if (killer === t) {
      t.kills = Math.max(0, t.kills - 1);
    }
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
        t.alive ? 0 : Math.max(0, Math.ceil(t.respawnT)),
      ]);
    }
    const bullets = this.bullets.map((b) => [b.id, r2(b.x), r2(b.y), b.owner]);
    return { tanks, bullets, winner: this.winner };
  }

  roster() {
    return [...this.tanks.values()].map((t) => ({ id: t.id, name: t.name, color: t.color, bot: t.bot }));
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
        let dx = t.x - nx, dy = t.y - ny;
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
