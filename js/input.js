// Управление: два виртуальных стика на тачскрине, WASD + мышь на компьютере.
const STICK_R = 60;
// Зоны стиков: только нижняя часть экрана (слева — движение, справа — прицел).
const ZONE_TOP = 0.35;
const REST_X = 110;
const REST_Y = 100;

export class Input {
  constructor(root, { aimFromMouse }) {
    this.root = root;
    this.aimFromMouse = aimFromMouse;
    this.move = { x: 0, y: 0, id: null, el: null };
    this.aim = { x: 0, y: 0, id: null, el: null };
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false, active: false };
    this.enabled = false;

    this.move.el = makeStick(root, 'move');
    this.aim.el = makeStick(root, 'aim');
    this.touchUi = matchMedia('(pointer: coarse)').matches;

    root.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    root.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    root.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
    root.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false });

    this.abilityLatch = false;
    this.fixed = false;
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (this.enabled && !e.repeat && ['KeyE', 'ShiftLeft', 'ShiftRight', 'Space'].includes(e.code)) this.abilityLatch = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    root.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.active = true;
    });
    root.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, .overlay')) return;
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.abilityLatch = true;
    });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onTouchStart(e) {
    // Кнопки и окна поверх игры должны нажиматься как обычно.
    if (!this.enabled || e.target.closest('button, .overlay')) return;
    e.preventDefault();
    this.mouse.active = false;
    this.touchUi = true;
    for (const t of e.changedTouches) {
      if (t.clientY < window.innerHeight * ZONE_TOP) continue;
      const stick = t.clientX < window.innerWidth / 2 ? this.move : this.aim;
      if (stick.id !== null) continue;
      stick.id = t.identifier;
      if (this.fixed) {
        // Фиксированный стик стоит на месте — палец просто отклоняет его.
        const [rx, ry] = this.restPos(stick);
        stick.ox = rx; stick.oy = ry;
        this.moveStick(stick, t.clientX, t.clientY);
      } else {
        stick.ox = t.clientX; stick.oy = t.clientY;
        stick.x = stick.y = 0;
        showStick(stick, t.clientX, t.clientY);
      }
    }
  }

  moveStick(stick, px, py) {
    let dx = px - stick.ox, dy = py - stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      if (this.fixed) {
        dx *= STICK_R / d; dy *= STICK_R / d;
      } else {
        // Плавающий стик «тянется» за пальцем, если тот ушёл далеко.
        stick.ox += (dx / d) * (d - STICK_R);
        stick.oy += (dy / d) * (d - STICK_R);
        dx = px - stick.ox; dy = py - stick.oy;
      }
    }
    stick.x = dx / STICK_R; stick.y = dy / STICK_R;
    showStick(stick, stick.ox, stick.oy);
  }

  restPos(stick) {
    const left = stick === this.move;
    return [left ? REST_X : window.innerWidth - REST_X, window.innerHeight - REST_Y];
  }

  onTouchMove(e) {
    if (!this.enabled || (this.move.id === null && this.aim.id === null)) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      for (const stick of [this.move, this.aim]) {
        if (stick.id !== t.identifier) continue;
        this.moveStick(stick, t.clientX, t.clientY);
      }
    }
  }

  onTouchEnd(e) {
    for (const t of e.changedTouches) {
      for (const stick of [this.move, this.aim]) {
        if (stick.id !== t.identifier) continue;
        stick.id = null;
        stick.x = stick.y = 0;
        this.rest(stick);
      }
    }
  }

  // Стик в покое — полупрозрачный в своём углу, чтобы было видно, где зона управления.
  rest(stick) {
    if (!this.touchUi || !this.enabled) { stick.el.style.display = 'none'; return; }
    const [x, y] = this.restPos(stick);
    stick.x = stick.y = 0;
    showStick(stick, x, y);
    stick.el.classList.add('resting');
  }

  setEnabled(on) {
    this.enabled = on;
    this.reset();
  }

  read() {
    let mx = this.move.x, my = this.move.y;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    if (ml < 0.15) { mx = 0; my = 0; }

    let ax = this.aim.x, ay = this.aim.y, fire = false;
    const am = Math.hypot(ax, ay);
    if (this.aim.id !== null) {
      // Стик прицела отклонён достаточно сильно — стреляем.
      fire = am > 0.45;
    } else if (this.mouse.active) {
      const dir = this.aimFromMouse(this.mouse.x, this.mouse.y);
      if (dir) { ax = dir.x; ay = dir.y; }
      fire = this.mouse.down;
    }
    const ability = this.abilityLatch;
    this.abilityLatch = false;
    return { mx: r2(mx), my: r2(my), ax: r2(ax), ay: r2(ay), fire, ability };
  }

  reset() {
    for (const s of [this.move, this.aim]) {
      s.id = null; s.x = s.y = 0; this.rest(s);
    }
    this.keys.clear();
    this.mouse.down = false;
  }
}

function makeStick(root, kind) {
  const el = document.createElement('div');
  el.className = 'stick stick-' + kind;
  el.innerHTML = '<div class="knob"></div>';
  el.style.display = 'none';
  root.appendChild(el);
  return el;
}

function showStick(stick, ox, oy) {
  const el = stick.el;
  el.style.display = 'block';
  el.classList.remove('resting');
  el.style.left = ox + 'px';
  el.style.top = oy + 'px';
  const k = el.firstChild;
  k.style.transform = `translate(${stick.x * STICK_R}px, ${stick.y * STICK_R}px)`;
}

function r2(v) { return Math.round(v * 100) / 100; }
