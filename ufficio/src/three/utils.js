/**
 * three/utils.js — Mattoncini grafici condivisi.
 *
 * Tutto è procedurale: nessun modello, nessuna texture esterna.
 * Lo stile è "cartone animato": volumi arrotondati, ombreggiatura a fasce
 * (toon) e contorno scuro sulle silhouette.
 */

import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ *
 * Geometrie
 * ------------------------------------------------------------------ */

const roundedCache = new Map();

/** Box con spigoli smussati: la forma base di quasi tutto l'arredo. */
export function roundedBox(w, h, d, r = 0.12, seg = 4) {
  const key = `${w}|${h}|${d}|${r}|${seg}`;
  if (roundedCache.has(key)) return roundedCache.get(key);

  const radius = Math.min(r, w / 2, h / 2, d / 2);
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = geo.attributes.position;
  const inner = new THREE.Vector3(
    Math.max(w / 2 - radius, 0),
    Math.max(h / 2 - radius, 0),
    Math.max(d / 2 - radius, 0),
  );
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  const dir = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    c.set(clamp(v.x, -inner.x, inner.x), clamp(v.y, -inner.y, inner.y), clamp(v.z, -inner.z, inner.z));
    dir.copy(v).sub(c);
    if (dir.lengthSq() > 1e-8) {
      dir.normalize().multiplyScalar(radius);
      v.copy(c).add(dir);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  roundedCache.set(key, geo);
  return geo;
}

/* ------------------------------------------------------------------ *
 * Materiali toon
 * ------------------------------------------------------------------ */

let gradientMap = null;

/** Rampa a 4 gradini: dà la classica ombreggiatura "a fasce" dei cartoni. */
export function toonGradient() {
  if (gradientMap) return gradientMap;
  const steps = new Uint8Array([96, 152, 208, 255]);
  gradientMap = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const matCache = new Map();

/** Materiale toon condiviso per colore (riuso aggressivo = poche draw call). */
export function toon(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (matCache.has(key)) return matCache.get(key);
  const mat = new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    gradientMap: toonGradient(),
    ...opts,
  });
  matCache.set(key, mat);
  return mat;
}

/** Materiale piatto e luminoso (schermi, spie, emissivi). */
export function flat(color, opts = {}) {
  const key = `flat|${color}|${JSON.stringify(opts)}`;
  if (matCache.has(key)) return matCache.get(key);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), ...opts });
  matCache.set(key, mat);
  return mat;
}

const OUTLINE_COLOR = 0x1a1d2e;
let outlineMat = null;

function outlineMaterial() {
  if (!outlineMat) {
    outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  }
  return outlineMat;
}

/**
 * Contorno cartoon: una copia della mesh leggermente ingrossata e vista da dentro.
 * Semplice, robusto e senza post-processing.
 */
export function addOutline(mesh, scale = 1.055) {
  const shell = new THREE.Mesh(mesh.geometry, outlineMaterial());
  shell.scale.setScalar(scale);
  shell.castShadow = false;
  shell.receiveShadow = false;
  shell.userData.isOutline = true;
  mesh.add(shell);
  return mesh;
}

/** Mesh + contorno in una riga. */
export function part(geometry, material, { outline = true, shadow = true, outlineScale = 1.055 } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  if (outline) addOutline(mesh, outlineScale);
  return mesh;
}

/* ------------------------------------------------------------------ *
 * Texture procedurali
 * ------------------------------------------------------------------ */

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Macchia morbida sotto i personaggi: ancora le figure al pavimento. */
export function contactShadowTexture() {
  return canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(24,28,48,0.55)');
    g.addColorStop(0.55, 'rgba(24,28,48,0.22)');
    g.addColorStop(1, 'rgba(24,28,48,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Parquet chiaro a doghe: ripetuto sul pavimento. */
export function floorTexture() {
  const tex = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#e8d9c3';
    ctx.fillRect(0, 0, s, s);
    const plank = s / 8;
    for (let i = 0; i < 8; i += 1) {
      const shade = 0.93 + ((i * 37) % 11) / 100;
      ctx.fillStyle = `rgba(214,188,152,${0.35 * shade})`;
      ctx.fillRect(0, i * plank, s, plank - 2);
      ctx.strokeStyle = 'rgba(160,128,92,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, i * plank + plank - 1);
      ctx.lineTo(s, i * plank + plank - 1);
      ctx.stroke();
      // giunzioni verticali sfalsate
      const offset = (i % 2) * (s / 4);
      for (let j = 0; j < 3; j += 1) {
        const x = offset + j * (s / 3);
        ctx.beginPath();
        ctx.moveTo(x, i * plank);
        ctx.lineTo(x, i * plank + plank);
        ctx.stroke();
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 9);
  return tex;
}

/** Sfondo a gradiente: cielo sereno dietro le vetrate. */
export function skyTexture(top = '#bfe3ff', bottom = '#ffeede') {
  const canvas = document.createElement('canvas');
  canvas.width = 8; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Post-it della lavagna: colore del tipo di incarico + titolo a capo. */
export function noteTexture(title, color = '#ffd76e') {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 208;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 208);
  // piega d'angolo, per farlo sembrare carta
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.moveTo(256, 152); ctx.lineTo(256, 208); ctx.lineTo(196, 208); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(88, 8, 80, 20);   // pezzetto di nastro adesivo

  ctx.fillStyle = '#25293f';
  ctx.font = '700 26px "Trebuchet MS", system-ui, sans-serif';
  ctx.textAlign = 'center';
  const parole = String(title).split(/\s+/);
  const righe = [];
  let riga = '';
  parole.forEach((parola) => {
    const prova = riga ? `${riga} ${parola}` : parola;
    if (ctx.measureText(prova).width > 216 && riga) { righe.push(riga); riga = parola; } else riga = prova;
  });
  if (riga) righe.push(riga);
  const mostrate = righe.slice(0, 4);
  if (righe.length > 4) mostrate[3] = `${mostrate[3].slice(0, 12)}…`;
  mostrate.forEach((r, i) => ctx.fillText(r, 128, 74 + i * 30));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Etichetta testuale su piano (targhe scrivania, lavagna, insegne). */
export function labelTexture(text, { bg = '#ffffff', fg = '#22263c', size = 256, ratio = 4 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size * ratio; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = fg;
  ctx.font = `700 ${size * 0.5}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + size * 0.03);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ------------------------------------------------------------------ *
 * Piccole matematiche
 * ------------------------------------------------------------------ */

export const lerp = (a, b, t) => a + (b - a) * t;

/** Smorzamento indipendente dal frame rate (per camera e movimenti morbidi). */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function shortestAngle(from, to) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}
