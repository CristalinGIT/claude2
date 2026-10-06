// Симуляция игры. Работает только на устройстве хоста.
import { MAP, CELL, isSolid, emptyCells, cellKey, setMap, randomMapId } from './map.js';
import { botThink } from './bot.js';
import { statsFromCards, rollCards, CARD_BY_ID, ABILITIES, BASE_DAMAGE } from './cards.js';

export const CFG = {
  TANK_R: 0.75,
  TANK_SPEED: 6.5,
  TURN_SPEED: 10,
  BULLET_SPEED: 15,
  BULLET_R: 0.18,
  BULLET_LIFE: 2.6,
  FIRE_CD: 0.55,
  RESPAWN: 2.5,
  INVULN: 1.5,
  COUNTDOWN: 3,
  ROUND_END: 2.5,
  DRAFT_TIME: 20,
  ZONE_START: 45,
  ZONE_SHRINK: 30,
  ZONE_MIN: 3,
  ZONE_TICK: 1.5,
  ZONE_DAMAGE: 20,
  POISON_DELAY: 1.5,
  SLOW_TIME: 1.5,
  BLINK_DIST: 10,
  WALL_HP: 3,
  WALL_LIFE: 25,
  WALLS_PER_TANK: 3,
  MINE_DAMAGE: 45,
  MINE_RADIUS: 2.6,
  MINE_TRIGGER: 1.7,
  MINES_PER_TANK: 3,
  RAM_DAMAGE: 25,
};

// Типы событий, которые уходят клиентам (звук и эффекты).
export const EV = {
  SHOT: 1, BOUNCE: 2, HIT: 3, BOOM: 4, CLASH: 5, SPAWN: 6, FIZZLE: 7, SHIELD: 8, HEAL: 9,
  BLINK: 10, WALL: 11, WALL_BREAK: 12, MINE_BOOM: 13, POISON: 14, INVIS: 15, MINE: 16,
};

export const COLORS = [
  0xff4d4d, 0x4da6ff, 0x5ce65c, 0xffd23f,
  0xc77dff, 0xff8c42, 0x2ee6d6, 0xff6fb5,
  0xa0e05a, 0x8c9bff, 0xffa3a3, 0xd9d9d9,
];

export const TEAM_COLORS = [0xff4d4d, 0x4da6ff, 0x5ce65c, 0xffd23f];
export const TEAM_NAMES = ['Красные', 'Синие', 'Зелёные', 'Жёлтые'];

export const DEFAULT_SETTINGS = { mode: 'rounds', teams: 0, roundsToWin: 5, killsToWin: 10, map: 'random', bounces: 1 };

// Флаги танка в снимке.
export const TF = { ALIVE: 1, INV: 2, INVIS: 4, POISONED: 8, SLOWED: 16 };

export class Game {
  constructor(settings) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.tanks = new Map();
    this.bullets = [];
    this.mines = [];
    this.events = [];
    this.nextId = 1;
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
    // «Случайная» карта меняется каждый раунд, иначе играем на выбранной.
    this.mapId = this.settings.map === 'random' ? randomMapId() : this.settings.map;
    setMap(this.mapId);
    MAP.dyn.clear();
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
      cards: [], s: this.statsFor([]),
      hp: 100, shield: 0, shieldT: 0, alive: false, respawnT: 0, cd: 0, inv: 0, zoneT: 0,
      lastHurt: 0, abilityTs: [0, 0], invisT: 0, ambushReady: false, slowT: 0, poison: [],
      lastChanceUsed: false, ramCd: new Map(),
      kills: 0, deaths: 0,
      input: { mx: 0, my: 0, ax: 0, ay: 0, fire: false, ability: false, ability2: false },
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
    // Нажатие способности «защёлкивается» до следующего тика.
    if (input.ability) t.input.ability = true;
    if (input.ability2) t.input.ability2 = true;
  }

  // Характеристики с учётом настроек матча (базовое число рикошетов).
  statsFor(cards) {
    const s = statsFromCards(cards);
    s.bounces += (this.settings.bounces ?? 1) - 1;
    return s;
  }

  resetTank(t) {
    t.s = this.statsFor(t.cards);
    t.hp = t.s.maxHp;
    t.shield = t.s.shieldCd ? 1 : 0;
    t.shieldT = 0;
    t.vx = t.vy = 0;
    t.alive = true;
    t.cd = 0.3;
    t.zoneT = 0;
    t.lastHurt = -99;
    t.abilityTs = [0, 0];
    t.invisT = 0;
    t.slowT = 0;
    t.poison = [];
    t.lastChanceUsed = false;
    t.burst = [];
    t.adrenT = 0;
    t.regenT = 0;
    t.input.ability = t.input.ability2 = false;
    t.rot = t.tur = Math.atan2(MAP.h * CELL / 2 - t.y, MAP.w * CELL / 2 - t.x);
  }

  // Тренировка: выставить танку произвольный набор карт прямо в бою.
  setCards(id, cards) {
    const t = this.tanks.get(id);
    if (!t) return;
    t.cards = cards;
    t.s = this.statsFor(cards);
    if (t.alive) {
      t.hp = t.s.maxHp;
      t.shield = t.s.shieldCd ? 1 : 0;
      t.abilityTs = [0, 0];
    }
  }

  // Появление в свободной клетке, максимально далёкой от врагов.
  spawn(t) {
    const others = [...this.tanks.values()].filter((o) => o !== t && o.alive && this.isEnemy(t, o));
    let best = null;
    let bestScore = -Infinity;
    for (const c of emptyCells()) {
      if (MAP.dyn.has(c.row * MAP.w + c.col)) continue;
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
    MAP.dyn.clear();
    this.mines = [];
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
      if (frozen) { t.input.ability = t.input.ability2 = false; continue; }
      if (t.bot) botThink(this, t, dt);
      this.stepTank(t, dt);
    }
    if (!frozen) {
      this.separateTanks();
      this.stepBullets(dt);
      this.stepMines(dt);
      this.stepWalls(dt);
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
      if (t.bot) this.pickCard(t.id, botPick(options));
      else this.newOffers.push({ id: t.id, options });
    }
    if (!this.offers.size) { this.nextRound(); return; }
    this.phase = 'draft';
    this.phaseT = CFG.DRAFT_TIME;
  }

  // «Другие карты»: один раз за выбор, все новые карты отличаются от прежних.
  reroll(id) {
    const offer = this.offers.get(id);
    const t = this.tanks.get(id);
    if (!offer || !t || offer.picked || offer.rerolled) return false;
    const options = rollCards(t.cards, 3, offer.options);
    if (!options.length) return false;
    offer.options = options;
    offer.rerolled = true;
    this.newOffers.push({ id, options, rerolled: true });
    return true;
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
    if (this.settings.map === 'random') {
      this.mapId = randomMapId(this.mapId);
      setMap(this.mapId);
    }
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
    const s = t.s;
    const inp = t.input;
    let mx = inp.mx, my = inp.my;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const px = t.x, py = t.y;
    t.slowT = Math.max(0, t.slowT - dt);
    const slowed = t.slowT > 0 || (t.poison.length && t.poison.some((p) => p.neuro));
    t.adrenT = Math.max(0, (t.adrenT || 0) - dt);
    let speed = CFG.TANK_SPEED * s.speed * (slowed ? (t.slowT > 0 ? 0.65 : 0.6) : 1);
    if (t.adrenT > 0) speed *= 1.4;
    if (isRaging(t)) speed *= 1.15;
    t.x += mx * speed * dt;
    t.y += my * speed * dt;
    resolveWalls(t);
    t.vx = (t.x - px) / dt;
    t.vy = (t.y - py) / dt;

    if (m > 0.15) t.rot = turnTowards(t.rot, Math.atan2(my, mx), CFG.TURN_SPEED * dt);
    if (Math.hypot(inp.ax, inp.ay) > 0.2) t.tur = Math.atan2(inp.ay, inp.ax);

    t.cd -= dt;
    t.inv = Math.max(0, t.inv - dt);
    t.invisT = Math.max(0, t.invisT - dt);
    t.abilityTs[0] = Math.max(0, t.abilityTs[0] - dt);
    t.abilityTs[1] = Math.max(0, t.abilityTs[1] - dt);

    // Щит восстанавливается после поглощения.
    if (s.shieldCd && !t.shield) {
      t.shieldT += dt;
      if (t.shieldT >= s.shieldCd) { t.shield = 1; t.shieldT = 0; }
    }

    // Ремкомплект: после паузы без урона чинит порцию HP раз в несколько секунд.
    if (s.regenAmount && t.hp < s.maxHp && this.time - t.lastHurt >= s.regenDelay) {
      // Первая порция — сразу после паузы, дальше раз в regenEvery секунд.
      t.regenT = (t.regenT || 0) + dt;
      if (!t.regenOn || t.regenT >= s.regenEvery) {
        t.regenOn = true;
        t.regenT = 0;
        t.hp = Math.min(s.maxHp, t.hp + s.regenAmount);
        this.events.push([EV.HEAL, r2(t.x), r2(t.y), t.id]);
      }
    } else {
      t.regenT = 0;
      t.regenOn = false;
    }

    // Отложенный урон от яда.
    if (t.poison.length) {
      for (const p of t.poison) {
        p.t -= dt;
        if (p.t <= 0) {
          this.events.push([EV.POISON, r2(t.x), r2(t.y), t.id]);
          this.damage(t, p.src, p.dmg, { ignoreShield: true });
          if (!t.alive) return;
        }
      }
      t.poison = t.poison.filter((p) => p.t > 0);
    }

    // Вне зоны танк получает урон.
    if (this.zone > 0) {
      const cx = MAP.w * CELL / 2, cy = MAP.h * CELL / 2;
      if (Math.hypot(t.x - cx, t.y - cy) > this.zone) {
        t.zoneT += dt;
        if (t.zoneT >= CFG.ZONE_TICK) {
          t.zoneT = 0;
          this.damage(t, null, CFG.ZONE_DAMAGE, { ignoreShield: true });
          if (!t.alive) return;
        }
      } else {
        t.zoneT = 0;
      }
    }

    const canAct = this.phase === 'fight' || this.phase === 'roundEnd';
    for (const [slot, key] of [[0, 'ability'], [1, 'ability2']]) {
      if (!inp[key]) continue;
      inp[key] = false;
      if (canAct && s.abilities[slot] && t.abilityTs[slot] <= 0) this.useAbility(t, slot);
    }
    // «Очередь»: догоняющие залпы вылетают друг за другом.
    if (t.burst?.length) {
      for (const b of t.burst) b.t -= dt;
      while (t.burst.length && t.burst[0].t <= 0) this.volley(t, t.burst.shift().mul);
    }
    if (inp.fire && t.cd <= 0 && canAct) this.fire(t);
  }

  fire(t) {
    const s = t.s;
    t.cd = CFG.FIRE_CD * s.cdMul;
    t.inv = 0;
    // Выстрел из невидимости раскрывает танк; с «Засадой» — двойной урон.
    let dmgMul = 1;
    if (t.invisT > 0) {
      if (s.ambush) dmgMul = 2;
      t.invisT = 0;
    }
    if (isRaging(t)) dmgMul *= 1.4;
    this.volley(t, dmgMul);
    // Отдача: танк отталкивает назад.
    if (s.recoil) {
      t.x -= Math.cos(t.tur) * s.recoil;
      t.y -= Math.sin(t.tur) * s.recoil;
      resolveWalls(t);
    }
    t.burst = [];
    for (let i = 1; i < s.burst; i++) t.burst.push({ t: 0.1 * i, mul: dmgMul });
  }

  volley(t, dmgMul) {
    const s = t.s;
    const spread = 0.17;
    const off = CFG.TANK_R * 0.6;
    const barrels = s.twin ? [-0.28, 0.28] : [0];
    for (let i = 0; i < s.shots; i++) {
      const a = t.tur + (i - (s.shots - 1) / 2) * spread + (Math.random() - 0.5) * 2 * s.spread;
      const dx = Math.cos(a), dy = Math.sin(a);
      for (const side of barrels) {
        // Параллельные стволы смещены поперёк направления стрельбы.
        const ox = -Math.sin(t.tur) * side, oy = Math.cos(t.tur) * side;
        this.bullets.push({
          id: this.nextId++,
          owner: t.id,
          team: t.team,
          x: t.x + dx * off + ox, y: t.y + dy * off + oy,
          vx: dx * CFG.BULLET_SPEED * s.bSpeed, vy: dy * CFG.BULLET_SPEED * s.bSpeed,
          r: CFG.BULLET_R * s.bSize,
          dmg: BASE_DAMAGE * s.damage * dmgMul,
          maxBounces: s.bounces,
          homing: s.homing,
          split: s.split,
          pierce: s.pierce ? 1 : 0,
          billiard: s.billiard,
          poison: s.poison,
          neuro: s.neuro,
          ice: s.ice,
          hit: null,
          life: CFG.BULLET_LIFE * s.bLife,
          bounces: 0,
        });
      }
    }
    const dx = Math.cos(t.tur), dy = Math.sin(t.tur);
    this.events.push([EV.SHOT, r2(t.x + dx * 1.1), r2(t.y + dy * 1.1), t.id]);
  }

  // ---------- Способности ----------

  useAbility(t, slot) {
    const s = t.s;
    let ok = false;
    switch (s.abilities[slot]) {
      case 'blink': ok = this.blink(t); break;
      case 'invis':
        t.invisT = ABILITIES.invis.duration;
        this.events.push([EV.INVIS, r2(t.x), r2(t.y), t.id]);
        ok = true;
        break;
      case 'wall': ok = this.buildWall(t); break;
      case 'mine': ok = this.dropMine(t); break;
    }
    if (ok) t.abilityTs[slot] = s.abilityCds[slot];
  }

  // Прыжок по направлению движения (или башни), можно сквозь стены.
  blink(t) {
    let dx = t.input.mx, dy = t.input.my;
    if (Math.hypot(dx, dy) < 0.2) { dx = Math.cos(t.tur); dy = Math.sin(t.tur); }
    const d = Math.hypot(dx, dy);
    dx /= d; dy /= d;
    for (let dist = CFG.BLINK_DIST; dist >= 1; dist -= 0.25) {
      const x = t.x + dx * dist, y = t.y + dy * dist;
      if (!tankFits(x, y)) continue;
      this.events.push([EV.BLINK, r2(t.x), r2(t.y), t.id]);
      t.x = x; t.y = y;
      this.events.push([EV.BLINK, r2(t.x), r2(t.y), t.id]);
      if (t.s.blinkStrike) {
        for (const o of this.tanks.values()) {
          if (!o.alive || !this.isEnemy(t, o)) continue;
          if (Math.hypot(o.x - x, o.y - y) < 2.6) this.damage(o, t.id, 30);
        }
        this.events.push([EV.MINE_BOOM, r2(x), r2(y), t.id]);
      }
      return true;
    }
    return false;
  }

  buildWall(t) {
    const dx = Math.cos(t.tur), dy = Math.sin(t.tur);
    const hp = t.s.fortress ? 5 : CFG.WALL_HP;
    // Пробуем клетку прямо перед танком, если занята — чуть дальше.
    for (const dist of [2.3, 3.2, 4.1]) {
      const col = Math.floor((t.x + dx * dist) / CELL), row = Math.floor((t.y + dy * dist) / CELL);
      if (!this.canBuild(col, row)) continue;
      const cells = [[col, row]];
      if (t.s.fortress) {
        // Две дополнительные клетки поперёк направления взгляда.
        if (Math.abs(dx) > Math.abs(dy)) cells.push([col, row - 1], [col, row + 1]);
        else cells.push([col - 1, row], [col + 1, row]);
      }
      for (const [c, r] of cells) {
        if (!this.canBuild(c, r)) continue;
        MAP.dyn.set(r * MAP.w + c, { hp, max: hp, owner: t.id, life: CFG.WALL_LIFE, born: this.time });
        this.events.push([EV.WALL, r2((c + 0.5) * CELL), r2((r + 0.5) * CELL), t.id]);
      }
      // Лимит стен на игрока: старые рассыпаются.
      const mine = [...MAP.dyn].filter(([, w]) => w.owner === t.id).sort((a, b) => a[1].born - b[1].born);
      const limit = CFG.WALLS_PER_TANK * (t.s.fortress ? 3 : 1);
      while (mine.length > limit) this.breakWall(mine.shift()[0]);
      return true;
    }
    return false;
  }

  // Клетка свободна и на ней нет танков.
  canBuild(c, r) {
    if (MAP.solid(c, r)) return false;
    for (const o of this.tanks.values()) {
      if (!o.alive) continue;
      const nx = clamp(o.x, c * CELL, (c + 1) * CELL), ny = clamp(o.y, r * CELL, (r + 1) * CELL);
      if (Math.hypot(o.x - nx, o.y - ny) < CFG.TANK_R) return false;
    }
    return true;
  }

  breakWall(key) {
    if (!MAP.dyn.has(key)) return;
    MAP.dyn.delete(key);
    const c = key % MAP.w, r = Math.floor(key / MAP.w);
    this.events.push([EV.WALL_BREAK, r2((c + 0.5) * CELL), r2((r + 0.5) * CELL), 0]);
  }

  stepWalls(dt) {
    for (const [key, w] of MAP.dyn) {
      w.life -= dt;
      if (w.life <= 0) this.breakWall(key);
    }
  }

  dropMine(t) {
    const dx = Math.cos(t.rot), dy = Math.sin(t.rot);
    this.mines.push({ id: this.nextId++, owner: t.id, team: t.team, x: t.x - dx * 1.1, y: t.y - dy * 1.1, arm: 0.8 });
    const mine = this.mines.filter((m) => m.owner === t.id);
    if (mine.length > CFG.MINES_PER_TANK) this.mines = this.mines.filter((m) => m !== mine[0]);
    this.events.push([EV.MINE, r2(t.x), r2(t.y), t.id]);
    return true;
  }

  stepMines(dt) {
    for (const m of this.mines) {
      m.arm -= dt;
      if (m.arm > 0) continue;
      const owner = this.tanks.get(m.owner) ?? { id: m.owner, team: m.team };
      const triggered = [...this.tanks.values()].some((o) =>
        o.alive && this.isEnemy(owner, o) && Math.hypot(o.x - m.x, o.y - m.y) < CFG.MINE_TRIGGER);
      if (!triggered) continue;
      m.dead = true;
      this.events.push([EV.MINE_BOOM, r2(m.x), r2(m.y), m.owner]);
      for (const o of this.tanks.values()) {
        if (!o.alive) continue;
        if (o.id !== m.owner && !this.isEnemy(owner, o)) continue;
        if (Math.hypot(o.x - m.x, o.y - m.y) < CFG.MINE_RADIUS) this.damage(o, m.owner, CFG.MINE_DAMAGE);
      }
    }
    this.mines = this.mines.filter((m) => !m.dead);
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
        this.ram(a, b, dx / d, dy / d);
        this.ram(b, a, -dx / d, -dy / d);
        const push = (minD - d) / 2;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
        resolveWalls(a); resolveWalls(b);
      }
    }
  }

  // Таран: урон, если a врезается в b на скорости.
  ram(a, b, nx, ny) {
    if (!a.s.ram || !a.alive || !b.alive || !this.isEnemy(a, b)) return;
    const closing = a.vx * nx + a.vy * ny;
    if (closing < 4) return;
    const until = a.ramCd.get(b.id) || 0;
    if (this.time < until) return;
    a.ramCd.set(b.id, this.time + 0.8);
    this.damage(b, a.id, CFG.RAM_DAMAGE);
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
        if (isSolid(b.x, b.y)) { this.hitWallCell(b); if (b.dead) break; b.x -= b.vx * h; b.vx = -b.vx; this.bounce(b, spawned); }
        b.y += b.vy * h;
        if (!b.dead && isSolid(b.x, b.y)) { this.hitWallCell(b); if (b.dead) break; b.y -= b.vy * h; b.vy = -b.vy; this.bounce(b, spawned); }
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

  // Пуля попала в построенную стену — стена теряет прочность, пуля гаснет.
  hitWallCell(b) {
    const key = cellKey(b.x, b.y);
    const w = MAP.dyn.get(key);
    if (!w) return;
    b.dead = true;
    w.hp--;
    this.events.push([EV.FIZZLE, r2(b.x), r2(b.y), 0]);
    if (w.hp <= 0) this.breakWall(key);
  }

  // Самонаведение: плавно поворачиваем пулю к ближайшему врагу впереди.
  steer(b, dt) {
    const owner = this.tanks.get(b.owner);
    let best = null, bestD = 9;
    for (const t of this.tanks.values()) {
      if (!t.alive || t.id === b.owner || t.invisT > 0 || (owner && !this.isEnemy(owner, t))) continue;
      const dx = t.x - b.x, dy = t.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > bestD) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if ((dx * b.vx + dy * b.vy) / (d * sp) < 0) continue;
      best = t; bestD = d;
    }
    if (!best) return;
    const cur = Math.atan2(b.vy, b.vx);
    const want = Math.atan2(best.y - b.y, best.x - b.x);
    const a = cur + clamp(angleDiff(cur, want), -1, 1) * Math.min(1, 2.6 * b.homing * dt);
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
    if (b.billiard) {
      b.dmg *= 1.25;
      b.vx *= 1.1; b.vy *= 1.1;
    }
    if (b.split) {
      // Осколки: пуля расходится на две под углом.
      b.split = false;
      // Осколки слабее целой пули.
      b.dmg *= 0.7;
      const a = Math.atan2(b.vy, b.vx);
      const sp = Math.hypot(b.vx, b.vy);
      const twin = { ...b, id: this.nextId++, dead: false, hit: b.hit ? new Set(b.hit) : null };
      b.vx = Math.cos(a - 0.3) * sp; b.vy = Math.sin(a - 0.3) * sp;
      twin.vx = Math.cos(a + 0.3) * sp; twin.vy = Math.sin(a + 0.3) * sp;
      spawned.push(twin);
    }
  }

  bulletHits(b) {
    for (const t of this.tanks.values()) {
      if (!t.alive || b.hit?.has(t.id)) continue;
      const own = t.id === b.owner;
      // Свою пулю можно словить только после рикошета (и без «Резиновой брони»).
      if (own && (b.bounces === 0 || t.s.selfImmune)) continue;
      // Пули союзников пролетают сквозь своих.
      if (!own && this.teams && t.team === b.team) continue;
      const hitD = CFG.TANK_R + b.r;
      const dx = t.x - b.x, dy = t.y - b.y;
      if (dx * dx + dy * dy > hitD * hitD) continue;

      if (t.inv > 0 || this.phase === 'roundEnd') {
        b.dead = true;
        this.events.push([EV.FIZZLE, r2(b.x), r2(b.y), 0]);
        return;
      }
      // Зеркальный щит разворачивает пулю — теперь она принадлежит защитнику.
      if (t.shield > 0 && t.s.mirror && !own) {
        t.shield = 0;
        t.shieldT = 0;
        b.owner = t.id; b.team = t.team;
        b.vx = -b.vx; b.vy = -b.vy;
        b.bounces = 0;
        b.life = CFG.BULLET_LIFE;
        b.x = t.x + (b.x - t.x) * 1.4; b.y = t.y + (b.y - t.y) * 1.4;
        this.events.push([EV.SHIELD, r2(t.x), r2(t.y), t.id]);
        return;
      }

      // Бронебойная пуля летит дальше.
      if (b.pierce > 0 && !own) {
        b.pierce--;
        b.hit = b.hit || new Set();
        b.hit.add(t.id);
      } else {
        b.dead = true;
      }
      this.applyBulletHit(t, b);
      return;
    }
  }

  applyBulletHit(t, b) {
    if (b.poison) {
      const now = b.dmg * 0.5;
      if (this.damage(t, b.owner, now) && t.alive) {
        t.poison.push({ t: CFG.POISON_DELAY, dmg: b.dmg * 0.45, src: b.owner, neuro: b.neuro });
      }
    } else {
      this.damage(t, b.owner, b.dmg);
    }
    if (b.ice && t.alive) t.slowT = CFG.SLOW_TIME;
  }

  // Возвращает true, если урон прошёл (не поглощён щитом).
  damage(t, attackerId, amount, { ignoreShield = false } = {}) {
    if (!t.alive) return false;
    if (t.shield > 0 && !ignoreShield) {
      t.shield = 0;
      t.shieldT = 0;
      this.events.push([EV.SHIELD, r2(t.x), r2(t.y), t.id]);
      return false;
    }
    t.hp -= amount;
    t.lastHurt = this.time;
    t.regenT = 0;
    if (t.s.adrenaline) t.adrenT = 1.5;
    this.events.push([EV.HIT, r2(t.x), r2(t.y), t.id]);

    const attacker = this.tanks.get(attackerId);
    if (attacker && attacker !== t && attacker.alive && attacker.s.vampire && attacker.hp < attacker.s.maxHp) {
      attacker.hp = Math.min(attacker.s.maxHp, attacker.hp + amount * attacker.s.vampire);
      this.events.push([EV.HEAL, r2(attacker.x), r2(attacker.y), attacker.id]);
    }

    if (t.hp > 0.5) return true;
    if (t.s.lastChance && !t.lastChanceUsed) {
      t.lastChanceUsed = true;
      t.hp = 1;
      t.inv = 1;
      this.events.push([EV.SHIELD, r2(t.x), r2(t.y), t.id]);
      return true;
    }
    t.hp = 0;
    t.alive = false;
    t.deaths++;
    t.respawnT = CFG.RESPAWN;
    t.poison = [];
    this.events.push([EV.BOOM, r2(t.x), r2(t.y), t.id]);
    if (attacker && attacker !== t) {
      attacker.kills++;
    } else if (attacker === t && !this.rounds) {
      t.kills = Math.max(0, t.kills - 1);
    }
    if (!this.rounds) this.checkFragWin();
    return true;
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
      const flags = (t.alive ? TF.ALIVE : 0) | (t.inv > 0 ? TF.INV : 0) | (t.invisT > 0 ? TF.INVIS : 0) |
        (t.poison.length ? TF.POISONED : 0) | (t.slowT > 0 ? TF.SLOWED : 0);
      tanks.push([
        t.id, r2(t.x), r2(t.y), r2(t.rot), r2(t.tur), Math.ceil(t.hp), flags,
        t.kills, t.deaths,
        t.alive || this.rounds ? 0 : Math.max(0, Math.ceil(t.respawnT)),
        Math.round(t.s.maxHp), t.shield,
        Math.round(t.abilityTs[0] * 10), Math.round(t.abilityTs[1] * 10),
      ]);
    }
    const bullets = this.bullets.map((b) => [b.id, r2(b.x), r2(b.y), b.owner, Math.round(b.r * 100)]);
    const walls = [...MAP.dyn].map(([k, w]) => [k, w.hp, w.max]);
    const mines = this.mines.map((m) => [m.id, r2(m.x), r2(m.y), m.owner, m.arm > 0 ? 0 : 1]);
    const waiting = [];
    for (const [id, o] of this.offers) if (!o.picked) waiting.push(id);
    return {
      tanks, bullets, walls, mines,
      map: this.mapId,
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

// Бот предпочитает эволюции и способности, иначе берёт случайную карту.
function botPick(options) {
  const evo = options.find((id) => CARD_BY_ID.get(id)?.kind === 'evo');
  if (evo) return evo;
  return options[Math.floor(Math.random() * options.length)];
}

// «Ярость»: усиление при низком здоровье.
function isRaging(t) {
  return t.s.rage && t.hp < t.s.maxHp * 0.4;
}

// Помещается ли танк в точке (не задевает стены).
export function tankFits(x, y) {
  const R = CFG.TANK_R;
  const c0 = Math.floor((x - R) / CELL), c1 = Math.floor((x + R) / CELL);
  const r0 = Math.floor((y - R) / CELL), r1 = Math.floor((y + R) / CELL);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (!MAP.solid(c, r)) continue;
      const nx = clamp(x, c * CELL, (c + 1) * CELL), ny = clamp(y, r * CELL, (r + 1) * CELL);
      if (Math.hypot(x - nx, y - ny) < R) return false;
    }
  }
  return true;
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
