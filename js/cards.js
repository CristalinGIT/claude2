// Карточки усилений. Их получают проигравшие после каждого раунда.
// Каждая карта меняет характеристики танка (stats) и может браться несколько раз до max.

export function defaultStats() {
  return {
    maxHp: 3,
    speed: 1,
    cdMul: 1,
    bSpeed: 1,
    bSize: 1,
    bounces: 1,
    shots: 1,
    damage: 1,
    shieldMax: 0,
    regen: 0,       // секунд на 1 HP, 0 — нет регенерации
    vampire: false,
    homing: 0,
    selfImmune: false,
    split: false,
  };
}

export const CARDS = [
  { id: 'ricochet', icon: '🔁', name: 'Рикошет', desc: 'Пули отскакивают на 1 раз больше', max: 4,
    apply: (s) => { s.bounces += 1; } },
  { id: 'rapid', icon: '⚡', name: 'Скорострельность', desc: 'Перезарядка быстрее на 25%', max: 3,
    apply: (s) => { s.cdMul *= 0.75; } },
  { id: 'armor', icon: '🧱', name: 'Броня', desc: '+1 к здоровью', max: 3,
    apply: (s) => { s.maxHp += 1; } },
  { id: 'turbo', icon: '🏎️', name: 'Турбо', desc: 'Танк ездит на 18% быстрее', max: 3,
    apply: (s) => { s.speed *= 1.18; } },
  { id: 'velocity', icon: '🚀', name: 'Быстрые снаряды', desc: 'Пули летят на 30% быстрее', max: 3,
    apply: (s) => { s.bSpeed *= 1.3; } },
  { id: 'caliber', icon: '🎳', name: 'Крупный калибр', desc: 'Пули в 1.6 раза больше — проще попасть', max: 2,
    apply: (s) => { s.bSize *= 1.6; } },
  { id: 'shotgun', icon: '🔱', name: 'Дробовик', desc: '+1 пуля веером, перезарядка чуть дольше', max: 3,
    apply: (s) => { s.shots += 1; s.cdMul *= 1.15; } },
  { id: 'heavy', icon: '💥', name: 'Тяжёлый снаряд', desc: 'Урон +1, но пули медленнее', max: 2,
    apply: (s) => { s.damage += 1; s.bSpeed *= 0.85; } },
  { id: 'shield', icon: '🔵', name: 'Энергощит', desc: 'Щит поглощает 1 попадание каждый раунд', max: 2,
    apply: (s) => { s.shieldMax += 1; } },
  { id: 'regen', icon: '🔧', name: 'Ремкомплект', desc: 'Восстанавливает 1 HP раз в несколько секунд', max: 3,
    apply: (s) => { s.regen = s.regen ? Math.max(3, s.regen - 2.5) : 8; } },
  { id: 'vampire', icon: '🧛', name: 'Вампир', desc: 'Попадание по врагу лечит вас на 1 HP', max: 1,
    apply: (s) => { s.vampire = true; } },
  { id: 'homing', icon: '🎯', name: 'Самонаведение', desc: 'Пули доворачивают к ближайшему врагу', max: 2,
    apply: (s) => { s.homing += 1; } },
  { id: 'rubber', icon: '🪀', name: 'Резиновая броня', desc: 'Свои пули вас не ранят', max: 1,
    apply: (s) => { s.selfImmune = true; } },
  { id: 'split', icon: '🌿', name: 'Осколки', desc: 'При первом рикошете пуля раскалывается на две', max: 1,
    apply: (s) => { s.split = true; } },
];

export const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));

// Пересчитать характеристики по списку взятых карт.
export function statsFromCards(cardIds) {
  const s = defaultStats();
  for (const id of cardIds) CARD_BY_ID.get(id)?.apply(s);
  return s;
}

// Случайные n карт, которые ещё не взяты до максимума.
export function rollCards(owned, n = 3) {
  const count = new Map();
  for (const id of owned) count.set(id, (count.get(id) || 0) + 1);
  const pool = CARDS.filter((c) => (count.get(c.id) || 0) < c.max).map((c) => c.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}
