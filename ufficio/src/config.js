/**
 * config.js — Anagrafica dell'ufficio agentico.
 *
 * Qui vivono i dati "statici": ruoli, tipi di incarico, palette, layout 3D
 * e le battute che gli agenti pronunciano nelle nuvolette.
 * Nessuna dipendenza: è importabile sia dal motore che dalla scena 3D.
 */

/** Stati possibili di un incarico. */
export const TASK_STATUS = {
  BACKLOG: 'backlog',
  ASSIGNED: 'assegnato',
  WORKING: 'in_corso',
  REVIEW: 'in_revisione',
  BLOCKED: 'bloccato',
  DONE: 'completato',
};

export const STATUS_META = {
  backlog: { label: 'Da assegnare', color: '#8b93a7', emoji: '📥' },
  assegnato: { label: 'Assegnato', color: '#4f8cff', emoji: '📌' },
  in_corso: { label: 'In lavorazione', color: '#31c48d', emoji: '⚙️' },
  in_revisione: { label: 'In revisione', color: '#a78bfa', emoji: '🔍' },
  bloccato: { label: 'Bloccato', color: '#f97066', emoji: '⛔' },
  completato: { label: 'Completato', color: '#12b76a', emoji: '✅' },
};

/** Tipi di incarico: guidano l'assegnazione e la scenografia. */
export const TASK_TYPES = {
  feature: { label: 'Nuova funzione', emoji: '✨', color: '#4f8cff', baseWork: 46 },
  bug: { label: 'Bug da correggere', emoji: '🐞', color: '#f97066', baseWork: 30 },
  refactor: { label: 'Refactor', emoji: '🧹', color: '#f2b441', baseWork: 38 },
  test: { label: 'Test', emoji: '🧪', color: '#31c48d', baseWork: 26 },
  design: { label: 'Design UI', emoji: '🎨', color: '#f472b6', baseWork: 34 },
  infra: { label: 'Infrastruttura', emoji: '🛠️', color: '#22d3ee', baseWork: 42 },
  ricerca: { label: 'Ricerca', emoji: '🔭', color: '#a78bfa', baseWork: 30 },
  docs: { label: 'Documentazione', emoji: '📚', color: '#94a3b8', baseWork: 22 },
};

export const PRIORITIES = {
  bassa: { label: 'Bassa', weight: 1, color: '#8b93a7' },
  media: { label: 'Media', weight: 2, color: '#4f8cff' },
  alta: { label: 'Alta', weight: 3, color: '#f2b441' },
  critica: { label: 'Critica', weight: 5, color: '#f97066' },
};

/**
 * Ruoli assumibili. `skills` è l'affinità (0..1) con ogni tipo di incarico:
 * la Direttrice la usa per scegliere a chi affidare il lavoro.
 * `look` descrive il personaggio 3D (tutto procedurale, zero asset esterni).
 */
export const ROLES = {
  architetto: {
    label: 'Architetta di sistema',
    short: 'Architettura',
    emoji: '📐',
    speed: 1.0,
    review: 0.9,
    skills: { feature: 0.85, bug: 0.5, refactor: 1.0, test: 0.4, design: 0.4, infra: 0.7, ricerca: 0.8, docs: 0.7 },
    look: { body: '#5b6ee1', accent: '#c7d2fe', skin: '#f0c8a0', hair: '#3b3355', hat: 'none', accessory: 'occhiali', hairStyle: 'chignon' },
    traits: ['visione d\'insieme', 'diagrammi ovunque'],
  },
  frontend: {
    label: 'Sviluppatrice frontend',
    short: 'Frontend',
    emoji: '🖥️',
    speed: 1.15,
    review: 0.6,
    skills: { feature: 1.0, bug: 0.8, refactor: 0.7, test: 0.5, design: 0.75, infra: 0.2, ricerca: 0.4, docs: 0.5 },
    look: { body: '#f472b6', accent: '#fbcfe8', skin: '#e8b48c', hair: '#8b2f63', hat: 'cuffie', accessory: 'none', hairStyle: 'caschetto' },
    traits: ['pixel perfect', 'animazioni fluide'],
  },
  backend: {
    label: 'Sviluppatore backend',
    short: 'Backend',
    emoji: '🧩',
    speed: 1.1,
    review: 0.7,
    skills: { feature: 0.95, bug: 0.9, refactor: 0.8, test: 0.6, design: 0.15, infra: 0.7, ricerca: 0.5, docs: 0.5 },
    look: { body: '#2f9e8f', accent: '#a7f3d0', skin: '#c98b5e', hair: '#2b2118', hat: 'none', accessory: 'none', hairStyle: 'corti' },
    traits: ['query ottimizzate', 'caffè doppio'],
  },
  qa: {
    label: 'Tester QA',
    short: 'Qualità',
    emoji: '🧪',
    speed: 1.0,
    review: 1.0,
    skills: { feature: 0.4, bug: 1.0, refactor: 0.5, test: 1.0, design: 0.2, infra: 0.3, ricerca: 0.5, docs: 0.6 },
    look: { body: '#31c48d', accent: '#d9f99d', skin: '#f2d2b0', hair: '#a16207', hat: 'none', accessory: 'occhiali', hairStyle: 'coda' },
    traits: ['rompe tutto con garbo', 'casi limite'],
  },
  reviewer: {
    label: 'Revisore del codice',
    short: 'Revisione',
    emoji: '🔍',
    speed: 0.9,
    review: 1.2,
    skills: { feature: 0.5, bug: 0.85, refactor: 0.95, test: 0.7, design: 0.3, infra: 0.5, ricerca: 0.6, docs: 0.8 },
    look: { body: '#7c6cf0', accent: '#ddd6fe', skin: '#8d5a3b', hair: '#1f2937', hat: 'none', accessory: 'occhiali', hairStyle: 'afro' },
    traits: ['commenti puntuali', 'zero tolleranza sui nomi'],
  },
  devops: {
    label: 'Ingegnere DevOps',
    short: 'DevOps',
    emoji: '🛠️',
    speed: 1.0,
    review: 0.7,
    skills: { feature: 0.4, bug: 0.7, refactor: 0.6, test: 0.6, design: 0.1, infra: 1.0, ricerca: 0.5, docs: 0.5 },
    look: { body: '#f2b441', accent: '#fde68a', skin: '#d59a6a', hair: '#4b3621', hat: 'casco', accessory: 'none', hairStyle: 'corti' },
    traits: ['pipeline verdi', 'deploy del venerdì (mai)'],
  },
  designer: {
    label: 'Designer di prodotto',
    short: 'Design',
    emoji: '🎨',
    speed: 1.05,
    review: 0.6,
    skills: { feature: 0.6, bug: 0.3, refactor: 0.3, test: 0.2, design: 1.0, infra: 0.1, ricerca: 0.7, docs: 0.6 },
    look: { body: '#fb7185', accent: '#fecdd3', skin: '#f5cba7', hair: '#6d28d9', hat: 'basco', accessory: 'none', hairStyle: 'lunghi' },
    traits: ['palette armoniche', 'griglie a 8pt'],
  },
  ricercatore: {
    label: 'Ricercatore',
    short: 'Ricerca',
    emoji: '🔭',
    speed: 0.95,
    review: 0.8,
    skills: { feature: 0.5, bug: 0.4, refactor: 0.4, test: 0.4, design: 0.3, infra: 0.4, ricerca: 1.0, docs: 1.0 },
    look: { body: '#38bdf8', accent: '#bae6fd', skin: '#e3b58c', hair: '#334155', hat: 'none', accessory: 'cuffie', hairStyle: 'riccio' },
    traits: ['fonti verificate', 'appunti infiniti'],
  },
};

/** La Direttrice: sei tu, Claude. Non è assumibile né licenziabile. */
export const DIRECTOR = {
  id: 'direttrice',
  name: 'Claude',
  role: 'direttrice',
  roleLabel: 'Direttrice degli agenti',
  emoji: '👑',
  look: { body: '#d97757', accent: '#f5d0b8', skin: '#f0c8a0', hair: '#7c2d12', hat: 'none', accessory: 'tablet', hairStyle: 'chignon' },
};

/** Nomi per le nuove assunzioni. */
export const NAME_POOL = [
  'Nova', 'Iris', 'Milo', 'Vera', 'Enzo', 'Luna', 'Rocco', 'Alba', 'Nino', 'Gaia',
  'Teo', 'Mira', 'Dario', 'Elsa', 'Kilo', 'Zoe', 'Bruno', 'Nina', 'Ugo', 'Sole',
];

/** Battute pronunciate nelle nuvolette 3D. */
export const PHRASES = {
  start: [
    'Ci penso io.',
    'Preso in carico!',
    'Apro un branch e parto.',
    'Ok, leggo le specifiche…',
    'Questo lo chiudo oggi.',
  ],
  work: [
    'Quasi… ci siamo.',
    'Compila! 🎉',
    'Rifattorizzo due funzioni.',
    'Scrivo anche il test.',
    'Mmm, questo nome non mi piace.',
    'Ancora tre righe.',
  ],
  done: [
    'Fatto! Passo in revisione.',
    'Consegnato ✅',
    'Tutto verde da parte mia.',
    'Chiuso, e pure elegante.',
  ],
  blocked: [
    'Qui mi serve una decisione.',
    'Ho un dubbio sulle specifiche…',
    'Dipendenza mancante, sono fermo.',
    'Direttrice, mi serve lei.',
  ],
  review: [
    'Guardo il diff.',
    'Due nit e approvo.',
    'Manca un caso limite.',
    'Bel lavoro, approvo.',
  ],
  coffee: ['Pausa caffè ☕', 'Ricarico le batterie.', 'Due minuti e torno.'],
  meeting: ['Presente!', 'Aggiorno sullo stato.', 'Io sono in linea.'],
  hired: ['Che bello essere qui!', 'Dove mi siedo?', 'Pronta a partire!'],
};

/** Frasi della Direttrice nel registro attività. */
export const DIRECTOR_LINES = {
  assign: (a, t) => `Affido «${t}» a ${a}: è il profilo giusto.`,
  review: (a, t) => `${a}, dai un'occhiata a «${t}» prima di chiudere.`,
  unblock: (a) => `${a}, sblocchiamo: ti do io la direzione.`,
  praise: (a) => `Ottimo lavoro ${a}, continua così.`,
  standup: () => 'Riunione! Tutti al tavolo, aggiornamento veloce.',
  hire: (a, r) => `Benvenuta a bordo ${a}, ${r}. Scrivania pronta.`,
  idle: () => 'Bacheca vuota: dammi un incarico e lo smisto subito.',
};

/** Geometria dell'ufficio (unità: metri "cartoon"). */
export const LAYOUT = {
  floor: { width: 30, depth: 24 },
  wallHeight: 7,
  desks: [
    { x: -10.5, z: -5.5 }, { x: -5.5, z: -5.5 }, { x: -0.5, z: -5.5 }, { x: 4.5, z: -5.5 },
    { x: -10.5, z: 1.5 }, { x: -5.5, z: 1.5 }, { x: -0.5, z: 1.5 }, { x: 4.5, z: 1.5 },
  ],
  meeting: { x: 10.5, z: -4.5, radius: 2.7 },
  directorSpot: { x: 10.5, z: 4.5 },
  coffee: { x: -12.5, z: 8 },
  door: { x: 14, z: 9 },
  whiteboard: { x: -14.6, z: -2 },
};

export const MAX_AGENTS = LAYOUT.desks.length;

/** Ritmo della simulazione: quanti "punti di lavoro" al secondo a velocità 1x. */
export const SIM = {
  workPerSecond: 3.2,
  blockChancePerSecond: 0.006,
  coffeeChancePerSecond: 0.008,
  reviewWork: 14,
  bugFoundChance: 0.28,
};
