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
    regenDelay: 0,     // через сколько секунд без урона начинается ремонт
    regenEvery: 5,     // период ремонта, секунд
    regenAmount: 0,    // HP за раз, 0 — нет ремкомплекта
    burst: 1,          // пуль в очереди друг за другом
    recoil: 0,         // отдача: насколько выстрел отталкивает танк назад
    bLife: 1,          // множитель дальности полёта пули
    hpMul: 1,
    abilityCdMul: 1,
    rage: false,
    adrenaline: false,
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
    ability: null,       // первая способность (для совместимости)
    abilities: [],       // активные способности по порядку получения
    abilityCds: [],      // перезарядка каждой из них
    abilitySlots: 1,
    abilityLevels: {},
    blinkStrike: false,
    ambush: false,
    fortress: false,
  };
}

function ability(id) {
  return (s) => {
    s.abilityLevels[id] = (s.abilityLevels[id] || 0) + 1;
    if (s.abilities.includes(id)) return;
    s.abilities.push(id);
    // Слоты заняты — новая способность вытесняет самую старую.
    if (s.abilities.length > s.abilitySlots) s.abilities.shift();
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
  { id: 'heavy', kind: 'stat', icon: '💥', name: 'Тяжёлый снаряд', desc: 'Урон +50%, но пули летят на 25% медленнее и есть отдача', max: 2,
    apply: (s) => { s.damage *= 1.5; s.bSpeed *= 0.75; s.recoil += 0.5; } },
  { id: 'shotgun', kind: 'stat', icon: '🔱', name: 'Дробовик', desc: '+1 пуля веером, перезарядка на 15% дольше', max: 3,
    apply: (s) => { s.shots += 1; s.cdMul *= 1.15; } },
  { id: 'twin', kind: 'stat', icon: '⏸️', name: 'Двойной ствол', desc: 'Две параллельные пули за выстрел. Урон каждой −25%, перезарядка +15%', max: 1,
    apply: (s) => { s.twin = true; s.damage *= 0.75; s.cdMul *= 1.15; } },
  { id: 'burst', kind: 'stat', icon: '⏩', name: 'Очередь', desc: '+1 пуля вслед за первой. Урон каждой −25%, перезарядка +10%, пули разлетаются шире', max: 2,
    apply: (s) => { s.burst += 1; s.damage *= s.burst === 2 ? 0.75 : 0.85; s.cdMul *= 1.1; s.spread += 0.06; } },
  { id: 'homing', kind: 'stat', icon: '🎯', name: 'Самонаведение', desc: 'Пули доворачивают к врагу. Урон −10%, дальность −25%', max: 2,
    apply: (s) => { s.homing += 1; s.damage *= 0.9; s.bLife *= 0.75; } },
  { id: 'poison', kind: 'stat', icon: '☠️', name: 'Отравляющая пуля', desc: 'Пуля бьёт на 30% слабее, но отравляет: через 1.5 с враг получает ещё 40% урона', max: 1,
    apply: (s) => { s.poison = true; } },
  { id: 'ice', kind: 'stat', icon: '❄️', name: 'Ледяные пули', desc: 'Попадание замедляет врага на 35% на 1.5 с, но ваши пули летят на 10% медленнее', max: 1,
    apply: (s) => { s.ice = true; s.bSpeed *= 0.9; } },
  { id: 'pierce', kind: 'stat', icon: '📌', name: 'Бронебойные', desc: 'Пуля пробивает первый танк насквозь, но летит на 15% медленнее', max: 1,
    apply: (s) => { s.pierce = true; s.bSpeed *= 0.85; } },
  { id: 'split', kind: 'stat', icon: '🌿', name: 'Осколки', desc: 'При первом рикошете пуля раскалывается на две, урон каждой −30%', max: 1,
    apply: (s) => { s.split = true; } },
  { id: 'laser', kind: 'stat', icon: '🔦', name: 'Лазерный прицел', desc: 'Вы видите траекторию выстрела вместе с рикошетами', max: 1,
    apply: (s) => { s.laser = true; } },

  { id: 'endless', kind: 'stat', icon: '♾️', name: 'Бесконечная дальность', desc: 'Пули летят, пока во что-нибудь не врежутся, но −2 рикошета', max: 1,
    apply: (s) => { s.bLife = Infinity; s.bounces -= 2; } },
  { id: 'sniper', kind: 'stat', icon: '🔭', name: 'Снайпер', desc: 'Пули на 60% быстрее и урон +25%. Перезарядка +30% и сильная отдача', max: 1,
    apply: (s) => { s.bSpeed *= 1.6; s.damage *= 1.25; s.cdMul *= 1.3; s.recoil += 0.9; } },
  { id: 'glass', kind: 'stat', icon: '🍷', name: 'Стеклянная пушка', desc: 'Урон +40%, но здоровье −30%', max: 1,
    apply: (s) => { s.damage *= 1.4; s.hpMul *= 0.7; } },
  { id: 'longshot', kind: 'stat', icon: '📏', name: 'Дальнобой', desc: 'Пули летят на 60% дальше', max: 1,
    apply: (s) => { s.bLife *= 1.6; } },
  { id: 'rage', kind: 'stat', icon: '😡', name: 'Ярость', desc: 'Когда здоровья меньше 40%: урон +40% и скорость +15%', max: 1,
    apply: (s) => { s.rage = true; } },

  // ---- Живучесть и движение ----
  { id: 'armor', kind: 'stat', icon: '🛡️', name: 'Броня', desc: '+34 к здоровью (ещё одно попадание)', max: 3,
    apply: (s) => { s.maxHp += 34; } },
  { id: 'turbo', kind: 'stat', icon: '🏎️', name: 'Турбо', desc: 'Танк ездит на 18% быстрее', max: 3,
    apply: (s) => { s.speed *= 1.18; } },
  { id: 'shield', kind: 'stat', icon: '🔵', name: 'Энергощит', desc: 'Щит поглощает попадание и восстанавливается за 7 с. Каждая следующая карта: −1 с', max: 3,
    apply: (s) => { s.shieldCd = s.shieldCd ? s.shieldCd - 1 : 7; } },
  { id: 'regen', kind: 'stat', icon: '🔧', name: 'Ремкомплект', desc: 'Через 8 с без урона чинит полделения (17 HP), дальше ещё по 17 HP каждые 5 с. Урон сбрасывает отсчёт. Следующие карты: +5 HP за раз', max: 3,
    apply: (s) => {
      s.regenDelay = 8;
      s.regenAmount = s.regenAmount ? s.regenAmount + 5 : 17;
    } },
  { id: 'vampire', kind: 'stat', icon: '🧛', name: 'Вампир', desc: 'Лечит вас на 33% от нанесённого урона, но здоровье −10', max: 1,
    apply: (s) => { s.vampire = 0.33; s.maxHp -= 10; } },
  { id: 'phoenix', kind: 'stat', icon: '♻️', name: 'Феникс', desc: 'Здоровье −45%, но после гибели возрождение через 2 с с неуязвимостью 0.5 с (в раундах — один раз за раунд)', max: 1,
    apply: (s) => { s.hpMul *= 0.55; s.phoenix = true; } },
  { id: 'light', kind: 'stat', icon: '🪶', name: 'Лёгкий корпус', desc: 'Скорость +25%, но здоровье −20', max: 1,
    apply: (s) => { s.speed *= 1.25; s.maxHp -= 20; } },
  { id: 'adrenaline', kind: 'stat', icon: '💉', name: 'Адреналин', desc: 'После получения урона 1.5 с скорость +40%', max: 1,
    apply: (s) => { s.adrenaline = true; } },
  { id: 'slot', kind: 'stat', icon: '➕', name: '+1 способность', desc: 'Второй слот под способность (вторая кнопка). В следующем выборе одна карта точно будет способностью', max: 1,
    apply: (s) => { s.abilitySlots += 1; } },
  { id: 'overload', kind: 'stat', icon: '🔋', name: 'Перегрузка', desc: 'Способность перезаряжается на 30% быстрее, оружие — на 10% дольше', max: 2, needsAbility: true,
    apply: (s) => { s.abilityCdMul *= 0.7; s.cdMul *= 1.1; } },
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
  { id: 'machinegun', kind: 'evo', icon: '🔫', name: 'Пулемёт', desc: 'Очень быстрая стрельба. Урон −50%, разброс, мелкие пули, танк на 10% медленнее',
    max: 1, needs: 'Дробовик', reqId: 'shotgun',
    apply: (s) => { s.cdMul *= 0.5; s.damage *= 0.5; s.bSize *= 0.8; s.spread += 0.12; s.speed *= 0.9; } },
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
  s.abilityCds = s.abilities.map((id) =>
    ABILITIES[id].cd * Math.pow(0.8, (s.abilityLevels[id] || 1) - 1) * s.abilityCdMul);
  s.ability = s.abilities[0] ?? null;
  s.maxHp = Math.max(30, Math.round(s.maxHp * s.hpMul));
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
  if (card.needsAbility && !stats.abilities.length) return false;
  if (card.reqId) {
    if ((count.get(card.reqId) || 0) < (card.reqN || 1)) return false;
    if (card.reqAbility && !stats.abilities.includes(card.reqId)) return false;
  }
  return true;
}

// Случайные n карт из доступных; эволюции выпадают чаще, чтобы их было видно.
// exclude — карты, которые выпадать не должны (например, прошлый набор при «Другие карты»).
export function rollCards(owned, n = 3, exclude = []) {
  const stats = statsFromCards(owned);
  const pool = [];
  for (const c of CARDS) {
    if (exclude.includes(c.id) || !cardAvailable(c, owned, stats)) continue;
    pool.push({ id: c.id, w: c.kind === 'evo' ? 3 : 1 });
  }
  const res = [];
  // Сразу после «+1 способность» одна из карт — гарантированно способность (лучше новая).
  if (owned[owned.length - 1] === 'slot') {
    const abs = pool.filter((p) => CARD_BY_ID.get(p.id).kind === 'ability');
    const fresh = abs.filter((p) => !stats.abilities.includes(p.id));
    const from = fresh.length ? fresh : abs;
    if (from.length) {
      const pick = from[Math.floor(Math.random() * from.length)];
      res.push(pick.id);
      pool.splice(pool.indexOf(pick), 1);
    }
  }
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
