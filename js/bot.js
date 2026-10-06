// Простой ИИ бота: ищет цель, обходит стены по сетке, стреляет с упреждением, уворачивается.
import { MAP, CELL, lineOfSight } from './map.js';
import { CFG, angleDiff } from './game.js';

export function botThink(game, t, dt) {
  const b = t.brain;
  b.retarget = (b.retarget ?? 0) - dt;
  b.repath = (b.repath ?? 0) - dt;
  b.strafeT = (b.strafeT ?? 0) - dt;
  b.react = (b.react ?? 0) - dt;

  let target = game.tanks.get(b.targetId);
  if (target && hidden(t, target)) target = null;
  if (b.retarget <= 0 || !target || !target.alive) {
    target = pickTarget(game, t);
    b.targetId = target?.id;
    b.retarget = 0.4 + Math.random() * 0.4;
  }

  let mx = 0, my = 0, ax = Math.cos(t.tur), ay = Math.sin(t.tur), fire = false;
  let wantAbility = null;
  let danger = false;

  if (target) {
    const dx = target.x - t.x, dy = target.y - t.y;
    const dist = Math.hypot(dx, dy);
    const see = lineOfSight(t.x, t.y, target.x, target.y);

    if (see) {
      // Упреждение по скорости цели плюс небольшая ошибка, чтобы бот не был идеальным.
      const lead = dist / (CFG.BULLET_SPEED * t.s.bSpeed);
      const px = target.x + target.vx * lead * 0.8;
      const py = target.y + target.vy * lead * 0.8;
      if (b.react <= 0) {
        b.aimErr = (Math.random() - 0.5) * 0.22;
        b.react = 0.25;
      }
      const aim = Math.atan2(py - t.y, px - t.x) + (b.aimErr ?? 0);
      ax = Math.cos(aim); ay = Math.sin(aim);
      fire = Math.abs(angleDiff(t.tur, aim)) < 0.15 && dist < 22;
      // Стену ставим, когда цель рядом и мы ранены; мину — когда враг близко.
      if (dist < 12 && t.hp < t.s.maxHp * 0.7 && Math.random() < dt * 2) wantAbility = 'wall';
      if (dist < 9 && Math.random() < dt * 2) wantAbility = wantAbility || 'mine';
      if (t.hp < t.s.maxHp * 0.5) wantAbility = wantAbility || 'invis';

      // Кружим вокруг цели, держа дистанцию.
      if (b.strafeT <= 0) {
        b.strafeDir = Math.random() < 0.5 ? -1 : 1;
        b.strafeT = 0.8 + Math.random() * 1.4;
      }
      const ux = dx / dist, uy = dy / dist;
      mx = -uy * b.strafeDir;
      my = ux * b.strafeDir;
      if (dist < 6) { mx -= ux; my -= uy; }
      else if (dist > 11) { mx += ux; my += uy; }
      b.path = null;
    } else {
      if (b.repath <= 0 || !b.path) {
        b.path = findPath(t.x, t.y, target.x, target.y);
        b.repath = 0.5;
      }
      const wp = nextWaypoint(b, t);
      if (wp) {
        mx = wp.x - t.x; my = wp.y - t.y;
        const aim = Math.atan2(my, mx);
        ax = Math.cos(aim); ay = Math.sin(aim);
      }
    }
  } else {
    // Целей нет — просто бродим.
    if (b.strafeT <= 0) {
      const a = Math.random() * Math.PI * 2;
      b.wander = [Math.cos(a), Math.sin(a)];
      b.strafeT = 1.5;
    }
    [mx, my] = b.wander ?? [0, 0];
  }

  // Сужающаяся зона: держимся ближе к центру.
  if (game.zone > 0) {
    const cx = MAP.w * CELL / 2, cy = MAP.h * CELL / 2;
    const dx = cx - t.x, dy = cy - t.y;
    const d = Math.hypot(dx, dy);
    if (d > game.zone - 2.5 && d > 0.5) {
      mx = mx * 0.3 + (dx / d) * 1.5;
      my = my * 0.3 + (dy / d) * 1.5;
    }
  }

  // Уклонение от летящих в нас пуль.
  for (const bl of game.bullets) {
    if (bl.owner === t.id && bl.bounces === 0) continue;
    if (bl.owner !== t.id && game.teams && bl.team === t.team) continue;
    const rx = t.x - bl.x, ry = t.y - bl.y;
    const d = Math.hypot(rx, ry);
    if (d > 6) continue;
    const sp = Math.hypot(bl.vx, bl.vy);
    const dot = (rx * bl.vx + ry * bl.vy) / (d * sp);
    if (dot < 0.85) continue;
    // Сдвигаемся перпендикулярно пуле в ту сторону, где мы уже есть.
    const side = Math.sign(rx * bl.vy - ry * bl.vx) || 1;
    mx += (bl.vy / sp) * side * 1.5;
    my += (-bl.vx / sp) * side * 1.5;
    if (d < 3.5) danger = true;
  }
  // Блинк — чтобы увернуться от пули.
  if (danger && Math.random() < 0.5) wantAbility = 'blink';

  // Если застряли — шаг в случайную сторону.
  const moved = Math.hypot(t.vx, t.vy);
  b.stuck = moved < 0.5 && Math.hypot(mx, my) > 0.3 ? (b.stuck ?? 0) + dt : 0;
  if (b.stuck > 0.6) {
    const a = Math.random() * Math.PI * 2;
    b.unstick = [Math.cos(a), Math.sin(a), 0.5];
    b.stuck = 0;
    b.path = null;
  }
  if (b.unstick && b.unstick[2] > 0) {
    mx = b.unstick[0]; my = b.unstick[1];
    b.unstick[2] -= dt;
  }

  const m = Math.hypot(mx, my);
  if (m > 1) { mx /= m; my /= m; }
  t.input.mx = mx; t.input.my = my;
  t.input.ax = ax; t.input.ay = ay;
  t.input.fire = fire;
  // Жмём нужную способность, если она есть в одном из слотов и готова.
  const slot = wantAbility ? t.s.abilities.indexOf(wantAbility) : -1;
  if (slot >= 0 && t.abilityTs[slot] <= 0) t.input[slot === 0 ? 'ability' : 'ability2'] = true;
}

// Невидимого врага бот не видит, пока тот не подъедет вплотную.
function hidden(t, o) {
  return o.invisT > 0 && Math.hypot(o.x - t.x, o.y - t.y) > 3;
}

function pickTarget(game, t) {
  let best = null, bestD = Infinity;
  for (const o of game.tanks.values()) {
    if (!o.alive || !game.isEnemy(t, o) || hidden(t, o)) continue;
    let d = Math.hypot(o.x - t.x, o.y - t.y);
    if (!lineOfSight(t.x, t.y, o.x, o.y)) d += 8;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

function nextWaypoint(b, t) {
  const path = b.path;
  if (!path || !path.length) return null;
  while (path.length > 1) {
    const p = path[0];
    if (Math.hypot(p.x - t.x, p.y - t.y) < 0.6) path.shift();
    else break;
  }
  return path[0];
}

// Поиск пути в ширину по клеткам карты.
function findPath(x0, y0, x1, y1) {
  const sc = Math.floor(x0 / CELL), sr = Math.floor(y0 / CELL);
  const tc = Math.floor(x1 / CELL), tr = Math.floor(y1 / CELL);
  const key = (c, r) => r * MAP.w + c;
  const prev = new Map([[key(sc, sr), -1]]);
  const queue = [[sc, sr]];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length) {
    const [c, r] = queue.shift();
    if (c === tc && r === tr) break;
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr;
      const k = key(nc, nr);
      if (MAP.solid(nc, nr) || prev.has(k)) continue;
      prev.set(k, key(c, r));
      queue.push([nc, nr]);
    }
  }
  let k = key(tc, tr);
  if (!prev.has(k)) return null;
  const cells = [];
  while (k !== -1) {
    cells.push({ x: ((k % MAP.w) + 0.5) * CELL, y: (Math.floor(k / MAP.w) + 0.5) * CELL });
    k = prev.get(k);
  }
  cells.reverse();
  cells.shift();
  return cells;
}
