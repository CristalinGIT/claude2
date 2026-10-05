// Карта арены: '#' — стена, '.' — пусто. Одна клетка = CELL единиц мира.
export const CELL = 2;

const LAYOUT = [
  '#################',
  '#.......#.......#',
  '#..##.......##..#',
  '#..#....#....#..#',
  '#.....#####.....#',
  '#...............#',
  '#.....#####.....#',
  '#..#....#....#..#',
  '#..##.......##..#',
  '#.......#.......#',
  '#################',
];

export const MAP = {
  w: LAYOUT[0].length,
  h: LAYOUT.length,
  rows: LAYOUT,
  solid(col, row) {
    if (col < 0 || row < 0 || col >= this.w || row >= this.h) return true;
    return LAYOUT[row][col] === '#';
  },
};

export function isSolid(x, y) {
  return MAP.solid(Math.floor(x / CELL), Math.floor(y / CELL));
}

let empty = null;
export function emptyCells() {
  if (!empty) {
    empty = [];
    for (let row = 0; row < MAP.h; row++) {
      for (let col = 0; col < MAP.w; col++) {
        if (!MAP.solid(col, row)) empty.push({ col, row });
      }
    }
  }
  return empty;
}

// Есть ли прямая видимость между двумя точками (шагаем по лучу).
export function lineOfSight(x0, y0, x1, y1, step = 0.25) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / step);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    if (isSolid(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k)) return false;
  }
  return true;
}
