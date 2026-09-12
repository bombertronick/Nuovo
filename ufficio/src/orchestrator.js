/**
 * orchestrator.js — Il cervello dell'ufficio: la Direttrice al lavoro.
 *
 * Smista gli incarichi in base all'affinità dei ruoli, apre le revisioni,
 * sblocca chi è fermo, convoca le riunioni e tiene i conti.
 * Non sa nulla di three.js: muove gli agenti dichiarando una *destinazione*
 * (`agent.body.goal`) e attende che il mondo 3D segnali l'arrivo (`body.at`).
 */

import {
  ROLES, TASK_STATUS, TASK_TYPES, PRIORITIES, SIM, PHRASES, DIRECTOR_LINES, MAX_AGENTS,
} from './config.js';
import {
  state, createAgent, createTask, getAgent, getTask, log, save, emit, agentTask,
} from './store.js';
import { SimulatedBackend, EndpointBackend, techLine } from './backends.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let backend = new SimulatedBackend();
let planCooldown = 0;
let chatterCooldown = 6;

export function getBackend() { return backend; }

export function setBackend(mode, endpoint = '') {
  if (mode === 'endpoint' && endpoint) {
    backend = new EndpointBackend(endpoint);
    state.mode = 'endpoint';
    state.endpoint = endpoint;
    log({ kind: 'direttrice', who: 'Claude', text: `Collego la squadra all'endpoint ${endpoint}.` });
  } else {
    backend = new SimulatedBackend();
    state.mode = 'simulazione';
    log({ kind: 'direttrice', who: 'Claude', text: 'Torniamo in modalità simulazione locale.' });
  }
  save();
  emit('mode', state.mode);
}

/* ------------------------------------------------------------------ *
 * Nuvolette
 * ------------------------------------------------------------------ */

export function say(who, text, seconds = 3.4) {
  if (!who || !text) return;
  who.say = { text, until: state.clock + seconds };
  emit('say', { id: who.id, text });
}

const directorSays = (text, seconds = 4) => say(state.director, text, seconds);

/* ------------------------------------------------------------------ *
 * Disponibilità e affinità
 * ------------------------------------------------------------------ */

/** Un agente è libero se è alla scrivania, senza incarico e senza commissioni. */
export function isFree(agent) {
  return !agent.errand && !agent.taskId && !agent.reviewTaskId && agent.status === 'inattivo';
}

export function affinity(agent, task) {
  const role = ROLES[agent.role];
  if (!role) return 0;
  const skill = role.skills[task.type] ?? 0.3;
  return skill * (0.65 + 0.35 * agent.energy) * (0.9 + 0.2 * agent.mood);
}

function bestAgentFor(task) {
  const candidates = state.agents.filter(isFree);
  if (!candidates.length) return null;
  let best = null; let bestScore = -1;
  for (const agent of candidates) {
    const score = affinity(agent, task) + Math.random() * 0.08;
    if (score > bestScore) { bestScore = score; best = agent; }
  }
  return best; // meglio un profilo imperfetto che un incarico fermo in bacheca
}

function bestReviewerFor(task, authorId) {
  const candidates = state.agents.filter((a) => a.id !== authorId && isFree(a));
  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const ra = (ROLES[a.role]?.review || 0.5) + (ROLES[a.role]?.skills[task.type] || 0) * 0.5;
    const rb = (ROLES[b.role]?.review || 0.5) + (ROLES[b.role]?.skills[task.type] || 0) * 0.5;
    return rb - ra;
  })[0];
}

/* ------------------------------------------------------------------ *
 * Azioni pubbliche (usate dalla UI)
 * ------------------------------------------------------------------ */

export function addTask(input) {
  const task = createTask(input);
  state.tasks.push(task);
  log({ kind: 'info', text: `Nuovo incarico in bacheca: «${task.title}»`, taskId: task.id });
  emit('tasks');
  save();
  planCooldown = 0; // la Direttrice smista subito
  return task;
}

export function assign(taskId, agentId) {
  const task = getTask(taskId);
  const agent = getAgent(agentId);
  if (!task || !agent) return false;
  if (task.status === TASK_STATUS.DONE) return false;
  if (agent.taskId && agent.taskId !== task.id) {
    // Libera l'incarico precedente rimettendolo in bacheca.
    const prev = getTask(agent.taskId);
    if (prev) { prev.status = TASK_STATUS.BACKLOG; prev.assignee = null; }
  }
  task.assignee = agent.id;
  task.status = TASK_STATUS.ASSIGNED;
  task.startedAt = task.startedAt || new Date().toISOString();
  agent.taskId = task.id;
  agent.status = 'lavora';
  backend.start(task, agent).catch(() => {});
  log({ kind: 'direttrice', who: 'Claude', text: DIRECTOR_LINES.assign(agent.name, task.title), taskId: task.id });
  say(agent, pick(PHRASES.start));
  emit('tasks'); emit('agents');
  save();
  return true;
}

export function unblock(taskId, byUser = true) {
  const task = getTask(taskId);
  if (!task || task.status !== TASK_STATUS.BLOCKED) return false;
  const agent = getAgent(task.assignee);
  task.status = TASK_STATUS.WORKING;
  task.blockedReason = null;
  if (agent) {
    agent.status = 'lavora';
    agent.mood = clamp(agent.mood + 0.1, 0, 1);
    say(agent, 'Chiarito, riparto!');
  }
  log({
    kind: 'direttrice',
    who: byUser ? 'Tu' : 'Claude',
    text: agent ? DIRECTOR_LINES.unblock(agent.name) : 'Incarico sbloccato.',
    taskId: task.id,
  });
  emit('tasks'); emit('agents');
  save();
  return true;
}

export function hire(roleId) {
  if (state.agents.length >= MAX_AGENTS) {
    log({ kind: 'allarme', text: `Scrivanie esaurite: massimo ${MAX_AGENTS} agenti.` });
    return null;
  }
  const agent = createAgent(roleId);
  agent.body = { at: 'ingresso', goal: 'scrivania', anim: 'cammina' };
  state.agents.push(agent);
  log({ kind: 'successo', who: 'Claude', text: DIRECTOR_LINES.hire(agent.name, ROLES[roleId].label.toLowerCase()) });
  say(agent, pick(PHRASES.hired), 5);
  emit('agents'); emit('hired', agent);
  save();
  return agent;
}

export function fire(agentId) {
  const agent = getAgent(agentId);
  if (!agent) return false;
  const task = agentTask(agent);
  if (task) { task.status = TASK_STATUS.BACKLOG; task.assignee = null; }
  if (agent.reviewTaskId) {
    const rt = getTask(agent.reviewTaskId);
    if (rt) { rt.status = TASK_STATUS.WORKING; rt.reviewer = null; }
  }
  agent.taskId = null; agent.reviewTaskId = null;
  agent.status = 'cammina';
  agent.errand = { kind: 'uscita', phase: 'andata', t: 0 };
  agent.body.goal = 'uscita';
  say(agent, 'È stato un piacere! 👋', 5);
  log({ kind: 'info', text: `${agent.name} lascia lo studio.` });
  emit('agents');
  save();
  return true;
}

export function sendToCoffee(agentId) {
  const agent = getAgent(agentId);
  if (!agent || agent.errand) return false;
  agent.errand = { kind: 'caffe', phase: 'andata', t: 0, dwell: 4 };
  agent.body.goal = 'caffe';
  agent.status = 'caffe';
  say(agent, pick(PHRASES.coffee));
  emit('agents');
  return true;
}

export function praise(agentId) {
  const agent = getAgent(agentId);
  if (!agent) return false;
  agent.mood = clamp(agent.mood + 0.25, 0, 1);
  agent.energy = clamp(agent.energy + 0.1, 0, 1);
  say(agent, 'Grazie! 😊', 3);
  directorSays(DIRECTOR_LINES.praise(agent.name), 3.5);
  log({ kind: 'direttrice', who: 'Claude', text: DIRECTOR_LINES.praise(agent.name) });
  emit('agents');
  return true;
}

export function standup() {
  if (!state.agents.length) return false;
  state.agents.forEach((agent) => {
    if (agent.errand?.kind === 'uscita') return;
    agent.errand = { kind: 'riunione', phase: 'andata', t: 0, dwell: 7 + Math.random() * 2 };
    agent.body.goal = 'riunione';
    agent.status = 'riunione';
  });
  state.director.errand = { kind: 'riunione', phase: 'andata', t: 0, dwell: 8 };
  state.director.body.goal = 'riunione';
  directorSays(DIRECTOR_LINES.standup(), 5);
  log({ kind: 'direttrice', who: 'Claude', text: DIRECTOR_LINES.standup() });
  emit('agents');
  return true;
}

/* ------------------------------------------------------------------ *
 * Ciclo di simulazione
 * ------------------------------------------------------------------ */

export function tick(dtReal) {
  if (state.speed === 0) return;
  const dt = Math.min(dtReal, 0.1) * state.speed;
  state.clock += dt;

  // Nuvolette scadute
  [...state.agents, state.director].forEach((who) => {
    if (who.say && who.say.until < state.clock) who.say = null;
  });

  state.agents.forEach((agent) => updateAgent(agent, dt));
  updateErrand(state.director, dt);

  planCooldown -= dt;
  if (planCooldown <= 0) { planCooldown = 0.9; plan(); }

  chatterCooldown -= dt;
  if (chatterCooldown <= 0) { chatterCooldown = 7 + Math.random() * 9; chatter(); }
}

/** Decisioni della Direttrice: assegnare, far revisionare, sbloccare. */
function plan() {
  // 1. Sbloccare chi è fermo (la Direttrice va di persona alla scrivania).
  // Se per qualsiasi motivo la visita è saltata, il contrassegno va ripulito:
  // nessun incarico deve restare bloccato in eterno.
  state.tasks.forEach((t) => {
    if (t._directorOnIt && state.director.errand?.taskId !== t.id) delete t._directorOnIt;
  });
  const blocked = state.tasks.find((t) => t.status === TASK_STATUS.BLOCKED && !t._directorOnIt);
  if (blocked && !state.director.errand) {
    const agent = getAgent(blocked.assignee);
    if (agent) {
      blocked._directorOnIt = true;
      state.director.errand = { kind: 'sblocco', phase: 'andata', t: 0, dwell: 2.6, target: agent.id, taskId: blocked.id };
      state.director.body.goal = `visita:${agent.id}`;
      directorSays('Arrivo, vediamo il blocco.', 3);
      return;
    }
  }

  // 2. Riavviare revisioni rimaste in sospeso (consegna interrotta, agente uscito…).
  state.tasks
    .filter((t) => t.status === TASK_STATUS.REVIEW)
    .forEach((task) => {
      const reviewer = getAgent(task.reviewer);
      const author = getAgent(task.assignee);
      if (!reviewer) { task.status = TASK_STATUS.WORKING; task.reviewer = null; return; }
      if (reviewer.reviewTaskId === task.id) return;               // revisione già in corso
      const consegnaInCorso = author && author.errand?.kind === 'consegna' && author.errand.taskId === task.id;
      if (consegnaInCorso) return;
      reviewer.reviewTaskId = task.id;
      if (!reviewer.errand) reviewer.status = 'revisione';
    });

  // 3. Assegnare dalla bacheca, dal più urgente.
  const backlog = state.tasks
    .filter((t) => t.status === TASK_STATUS.BACKLOG)
    .sort((a, b) => (PRIORITIES[b.priority].weight - PRIORITIES[a.priority].weight)
      || (a.createdAt < b.createdAt ? -1 : 1));
  for (const task of backlog) {
    const agent = bestAgentFor(task);
    if (!agent) break;
    assign(task.id, agent.id);
  }
}

/** Chiacchiere di sottofondo: l'ufficio deve sembrare vivo. */
function chatter() {
  const busy = state.agents.filter((a) => a.status === 'lavora' && !a.say);
  if (busy.length && Math.random() < 0.8) {
    say(pick(busy), pick(PHRASES.work), 3);
    return;
  }
  if (!state.tasks.some((t) => t.status !== TASK_STATUS.DONE) && state.agents.length) {
    directorSays(DIRECTOR_LINES.idle(), 4);
  }
}

/* ------------------------------------------------------------------ *
 * Aggiornamento del singolo agente
 * ------------------------------------------------------------------ */

function updateAgent(agent, dt) {
  if (agent.errand) { updateErrand(agent, dt); return; }

  const seated = agent.body.at === 'scrivania';
  if (!seated) { agent.body.goal = 'scrivania'; return; }

  if (agent.status === 'lavora') { progressTask(agent, dt); return; }
  if (agent.status === 'revisione') { progressReview(agent, dt); return; }

  if (agent.status === 'inattivo') {
    agent.energy = clamp(agent.energy + dt * 0.02, 0, 1);
    return;
  }
}

function progressTask(agent, dt) {
  const task = agentTask(agent);
  if (!task) { agent.status = 'inattivo'; return; }
  if (task.status === TASK_STATUS.BLOCKED) return;
  if (task.status === TASK_STATUS.ASSIGNED) task.status = TASK_STATUS.WORKING;

  agent.stats.secondiLavorati += dt;
  agent.energy = clamp(agent.energy - dt * 0.012, 0, 1);
  if (agent.energy < 0.22 && !agent.errand && Math.random() < dt * 0.5) { sendToCoffee(agent.id); return; }

  const role = ROLES[agent.role];
  const fit = role.skills[task.type] ?? 0.35;
  const rate = SIM.workPerSecond * role.speed * (0.45 + 0.55 * fit) * (0.5 + 0.5 * agent.energy);

  if (agent._pending) return;
  agent._pending = true;
  backend.progress(task, agent, dt, rate)
    .then((res) => {
      agent._pending = false;
      if (!res) return;
      task.work = Math.min(task.workTotal, task.work + (res.delta || 0));
      if (res.line) log({ kind: 'agente', who: agent.name, text: res.line, taskId: task.id });
      if (res.blocked) { blockTask(task, agent, typeof res.blocked === 'string' ? res.blocked : null); return; }
      if (res.done || task.work >= task.workTotal) sendToReview(task, agent);
      emit('progress', task.id);
    })
    .catch((err) => { agent._pending = false; console.warn(err); });
}

function blockTask(task, agent, reason) {
  task.status = TASK_STATUS.BLOCKED;
  task.blockedReason = reason || pick([
    'specifiche ambigue', 'dipendenza non disponibile', 'serve una decisione di prodotto',
    'credenziali mancanti', 'conflitto con un altro incarico',
  ]);
  agent.status = 'bloccato';
  agent.mood = clamp(agent.mood - 0.12, 0, 1);
  say(agent, pick(PHRASES.blocked), 6);
  log({ kind: 'allarme', who: agent.name, text: `Bloccato: ${task.blockedReason}`, taskId: task.id });
  emit('tasks'); emit('agents');
  save();
}

function sendToReview(task, agent) {
  backend.finish(task, agent).catch(() => {});
  say(agent, pick(PHRASES.done), 3.5);
  const reviewer = bestReviewerFor(task, agent.id);
  if (!reviewer) {
    // Nessuno libero: approva la Direttrice.
    completeTask(task, agent, 'Approvato dalla Direttrice.');
    return;
  }
  task.status = TASK_STATUS.REVIEW;
  task.reviewer = reviewer.id;
  task.reviewWork = 0;
  agent.status = 'cammina';
  agent.errand = { kind: 'consegna', phase: 'andata', t: 0, dwell: 2.2, target: reviewer.id, taskId: task.id };
  agent.body.goal = `visita:${reviewer.id}`;
  reviewer.status = 'attesa';
  log({ kind: 'direttrice', who: 'Claude', text: DIRECTOR_LINES.review(reviewer.name, task.title), taskId: task.id });
  emit('tasks'); emit('agents');
  save();
}

function progressReview(agent, dt) {
  const task = getTask(agent.reviewTaskId);
  if (!task) { agent.status = 'inattivo'; agent.reviewTaskId = null; return; }
  const role = ROLES[agent.role];
  task.reviewWork += SIM.workPerSecond * (role.review || 0.8) * dt;
  if (Math.random() < dt / 3) log({ kind: 'agente', who: agent.name, text: pick(PHRASES.review), taskId: task.id });
  if (task.reviewWork < SIM.reviewWork) return;

  agent.stats.revisioni += 1;
  state.stats.revisioni += 1;
  agent.reviewTaskId = null;
  agent.status = 'inattivo';
  const author = getAgent(task.assignee);

  const strictness = (role.skills.bug || 0.4) * (role.review || 0.8);
  if (task.reviewRound < 2 && Math.random() < SIM.bugFoundChance * (0.6 + strictness)) {
    task.reviewRound += 1;
    task.status = TASK_STATUS.WORKING;
    task.work = task.workTotal * 0.72;
    task.reviewer = null;
    agent.stats.bugTrovati += 1;
    state.stats.bugTrovati += 1;
    say(agent, 'Trovato un caso limite 🐞', 4);
    log({ kind: 'allarme', who: agent.name, text: `Rimando «${task.title}»: manca un caso limite.`, taskId: task.id });
    if (author) {
      author.status = 'lavora';
      author.mood = clamp(author.mood - 0.08, 0, 1);
      say(author, 'Giusto, sistemo subito.', 3.5);
    }
    emit('tasks'); emit('agents'); save();
    return;
  }

  say(agent, 'Approvato ✅', 3);
  if (author) completeTask(task, author, `${agent.name} ha approvato la revisione.`);
  else { task.status = TASK_STATUS.DONE; emit('tasks'); }
}

function completeTask(task, agent, note) {
  task.status = TASK_STATUS.DONE;
  task.work = task.workTotal;
  task.doneAt = new Date().toISOString();
  task.reviewer = task.reviewer || null;
  if (agent) {
    agent.taskId = null;
    agent.status = 'inattivo';
    agent.stats.completati += 1;
    agent.mood = clamp(agent.mood + 0.15, 0, 1);
    agent.body.anim = 'festeggia';
    agent._celebrate = 2.6;
    say(agent, pick(PHRASES.done), 3);
  }
  state.stats.completati += 1;
  log({ kind: 'successo', who: agent?.name || 'Claude', text: `«${task.title}» completato. ${note || ''}`.trim(), taskId: task.id });
  if (Math.random() < 0.45 && agent) directorSays(DIRECTOR_LINES.praise(agent.name), 3.5);
  emit('tasks'); emit('agents'); emit('completato', task.id);
  save();
}

/* ------------------------------------------------------------------ *
 * Commissioni (spostamenti con una sosta)
 * ------------------------------------------------------------------ */

function updateErrand(who, dt) {
  const errand = who.errand;
  if (!errand) {
    if (who._celebrate) {
      who._celebrate -= dt;
      if (who._celebrate <= 0) { who._celebrate = 0; who.body.anim = 'idle'; }
    }
    return;
  }

  if (errand.phase === 'andata') {
    if (who.body.at === who.body.goal) { errand.phase = 'sosta'; errand.t = errand.dwell || 2; onArrive(who, errand); }
    return;
  }

  if (errand.phase === 'sosta') {
    errand.t -= dt;
    if (errand.t > 0) return;
    errand.phase = 'ritorno';
    who.body.goal = who.id === 'direttrice' ? 'direzione' : 'scrivania';
    onLeave(who, errand);
    return;
  }

  // ritorno
  if (who.body.at === who.body.goal) {
    who.errand = null;
    if (who.id === 'direttrice') return;
    // Chi aveva una revisione in sospeso la riprende: nessun incarico resta appeso.
    if (who.reviewTaskId) who.status = 'revisione';
    else who.status = who.taskId ? 'lavora' : 'inattivo';
  }
}

function onArrive(who, errand) {
  if (errand.kind === 'consegna') {
    const reviewer = getAgent(errand.target);
    const task = getTask(errand.taskId);
    if (reviewer && task) {
      reviewer.status = 'revisione';
      reviewer.reviewTaskId = task.id;
      say(reviewer, pick(PHRASES.review), 3.5);
      say(who, 'Ecco il diff, grazie!', 3);
    }
  } else if (errand.kind === 'sblocco') {
    const task = getTask(errand.taskId);
    if (task) { delete task._directorOnIt; unblock(task.id, false); }
  } else if (errand.kind === 'caffe') {
    say(who, pick(PHRASES.coffee), 3);
  } else if (errand.kind === 'riunione') {
    if (Math.random() < 0.5) say(who, pick(PHRASES.meeting), 3.5);
  } else if (errand.kind === 'uscita') {
    // gestita dal mondo 3D: l'agente esce e viene rimosso
    const idx = state.agents.findIndex((a) => a.id === who.id);
    if (idx >= 0) state.agents.splice(idx, 1);
    if (state.selectedAgentId === who.id) state.selectedAgentId = null;
    emit('agents'); emit('despawn', who.id); save();
  }
}

function onLeave(who, errand) {
  if (errand.kind === 'caffe') {
    who.energy = 1;
    who.mood = clamp(who.mood + 0.1, 0, 1);
  } else if (errand.kind === 'riunione') {
    who.energy = clamp(who.energy + 0.22, 0, 1);
    who.mood = clamp(who.mood + 0.12, 0, 1);
  }
}

/* ------------------------------------------------------------------ *
 * Utilità esposte
 * ------------------------------------------------------------------ */

export function setSpeed(speed) {
  state.speed = speed;
  emit('speed', speed);
}

export function summary() {
  const attivi = state.agents.filter((a) => a.status === 'lavora').length;
  const inCorso = state.tasks.filter((t) => [TASK_STATUS.WORKING, TASK_STATUS.ASSIGNED].includes(t.status)).length;
  const inRevisione = state.tasks.filter((t) => t.status === TASK_STATUS.REVIEW).length;
  const bloccati = state.tasks.filter((t) => t.status === TASK_STATUS.BLOCKED).length;
  const bacheca = state.tasks.filter((t) => t.status === TASK_STATUS.BACKLOG).length;
  return { attivi, inCorso, inRevisione, bloccati, bacheca, completati: state.stats.completati };
}

export { TASK_STATUS, TASK_TYPES, techLine };
