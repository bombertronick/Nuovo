/**
 * three/world.js — Il mondo: camera, luci, avatar, spostamenti e targhette.
 *
 * È l'unico modulo che "vede" contemporaneamente lo stato dell'ufficio e la
 * scena 3D: legge `state.agents`, muove i personaggi verso la destinazione
 * dichiarata dall'orchestratore e riporta gli arrivi (`body.at`).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from '../store.js';
import { ROLES, DIRECTOR, STATUS_META, LAYOUT } from '../config.js';
import { createCharacter } from './character.js';
import { createOffice } from './office.js';
import { damp, shortestAngle, skyTexture } from './utils.js';

const WALK_SPEED = 3.3;
const ARRIVE_EPS = 0.12;

/** Corsie libere fra le file di scrivanie (per non attraversare i mobili). */
const LANE_FRONT = 5.6;
const LANE_MID = -1.8;
const LANE_BACK = -8.6;
const CORRIDORS = [-13.4, -8, -3, 2, 7, 13];

const VIEWS = {
  panoramica: { pos: [-0.5, 9, 14.5], target: [-1.5, 1.3, -3.6] },
  scrivanie: { pos: [-4.5, 4.6, 5.5], target: [-4.5, 1.3, -4.2] },
  riunione: { pos: [17, 8.5, 4.5], target: [10.5, 1.1, -4.6] },
  direzione: { pos: [15, 5.5, 13], target: [10.5, 1.5, 3.5] },
  lavagna: { pos: [-4.5, 5.2, 3.5], target: [-14.2, 2.9, -2] },
};

export function createWorld(canvas, labelLayer) {
  /* ---------------------------------------------------------------- *
   * Renderer, scena, camera
   * ---------------------------------------------------------------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = skyTexture('#cfe6ff', '#ffeede');
  scene.fog = new THREE.Fog(0xe9eefb, 42, 78);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(...VIEWS.panoramica.pos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(...VIEWS.panoramica.target);
  controls.minDistance = 6;
  controls.maxDistance = 42;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minPolarAngle = Math.PI * 0.08;
  controls.enablePan = true;
  controls.screenSpacePanning = false;

  /* ---------------------------------------------------------------- *
   * Luci: chiare, morbide, da cartone animato
   * ---------------------------------------------------------------- */
  scene.add(new THREE.HemisphereLight(0xfdf6ff, 0xd8c7ae, 1.05));
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  const sun = new THREE.DirectionalLight(0xfff3df, 1.55);
  sun.position.set(-11, 17, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.028;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0xbcd7ff, 0.5);
  fill.position.set(14, 9, -10);
  scene.add(fill);

  /* ---------------------------------------------------------------- *
   * Ufficio + avatar
   * ---------------------------------------------------------------- */
  const office = createOffice();
  scene.add(office.group);

  /** Avatar della Direttrice. */
  const directorAvatar = spawn(DIRECTOR.look, state.director.id, 1.06);
  const anchorDir = office.anchors.director;
  directorAvatar.root.position.copy(anchorDir.seat);
  directorAvatar.root.rotation.y = anchorDir.rotation;
  directorAvatar.setStatusColor('#d97757');

  const avatars = new Map();       // agentId -> avatar
  avatars.set(state.director.id, directorAvatar);

  function spawn(look, id, scale = 1) {
    const char = createCharacter(look, { scale });
    char.root.userData.agentId = id;
    char.root.traverse((o) => { o.userData.agentId = id; });
    scene.add(char.root);
    return char;
  }

  function ensureAvatars() {
    state.agents.forEach((agent) => {
      if (avatars.has(agent.id)) return;
      const look = ROLES[agent.role].look;
      const char = spawn(look, agent.id);
      const from = agent.body.at === 'ingresso' ? office.anchors.door.seat : deskAnchor(agent).seat;
      char.root.position.copy(from);
      char.root.rotation.y = Math.PI;
      char.path = [];
      avatars.set(agent.id, char);
      makeLabel(agent.id);
    });
    // rimuove gli avatar di chi non c'è più
    avatars.forEach((char, id) => {
      if (id === state.director.id) return;
      if (state.agents.some((a) => a.id === id)) return;
      scene.remove(char.root);
      avatars.delete(id);
      removeLabel(id);
    });
  }

  /* ---------------------------------------------------------------- *
   * Destinazioni
   * ---------------------------------------------------------------- */
  function deskAnchor(agent) {
    return office.anchors.desks[agent.deskIndex % office.anchors.desks.length];
  }

  function meetingAnchor(agent) {
    const seats = office.anchors.meeting;
    const index = state.agents.indexOf(agent);
    return seats[(index + 1) % seats.length];   // il posto 0 resta alla Direttrice
  }

  function goalAnchor(who) {
    const goal = who.body.goal;
    if (who.id === state.director.id) {
      if (goal === 'riunione') return office.anchors.meeting[0];
      if (goal.startsWith('visita:')) {
        const target = state.agents.find((a) => a.id === goal.slice(7));
        return target ? deskAnchor(target) : office.anchors.director;
      }
      return office.anchors.director;
    }
    if (goal === 'riunione') return meetingAnchor(who);
    if (goal === 'caffe') return office.anchors.coffee;
    if (goal === 'uscita') return office.anchors.door;
    if (goal.startsWith('visita:')) {
      const target = state.agents.find((a) => a.id === goal.slice(7));
      if (target) {
        const anchor = deskAnchor(target);
        return { seat: anchor.visit, rotation: anchor.rotation + Math.PI * 0.75 };
      }
    }
    return deskAnchor(who);
  }

  /** Corsia libera più vicina a una certa profondità. */
  const laneFor = (z) => {
    if (z >= 3.2) return LANE_FRONT;
    if (z >= -4.4) return LANE_MID;
    return LANE_BACK;
  };

  /** Percorso a "L" che evita scrivanie e mobili. */
  function route(from, to) {
    const points = [];
    const laneA = laneFor(from.z);
    const laneB = laneFor(to.z);
    const openColumn = from.x > 6.8 || from.x < -12.2 || to.x > 6.8 || to.x < -12.2;

    if (Math.abs(from.z - to.z) < 0.4 || (laneA === laneB && Math.abs(from.x - to.x) < 0.4)) {
      points.push(to.clone());
      return points;
    }

    // Si esce sempre sulla corsia di partenza, poi si cambia banda in un
    // corridoio libero fra le scrivanie, e solo alla fine ci si avvicina al posto.
    if (Math.abs(from.z - laneA) > 0.35) points.push(new THREE.Vector3(from.x, 0, laneA));

    if (laneA === laneB) {
      points.push(new THREE.Vector3(to.x, 0, laneA));
    } else {
      const col = openColumn
        ? ((from.x > 6.8 || from.x < -12.2) ? from.x : to.x)
        : CORRIDORS.reduce((best, c) => (Math.abs(c - to.x) < Math.abs(best - to.x) ? c : best), CORRIDORS[0]);
      points.push(new THREE.Vector3(col, 0, laneA));
      points.push(new THREE.Vector3(col, 0, laneB));
      points.push(new THREE.Vector3(to.x, 0, laneB));
    }
    points.push(to.clone());
    return points;
  }

  /* ---------------------------------------------------------------- *
   * Movimento e animazione dei personaggi
   * ---------------------------------------------------------------- */
  const tmp = new THREE.Vector3();

  function moveCharacter(who, char, dt) {
    const anchor = goalAnchor(who);
    const goalKey = who.body.goal;

    if (char.goalKey !== goalKey) {
      char.goalKey = goalKey;
      char.path = route(char.root.position, anchor.seat);
      char.pathIndex = 0;
      if (char.root.position.distanceTo(anchor.seat) > ARRIVE_EPS) who.body.at = 'in_movimento';
    }

    const arrived = !char.path || char.pathIndex >= char.path.length;
    if (arrived) {
      who.body.at = goalKey;
      char.walkSpeed = damp(char.walkSpeed, 0, 8, dt);
      // si allinea dolcemente alla posa prevista dall'ancora
      char.root.position.x = damp(char.root.position.x, anchor.seat.x, 6, dt);
      char.root.position.z = damp(char.root.position.z, anchor.seat.z, 6, dt);
      const delta = shortestAngle(char.root.rotation.y, anchor.rotation);
      char.root.rotation.y += delta * Math.min(1, dt * 7);
      return false;
    }

    const target = char.path[char.pathIndex];
    tmp.copy(target).sub(char.root.position);
    tmp.y = 0;
    const dist = tmp.length();
    if (dist < ARRIVE_EPS) {
      char.pathIndex += 1;
      return true;
    }
    tmp.normalize();
    const step = Math.min(WALK_SPEED * Math.min(dt, 0.2), dist);
    char.root.position.addScaledVector(tmp, step);
    char.walkSpeed = damp(char.walkSpeed, 1, 8, dt);

    const facing = Math.atan2(tmp.x, tmp.z);
    const delta = shortestAngle(char.root.rotation.y, facing);
    char.root.rotation.y += delta * Math.min(1, dt * 6);
    return true;
  }

  /** Che animazione mostrare, dato lo stato logico dell'agente. */
  function animationFor(agent, walking) {
    if (walking) return 'cammina';
    if (agent._celebrate > 0) return 'festeggia';
    switch (agent.status) {
      case 'lavora': return agent.taskId ? 'digita' : 'idle';
      case 'revisione': return 'revisiona';
      case 'bloccato': return 'bloccato';
      case 'caffe': return 'caffe';
      case 'riunione': return 'parla';
      case 'attesa': return 'pensa';
      default: return agent.energy < 0.25 ? 'dorme' : 'idle';
    }
  }

  const BADGES = {
    lavora: '⚙️', revisione: '🔍', bloccato: '⛔', caffe: '☕',
    riunione: '💬', attesa: '⏳', inattivo: '', cammina: '',
  };

  /* ---------------------------------------------------------------- *
   * Targhette HTML sopra i personaggi
   * ---------------------------------------------------------------- */
  const labels = new Map();

  function makeLabel(id) {
    if (labels.has(id)) return labels.get(id);
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = `
      <div class="tag-bubble" hidden></div>
      <div class="tag-card">
        <span class="tag-name"></span>
        <span class="tag-role"></span>
        <span class="tag-bar"><i></i></span>
      </div>`;
    el.addEventListener('click', () => select(id));
    labelLayer.appendChild(el);
    const entry = {
      el,
      bubble: el.querySelector('.tag-bubble'),
      name: el.querySelector('.tag-name'),
      role: el.querySelector('.tag-role'),
      bar: el.querySelector('.tag-bar i'),
    };
    labels.set(id, entry);
    return entry;
  }

  function removeLabel(id) {
    const entry = labels.get(id);
    if (!entry) return;
    entry.el.remove();
    labels.delete(id);
  }

  const projected = new THREE.Vector3();

  function updateLabel(who, char, task) {
    const entry = labels.get(who.id) || makeLabel(who.id);
    projected.copy(char.root.position);
    projected.y += 2.32 * (char.root.scale.x || 1);
    projected.project(camera);

    const visible = projected.z < 1;
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    entry.el.style.transform = `translate(-50%,-100%) translate(${(projected.x * 0.5 + 0.5) * w}px, ${(-projected.y * 0.5 + 0.5) * h}px)`;
    entry.el.classList.toggle('is-hidden', !visible);
    entry.el.classList.toggle('is-selected', state.selectedAgentId === who.id);

    const meta = STATUS_META[task?.status] || null;
    const isDirector = who.id === state.director.id;
    entry.name.textContent = who.name;
    entry.role.textContent = isDirector ? '👑 Direttrice' : `${ROLES[who.role].emoji} ${ROLES[who.role].short}`;
    entry.el.style.setProperty('--tag-color', isDirector ? '#d97757' : (meta?.color || '#8b93a7'));
    const pct = task ? Math.round((task.work / task.workTotal) * 100) : 0;
    entry.bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    entry.el.classList.toggle('has-bar', Boolean(task));

    if (who.say) {
      entry.bubble.hidden = false;
      entry.bubble.textContent = who.say.text;
    } else {
      entry.bubble.hidden = true;
    }
  }

  /* ---------------------------------------------------------------- *
   * Selezione e camera
   * ---------------------------------------------------------------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let onSelect = () => {};
  let pressedAt = null;

  function select(id) {
    state.selectedAgentId = state.selectedAgentId === id ? null : id;
    onSelect(state.selectedAgentId);
    if (state.selectedAgentId) focusOn(state.selectedAgentId);
  }

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    pressedAt = { x: ev.clientX, y: ev.clientY };
  });

  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!pressedAt) return;
    const moved = Math.hypot(ev.clientX - pressedAt.x, ev.clientY - pressedAt.y);
    pressedAt = null;
    if (moved > 6) return;                 // era una rotazione della camera
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const roots = [...avatars.values()].map((c) => c.root);
    const hit = raycaster.intersectObjects(roots, true)[0];
    const id = hit?.object?.userData?.agentId;
    if (id && id !== state.director.id) select(id);
    else if (!id) { state.selectedAgentId = null; onSelect(null); }
  });

  let hoverTimer = 0;
  renderer.domElement.addEventListener('pointermove', (ev) => {
    const now = performance.now();
    if (now - hoverTimer < 90) return;
    hoverTimer = now;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const roots = [...avatars.values()].map((c) => c.root);
    const hit = raycaster.intersectObjects(roots, true)[0];
    renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
  });

  /** Su schermi stretti/verticali la camera si allontana: ci sta più scena. */
  function aspectFactor() {
    const aspect = camera.aspect || 1.6;
    return Math.max(1, Math.min(1.45, 1.15 / Math.max(0.4, aspect)));
  }

  /** Transizione morbida della camera. */
  const tween = { active: false, t: 0, dur: 1.1, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTarget: new THREE.Vector3(), toTarget: new THREE.Vector3() };

  function flyTo(pos, target, dur = 1.1) {
    const k = aspectFactor();
    if (k > 1.001) {
      // Ci si allontana soprattutto in orizzontale: alzare la camera
      // riempirebbe l'inquadratura di cielo e pavimento.
      const off = pos.clone().sub(target);
      off.x *= k; off.z *= k; off.y *= 1 + (k - 1) * 0.3;
      target = target.clone();
      target.y += (k - 1) * 3.2;          // si mira più in alto: meno pavimento vuoto
      pos = target.clone().add(off);
    }
    tween.active = true;
    tween.t = 0;
    tween.dur = dur;
    tween.fromPos.copy(camera.position);
    tween.toPos.copy(pos);
    tween.fromTarget.copy(controls.target);
    tween.toTarget.copy(target);
  }

  function setView(name) {
    const view = VIEWS[name] || VIEWS.panoramica;
    flyTo(new THREE.Vector3(...view.pos), new THREE.Vector3(...view.target));
  }

  function focusOn(agentId) {
    const char = avatars.get(agentId);
    if (!char) return;
    const p = char.root.position;
    // si mette davanti al personaggio, leggermente di lato: si vede la faccia
    const yaw = char.root.rotation.y;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const pos = new THREE.Vector3(
      p.x + fx * 4.4 + fz * 2.0,
      2.6,
      p.z + fz * 4.4 - fx * 2.0,
    );
    flyTo(pos, new THREE.Vector3(p.x + fx * 0.35, 1.32, p.z + fz * 0.35), 0.95);
  }

  function updateTween(dt) {
    if (!tween.active) return;
    tween.t += dt / tween.dur;
    const t = Math.min(1, tween.t);
    const e = t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;  // easeInOutCubic
    camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
    if (t >= 1) tween.active = false;
  }

  /* ---------------------------------------------------------------- *
   * Ridimensionamento
   * ---------------------------------------------------------------- */
  function resize() {
    const parent = renderer.domElement.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 56 : 42;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  {
    const view = VIEWS.panoramica;
    const target = new THREE.Vector3(...view.target);
    const pos = new THREE.Vector3(...view.pos);
    const k = aspectFactor();
    const off = pos.sub(target);
    off.x *= k; off.z *= k; off.y *= 1 + (k - 1) * 0.3;
    target.y += (k - 1) * 3.2;
    camera.position.copy(target.clone().add(off));
    controls.target.copy(target);
  }

  /* ---------------------------------------------------------------- *
   * Ciclo di disegno
   * ---------------------------------------------------------------- */
  let time = 0;

  function update(dt) {
    // Gli spostamenti seguono la velocità della simulazione: in pausa l'ufficio
    // si congela, a 4× tutti si muovono davvero più in fretta.
    const sdt = dt * state.speed;
    time += sdt;
    ensureAvatars();
    office.update(dt);

    state.agents.forEach((agent) => {
      const char = avatars.get(agent.id);
      if (!char) return;
      const walking = moveCharacter(agent, char, sdt);
      const seated = !walking && agent.body.goal === 'scrivania'
        && ['lavora', 'revisione', 'inattivo', 'bloccato', 'attesa'].includes(agent.status);
      char.setSeated(seated);
      char.setAnim(animationFor(agent, walking));
      const task = agent.taskId ? state.tasks.find((t) => t.id === agent.taskId) : null;
      const meta = STATUS_META[task?.status];
      char.setStatusColor(agent.status === 'bloccato' ? '#f97066' : (meta?.color || '#8b93a7'));
      char.setBadge(walking ? '' : (BADGES[agent.status] ?? ''));
      char.update(sdt, time);
      updateLabel(agent, char, task);

      office.setScreenActive(agent.deskIndex, seated && agent.status === 'lavora', meta?.color);
    });

    // La Direttrice
    const dirWalking = moveCharacter(state.director, directorAvatar, sdt);
    directorAvatar.setSeated(false);
    directorAvatar.setAnim(dirWalking ? 'cammina' : (state.director.say ? 'parla' : 'idle'));
    directorAvatar.update(sdt, time);
    updateLabel(state.director, directorAvatar, null);

    updateTween(dt);
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    update,
    resize,
    setView,
    focusOn,
    office,
    onSelect(fn) { onSelect = fn; },
    setDeskLabel: (i, name, color) => office.setDeskLabel(i, name, color),
    updateBoard: (tasks) => office.updateBoard(tasks),
    get renderer() { return renderer; },
  };
}
