/**
 * three/character.js — I "dipendenti": personaggi 3D costruiti a mano.
 *
 * Proporzioni da cartone animato (testa grande, arti corti), scheletro con
 * bacino/ginocchia/spalle/gomiti e animazioni interamente procedurali:
 * niente file di animazione, solo seni, coseni e smorzamenti.
 */

import * as THREE from 'three';
import { roundedBox, toon, flat, part, damp, contactShadowTexture } from './utils.js';

const CAPSULE = (r, len, cap = 6, rad = 12) => new THREE.CapsuleGeometry(r, len, cap, rad);
const SPHERE = (r, w = 20, h = 16) => new THREE.SphereGeometry(r, w, h);

let shadowTex = null;
const badgeCache = new Map();

/** Bollino fluttuante sopra la testa (sempre rivolto alla camera). */
function badgeSprite(emoji) {
  if (!badgeCache.has(emoji)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#1a1d2e';
    ctx.stroke();
    ctx.font = '62px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 70);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    badgeCache.set(emoji, tex);
  }
  const mat = new THREE.SpriteMaterial({ map: badgeCache.get(emoji), transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(0.42);
  return sprite;
}

/* ------------------------------------------------------------------ *
 * Costruzione del personaggio
 * ------------------------------------------------------------------ */

export function createCharacter(look, { scale = 1 } = {}) {
  const root = new THREE.Group();
  root.scale.setScalar(scale);

  const skin = toon(look.skin);
  const cloth = toon(look.body);
  const accent = toon(look.accent);
  const hairMat = toon(look.hair);
  const dark = toon('#2b2f45');

  /* --- gambe ------------------------------------------------------ */
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.15 * side, 0.62, 0);
    const thigh = part(CAPSULE(0.105, 0.18), dark);
    thigh.position.y = -0.15;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.3;
    const shin = part(CAPSULE(0.095, 0.16), dark);
    shin.position.y = -0.14;
    knee.add(shin);

    const foot = part(roundedBox(0.2, 0.11, 0.3, 0.05), toon('#3b405e'));
    foot.position.set(0, -0.28, 0.06);
    knee.add(foot);

    hip.add(knee);
    root.add(hip);
    legs.push({ hip, knee });
  }

  /* --- busto ------------------------------------------------------ */
  const torso = new THREE.Group();
  torso.position.y = 0.62;
  root.add(torso);

  const chest = part(roundedBox(0.68, 0.66, 0.44, 0.2, 5), cloth);
  chest.position.y = 0.3;
  torso.add(chest);

  // Colletto/spallina in tinta chiara: stacca la figura dallo sfondo.
  const collar = part(CAPSULE(0.2, 0.04), accent, { outlineScale: 1.03 });
  collar.rotation.z = Math.PI / 2;
  collar.position.y = 0.6;
  torso.add(collar);

  /* --- braccia ---------------------------------------------------- */
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.36 * side, 0.5, 0);
    const upper = part(CAPSULE(0.085, 0.16), cloth);
    upper.position.y = -0.13;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.26;
    const fore = part(CAPSULE(0.075, 0.14), skin);
    fore.position.y = -0.12;
    elbow.add(fore);
    const hand = part(SPHERE(0.1, 14, 12), skin);
    hand.position.y = -0.24;
    elbow.add(hand);
    shoulder.add(elbow);

    torso.add(shoulder);
    arms.push({ shoulder, elbow, hand });
  }

  /* --- testa ------------------------------------------------------ */
  const head = new THREE.Group();
  head.position.y = 0.76;
  head.scale.setScalar(0.9);
  torso.add(head);

  const skull = part(SPHERE(0.37, 26, 20), skin);
  skull.scale.set(1, 0.98, 0.95);
  head.add(skull);

  // occhi
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(0.135 * side, 0.05, 0.315);
    const white = new THREE.Mesh(SPHERE(0.075, 16, 12), flat('#ffffff'));
    white.scale.set(1, 1.12, 0.55);
    eye.add(white);
    const pupil = new THREE.Mesh(SPHERE(0.042, 14, 10), flat('#1e2233'));
    pupil.position.set(0, 0, 0.045);
    pupil.scale.set(1, 1.1, 0.7);
    eye.add(pupil);
    const glint = new THREE.Mesh(SPHERE(0.015, 8, 6), flat('#ffffff'));
    glint.position.set(0.02, 0.022, 0.075);
    eye.add(glint);
    head.add(eye);
    eyes.push(eye);
  }

  // sopracciglia
  const brows = [];
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(roundedBox(0.13, 0.03, 0.04, 0.014), flat(look.hair));
    brow.position.set(0.14 * side, 0.17, 0.32);
    brow.rotation.z = -0.14 * side;
    head.add(brow);
    brows.push(brow);
  }

  // bocca (sorriso): mezzo toro
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 18, Math.PI), flat('#8e3b45'));
  mouth.position.set(0, -0.1, 0.315);
  mouth.rotation.set(0, 0, Math.PI);
  head.add(mouth);

  // guance
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(SPHERE(0.055, 10, 8), flat('#f7a9a0', { transparent: true, opacity: 0.5 }));
    cheek.position.set(0.21 * side, -0.04, 0.26);
    cheek.scale.set(1, 0.7, 0.4);
    head.add(cheek);
  }

  addHair(head, look, hairMat);
  addHat(head, look, toon, accent);
  if (look.accessory === 'occhiali') addGlasses(head);

  /* --- anello di stato + ombra ------------------------------------ */
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x31c48d, transparent: true, opacity: 0.9 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 8, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  root.add(ring);

  if (!shadowTex) shadowTex = contactShadowTexture();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.9 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  root.add(shadow);

  /* --- oggetti di scena ------------------------------------------- */
  const mug = new THREE.Group();
  const mugBody = part(new THREE.CylinderGeometry(0.075, 0.065, 0.13, 14), toon('#ffffff'), { outlineScale: 1.08 });
  const mugHandle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.016, 6, 12), toon('#ffffff'));
  mugHandle.position.set(0.085, 0, 0);
  mugHandle.rotation.y = Math.PI / 2;
  mug.add(mugBody, mugHandle);
  mug.position.set(0, -0.3, 0.06);
  mug.visible = false;
  arms[1].elbow.add(mug);

  const tablet = new THREE.Group();
  const slab = part(roundedBox(0.36, 0.26, 0.025, 0.03), toon('#e8ecf8'), { outlineScale: 1.05 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), flat('#8fd0ff'));
  screen.position.z = 0.016;
  tablet.add(slab, screen);
  tablet.position.set(0, -0.28, 0.12);
  tablet.rotation.set(-0.9, 0, 0);
  tablet.visible = look.accessory === 'tablet';
  arms[0].elbow.add(tablet);

  const badge = badgeSprite('⚙️');
  badge.position.set(0, 1.98, 0);
  badge.visible = false;
  root.add(badge);

  /* --- stato di animazione ---------------------------------------- */
  const pose = {
    torsoY: 0.62, lean: 0, headPitch: 0, headYaw: 0, rootY: 0,
    armLX: 0.1, armLZ: 0.12, elbowLX: -0.15,
    armRX: 0.1, armRZ: -0.12, elbowRX: -0.15,
    thighL: 0, kneeL: 0, thighR: 0, kneeR: 0,
  };
  const current = { ...pose };

  const api = {
    root,
    head,
    torso,
    ring,
    badge,
    anim: 'idle',
    phase: Math.random() * Math.PI * 2,
    blinkIn: 1 + Math.random() * 3,
    blink: 0,
    seated: false,
    walkSpeed: 0,
    currentBadge: '',

    setAnim(name) { api.anim = name; },
    setSeated(v) { api.seated = v; },

    setStatusColor(hex) { ringMat.color.set(hex); },

    setBadge(emoji) {
      if (emoji === api.currentBadge) return;
      api.currentBadge = emoji;
      if (!emoji) { badge.visible = false; return; }
      badge.visible = true;
      badge.material.map = badgeSprite(emoji).material.map;
      badge.material.needsUpdate = true;
    },

    update(dt, time) {
      api.phase += dt;
      computePose(api, pose, time, { mug, tablet, look });

      const k = 12;
      for (const key of Object.keys(pose)) current[key] = damp(current[key], pose[key], k, dt);

      torso.position.y = current.torsoY;
      torso.rotation.x = current.lean;
      root.position.y = current.rootY;
      head.rotation.x = current.headPitch;
      head.rotation.y = current.headYaw;

      arms[0].shoulder.rotation.x = current.armLX;
      arms[0].shoulder.rotation.z = current.armLZ;
      arms[0].elbow.rotation.x = current.elbowLX;
      arms[1].shoulder.rotation.x = current.armRX;
      arms[1].shoulder.rotation.z = current.armRZ;
      arms[1].elbow.rotation.x = current.elbowRX;

      legs[0].hip.rotation.x = current.thighL;
      legs[0].knee.rotation.x = current.kneeL;
      legs[1].hip.rotation.x = current.thighR;
      legs[1].knee.rotation.x = current.kneeR;

      // battito di ciglia
      api.blinkIn -= dt;
      if (api.blinkIn <= 0) { api.blink = 0.14; api.blinkIn = 2.4 + Math.random() * 4; }
      if (api.blink > 0) {
        api.blink -= dt;
        const s = Math.max(0.08, Math.abs(Math.sin((api.blink / 0.14) * Math.PI)));
        eyes.forEach((e) => e.scale.set(1, s, 1));
      } else {
        eyes.forEach((e) => e.scale.set(1, 1, 1));
      }

      badge.position.y = (api.seated ? 1.82 : 1.98) + Math.sin(api.phase * 2.2) * 0.05;
      shadow.material.opacity = 0.9 - current.rootY * 0.6;
    },
  };

  return api;
}

/* ------------------------------------------------------------------ *
 * Capigliature e copricapi
 * ------------------------------------------------------------------ */

function addHair(head, look, hairMat) {
  const style = look.hairStyle || 'corti';
  const cap = part(new THREE.SphereGeometry(0.385, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.52), hairMat, { outlineScale: 1.04 });
  cap.position.set(0, 0.02, -0.02);

  if (style === 'afro') {
    const afro = part(SPHERE(0.46, 20, 16), hairMat, { outlineScale: 1.03 });
    afro.position.y = 0.1;
    afro.scale.set(1, 0.92, 1);
    head.add(afro);
    return;
  }

  head.add(cap);

  if (style === 'chignon') {
    const bun = part(SPHERE(0.16, 14, 12), hairMat, { outlineScale: 1.05 });
    bun.position.set(0, 0.24, -0.28);
    head.add(bun);
  } else if (style === 'coda') {
    const tail = part(CAPSULE(0.09, 0.26), hairMat, { outlineScale: 1.05 });
    tail.position.set(0, 0.04, -0.36);
    tail.rotation.x = -0.35;
    head.add(tail);
  } else if (style === 'caschetto') {
    for (const side of [-1, 1]) {
      const lock = part(roundedBox(0.12, 0.3, 0.24, 0.06), hairMat, { outlineScale: 1.04 });
      lock.position.set(0.31 * side, -0.06, -0.06);
      head.add(lock);
    }
  } else if (style === 'lunghi') {
    for (const side of [-1, 1]) {
      const lock = part(roundedBox(0.13, 0.46, 0.26, 0.07), hairMat, { outlineScale: 1.04 });
      lock.position.set(0.3 * side, -0.16, -0.02);
      head.add(lock);
    }
    const back = part(roundedBox(0.4, 0.36, 0.16, 0.08), hairMat, { outlineScale: 1.04 });
    back.position.set(0, -0.14, -0.28);
    head.add(back);
  } else if (style === 'riccio') {
    for (let i = 0; i < 5; i += 1) {
      const curl = part(SPHERE(0.16, 12, 10), hairMat, { outlineScale: 1.05 });
      const a = (i / 5) * Math.PI * 2;
      curl.position.set(Math.cos(a) * 0.24, 0.2 + Math.sin(i) * 0.05, Math.sin(a) * 0.2);
      head.add(curl);
    }
  }
}

function addHat(head, look, toonFn, accent) {
  if (look.hat === 'casco') {
    const shell = part(new THREE.SphereGeometry(0.4, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), toonFn('#f2b441'));
    shell.position.y = 0.08;
    const brim = part(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 20), toonFn('#f2b441'), { outlineScale: 1.03 });
    brim.position.y = 0.09;
    const crest = part(roundedBox(0.06, 0.1, 0.7, 0.03), toonFn('#e09b1f'), { outlineScale: 1.05 });
    crest.position.y = 0.32;
    head.add(shell, brim, crest);
  } else if (look.hat === 'cuffie' || look.accessory === 'cuffie') {
    const band = part(new THREE.TorusGeometry(0.39, 0.045, 8, 20, Math.PI), toonFn('#2b2f45'), { outlineScale: 1.05 });
    band.rotation.set(0, Math.PI / 2, 0);
    band.position.y = 0.06;
    head.add(band);
    for (const side of [-1, 1]) {
      const cup = part(roundedBox(0.1, 0.2, 0.18, 0.06), toonFn('#2b2f45'), { outlineScale: 1.06 });
      cup.position.set(0.37 * side, 0.02, 0);
      head.add(cup);
      const pad = new THREE.Mesh(SPHERE(0.06, 10, 8), accent);
      pad.position.set(0.42 * side, 0.02, 0);
      pad.scale.set(0.5, 1, 1);
      head.add(pad);
    }
  } else if (look.hat === 'basco') {
    const beret = part(new THREE.SphereGeometry(0.4, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), toonFn('#1f2937'));
    beret.scale.set(1.05, 0.55, 1.05);
    beret.position.y = 0.2;
    const nub = part(SPHERE(0.05, 10, 8), toonFn('#1f2937'), { outlineScale: 1.08 });
    nub.position.y = 0.42;
    head.add(beret, nub);
  }
}

function addGlasses(head) {
  const frame = toon('#2b2f45');
  for (const side of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.018, 8, 18), frame);
    lens.position.set(0.135 * side, 0.05, 0.33);
    head.add(lens);
    const glassPane = new THREE.Mesh(
      new THREE.CircleGeometry(0.1, 18),
      new THREE.MeshBasicMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.35 }),
    );
    glassPane.position.set(0.135 * side, 0.05, 0.332);
    head.add(glassPane);
  }
  const bridge = new THREE.Mesh(roundedBox(0.08, 0.016, 0.016, 0.008), frame);
  bridge.position.set(0, 0.05, 0.335);
  head.add(bridge);
}

/* ------------------------------------------------------------------ *
 * Pose: una funzione per ogni stato d'animo
 * ------------------------------------------------------------------ */

function computePose(api, p, time, props) {
  const t = api.phase;
  const breath = Math.sin(t * 1.9) * 0.02;

  // valori di riposo
  p.rootY = 0;
  p.lean = 0;
  p.headPitch = 0;
  p.headYaw = Math.sin(t * 0.6) * 0.12;
  p.armLX = 0.1; p.armLZ = 0.14; p.elbowLX = -0.2;
  p.armRX = 0.1; p.armRZ = -0.14; p.elbowRX = -0.2;
  p.thighL = 0; p.thighR = 0; p.kneeL = 0; p.kneeR = 0;
  p.torsoY = 0.62 + breath;

  props.mug.visible = api.anim === 'caffe';
  props.tablet.visible = props.look.accessory === 'tablet' && api.anim !== 'cammina';

  if (api.seated) {
    // seduto: cosce in avanti, stinchi a terra, busto più basso
    p.torsoY = 0.58 + breath;
    p.thighL = -Math.PI / 2 + 0.06; p.thighR = -Math.PI / 2 - 0.04;
    p.kneeL = Math.PI / 2 - 0.08; p.kneeR = Math.PI / 2 - 0.05;
  }

  switch (api.anim) {
    case 'cammina': {
      const s = 6.2 * Math.max(0.4, api.walkSpeed);
      const swing = Math.sin(t * s);
      p.thighL = swing * 0.62;
      p.thighR = -swing * 0.62;
      p.kneeL = Math.max(0, -swing) * 0.85;
      p.kneeR = Math.max(0, swing) * 0.85;
      p.armLX = -swing * 0.55; p.elbowLX = -0.5;
      p.armRX = swing * 0.55; p.elbowRX = -0.5;
      p.rootY = Math.abs(Math.sin(t * s)) * 0.055;
      p.lean = 0.08;
      p.torsoY = 0.62;
      break;
    }
    case 'digita': {
      const tap = Math.sin(t * 13) * 0.09;
      p.headPitch = 0.15;
      p.headYaw = Math.sin(t * 1.2) * 0.06;
      p.armLX = -1.02 + tap; p.armLZ = 0.3; p.elbowLX = -0.78;
      p.armRX = -1.02 - tap; p.armRZ = -0.3; p.elbowRX = -0.78;
      p.lean = 0.07;
      break;
    }
    case 'pensa': {
      p.headPitch = 0.18;
      p.headYaw = 0.35 + Math.sin(t * 0.9) * 0.12;
      p.armRX = -2.1; p.armRZ = -0.45; p.elbowRX = -1.75;
      p.armLX = -0.3; p.armLZ = 0.5; p.elbowLX = -1.2;
      p.lean = 0.06;
      break;
    }
    case 'festeggia': {
      const j = Math.abs(Math.sin(t * 6.5));
      p.rootY = j * 0.28;
      p.armLX = 2.8 + Math.sin(t * 9) * 0.2; p.armLZ = 0.5;
      p.armRX = 2.8 - Math.sin(t * 9) * 0.2; p.armRZ = -0.5;
      p.elbowLX = -0.2; p.elbowRX = -0.2;
      p.headPitch = -0.25;
      p.torsoY = api.seated ? 0.62 : 0.64;
      p.thighL = 0; p.thighR = 0; p.kneeL = 0; p.kneeR = 0;
      break;
    }
    case 'parla': {
      p.headPitch = Math.sin(t * 7) * 0.05;
      p.armRX = -0.9 + Math.sin(t * 4.5) * 0.25; p.armRZ = -0.45; p.elbowRX = -1.1;
      p.armLX = -0.35; p.armLZ = 0.35; p.elbowLX = -0.7;
      break;
    }
    case 'bloccato': {
      p.headPitch = 0.42;
      p.headYaw = Math.sin(t * 3.4) * 0.28;
      p.lean = 0.2;
      p.armLX = 0.34; p.armLZ = 0.34; p.elbowLX = -0.1;
      p.armRX = 0.34; p.armRZ = -0.34; p.elbowRX = -0.1;
      p.torsoY = (api.seated ? 0.54 : 0.58) + breath * 0.5;
      break;
    }
    case 'caffe': {
      const sip = (Math.sin(t * 1.8) + 1) / 2;
      p.armRX = -1.5 - sip * 0.9; p.armRZ = -0.35; p.elbowRX = -1.5 - sip * 0.5;
      p.headPitch = -0.1 + sip * 0.18;
      p.armLX = 0.1; p.armLZ = 0.2;
      break;
    }
    case 'dorme': {
      p.headPitch = 0.5;
      p.lean = 0.12;
      p.torsoY = (api.seated ? 0.53 : 0.58) + Math.sin(t * 0.8) * 0.03;
      p.armLX = 0.2; p.armRX = 0.2;
      break;
    }
    case 'revisiona': {
      p.headPitch = 0.16;
      p.headYaw = Math.sin(t * 2.4) * 0.3;
      p.armLX = -1.25; p.armLZ = 0.32; p.elbowLX = -0.95;
      p.armRX = -1.1; p.armRZ = -0.28; p.elbowRX = -1.1;
      p.lean = 0.12;
      break;
    }
    default: { // idle
      p.armLX = 0.08 + Math.sin(t * 1.6) * 0.06;
      p.armRX = 0.08 - Math.sin(t * 1.6) * 0.06;
      break;
    }
  }
}
