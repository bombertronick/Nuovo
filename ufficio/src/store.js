/**
 * store.js — Stato dell'ufficio, persistenza locale e bus di eventi.
 *
 * Tutto vive nel browser (localStorage): nessun server, nessun account.
 * La UI e la scena 3D si limitano a leggere lo stato e ad ascoltare gli eventi.
 */

import { TASK_STATUS, TASK_TYPES, ROLES, NAME_POOL, MAX_AGENTS } from './config.js';

const STORAGE_KEY = 'agent-office:v1';

/** Generatore di id leggibili e ordinabili. */
let seq = 0;
export function uid(prefix = 'id') {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ *
 * Bus di eventi minimale
 * ------------------------------------------------------------------ */

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try { fn(payload); } catch (err) { console.error('[bus]', event, err); }
  });
  if (event !== '*') emit('*', { event, payload });
}

/* ------------------------------------------------------------------ *
 * Stato
 * ------------------------------------------------------------------ */

export const state = {
  project: 'Progetto Aurora',
  /** La Direttrice (tu, Claude): presenza fissa, non persistita. */
  director: {
    id: 'direttrice',
    name: 'Claude',
    role: 'direttrice',
    roleLabel: 'Direttrice degli agenti',
    status: 'inattivo',
    say: null,
    body: { at: 'direzione', goal: 'direzione', anim: 'idle' },
  },
  agents: [],
  tasks: [],
  feed: [],          // registro attività (voci più recenti in testa)
  speed: 1,          // 0 = pausa, 1 = normale, 2, 4
  selectedAgentId: null,
  mode: 'simulazione', // 'simulazione' | 'endpoint'
  endpoint: '',
  stats: { completati: 0, bugTrovati: 0, revisioni: 0, giorno: 1 },
  clock: 0,          // secondi simulati
  createdAt: nowIso(),
};

/* ------------------------------------------------------------------ *
 * Fabbriche
 * ------------------------------------------------------------------ */

export function createAgent(roleId, name) {
  const role = ROLES[roleId];
  if (!role) throw new Error(`Ruolo sconosciuto: ${roleId}`);
  const used = new Set(state.agents.map((a) => a.name));
  const pool = NAME_POOL.filter((n) => !used.has(n));
  const chosen = name || pool[Math.floor(Math.random() * pool.length)] || `Agente ${state.agents.length + 1}`;
  const deskIndex = firstFreeDesk();
  return {
    id: uid('ag'),
    name: chosen,
    role: roleId,
    roleLabel: role.label,
    deskIndex,
    status: 'inattivo',      // inattivo | lavora | revisione | bloccato | riunione | caffe | cammina
    taskId: null,
    reviewTaskId: null,
    energy: 1,
    mood: 0.8,
    hiredAt: nowIso(),
    stats: { completati: 0, revisioni: 0, bugTrovati: 0, secondiLavorati: 0 },
    say: null,               // { text, until }
    // Stato "fisico" gestito dal mondo 3D (posizione, destinazione, animazione).
    body: { at: 'ingresso', goal: 'scrivania', anim: 'cammina' },
  };
}

function firstFreeDesk() {
  const taken = new Set(state.agents.map((a) => a.deskIndex));
  for (let i = 0; i < MAX_AGENTS; i += 1) if (!taken.has(i)) return i;
  return 0;
}

export function createTask(input) {
  const type = TASK_TYPES[input.type] ? input.type : 'feature';
  const base = TASK_TYPES[type].baseWork;
  const size = input.size || 'media';
  const sizeFactor = { piccola: 0.55, media: 1, grande: 1.8 }[size] ?? 1;
  return {
    id: uid('tk'),
    title: (input.title || 'Incarico senza nome').trim().slice(0, 90),
    brief: (input.brief || '').trim().slice(0, 600),
    type,
    size,
    priority: input.priority || 'media',
    status: TASK_STATUS.BACKLOG,
    assignee: null,
    reviewer: null,
    work: 0,
    workTotal: Math.round(base * sizeFactor),
    reviewWork: 0,
    reviewRound: 0,
    blockedReason: null,
    log: [],
    createdAt: nowIso(),
    startedAt: null,
    doneAt: null,
  };
}

/* ------------------------------------------------------------------ *
 * Accessori di lettura
 * ------------------------------------------------------------------ */

export const getAgent = (id) => state.agents.find((a) => a.id === id) || null;
export const getTask = (id) => state.tasks.find((t) => t.id === id) || null;
export const tasksByStatus = (status) => state.tasks.filter((t) => t.status === status);
export const agentTask = (agent) => (agent?.taskId ? getTask(agent.taskId) : null);

/* ------------------------------------------------------------------ *
 * Registro attività
 * ------------------------------------------------------------------ */

export function log(entry) {
  const item = {
    id: uid('ev'),
    at: nowIso(),
    kind: entry.kind || 'info',     // info | direttrice | agente | successo | allarme
    who: entry.who || null,
    text: entry.text,
    taskId: entry.taskId || null,
  };
  state.feed.unshift(item);
  if (state.feed.length > 260) state.feed.length = 260;
  const task = item.taskId ? getTask(item.taskId) : null;
  if (task) {
    task.log.push({ at: item.at, text: item.text, who: item.who });
    if (task.log.length > 60) task.log.shift();
  }
  emit('feed', item);
  return item;
}

/* ------------------------------------------------------------------ *
 * Persistenza
 * ------------------------------------------------------------------ */

let saveTimer = null;

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const snapshot = {
        v: 1,
        project: state.project,
        agents: state.agents,
        tasks: state.tasks,
        feed: state.feed.slice(0, 80),
        stats: state.stats,
        clock: state.clock,
        mode: state.mode,
        endpoint: state.endpoint,
        createdAt: state.createdAt,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (err) {
      console.warn('Salvataggio non riuscito', err);
    }
  }, 400);
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !Array.isArray(data.agents)) return false;
    state.project = data.project || state.project;
    state.agents = data.agents.filter((a) => ROLES[a.role]);
    state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    state.feed = Array.isArray(data.feed) ? data.feed : [];
    state.stats = { ...state.stats, ...(data.stats || {}) };
    state.clock = data.clock || 0;
    state.mode = data.mode === 'endpoint' ? 'endpoint' : 'simulazione';
    state.endpoint = data.endpoint || '';
    state.createdAt = data.createdAt || nowIso();
    // Al riavvio nessuno è "in cammino": tutti rientrano alla scrivania.
    state.agents.forEach((a) => {
      a.say = null;
      a.body = { at: 'scrivania', goal: 'scrivania', anim: 'idle' };
      if (a.status === 'cammina' || a.status === 'riunione' || a.status === 'caffe') a.status = 'inattivo';
    });
    return true;
  } catch (err) {
    console.warn('Ripristino non riuscito', err);
    return false;
  }
}

export function reset() {
  localStorage.removeItem(STORAGE_KEY);
  state.agents = [];
  state.tasks = [];
  state.feed = [];
  state.stats = { completati: 0, bugTrovati: 0, revisioni: 0, giorno: 1 };
  state.clock = 0;
  state.selectedAgentId = null;
  emit('reset');
}

/** Squadra iniziale mostrata al primo avvio. */
export function seedOffice() {
  ['architetto', 'frontend', 'backend', 'qa'].forEach((role) => {
    const agent = createAgent(role);
    agent.body = { at: 'scrivania', goal: 'scrivania', anim: 'idle' };
    state.agents.push(agent);
  });
  [
    { title: 'Pagina di login con OAuth', type: 'feature', priority: 'alta', size: 'media',
      brief: 'Form di accesso, gestione errori e sessione persistente.' },
    { title: 'Crash al salvataggio offline', type: 'bug', priority: 'critica', size: 'piccola',
      brief: 'Su Safari il salvataggio fallisce quando la quota è piena.' },
    { title: 'Suite di test per il carrello', type: 'test', priority: 'media', size: 'media',
      brief: 'Coprire aggiunta, rimozione e sconti applicati.' },
  ].forEach((t) => state.tasks.push(createTask(t)));
}
