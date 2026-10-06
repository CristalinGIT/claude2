// Карточки усилений. Их получают проигравшие после каждого раунда.
// kind: 'stat' — обычное усиление, 'ability' — способность (кнопка, перезарядка),
// 'evo' — эволюция: появляется только когда выполнено требование (requires).

export const BASE_HP = 100;
export const BASE_DAMAGE = 34;

export const ABILITIES = {
  blink: { icon: '✨', name: 'Блинк', cd: 5 },
  invis: { icon: '👻', name: 'Невидимость', cd: 9, duration: 2 },
  wall: { icon: '🧱', name: 'Стена', cd: 8 },
  mine: { icon: '💣', name: 'Мина', cd: 6 },
};

export function defaultStats() {
  return {
    maxHp: BASE_HP,
    speed: 1,
    cdMul: 1,
    bSpeed: 1,
    bSize: 1,
    bounces: 1,
    shots: 1,          // пули веером
    twin: false,       // два параллельных ствола
    damage: 1,         // множитель урона
    spread: 0,         // случайный разброс, радианы
    shieldCd: 0,       // перезарядка щита, 0 — щита нет
    mirror: false,
    regenDelay: 0,     // через сколько секунд без урона начинается ремонт, 0 — нет
    regenRate: 0,      // HP в секунду
    vampire: 0,        // доля урона, возвращаемая здоровьем
    homing: 0,
    selfImmune: false,
    split: false,
    poison: false,
    neuro: false,
    ice: false,
    pierce: false,
    billiard: false,
    laser: false,
    lastChance: false,
    ram: false,
    ability: null,
    abilityCd: 0,
    abilityLevels: {},
    blinkStrike: false,
    ambush: false,
    fortress: false,
  };
}

function ability(id) {
  return (s) => {
    s.abilityLevels[id] = (s.abilityLevels[id] || 0) + 1;
    s.ability = id;
  };
}

export const CARDS = [
  // ---- Стрельба ----
  { id: 'ricochet', kind: 'stat', icon: '🔁', name: 'Рикошет', desc: 'Пули отскакивают на 1 раз больше', max: 4,
    apply: (s) => { s.bounces += 1; } },
  { id: 'rapid', kind: 'stat', icon: '⚡', name: 'Скорострельность', desc: 'Перезарядка быстрее на 25%', max: 3,
    apply: (s) => { s.cdMul *= 0.75; } },
  { id: 'velocity', kind: 'stat', icon: '🚀', name: 'Быстрые снаряды', desc: 'Пули летят на 30% быстрее', max: 3,
    apply: (s) => { s.bSpeed *= 1.3; } },
  { id: 'caliber', kind: 'stat', icon: '🎳', name: 'Крупный калибр', desc: 'Пули в 1.6 раза больше, но летят на 15% медленнее', max: 2,
    apply: (s) => { s.bSize *= 1.6; s.bSpeed *= 0.85; } },
  { id: 'heavy', kind: 'stat', icon: '💥', name: 'Тяжёлый снаряд', desc: 'Урон +50%, но пули летят на 30% медленнее', max: 2,
    apply: (s) => { s.damage *= 1.5; s.bSpeed *= 0.7; } },
  { id: 'shotgun', kind: 'stat', icon: '🔱', name: 'Дробовик', desc: '+1 пуля веером, перезарядка на 15% дольше', max: 3,
    apply: (s) => { s.shots += 1; s.cdMul *= 1.15; } },
  { id: 'twin', kind: 'stat', icon: '⏸️', name: 'Двойной ствол', desc: 'Две параллельные пули за выстрел, урон каждой −40%', max: 1,
    apply: (s) => { s.twin = true; s.damage *= 0.6; } },
  { id: 'homing', kind: 'stat', icon: '🎯', name: 'Самонаведение', desc: 'Пули заметно доворачивают к врагу, урон −20%', max: 2,
    apply: (s) => { s.homing += 1; s.damage *= 0.8; } },
  { id: 'poison', kind: 'stat', icon: '☠️', name: 'Отравляющая пуля', desc: 'Попадание: половина урона сразу и ещё 45% через 1.5 с', max: 1,
    apply: (s) => { s.poison = true; } },
  { id: 'ice', kind: 'stat', icon: '❄️', name: 'Ледяные пули', desc: 'Попадание замедляет врага на 35% на 1.5 с', max: 1,
    apply: (s) => { s.ice = true; } },
  { id: 'pierce', kind: 'stat', icon: '📌', name: 'Бронебойные', desc: 'Пуля пробивает первый танк насквозь, урон −20%', max: 1,
    apply: (s) => { s.pierce = true; s.damage *= 0.8; } },
  { id: 'split', kind: 'stat', icon: '🌿', name: 'Осколки', desc: 'При первом рикошете пуля раскалывается на две', max: 1,
    apply: (s) => { s.split = true; } },
  { id: 'laser', kind: 'stat', icon: '🔦', name: 'Лазерный прицел', desc: 'Вы видите траекторию выстрела вместе с рикошетами', max: 1,
    apply: (s) => { s.laser = true; } },

  // ---- Живучесть и движение ----
  { id: 'armor', kind: 'stat', icon: '🛡️', name: 'Броня', desc: '+34 к здоровью (ещё одно попадание)', max: 3,
    apply: (s) => { s.maxHp += 34; } },
  { id: 'turbo', kind: 'stat', icon: '🏎️', name: 'Турбо', desc: 'Танк ездит на 18% быстрее', max: 3,
    apply: (s) => { s.speed *= 1.18; } },
  { id: 'shield', kind: 'stat', icon: '🔵', name: 'Энергощит', desc: 'Щит поглощает попадание и восстанавливается за 7 с. Каждая следующая карта: −1 с', max: 3,
    apply: (s) => { s.shieldCd = s.shieldCd ? s.shieldCd - 1 : 7; } },
  { id: 'regen', kind: 'stat', icon: '🔧', name: 'Ремкомплект', desc: 'Через 4 с без урона чинит 4 HP/с. Следующие карты: быстрее начинает и чинит', max: 3,
    apply: (s) => {
      s.regenDelay = s.regenDelay ? Math.max(2, s.regenDelay - 1) : 4;
      s.regenRate = s.regenRate ? s.regenRate + 2 : 4;
    } },
  { id: 'vampire', kind: 'stat', icon: '🧛', name: 'Вампир', desc: 'Лечит вас на 33% от нанесённого урона', max: 1,
    apply: (s) => { s.vampire = 0.33; } },
  { id: 'rubber', kind: 'stat', icon: '🪀', name: 'Резиновая броня', desc: 'Свои пули вас не ранят', max: 1,
    apply: (s) => { s.selfImmune = true; } },
  { id: 'lastChance', kind: 'stat', icon: '🍀', name: 'Последний шанс', desc: 'Раз за раунд смертельное попадание оставляет 1 HP', max: 1,
    apply: (s) => { s.lastChance = true; } },

  // ---- Способности (кнопка, одна на танк) ----
  { id: 'blink', kind: 'ability', icon: '✨', name: 'Блинк', desc: 'Мгновенный прыжок на 5 клеток вперёд, даже сквозь стены. Перезарядка 5 с', max: 3,
    apply: ability('blink') },
  { id: 'invis', kind: 'ability', icon: '👻', name: 'Невидимость', desc: 'Враги не видят вас 2 с (выстрел раскрывает). Перезарядка 9 с', max: 3,
    apply: ability('invis') },
  { id: 'wall', kind: 'ability', icon: '🧱', name: 'Стена', desc: 'Ставит перед танком стену на 3 попадания. Перезарядка 8 с', max: 3,
    apply: ability('wall') },
  { id: 'mine', kind: 'ability', icon: '💣', name: 'Мина', desc: 'Оставляет мину: взрывается рядом с врагом, 45 урона. Перезарядка 6 с', max: 3,
    apply: ability('mine') },

  // ---- Эволюции ----
  { id: 'machinegun', kind: 'evo', icon: '🔫', name: 'Пулемёт', desc: 'Ультрабыстрая стрельба, но урон −45%, пули меньше и с разбросом',
    max: 1, needs: 'Дробовик', reqId: 'shotgun',
    apply: (s) => { s.cdMul *= 0.35; s.damage *= 0.55; s.bSize *= 0.8; s.spread += 0.12; } },
  { id: 'billiard', kind: 'evo', icon: '🎱', name: 'Бильярд', desc: 'Каждый рикошет: урон пули +25% и скорость +10%',
    max: 1, needs: 'Рикошет ×2', reqId: 'ricochet', reqN: 2,
    apply: (s) => { s.billiard = true; } },
  { id: 'neuro', kind: 'evo', icon: '🧪', name: 'Нейротоксин', desc: 'Отравленный враг ещё и замедлен на 40%',
    max: 1, needs: 'Отравляющая пуля', reqId: 'poison',
    apply: (s) => { s.neuro = true; } },
  { id: 'mirror', kind: 'evo', icon: '🪞', name: 'Зеркальный щит', desc: 'Щит не просто гасит пулю, а отражает её обратно',
    max: 1, needs: 'Энергощит', reqId: 'shield',
    apply: (s) => { s.mirror = true; } },
  { id: 'juggernaut', kind: 'evo', icon: '🦏', name: 'Тяжёлый танк', desc: '+50 к здоровью, но скорость −12%',
    max: 1, needs: 'Броня ×2', reqId: 'armor', reqN: 2,
    apply: (s) => { s.maxHp += 50; s.speed *= 0.88; } },
  { id: 'ram', kind: 'evo', icon: '🐏', name: 'Таран', desc: 'Наезд на врага на скорости наносит 25 урона',
    max: 1, needs: 'Турбо ×2', reqId: 'turbo', reqN: 2,
    apply: (s) => { s.ram = true; } },
  { id: 'blinkStrike', kind: 'evo', icon: '⚡', name: 'Ударный блинк', desc: 'Приземление после блинка бьёт врагов рядом на 30 урона',
    max: 1, needs: 'Блинк', reqId: 'blink', reqAbility: true,
    apply: (s) => { s.blinkStrike = true; } },
  { id: 'ambush', kind: 'evo', icon: '🗡️', name: 'Засада', desc: 'Первый выстрел из невидимости наносит двойной урон',
    max: 1, needs: 'Невидимость', reqId: 'invis', reqAbility: true,
    apply: (s) => { s.ambush = true; } },
  { id: 'fortress', kind: 'evo', icon: '🏰', name: 'Крепость', desc: 'Стена строится из трёх блоков, каждый держит 5 попаданий',
    max: 1, needs: 'Стена', reqId: 'wall', reqAbility: true,
    apply: (s) => { s.fortress = true; } },
];

export const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));

// Пересчитать характеристики по списку взятых карт.
export function statsFromCards(cardIds) {
  const s = defaultStats();
  for (const id of cardIds) CARD_BY_ID.get(id)?.apply(s);
  if (s.ability) {
    const a = ABILITIES[s.ability];
    s.abilityCd = a.cd * Math.pow(0.8, (s.abilityLevels[s.ability] || 1) - 1);
  }
  return s;
}

function countCards(owned) {
  const count = new Map();
  for (const id of owned) count.set(id, (count.get(id) || 0) + 1);
  return count;
}

// Доступна ли карта при текущем наборе (лимит и требования эволюций).
export function cardAvailable(card, owned, stats = statsFromCards(owned)) {
  const count = countCards(owned);
  if ((count.get(card.id) || 0) >= card.max) return false;
  if (card.reqId) {
    if ((count.get(card.reqId) || 0) < (card.reqN || 1)) return false;
    if (card.reqAbility && stats.ability !== card.reqId) return false;
  }
  return true;
}

// Случайные n карт из доступных; эволюции выпадают чаще, чтобы их было видно.
export function rollCards(owned, n = 3) {
  const stats = statsFromCards(owned);
  const pool = [];
  for (const c of CARDS) {
    if (!cardAvailable(c, owned, stats)) continue;
    pool.push({ id: c.id, w: c.kind === 'evo' ? 3 : 1 });
  }
  const res = [];
  while (res.length < n && pool.length) {
    const total = pool.reduce((a, p) => a + p.w, 0);
    let r = Math.random() * total;
    let i = 0;
    while (r > pool[i].w) { r -= pool[i].w; i++; }
    res.push(pool[i].id);
    pool.splice(i, 1);
  }
  return res;
}
