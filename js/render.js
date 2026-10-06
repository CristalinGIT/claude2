// Отрисовка в «2.5D»: логика плоская, картинка объёмная (Three.js).
import * as THREE from '../vendor/three.module.min.js';
import { MAP, CELL } from './map.js';
import { CFG } from './game.js';

const WALL_H = 1.4;
const CAM_TILT = THREE.MathUtils.degToRad(58);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d2e);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 200);

    this.worldW = MAP.w * CELL;
    this.worldH = MAP.h * CELL;
    this.center = new THREE.Vector3(this.worldW / 2, 0, this.worldH / 2);

    this.buildLights();
    this.buildArena();

    this.zoneRing = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 96),
      new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    this.zoneRing.rotation.x = -Math.PI / 2;
    this.zoneRing.position.set(this.center.x, 0.05, this.center.z);
    this.zoneRing.visible = false;
    this.scene.add(this.zoneRing);

    this.tankMeshes = new Map();
    this.bulletMeshes = new Map();
    this.bulletGeo = new THREE.SphereGeometry(CFG.BULLET_R * 1.3, 10, 8);
    this.particles = [];
    this.particleGeo = new THREE.BoxGeometry(1, 1, 1);
    this.flashes = [];
    this.shake = 0;

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30283a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(this.center.x - 10, 30, this.center.z - 14);
    sun.target.position.copy(this.center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = sun.shadow.camera;
    s.left = -24; s.right = 24; s.top = 24; s.bottom = -24; s.near = 1; s.far = 80;
    sun.shadow.bias = -0.0015;
    this.scene.add(sun, sun.target);
  }

  buildArena() {
    // Пол в шашечку.
    const tex = checkerTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(MAP.w / 2, MAP.h / 2);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.worldW, this.worldH),
      new THREE.MeshLambertMaterial({ map: tex }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(this.center);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Стены одним InstancedMesh — быстро даже на слабых телефонах.
    const cells = [];
    for (let r = 0; r < MAP.h; r++) for (let c = 0; c < MAP.w; c++) if (MAP.solid(c, r)) cells.push([c, r]);
    const geo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const walls = new THREE.InstancedMesh(geo, mat, cells.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    cells.forEach(([c, r], i) => {
      m.makeTranslation((c + 0.5) * CELL, WALL_H / 2, (r + 0.5) * CELL);
      walls.setMatrixAt(i, m);
      const border = c === 0 || r === 0 || c === MAP.w - 1 || r === MAP.h - 1;
      col.set(border ? 0x3d4466 : 0x5b6699).offsetHSL(0, 0, ((c * 7 + r * 13) % 5) * 0.012);
      walls.setColorAt(i, col);
    });
    walls.castShadow = true;
    walls.receiveShadow = true;
    this.scene.add(walls);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.fitCamera();
  }

  // Подбираем расстояние камеры так, чтобы вся арена влезла в экран.
  fitCamera() {
    const dir = new THREE.Vector3(0, Math.sin(CAM_TILT), Math.cos(CAM_TILT));
    const corners = [];
    for (const x of [0, this.worldW]) for (const z of [0, this.worldH]) for (const y of [0, WALL_H]) {
      corners.push(new THREE.Vector3(x, y, z));
    }
    const target = this.center.clone();
    let lo = 5, hi = 200;
    for (let i = 0; i < 30; i++) {
      const d = (lo + hi) / 2;
      this.placeCamera(target, dir, d);
      const fits = corners.every((p) => {
        const v = p.clone().project(this.camera);
        return Math.abs(v.x) <= 0.98 && Math.abs(v.y) <= 0.96;
      });
      if (fits) hi = d; else lo = d;
    }
    this.camDir = dir;
    this.camDist = hi;
    this.placeCamera(target, dir, hi);
  }

  placeCamera(target, dir, d) {
    this.camera.position.copy(target).addScaledVector(dir, d);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  // Направление прицела от своего танка к курсору мыши.
  aimDirection(px, py, myTank) {
    if (!myTank) return null;
    const ndc = new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const dx = hit.x - myTank.x, dz = hit.z - myTank.y;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return null;
    return { x: dx / d, y: dz / d };
  }

  tankMesh(info) {
    let tm = this.tankMeshes.get(info.id);
    if (tm) return tm;
    tm = buildTank(info.color);
    this.tankMeshes.set(info.id, tm);
    this.scene.add(tm.root);
    return tm;
  }

  // state: { tanks, bullets, walls, mines, zone }; opts: { isAlly(id), laser: {bounces} | null }
  render(state, myId, dt, time, opts = {}) {
    const isAlly = opts.isAlly ?? ((id) => id === myId);
    const seen = new Set();
    for (const t of state.tanks) {
      seen.add(t.id);
      const tm = this.tankMesh(t);
      const ally = t.id === myId || isAlly(t.id);
      // Невидимый враг не рисуется совсем, невидимый союзник — полупрозрачный.
      const hiddenEnemy = t.invis && !ally;
      tm.root.visible = t.alive && !hiddenEnemy && !(t.inv && Math.floor(time * 12) % 2 === 0);
      setOpacity(tm, t.invis ? 0.3 : 1);
      tm.root.position.set(t.x, 0, t.y);
      tm.body.rotation.y = -t.rot;
      tm.turret.rotation.y = -t.tur;
      tm.ring.visible = t.id === myId;
      tm.ring.rotation.z += dt * 1.5;
      tm.bubble.visible = (t.shield ?? 0) > 0;
      tm.bubble.material.opacity = 0.16 + 0.06 * Math.sin(time * 5);
      updateBar(tm, t.hp, t.maxHp ?? 100);

      // Яд и лёд — облачка частиц вокруг танка.
      if (t.alive && !hiddenEnemy && (t.poisoned || t.slowed)) {
        tm.fxT = (tm.fxT ?? 0) - dt;
        if (tm.fxT <= 0) {
          tm.fxT = 0.18;
          if (t.poisoned) this.burst(t.x, t.y, { count: 2, color: 0x7dff4d, speed: 1, size: 0.14, life: 0.5, up: 2 });
          if (t.slowed) this.burst(t.x, t.y, { count: 2, color: 0xaee8ff, speed: 1, size: 0.14, life: 0.5, up: 1 });
        }
      }
    }
    for (const [id, tm] of this.tankMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(tm.root);
        this.tankMeshes.delete(id);
      }
    }

    this.renderWalls(state.walls || []);
    this.renderMines(state.mines || [], myId, isAlly, time);
    const me = state.tanks.find((t) => t.id === myId);
    this.renderLaser(opts.laser && me?.alive ? me : null, opts.laser);

    const seenB = new Set();
    for (const b of state.bullets) {
      seenB.add(b.id);
      let m = this.bulletMeshes.get(b.id);
      if (!m) {
        m = new THREE.Mesh(this.bulletGeo, new THREE.MeshBasicMaterial({ color: lighten(b.color ?? 0xffffff) }));
        m.castShadow = true;
        this.bulletMeshes.set(b.id, m);
        this.scene.add(m);
      }
      m.position.set(b.x, 0.75, b.y);
      m.scale.setScalar((b.r ?? CFG.BULLET_R) / CFG.BULLET_R);
    }
    for (const [id, m] of this.bulletMeshes) {
      if (!seenB.has(id)) {
        this.scene.remove(m);
        m.material.dispose();
        this.bulletMeshes.delete(id);
      }
    }

    if (state.zone > 0) {
      this.zoneRing.visible = true;
      this.zoneRing.scale.setScalar(state.zone);
      this.zoneRing.material.opacity = 0.6 + 0.3 * Math.sin(time * 6);
    } else {
      this.zoneRing.visible = false;
    }

    this.updateParticles(dt);

    // Тряска камеры от взрывов.
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * 0.5;
      const target = this.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * s, 0, (Math.random() - 0.5) * s));
      this.placeCamera(target, this.camDir, this.camDist);
    } else {
      this.placeCamera(this.center, this.camDir, this.camDist);
    }

    this.renderer.render(this.scene, this.camera);
  }

  renderWalls(walls) {
    if (!this.wallMeshes) {
      this.wallMeshes = new Map();
      this.wallGeo = new THREE.BoxGeometry(CELL * 0.9, WALL_H * 0.8, CELL * 0.9);
    }
    const seen = new Set();
    for (const [key, hp, max] of walls) {
      seen.add(key);
      let m = this.wallMeshes.get(key);
      if (!m) {
        m = new THREE.Mesh(this.wallGeo, new THREE.MeshLambertMaterial({ color: 0xc9a46a }));
        m.castShadow = m.receiveShadow = true;
        const c = key % MAP.w, r = Math.floor(key / MAP.w);
        m.position.set((c + 0.5) * CELL, WALL_H * 0.4, (r + 0.5) * CELL);
        this.wallMeshes.set(key, m);
        this.scene.add(m);
      }
      // Чем меньше прочность, тем темнее и ниже блок.
      const k = Math.max(0.2, hp / max);
      m.material.color.setHex(0xc9a46a).multiplyScalar(0.45 + 0.55 * k);
      m.scale.y = 0.55 + 0.45 * k;
      m.position.y = WALL_H * 0.4 * m.scale.y;
    }
    for (const [key, m] of this.wallMeshes) {
      if (seen.has(key)) continue;
      this.scene.remove(m);
      m.material.dispose();
      this.wallMeshes.delete(key);
    }
  }

  renderMines(mines, myId, isAlly, time) {
    if (!this.mineMeshes) {
      this.mineMeshes = new Map();
      this.mineGeo = new THREE.CylinderGeometry(0.42, 0.5, 0.18, 16);
    }
    const seen = new Set();
    for (const [id, x, y, owner, armed] of mines) {
      seen.add(id);
      let m = this.mineMeshes.get(id);
      if (!m) {
        m = new THREE.Mesh(this.mineGeo, new THREE.MeshBasicMaterial({ color: this.colorOf?.(owner) ?? 0xff4444, transparent: true }));
        this.mineMeshes.set(id, m);
        this.scene.add(m);
      }
      m.position.set(x, 0.1, y);
      // Чужие взведённые мины почти не видны.
      const ally = owner === myId || isAlly(owner);
      m.material.opacity = ally ? (armed ? 0.6 + 0.4 * Math.sin(time * 8) : 0.5) : (armed ? 0.14 : 0.5);
    }
    for (const [id, m] of this.mineMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      m.material.dispose();
      this.mineMeshes.delete(id);
    }
  }

  // Траектория выстрела с рикошетами (карточка «Лазерный прицел»).
  renderLaser(me, laser) {
    if (!this.laserLine) {
      this.laserPts = new Float32Array(3 * 12);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.laserPts, 3));
      this.laserLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.75 }));
      this.laserLine.frustumCulled = false;
      this.scene.add(this.laserLine);
    }
    if (!me) { this.laserLine.visible = false; return; }
    const pts = traceShot(me.x, me.y, me.tur, (laser.bounces ?? 1) + 1, 40);
    const n = Math.min(pts.length, 12);
    for (let i = 0; i < n; i++) {
      this.laserPts[i * 3] = pts[i][0];
      this.laserPts[i * 3 + 1] = 0.75;
      this.laserPts[i * 3 + 2] = pts[i][1];
    }
    this.laserLine.geometry.setDrawRange(0, n);
    this.laserLine.geometry.attributes.position.needsUpdate = true;
    this.laserLine.visible = true;
  }

  burst(x, y, { count = 10, color = 0xffaa33, speed = 6, size = 0.25, life = 0.6, up = 4 } = {}) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length > 300) break;
      const mesh = new THREE.Mesh(this.particleGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      mesh.position.set(x, 0.6, y);
      mesh.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      this.scene.add(mesh);
      this.particles.push({
        mesh, life, max: life,
        vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: up * (0.5 + Math.random()),
      });
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy -= 18 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y = Math.max(0.05, p.mesh.position.y + p.vy * dt);
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 4;
      p.mesh.material.opacity = Math.max(0, p.life / p.max);
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  explosion(x, y, color) {
    this.burst(x, y, { count: 26, color: 0xffcc44, speed: 9, size: 0.35, life: 0.7, up: 6 });
    this.burst(x, y, { count: 14, color: 0xff5522, speed: 6, size: 0.45, life: 0.9, up: 5 });
    this.burst(x, y, { count: 10, color, speed: 7, size: 0.4, life: 1.2, up: 8 });
    this.shake = Math.min(1, this.shake + 0.6);
  }

  clear() {
    for (const tm of this.tankMeshes.values()) this.scene.remove(tm.root);
    this.tankMeshes.clear();
    for (const m of this.bulletMeshes.values()) this.scene.remove(m);
    this.bulletMeshes.clear();
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.particles = [];
    this.renderWalls([]);
    this.renderMines([], null, () => false, 0);
    if (this.laserLine) this.laserLine.visible = false;
  }
}

function buildTank(color) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const turret = new THREE.Group();
  root.add(body, turret);

  const main = new THREE.MeshLambertMaterial({ color, transparent: true });
  const dark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), transparent: true });
  const tracks = new THREE.MeshLambertMaterial({ color: 0x2a2a33, transparent: true });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.45, 1.05), main);
  hull.position.y = 0.42;
  const trackGeo = new THREE.BoxGeometry(1.6, 0.4, 0.32);
  const trackL = new THREE.Mesh(trackGeo, tracks);
  trackL.position.set(0, 0.22, 0.58);
  const trackR = trackL.clone();
  trackR.position.z = -0.58;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.8), dark);
  nose.position.set(0.72, 0.4, 0);
  body.add(hull, trackL, trackR, nose);

  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.32, 16), dark);
  dome.position.y = 0.8;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 0.18), dark);
  barrel.position.set(0.62, 0.82, 0);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.24), main);
  tip.position.set(1.08, 0.82, 0);
  turret.add(dome, barrel, tip);

  for (const m of [hull, trackL, trackR, nose, dome, barrel, tip]) m.castShadow = true;

  // Кольцо под своим танком.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.12, 32, 1, 0, Math.PI * 1.6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  root.add(ring);

  // Пузырь энергощита.
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.2, depthWrite: false }),
  );
  bubble.position.y = 0.5;
  bubble.visible = false;
  root.add(bubble);

  // Полоска здоровья над танком.
  const bar = new THREE.Group();
  bar.position.set(0, 1.6, -0.25);
  const bg = new THREE.Mesh(BAR_GEO, BAR_BG);
  const fillMat = new THREE.MeshBasicMaterial({ color: 0x6dff7a });
  const fill = new THREE.Mesh(BAR_FILL_GEO, fillMat);
  fill.position.set(-BAR_W / 2, 0.01, 0);
  const ticks = new THREE.Group();
  bar.add(bg, fill, ticks);
  root.add(bar);

  return { root, body, turret, ring, bubble, bar, fill, fillMat, ticks, tickMax: 0, mats: [main, dark, tracks], opacity: 1, barKey: '' };
}

const BAR_W = 1.4;
const BAR_GEO = new THREE.BoxGeometry(BAR_W + 0.08, 0.06, 0.22);
const BAR_FILL_GEO = new THREE.BoxGeometry(BAR_W, 0.07, 0.16).translate(BAR_W / 2, 0, 0);
const BAR_BG = new THREE.MeshBasicMaterial({ color: 0x24242c });
const TICK_GEO = new THREE.BoxGeometry(0.025, 0.08, 0.17);
const TICK_MAT = new THREE.MeshBasicMaterial({ color: 0x15151b });

function updateBar(tm, hp, maxHp) {
  const key = hp + '/' + maxHp;
  if (tm.barKey === key) return;
  tm.barKey = key;
  const k = Math.max(0, Math.min(1, hp / maxHp));
  tm.fill.scale.x = Math.max(0.001, k);
  tm.fillMat.color.setHex(k > 0.6 ? 0x6dff7a : k > 0.3 ? 0xffd23f : 0xff4d4d);
  // Бар чуть длиннее у танков с бронёй.
  tm.bar.scale.x = Math.min(1.6, 0.85 + maxHp / 650);
  // Деления по 10 HP.
  if (tm.tickMax !== maxHp) {
    tm.tickMax = maxHp;
    tm.ticks.clear();
    for (let v = 10; v < maxHp; v += 10) {
      const m = new THREE.Mesh(TICK_GEO, TICK_MAT);
      m.position.set(-BAR_W / 2 + (v / maxHp) * BAR_W, 0.02, 0);
      tm.ticks.add(m);
    }
  }
}

function setOpacity(tm, o) {
  if (tm.opacity === o) return;
  tm.opacity = o;
  for (const m of tm.mats) m.opacity = o;
  tm.bar.visible = o > 0.5;
}

// Трассировка выстрела по статичной карте с отражениями от стен.
export function traceShot(x, y, angle, segments, maxLen) {
  let dx = Math.cos(angle), dy = Math.sin(angle);
  const pts = [[x, y]];
  let len = 0;
  const step = 0.1;
  let seg = 0;
  while (len < maxLen && seg < segments) {
    const nx = x + dx * step;
    if (MAP.solid(Math.floor(nx / CELL), Math.floor(y / CELL))) { dx = -dx; pts.push([x, y]); seg++; continue; }
    const ny = y + dy * step;
    if (MAP.solid(Math.floor(nx / CELL), Math.floor(ny / CELL))) { dy = -dy; pts.push([nx, y]); x = nx; seg++; continue; }
    x = nx; y = ny;
    len += step;
  }
  pts.push([x, y]);
  return pts;
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2b3047';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#323853';
  g.fillRect(0, 0, 32, 32);
  g.fillRect(32, 32, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function lighten(color) {
  return new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45);
}
