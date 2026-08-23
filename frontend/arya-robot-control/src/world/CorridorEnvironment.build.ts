/* ARYA — corridor + lobby environment mesh builder.
   Ported from the standalone Three.js prototype: a wood-panelled
   reception lobby (pillars, sofas, reception desk, notice board) opening
   into a long two-tone corridor (cream wall / terracotta band, dark
   polished floor, doors down both sides, ceiling strip lights) that ends
   at a window. Pure THREE object construction so it can be dropped into
   an R3F scene with a single <primitive object={...} />. */
import * as THREE from "three";
import { WORLD } from "./worldBounds";

type Mats = Record<string, THREE.Material>;


function makeFloorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#2b2f33');
  grad.addColorStop(0.5, '#3a3f45');
  grad.addColorStop(1, '#262a2e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function makeWoodTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#7a4b30';
  ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = `rgba(40,20,10,${0.15 + Math.random() * 0.1})`;
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.moveTo(0, Math.random() * 256);
    ctx.bezierCurveTo(40, Math.random() * 256, 90, Math.random() * 256, 128, Math.random() * 256);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(30,15,8,0.5)';
  ctx.lineWidth = 3;
  for (let x = 0; x <= 128; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeCofferedCeilingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#efe9dd';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#c9c0aa';
  ctx.lineWidth = 4;
  const step = 64;
  for (let i = 0; i <= 256; i += step) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  for (let y = 0; y < 256; y += step) {
    for (let x = 0; x < 256; x += step) {
      if (Math.random() > 0.5) {
        ctx.fillStyle = 'rgba(255,247,225,0.55)';
        ctx.fillRect(x + 10, y + 10, step - 20, step - 20);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Cache: identical sign text/colors reuse one texture instead of a fresh
// canvas per door — with ~20 doors this cuts texture allocations a lot,
// which matters a good deal under software rendering / low-end mobile GPUs.
const signTextureCache = new Map<string, THREE.CanvasTexture>();

function makeSignTexture(lines: string | string[], bg?: string, fg?: string) {
  const key = `${Array.isArray(lines) ? lines.join("|") : lines}::${bg}::${fg}`;
  const cached = signTextureCache.get(key);
  if (cached) return cached;

  const c = document.createElement('canvas');
  c.width = 96; c.height = 36;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg || '#7a1f22';
  ctx.fillRect(0, 0, 96, 36);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(1.5, 1.5, 93, 33);
  ctx.fillStyle = fg || '#f5e9c8';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  (Array.isArray(lines) ? lines : [lines]).forEach((line, i, arr) => {
    const y = 18 + (i - (arr.length - 1) / 2) * 15;
    ctx.fillText(line, 48, y);
  });
  const tex = new THREE.CanvasTexture(c);
  signTextureCache.set(key, tex);
  return tex;
}

function makeNoticeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#8a2f2f';
  ctx.fillRect(0, 0, 128, 160);
  const paperColors = ['#f5f0e2', '#eef0d8', '#f7e7c6'];
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = paperColors[i % paperColors.length];
    const w = 26 + Math.random() * 12, h = 20 + Math.random() * 12;
    const x = Math.random() * (128 - w), y = Math.random() * (160 - h);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((Math.random() - 0.5) * 0.3);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  return new THREE.CanvasTexture(c);
}

function makeGlassGridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#bcd7e0';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#5b6b70';
  ctx.lineWidth = 5;
  for (let i = 0; i <= 128; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------
// Materials (built lazily so THREE is available)
// ---------------------------------------------------------------------
function buildMaterials() {
  return {
    floor: new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.35, metalness: 0.15 }),
    cream: new THREE.MeshStandardMaterial({ color: 0xece5d4, roughness: 0.85 }),
    terracotta: new THREE.MeshStandardMaterial({ color: 0xb0532f, roughness: 0.7 }),
    skirtLine: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }),
    wood: new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.55, metalness: 0.08 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0xf5f2e8, roughness: 0.9 }),
    ceilingCoffer: new THREE.MeshStandardMaterial({ map: makeCofferedCeilingTexture(), roughness: 0.85 }),
    door: new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.4, metalness: 0.05 }),
    doorFrame: new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.5, metalness: 0.3 }),
    doorKnob: new THREE.MeshStandardMaterial({ color: 0xd8c48a, roughness: 0.3, metalness: 0.8 }),
    lightFixture: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d8, emissiveIntensity: 1.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8f9498, roughness: 0.4, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ map: makeGlassGridTexture(), roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }),
    darkFabric: new THREE.MeshStandardMaterial({ color: 0x33414d, roughness: 0.85 }),
    plantPot: new THREE.MeshStandardMaterial({ color: 0xa39a8c, roughness: 0.9 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.7, side: THREE.DoubleSide }),
    notice: new THREE.MeshStandardMaterial({ map: makeNoticeTexture(), roughness: 0.9 }),
    reception: new THREE.MeshStandardMaterial({ color: 0x8a4a2c, roughness: 0.4, metalness: 0.15 }),
    receptionTop: new THREE.MeshStandardMaterial({ color: 0xd8d3c6, roughness: 0.3, metalness: 0.2 }),
  };
}

// ---------------------------------------------------------------------
// Reusable pieces
// ---------------------------------------------------------------------
function addTwoToneWall(group: THREE.Group, mats: Mats, x: number, z1: number, z2: number, height: number, thickness: number, hasBand: boolean) {
  const g = new THREE.Group();
  const bandH = hasBand === false ? 0 : WORLD.bandH;
  if (bandH > 0) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(thickness, bandH, Math.abs(z2 - z1)), mats.terracotta);
    band.position.set(0, bandH / 2, (z1 + z2) / 2 - z1 + Math.min(z1, z2));
    band.position.z = (z1 + z2) / 2;
    band.castShadow = true; band.receiveShadow = true;
    g.add(band);
    const line = new THREE.Mesh(new THREE.BoxGeometry(thickness + 0.01, 0.02, Math.abs(z2 - z1)), mats.skirtLine);
    line.position.set(0, bandH, (z1 + z2) / 2);
    g.add(line);
  }
  const upperH = height - bandH;
  const upper = new THREE.Mesh(new THREE.BoxGeometry(thickness, upperH, Math.abs(z2 - z1)), mats.cream);
  upper.position.set(0, bandH + upperH / 2, (z1 + z2) / 2);
  upper.castShadow = true; upper.receiveShadow = true;
  g.add(upper);
  g.position.x = x;
  group.add(g);
  return g;
}

interface DoorOpts { w?: number; h?: number; rotY?: number; sign?: string; signBg?: string; signFg?: string }
function addDoor(group: THREE.Group, mats: Mats, x: number, z: number, facing: number, opts: DoorOpts = {}) {
  const w = opts.w || 1.0, h = opts.h || 2.05;
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.1, 0.06), mats.doorFrame);
  frame.position.set(0, h / 2, 0);
  g.add(frame);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.045), mats.door);
  leaf.position.set(0, h / 2, 0.02);
  leaf.castShadow = true;
  g.add(leaf);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), mats.doorKnob);
  knob.position.set(w * 0.34 * facing, h / 2, 0.05);
  g.add(knob);
  if (opts.sign) {
    const tex = makeSignTexture(opts.sign, opts.signBg, opts.signFg);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.13), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    sign.position.set(0, h + 0.16, 0.035);
    g.add(sign);
  }
  g.position.set(x, 0, z);
  g.rotation.y = opts.rotY || 0;
  group.add(g);
  return g;
}

function addCeilingLight(group: THREE.Group, mats: Mats, x: number, z: number, len: number) {
  const fix = new THREE.Mesh(new THREE.BoxGeometry(len || 1.1, 0.05, 0.14), mats.lightFixture);
  fix.position.set(x, (WORLD.wallH) - 0.05, z);
  group.add(fix);
  const pl = new THREE.PointLight(0xfff2d8, 0.55, 5.5, 2);
  pl.position.set(x, WORLD.wallH - 0.15, z);
  group.add(pl);
  return fix;
}

function addLocker(group: THREE.Group, mats: Mats, x: number, z: number, rotY: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.5, 0.45), new THREE.MeshStandardMaterial({ color: 0x9aa3aa, roughness: 0.5, metalness: 0.4 }));
  body.position.y = 0.75;
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  for (let i = 1; i < 3; i++) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.01, 0.46), new THREE.MeshStandardMaterial({ color: 0x555b60 }));
    seam.position.y = i * 0.5;
    g.add(seam);
  }
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.03), mats.doorKnob);
  handle.position.set(0.17, 0.9, 0.24);
  g.add(handle);
  g.position.set(x, 0, z);
  g.rotation.y = rotY || 0;
  group.add(g);
}

function addNoticeBoard(group: THREE.Group, mats: Mats, x: number, z: number, rotY: number) {
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.04), mats.notice);
  board.position.set(x, 1.55, z);
  board.rotation.y = rotY || 0;
  board.castShadow = true;
  group.add(board);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.84, 0.03), mats.doorFrame);
  frame.position.set(x - Math.sin(rotY || 0) * 0.015, 1.55, z - Math.cos(rotY || 0) * 0.015 + (rotY ? 0 : 0));
  frame.rotation.y = rotY || 0;
  group.add(frame);
}

function addSofa(group: THREE.Group, mats: Mats, x: number, z: number, rotY: number, lenArg?: number) {
  const g = new THREE.Group();
  const len = lenArg || 1.6;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(len, 0.36, 0.62), mats.darkFabric);
  seat.position.y = 0.28; seat.castShadow = true; seat.receiveShadow = true;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.14), mats.darkFabric);
  back.position.set(0, 0.62, -0.24); back.castShadow = true;
  g.add(back);
  [-len / 2 + 0.1, len / 2 - 0.1].forEach(ax => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.62), mats.darkFabric);
    arm.position.set(ax, 0.31, 0);
    g.add(arm);
  });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.4 });
  [[-len / 2 + 0.14, -0.24], [len / 2 - 0.14, -0.24], [-len / 2 + 0.14, 0.24], [len / 2 - 0.14, 0.24]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), legMat);
    leg.position.set(lx, 0.06, lz);
    g.add(leg);
  });
  g.position.set(x, 0, z);
  g.rotation.y = rotY || 0;
  group.add(g);
}

function addPillarPlanter(group: THREE.Group, mats: Mats, x: number, z: number) {
  const g = new THREE.Group();
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, WORLD.lobbyWallH, 12), mats.wood);
  pillar.position.y = WORLD.lobbyWallH / 2;
  pillar.castShadow = true; pillar.receiveShadow = true;
  g.add(pillar);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.5, 16), mats.plantPot);
  pot.position.y = 0.25; pot.castShadow = true;
  g.add(pot);
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.55, 6), mats.leaf);
    const a = (i / 7) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.08, 0.75, Math.sin(a) * 0.08);
    leaf.rotation.z = Math.cos(a) * 0.5;
    leaf.rotation.x = Math.sin(a) * 0.5;
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  group.add(g);
}

function addReceptionDesk(group: THREE.Group, mats: Mats, x: number, z: number, rotY: number) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.05, 0.7), mats.reception);
  base.position.y = 0.52; base.castShadow = true; base.receiveShadow = true;
  g.add(base);
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.06, 0.8), mats.receptionTop);
  top.position.y = 1.08; top.castShadow = true;
  g.add(top);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.12, 0.02), new THREE.MeshStandardMaterial({ color: 0xd8d3c6, metalness: 0.4, roughness: 0.3 }));
  stripe.position.set(0, 0.6, 0.36);
  g.add(stripe);
  g.position.set(x, 0, z);
  g.rotation.y = rotY || 0;
  group.add(g);
}

function addWindow(group: THREE.Group, mats: Mats, x: number, z: number, rotY: number, w: number, h: number) {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.08), mats.doorFrame);
  frame.position.set(x, 1.15 + h / 2, z);
  frame.rotation.y = rotY || 0;
  group.add(frame);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mats.glass);
  pane.position.set(x + Math.sin(rotY || 0) * 0.05, 1.15 + h / 2, z + Math.cos(rotY || 0) * 0.05);
  pane.rotation.y = rotY || 0;
  group.add(pane);
}

// ---------------------------------------------------------------------
// Main builder

export function buildEnvironmentGroup(): THREE.Group {
  const group = new THREE.Group();
  const mats = buildMaterials();

  // ================= FLOOR =================
  const floorGeoLobby = new THREE.PlaneGeometry(WORLD.lobbyHalfW * 2, WORLD.lobbyFrontZ - WORLD.lobbyBackZ);
  const floorLobby = new THREE.Mesh(floorGeoLobby, mats.floor);
  floorLobby.rotation.x = -Math.PI / 2;
  floorLobby.position.set(0, 0, (WORLD.lobbyFrontZ + WORLD.lobbyBackZ) / 2);
  floorLobby.receiveShadow = true;
  group.add(floorLobby);

  const floorGeoCorr = new THREE.PlaneGeometry(WORLD.corrHalfW * 2, WORLD.lobbyBackZ - WORLD.corrEndZ);
  const floorCorr = new THREE.Mesh(floorGeoCorr, mats.floor);
  floorCorr.rotation.x = -Math.PI / 2;
  floorCorr.position.set(0, 0, (WORLD.lobbyBackZ + WORLD.corrEndZ) / 2);
  floorCorr.receiveShadow = true;
  group.add(floorCorr);

  // faint centre lane stripes down the corridor (matches reference video)
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xcabf9e, roughness: 0.5, transparent: true, opacity: 0.55 });
  [-0.42, 0.42].forEach(sx => {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.05, WORLD.lobbyBackZ - WORLD.corrEndZ - 0.4), stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(sx, 0.005, (WORLD.lobbyBackZ + WORLD.corrEndZ) / 2);
    group.add(stripe);
  });

  // ================= CEILING =================
  const ceilLobby = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.lobbyHalfW * 2, WORLD.lobbyFrontZ - WORLD.lobbyBackZ), mats.ceilingCoffer);
  ceilLobby.rotation.x = Math.PI / 2;
  ceilLobby.position.set(0, WORLD.lobbyWallH, (WORLD.lobbyFrontZ + WORLD.lobbyBackZ) / 2);
  group.add(ceilLobby);

  const ceilCorr = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.corrHalfW * 2, WORLD.lobbyBackZ - WORLD.corrEndZ), mats.ceiling);
  ceilCorr.rotation.x = Math.PI / 2;
  ceilCorr.position.set(0, WORLD.wallH, (WORLD.lobbyBackZ + WORLD.corrEndZ) / 2);
  group.add(ceilCorr);

  // ================= LOBBY WALLS =================
  addTwoToneWall(group, mats, -WORLD.lobbyHalfW, WORLD.lobbyBackZ, WORLD.lobbyFrontZ, WORLD.lobbyWallH, 0.14, false);
  addTwoToneWall(group, mats, WORLD.lobbyHalfW, WORLD.lobbyBackZ, WORLD.lobbyFrontZ, WORLD.lobbyWallH, 0.14, false);

  // back wall of lobby (with a corridor opening in the middle)
  const backWallSpan = (WORLD.lobbyHalfW - WORLD.corrHalfW);
  [-1, 1].forEach(side => {
    const wSeg = new THREE.Mesh(new THREE.BoxGeometry(backWallSpan, WORLD.lobbyWallH, 0.14), mats.cream);
    wSeg.position.set(side * (WORLD.corrHalfW + backWallSpan / 2), WORLD.lobbyWallH / 2, WORLD.lobbyBackZ);
    wSeg.castShadow = true; wSeg.receiveShadow = true;
    group.add(wSeg);
    const band = new THREE.Mesh(new THREE.BoxGeometry(backWallSpan, WORLD.bandH, 0.16), mats.terracotta);
    band.position.set(side * (WORLD.corrHalfW + backWallSpan / 2), WORLD.bandH / 2, WORLD.lobbyBackZ);
    group.add(band);
  });
  // lintel above the corridor opening
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(WORLD.corrHalfW * 2 + 0.3, WORLD.lobbyWallH - WORLD.wallH + 0.1, 0.16), mats.doorFrame);
  lintel.position.set(0, WORLD.wallH + (WORLD.lobbyWallH - WORLD.wallH) / 2, WORLD.lobbyBackZ);
  group.add(lintel);

  // front wall (entrance) with glass doors
  const frontSpan = WORLD.lobbyHalfW - 1.3;
  [-1, 1].forEach(side => {
    const wSeg = new THREE.Mesh(new THREE.BoxGeometry(frontSpan, WORLD.lobbyWallH, 0.14), mats.wood);
    wSeg.position.set(side * (1.3 + frontSpan / 2), WORLD.lobbyWallH / 2, WORLD.lobbyFrontZ);
    wSeg.castShadow = true; wSeg.receiveShadow = true;
    group.add(wSeg);
  });
  addWindow(group, mats, -0.68, WORLD.lobbyFrontZ, 0, 1.0, 2.1);
  addWindow(group, mats, 0.68, WORLD.lobbyFrontZ, 0, 1.0, 2.1);
  const entranceLintel = new THREE.Mesh(new THREE.BoxGeometry(2.7, WORLD.lobbyWallH - 2.2, 0.16), mats.wood);
  entranceLintel.position.set(0, 2.2 + (WORLD.lobbyWallH - 2.2) / 2, WORLD.lobbyFrontZ);
  group.add(entranceLintel);

  // wood-panel accent strip along lobby walls (over the two-tone wall built above)
  [-WORLD.lobbyHalfW, WORLD.lobbyHalfW].forEach(x => {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.02, WORLD.lobbyWallH * 0.62, WORLD.lobbyFrontZ - WORLD.lobbyBackZ - 0.4), mats.wood);
    panel.position.set(x - Math.sign(x) * 0.075, WORLD.lobbyWallH * 0.31, (WORLD.lobbyFrontZ + WORLD.lobbyBackZ) / 2);
    group.add(panel);
  });

  // lobby furnishings
  addReceptionDesk(group, mats, WORLD.lobbyHalfW - 1.5, 3.4, Math.PI / 2 * -1 + Math.PI);
  addNoticeBoard(group, mats, -WORLD.lobbyHalfW + 0.09, 6.0, Math.PI / 2);
  addSofa(group, mats, -WORLD.lobbyHalfW + 1.0, 1.2, Math.PI / 2, 1.7);
  addSofa(group, mats, WORLD.lobbyHalfW - 1.6, -0.6, -Math.PI / 2, 1.5);
  addPillarPlanter(group, mats, -1.6, 3.0);
  addPillarPlanter(group, mats, 1.6, 3.0);
  addCeilingLight(group, mats, -1.6, 5.5, 1.4);
  addCeilingLight(group, mats, 1.6, 5.5, 1.4);
  addLocker(group, mats, WORLD.lobbyHalfW - 0.3, 6.3, -Math.PI / 2);
  addLocker(group, mats, WORLD.lobbyHalfW - 0.3, 6.85, -Math.PI / 2);

  // ================= CORRIDOR =================
  addTwoToneWall(group, mats, -WORLD.corrHalfW, WORLD.corrEndZ, WORLD.lobbyBackZ, WORLD.wallH, 0.14, true);
  addTwoToneWall(group, mats, WORLD.corrHalfW, WORLD.corrEndZ, WORLD.lobbyBackZ, WORLD.wallH, 0.14, true);

  // end wall with a window nook (matches the video's corridor terminus)
  const endWall = new THREE.Mesh(new THREE.BoxGeometry(WORLD.corrHalfW * 2, WORLD.wallH, 0.14), mats.cream);
  endWall.position.set(0, WORLD.wallH / 2, WORLD.corrEndZ);
  group.add(endWall);
  const endBand = new THREE.Mesh(new THREE.BoxGeometry(WORLD.corrHalfW * 2, WORLD.bandH, 0.16), mats.terracotta);
  endBand.position.set(0, WORLD.bandH / 2, WORLD.corrEndZ);
  group.add(endBand);
  addWindow(group, mats, 0, WORLD.corrEndZ + 0.05, 0, 1.3, 1.3);

  // doors down both sides + signage + ceiling lights + a few notice boards / lockers.
  // Wider spacing (and a shared/cached sign texture) than the original pass —
  // fewer meshes and far fewer unique canvas textures, which matters a lot
  // for low-end/mobile GPUs and this dev sandbox's software renderer alike.
  const doorSpacing = 5.6;
  let di = 0;
  for (let z = WORLD.lobbyBackZ - 1.4; z > WORLD.corrEndZ + 1.4; z -= doorSpacing) {
    const roomNum = 101 + di * 2;
    addDoor(group, mats, -WORLD.corrHalfW + 0.075, z, 1, { rotY: Math.PI / 2, sign: String(roomNum), signBg: '#7a1f22', signFg: '#f5e9c8' });
    addDoor(group, mats, WORLD.corrHalfW - 0.075, z, -1, { rotY: -Math.PI / 2, sign: String(roomNum + 1), signBg: '#7a1f22', signFg: '#f5e9c8' });
    if (di % 2 === 0) addCeilingLight(group, mats, 0, z - doorSpacing / 2, 1.2);
    if (di === 1) addNoticeBoard(group, mats, WORLD.corrHalfW - 0.075, z + 0.9, -Math.PI / 2);
    if (di === 2) addLocker(group, mats, -WORLD.corrHalfW + 0.28, z + 1.0, Math.PI / 2);
    if (di === 2) addLocker(group, mats, -WORLD.corrHalfW + 0.28, z + 1.5, Math.PI / 2);
    di++;
  }

  return group;
}
