// Раскладка сенсорного управления: положение (доля ширины/высоты экрана) и масштаб каждого элемента.
export const LAYOUT_ITEMS = {
  move: { label: 'Движение', base: 120 },
  aim: { label: 'Прицел', base: 120 },
  ab1: { label: 'Способность 1', base: 66 },
  ab2: { label: 'Способность 2', base: 58 },
};

export const DEFAULT_LAYOUT = {
  move: { x: 0.13, y: 0.74, s: 1 },
  aim: { x: 0.87, y: 0.74, s: 1 },
  ab1: { x: 0.73, y: 0.74, s: 1 },
  ab2: { x: 0.79, y: 0.54, s: 1 },
};

export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.7;

const KEY = 'tank-layout';

export function loadLayout() {
  const l = structuredClone(DEFAULT_LAYOUT);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k of Object.keys(l)) {
      const v = saved[k];
      if (v && isFinite(v.x) && isFinite(v.y) && isFinite(v.s)) l[k] = { x: clamp(v.x, 0, 1), y: clamp(v.y, 0, 1), s: clamp(v.s, MIN_SCALE, MAX_SCALE) };
    }
  } catch {}
  return l;
}

export function saveLayout(layout) {
  try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch {}
}

// Центр и диаметр элемента в пикселях для текущего размера экрана.
export function itemPx(layout, key) {
  const it = layout[key];
  const size = LAYOUT_ITEMS[key].base * it.s;
  const r = size / 2;
  // Не даём элементу уехать за край экрана.
  const x = clamp(it.x * window.innerWidth, r, window.innerWidth - r);
  const y = clamp(it.y * window.innerHeight, r, window.innerHeight - r);
  return { x, y, size };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
