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

  // state: { tanks: [{id,x,y,rot,tur,hp,alive,inv,color}], bullets: [{id,x,y,color}] }
  render(state, myId, dt, time) {
    const seen = new Set();
    for (const t of state.tanks) {
      seen.add(t.id);
      const tm = this.tankMesh(t);
      tm.root.visible = t.alive && !(t.inv && Math.floor(time * 12) % 2 === 0);
      tm.root.position.set(t.x, 0, t.y);
      tm.body.rotation.y = -t.rot;
      tm.turret.rotation.y = -t.tur;
      tm.ring.visible = t.id === myId;
      tm.ring.rotation.z += dt * 1.5;
      for (let i = 0; i < tm.hpPips.length; i++) {
        tm.hpPips[i].material = i < t.hp ? tm.hpOn : tm.hpOff;
      }
    }
    for (const [id, tm] of this.tankMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(tm.root);
        this.tankMeshes.delete(id);
      }
    }

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
    }
    for (const [id, m] of this.bulletMeshes) {
      if (!seenB.has(id)) {
        this.scene.remove(m);
        m.material.dispose();
        this.bulletMeshes.delete(id);
      }
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
  }
}

function buildTank(color) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const turret = new THREE.Group();
  root.add(body, turret);

  const main = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) });
  const tracks = new THREE.MeshLambertMaterial({ color: 0x2a2a33 });

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

  // Здоровье — квадратики над танком.
  const hpOn = new THREE.MeshBasicMaterial({ color: 0x6dff7a });
  const hpOff = new THREE.MeshBasicMaterial({ color: 0x40404a });
  const pipGeo = new THREE.BoxGeometry(0.34, 0.08, 0.18);
  const hpPips = [];
  for (let i = 0; i < CFG.HP; i++) {
    const p = new THREE.Mesh(pipGeo, hpOn);
    p.position.set((i - (CFG.HP - 1) / 2) * 0.42, 1.55, -0.2);
    root.add(p);
    hpPips.push(p);
  }

  return { root, body, turret, ring, hpPips, hpOn, hpOff };
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
