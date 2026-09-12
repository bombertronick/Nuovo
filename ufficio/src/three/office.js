/**
 * three/office.js — Lo studio: pavimento, vetrate, scrivanie, lavagna,
 * angolo caffè e tavolo riunioni. Tutto costruito a mano, stile "casa di bambole"
 * (senza soffitto) così la camera può girare liberamente.
 */

import * as THREE from 'three';
import { LAYOUT } from '../config.js';
import { roundedBox, toon, flat, part, floorTexture, skyTexture, labelTexture, noteTexture, toonGradient } from './utils.js';

const SPHERE = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);

export function createOffice() {
  const group = new THREE.Group();
  const anchors = { desks: [], meeting: [], coffee: null, door: null, director: null };
  const screens = [];
  const plates = [];

  /* ---------------------------------------------------------------- *
   * Pavimento e tappeti
   * ---------------------------------------------------------------- */
  const { width, depth } = LAYOUT.floor;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshToonMaterial({ map: floorTexture() }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // battiscopa: chiude visivamente il pavimento
  const skirt = new THREE.Mesh(roundedBox(width + 0.4, 0.3, depth + 0.4, 0.1), toon('#d9c3a6'));
  skirt.position.y = -0.16;
  group.add(skirt);

  const rug = new THREE.Mesh(new THREE.CircleGeometry(4.2, 40), toon('#f3c9b4'));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(LAYOUT.meeting.x, 0.02, LAYOUT.meeting.z);
  rug.receiveShadow = true;
  group.add(rug);
  const rugRing = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.85, 40), toon('#e9a98d'));
  rugRing.rotation.x = -Math.PI / 2;
  rugRing.position.set(LAYOUT.meeting.x, 0.025, LAYOUT.meeting.z);
  group.add(rugRing);

  /* ---------------------------------------------------------------- *
   * Pareti e vetrate
   * ---------------------------------------------------------------- */
  const wallMat = toon('#f3ede4');
  const H = LAYOUT.wallHeight;

  const back = new THREE.Mesh(roundedBox(width, H, 0.4, 0.06), wallMat);
  back.position.set(0, H / 2, -depth / 2);
  back.receiveShadow = true;
  group.add(back);

  const left = new THREE.Mesh(roundedBox(0.4, H, depth, 0.06), wallMat);
  left.position.set(-width / 2, H / 2, 0);
  left.receiveShadow = true;
  group.add(left);

  // fascia colorata a metà parete
  const stripe = new THREE.Mesh(roundedBox(width - 0.2, 1.1, 0.06, 0.03), toon('#dfe7f5'));
  stripe.position.set(0, 1.5, -depth / 2 + 0.22);
  group.add(stripe);

  // cielo dietro le vetrate
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(width + 12, H + 10), new THREE.MeshBasicMaterial({ map: skyTexture() }));
  sky.position.set(0, H / 2, -depth / 2 - 3);
  group.add(sky);
  const clouds = [];
  for (let i = 0; i < 5; i += 1) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 3; j += 1) {
      const puff = new THREE.Mesh(SPHERE(0.8 + Math.random() * 0.5, 12, 10), flat('#ffffff'));
      puff.position.set(j * 0.9 - 0.9, Math.sin(j) * 0.2, 0);
      cloud.add(puff);
    }
    cloud.position.set(-16 + i * 8, 3.6 + Math.random() * 2.4, -depth / 2 - 2.4);
    cloud.userData.speed = 0.12 + Math.random() * 0.16;
    group.add(cloud);
    clouds.push(cloud);
  }

  // tre grandi finestre sulla parete di fondo
  for (let i = -1; i <= 1; i += 1) {
    const win = new THREE.Group();
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 3.4),
      new THREE.MeshBasicMaterial({ color: 0xdcefff, transparent: true, opacity: 0.55 }),
    );
    const frame = new THREE.Mesh(roundedBox(6.9, 3.9, 0.24, 0.08), toon('#ffffff'));
    frame.position.z = -0.16;
    const barV = new THREE.Mesh(roundedBox(0.14, 3.5, 0.2, 0.04), toon('#ffffff'));
    const barH = new THREE.Mesh(roundedBox(6.5, 0.14, 0.2, 0.04), toon('#ffffff'));
    const sill = new THREE.Mesh(roundedBox(7.1, 0.2, 0.5, 0.06), toon('#eadfd0'));
    sill.position.y = -2.05;
    win.add(frame, glass, barV, barH, sill);
    win.position.set(i * 8.6, 3.4, -depth / 2 + 0.22);
    group.add(win);
  }

  /* ---------------------------------------------------------------- *
   * Lavagna con i post-it degli incarichi
   * ---------------------------------------------------------------- */
  const boardGroup = new THREE.Group();
  boardGroup.position.set(-width / 2 + 0.32, 3.1, LAYOUT.whiteboard.z);
  boardGroup.rotation.y = Math.PI / 2;
  const boardFrame = new THREE.Mesh(roundedBox(7.6, 4, 0.18, 0.08), toon('#cbb89c'));
  const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.6), flat('#fbfcff'));
  boardFace.position.z = 0.1;
  const boardTitle = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 0.5),
    new THREE.MeshBasicMaterial({ map: labelTexture('BACHECA', { bg: '#fbfcff', fg: '#4f8cff', ratio: 6 }), transparent: true }),
  );
  boardTitle.position.set(-1.7, 1.4, 0.11);
  boardGroup.add(boardFrame, boardFace, boardTitle);
  group.add(boardGroup);

  const notes = [];
  for (let i = 0; i < 12; i += 1) {
    const note = new THREE.Mesh(
      roundedBox(1.15, 0.92, 0.05, 0.04),
      new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient() }),
    );
    const col = i % 4;
    const row = Math.floor(i / 4);
    note.position.set(-2.55 + col * 1.42, 0.5 - row * 1.06, 0.14);
    note.rotation.z = (Math.random() - 0.5) * 0.12;
    note.castShadow = true;
    note.visible = false;
    boardGroup.add(note);
    notes.push(note);
  }

  /* ---------------------------------------------------------------- *
   * Scrivanie
   * ---------------------------------------------------------------- */
  LAYOUT.desks.forEach((spot, index) => {
    // La fila in fondo è girata: chi ci siede guarda verso la sala (e verso di noi),
    // mentre la fila davanti mostra gli schermi. Come in un open space vero.
    const flipped = spot.z < 0;
    const desk = buildDesk(index, flipped);
    desk.group.position.set(spot.x, 0, spot.z);
    group.add(desk.group);
    screens.push(desk.screen);
    plates.push(desk.plate);
    const side = flipped ? -1 : 1;
    anchors.desks.push({
      seat: new THREE.Vector3(spot.x, 0, spot.z + 1.0 * side),
      rotation: flipped ? 0 : Math.PI,          // sempre rivolti al proprio monitor
      visit: new THREE.Vector3(spot.x + 1.7, 0, spot.z + 1.5 * side),
    });
  });

  /* ---------------------------------------------------------------- *
   * Sala riunioni
   * ---------------------------------------------------------------- */
  const { x: mx, z: mz, radius } = LAYOUT.meeting;
  const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.16, 36), toon('#e6c79c'));
  tableTop.position.set(mx, 0.74, mz);
  tableTop.castShadow = true; tableTop.receiveShadow = true;
  const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 0.74, 18), toon('#b08968'));
  tableLeg.position.set(mx, 0.37, mz);
  tableLeg.castShadow = true;
  group.add(tableTop, tableLeg);

  // centrotavola
  const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.34, 14), toon('#7cc4e8'));
  vase.position.set(mx, 0.99, mz);
  group.add(vase);
  for (let i = 0; i < 4; i += 1) {
    const leaf = new THREE.Mesh(SPHERE(0.2, 12, 10), toon('#4fae6e'));
    leaf.position.set(mx + Math.cos(i * 1.6) * 0.18, 1.25 + i * 0.09, mz + Math.sin(i * 1.6) * 0.18);
    leaf.scale.set(1, 0.7, 1);
    group.add(leaf);
  }

  const POSTI = 9;
  for (let i = 0; i < POSTI; i += 1) {
    const a = (i / POSTI) * Math.PI * 2 + Math.PI / 7;
    const sx = mx + Math.cos(a) * (radius + 1.15);
    const sz = mz + Math.sin(a) * (radius + 1.15);
    const stool = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 16), toon('#f0a48c'));
    seat.position.y = 0.5; seat.castShadow = true;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), toon('#8b93a7'));
    pole.position.y = 0.25;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 14), toon('#8b93a7'));
    foot.position.y = 0.03;
    stool.add(seat, pole, foot);
    stool.position.set(sx, 0, sz);
    group.add(stool);
    anchors.meeting.push({
      seat: new THREE.Vector3(mx + Math.cos(a) * (radius + 1.5), 0, mz + Math.sin(a) * (radius + 1.5)),
      rotation: Math.atan2(mx - sx, mz - sz),
    });
  }

  /* ---------------------------------------------------------------- *
   * Postazione della Direttrice
   * ---------------------------------------------------------------- */
  const dir = new THREE.Group();
  dir.position.set(LAYOUT.directorSpot.x, 0, LAYOUT.directorSpot.z);
  const podium = new THREE.Mesh(roundedBox(2.6, 0.9, 1.2, 0.14), toon('#d97757'));
  podium.position.set(0, 0.45, -0.9);
  podium.castShadow = true; podium.receiveShadow = true;
  const podiumTop = new THREE.Mesh(roundedBox(2.9, 0.12, 1.5, 0.06), toon('#f5d0b8'));
  podiumTop.position.set(0, 0.94, -0.9);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 0.42),
    new THREE.MeshBasicMaterial({ map: labelTexture('DIREZIONE', { bg: '#d97757', fg: '#fff6f0', ratio: 6 }) }),
  );
  sign.position.set(0, 0.55, -0.29);
  dir.add(podium, podiumTop, sign);
  group.add(dir);
  anchors.director = { seat: new THREE.Vector3(LAYOUT.directorSpot.x, 0, LAYOUT.directorSpot.z + 0.4), rotation: Math.PI * 0.92 };

  /* ---------------------------------------------------------------- *
   * Angolo caffè
   * ---------------------------------------------------------------- */
  const coffee = new THREE.Group();
  coffee.position.set(LAYOUT.coffee.x, 0, LAYOUT.coffee.z);
  const counter = new THREE.Mesh(roundedBox(2.6, 1.0, 0.9, 0.12), toon('#cdd7e8'));
  counter.position.y = 0.5; counter.castShadow = true; counter.receiveShadow = true;
  const machine = new THREE.Mesh(roundedBox(0.8, 0.9, 0.6, 0.1), toon('#3b405e'));
  machine.position.set(-0.6, 1.45, 0); machine.castShadow = true;
  const machineFace = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.28), flat('#8fd0ff'));
  machineFace.position.set(-0.6, 1.68, 0.31);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8), toon('#8b93a7'));
  spout.position.set(-0.6, 1.16, 0.18);
  coffee.add(counter, machine, machineFace, spout);
  for (let i = 0; i < 3; i += 1) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.16, 12), toon('#ffffff'));
    cup.position.set(0.35 + i * 0.3, 1.08, -0.1 + (i % 2) * 0.25);
    cup.castShadow = true;
    coffee.add(cup);
  }
  group.add(coffee);
  anchors.coffee = { seat: new THREE.Vector3(LAYOUT.coffee.x + 0.2, 0, LAYOUT.coffee.z + 1.3), rotation: Math.PI };

  /* ---------------------------------------------------------------- *
   * Porta d'ingresso
   * ---------------------------------------------------------------- */
  const doorGroup = new THREE.Group();
  doorGroup.position.set(LAYOUT.door.x, 0, LAYOUT.door.z);
  const wallPanel = new THREE.Mesh(roundedBox(0.4, 4.2, 6.4, 0.1), wallMat);
  wallPanel.position.set(0, 2.1, 0);
  wallPanel.receiveShadow = true;
  const jamb = new THREE.Mesh(roundedBox(0.52, 3.5, 2.4, 0.1), toon('#b08968'));
  jamb.position.y = 1.75;
  const panel = new THREE.Mesh(roundedBox(0.18, 3.05, 1.9, 0.08), toon('#8fb8e8'));
  panel.position.set(-0.2, 1.55, 0);
  const glassDoor = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 1.1),
    new THREE.MeshBasicMaterial({ color: 0xdcefff, transparent: true, opacity: 0.6 }),
  );
  glassDoor.position.set(-0.31, 2.1, 0);
  glassDoor.rotation.y = -Math.PI / 2;
  const knob = new THREE.Mesh(SPHERE(0.08, 10, 8), toon('#f2b441'));
  knob.position.set(-0.32, 1.5, 0.66);
  const insegna = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.42),
    new THREE.MeshBasicMaterial({ map: labelTexture('AGENT OFFICE', { bg: '#f3ede4', fg: '#d97757', ratio: 6 }) }),
  );
  insegna.position.set(-0.22, 3.6, 0);
  insegna.rotation.y = -Math.PI / 2;
  doorGroup.add(wallPanel, jamb, panel, glassDoor, knob, insegna);
  group.add(doorGroup);
  anchors.door = { seat: new THREE.Vector3(LAYOUT.door.x - 1.6, 0, LAYOUT.door.z), rotation: -Math.PI / 2 };

  /* ---------------------------------------------------------------- *
   * Verde, libreria, lampade
   * ---------------------------------------------------------------- */
  [[-13.4, -9.6], [12.8, -10.2], [13.6, 2.4], [-13.8, 2.2], [2.4, 9.6]].forEach(([x, z], i) => {
    const plant = buildPlant(0.9 + (i % 3) * 0.25);
    plant.position.set(x, 0, z);
    group.add(plant);
  });

  const shelf = new THREE.Group();
  shelf.position.set(-14.2, 0, 6.2);
  shelf.rotation.y = Math.PI / 2;
  const shelfBody = new THREE.Mesh(roundedBox(3.2, 2.4, 0.6, 0.08), toon('#c59d72'));
  shelfBody.position.y = 1.2; shelfBody.castShadow = true;
  shelf.add(shelfBody);
  for (let r = 0; r < 2; r += 1) {
    for (let b = 0; b < 9; b += 1) {
      const book = new THREE.Mesh(
        roundedBox(0.14 + Math.random() * 0.06, 0.5 + Math.random() * 0.2, 0.42, 0.02),
        toon(['#f97066', '#4f8cff', '#31c48d', '#f2b441', '#a78bfa'][b % 5]),
      );
      book.position.set(-1.35 + b * 0.31, 0.6 + r * 1.1, 0.05);
      book.rotation.z = Math.random() < 0.2 ? 0.2 : 0;
      shelf.add(book);
    }
  }
  group.add(shelf);

  const lamps = [];
  [[-7, -2], [0, -2], [7, -2], [LAYOUT.meeting.x, LAYOUT.meeting.z]].forEach(([x, z]) => {
    const lamp = new THREE.Group();
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), toon('#5b6072'));
    wire.position.y = 6.45;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.55, 20, 1, true), toon('#ffffff', { side: THREE.DoubleSide }));
    shade.position.y = 5.62;
    const bulb = new THREE.Mesh(SPHERE(0.16, 12, 10), flat('#fff3c4'));
    bulb.position.y = 5.44;
    lamp.add(wire, shade, bulb);
    lamp.position.set(x, 0, z);
    group.add(lamp);
    lamps.push(lamp);
  });

  /* ---------------------------------------------------------------- *
   * API della scena
   * ---------------------------------------------------------------- */
  const clock = { t: 0 };

  return {
    group,
    anchors,

    /** Post-it sulla lavagna: uno per incarico non completato. */
    updateBoard(tasks) {
      notes.forEach((note, i) => {
        const task = tasks[i];
        note.visible = Boolean(task);
        if (!task) return;
        const firma = `${task.title}|${task.color}`;
        if (note.userData.firma === firma) return;
        note.userData.firma = firma;
        note.material.map?.dispose();
        note.material.map = noteTexture(task.title, task.color);
        note.material.needsUpdate = true;
      });
    },

    /** Targhetta con il nome sulla scrivania. */
    setDeskLabel(index, name, color) {
      const plate = plates[index];
      if (!plate) return;
      plate.visible = Boolean(name);
      if (!name) return;
      if (plate.material.map) plate.material.map.dispose();
      plate.material.map = labelTexture(name, { bg: '#fffaf2', fg: color || '#4f8cff', ratio: 4 });
      plate.material.needsUpdate = true;
    },

    /** Attività dei monitor: righe di codice che scorrono quando si lavora. */
    setScreenActive(index, active, color) {
      const screen = screens[index];
      if (screen) { screen.active = active; screen.color = color || '#4f8cff'; }
    },

    update(dt) {
      clock.t += dt;
      clouds.forEach((cloud) => {
        cloud.position.x += cloud.userData.speed * dt;
        if (cloud.position.x > 20) cloud.position.x = -20;
      });
      screens.forEach((screen) => screen.tick(dt, clock.t));
      notes.forEach((note, i) => {
        if (note.visible) note.position.y += Math.sin(clock.t * 1.4 + i) * 0.0006;
      });
    },
  };
}

/* ------------------------------------------------------------------ *
 * Pezzi d'arredo
 * ------------------------------------------------------------------ */

function buildDesk(index, facesRoom = false) {
  const group = new THREE.Group();
  const topColor = ['#f6e2c8', '#eddcc6'][index % 2];
  // `side` = da che parte della scrivania siede l'agente.
  // facesRoom: siede sul lato lontano e guarda la sala (vediamo la faccia, lui usa un portatile).
  const side = facesRoom ? -1 : 1;

  const top = new THREE.Mesh(roundedBox(2.8, 0.14, 1.5, 0.06), toon(topColor));
  top.position.y = 0.78;
  top.castShadow = true; top.receiveShadow = true;
  group.add(top);

  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(roundedBox(0.14, 0.78, 1.3, 0.05), toon('#c0c7d6'));
    leg.position.set(1.25 * s, 0.39, 0);
    leg.castShadow = true;
    group.add(leg);
  }

  const drawer = new THREE.Mesh(roundedBox(0.7, 0.66, 1.1, 0.08), toon('#8fb8e8'));
  drawer.position.set(-0.95, 0.35, -0.1 * side);
  drawer.castShadow = true;
  group.add(drawer);

  const canvas = document.createElement('canvas');
  canvas.width = 192; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  if (facesRoom) {
    // Portatile: schermo basso e inclinato, non copre il viso di chi ci lavora.
    const laptop = new THREE.Group();
    laptop.position.set(0.1, 0.85, -0.2);
    const base = new THREE.Mesh(roundedBox(1.02, 0.05, 0.7, 0.03), toon('#dfe5f2'));
    base.castShadow = true;
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.5), flat('#c3ccdf'));
    keys.rotation.x = -Math.PI / 2;
    keys.position.set(0, 0.03, 0.08);
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.02, -0.32);
    lidPivot.rotation.x = -1.16;
    const lid = part(roundedBox(1.02, 0.62, 0.05, 0.03), toon('#cfd8ea'), { outlineScale: 1.05 });
    lid.position.y = 0.3;
    lid.castShadow = true;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ map: tex }));
    glass.position.set(0, 0.3, 0.03);
    lidPivot.add(lid, glass);
    laptop.add(base, keys, lidPivot);
    group.add(laptop);

    const mug = part(new THREE.CylinderGeometry(0.1, 0.085, 0.18, 14), toon('#f97066'), { outlineScale: 1.09 });
    mug.position.set(-0.95, 0.94, -0.4);
    mug.castShadow = true;
    const papers = new THREE.Mesh(roundedBox(0.44, 0.03, 0.6, 0.01), toon('#ffffff'));
    papers.position.set(1.05, 0.87, 0.2);
    papers.rotation.y = -0.3;
    const penHolder = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 12), toon('#7c6cf0'));
    penHolder.position.set(1.15, 0.96, -0.35);
    group.add(mug, papers, penHolder);
  } else {
    const monitorGroup = new THREE.Group();
    monitorGroup.position.set(0.25, 0.85, -0.45);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), toon('#5b6072'));
    stand.position.y = 0.15;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.05, 16), toon('#5b6072'));
    base.position.y = 0.02;
    const shell = part(roundedBox(1.5, 0.95, 0.1, 0.06), toon('#3b405e'), { outlineScale: 1.04 });
    shell.position.y = 0.78;
    shell.castShadow = true;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.82), new THREE.MeshBasicMaterial({ map: tex }));
    glass.position.set(0, 0.78, 0.055);
    monitorGroup.add(stand, base, shell, glass);
    group.add(monitorGroup);

    const keyboard = new THREE.Mesh(roundedBox(1.1, 0.05, 0.4, 0.03), toon('#e6eaf4'));
    keyboard.position.set(0.25, 0.87, 0.3);
    keyboard.castShadow = true;
    const mouse = new THREE.Mesh(SPHERE(0.09, 12, 10), toon('#e6eaf4'));
    mouse.scale.set(1, 0.6, 1.3);
    mouse.position.set(1.05, 0.88, 0.3);
    const mug = part(new THREE.CylinderGeometry(0.1, 0.085, 0.18, 14), toon('#f97066'), { outlineScale: 1.09 });
    mug.position.set(-0.5, 0.94, 0.35);
    mug.castShadow = true;
    const papers = new THREE.Mesh(roundedBox(0.44, 0.03, 0.6, 0.01), toon('#ffffff'));
    papers.position.set(1.05, 0.87, -0.3);
    papers.rotation.y = 0.3;
    group.add(keyboard, mouse, mug, papers);
  }

  const screen = {
    active: false,
    color: '#4f8cff',
    next: 0,
    tick(dt, time) {
      this.next -= dt;
      if (this.next > 0) return;
      this.next = this.active ? 0.28 : 1.6;
      drawScreen(ctx, canvas, this.active, this.color, time);
      tex.needsUpdate = true;
    },
  };
  drawScreen(ctx, canvas, false, '#4f8cff', 0);
  tex.needsUpdate = true;

  // targhetta col nome, sempre sul bordo rivolto alla sala
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.21),
    new THREE.MeshBasicMaterial({ transparent: true }),
  );
  plate.position.set(facesRoom ? -0.98 : 0.98, 0.88, 0.5);
  plate.rotation.x = -1.02;
  plate.visible = false;
  group.add(plate);

  // sedia dal lato giusto
  const chair = new THREE.Group();
  chair.position.set(0, 0, 1.0 * side);
  chair.rotation.y = facesRoom ? Math.PI : 0;
  const seat = part(roundedBox(0.78, 0.14, 0.72, 0.08), toon('#7c6cf0'), { outlineScale: 1.06 });
  seat.position.y = 0.54; seat.castShadow = true;
  const backRest = part(roundedBox(0.74, 0.8, 0.14, 0.1), toon('#7c6cf0'), { outlineScale: 1.05 });
  backRest.position.set(0, 0.96, 0.32);
  backRest.rotation.x = 0.12;
  backRest.castShadow = true;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.52, 10), toon('#5b6072'));
  pole.position.y = 0.28;
  chair.add(seat, backRest, pole);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = new THREE.Mesh(roundedBox(0.42, 0.06, 0.1, 0.03), toon('#5b6072'));
    spoke.position.set(Math.cos(a) * 0.2, 0.07, Math.sin(a) * 0.2);
    spoke.rotation.y = -a;
    chair.add(spoke);
    const wheel = new THREE.Mesh(SPHERE(0.06, 8, 6), toon('#3b405e'));
    wheel.position.set(Math.cos(a) * 0.4, 0.06, Math.sin(a) * 0.4);
    chair.add(wheel);
  }
  group.add(chair);

  return { group, screen, plate };
}

function drawScreen(ctx, canvas, active, color, time) {
  const w = canvas.width; const h = canvas.height;
  ctx.fillStyle = active ? '#141a2e' : '#1c2236';
  ctx.fillRect(0, 0, w, h);
  // barra del titolo
  ctx.fillStyle = '#0e1424';
  ctx.fillRect(0, 0, w, 14);
  ['#f97066', '#f2b441', '#31c48d'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(10 + i * 12, 7, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  const rows = 9;
  for (let i = 0; i < rows; i += 1) {
    const seed = Math.sin((i + Math.floor(time * (active ? 3 : 0.3))) * 12.9898) * 43758.5453;
    const frac = seed - Math.floor(seed);
    const len = 16 + frac * (w - 50);
    ctx.fillStyle = i % 4 === 0 ? color : `rgba(200,214,255,${active ? 0.55 : 0.25})`;
    ctx.fillRect(10, 24 + i * 11, len, 5);
  }
  if (active) {
    ctx.fillStyle = color;
    ctx.fillRect(12 + (Math.floor(time * 4) % 5) * 9, 24 + 8 * 11, 6, 6);
  }
}

function buildPlant(scale = 1) {
  const plant = new THREE.Group();
  const pot = new THREE.Mesh(roundedBox(0.7, 0.7, 0.7, 0.12), toon('#e08b6d'));
  pot.position.y = 0.35; pot.castShadow = true;
  plant.add(pot);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), toon('#6b4a32'));
  soil.position.y = 0.7;
  plant.add(soil);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const leaf = new THREE.Mesh(SPHERE(0.34, 12, 10), toon(i % 2 ? '#4fae6e' : '#3f9a60'));
    leaf.scale.set(0.6, 1.45, 0.6);
    leaf.position.set(Math.cos(a) * 0.26, 1.05 + (i % 3) * 0.22, Math.sin(a) * 0.26);
    leaf.rotation.z = Math.cos(a) * 0.45;
    leaf.rotation.x = -Math.sin(a) * 0.45;
    leaf.castShadow = true;
    plant.add(leaf);
  }
  plant.scale.setScalar(scale);
  return plant;
}
