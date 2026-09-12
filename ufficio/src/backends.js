/**
 * backends.js — Da dove arriva il "lavoro" degli agenti.
 *
 * Due implementazioni con la stessa interfaccia:
 *   • SimulatedBackend — tutto locale, deterministico quanto basta, sempre disponibile.
 *   • EndpointBackend  — inoltra l'incarico a un tuo servizio (es. un proxy che parla
 *     con l'API di Claude o con il Claude Agent SDK) e ne mostra i progressi reali.
 *
 * Interfaccia:
 *   start(task, agent)          -> Promise<void>       apre la lavorazione
 *   progress(task, agent, dt)   -> Promise<{ delta, line?, done?, blocked? }>
 *   finish(task, agent)         -> Promise<void>
 */

import { SIM, TASK_TYPES } from './config.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);

/* ------------------------------------------------------------------ *
 * Righe di log verosimili, per dare "consistenza tecnica" alla scena
 * ------------------------------------------------------------------ */

const FILES = {
  feature: ['src/app/router.ts', 'src/ui/Form.tsx', 'src/api/client.ts', 'src/store/session.ts'],
  bug: ['src/db/quota.ts', 'src/ui/SaveButton.tsx', 'src/lib/storage.ts'],
  refactor: ['src/core/engine.ts', 'src/lib/utils.ts', 'src/ui/panels/'],
  test: ['tests/cart.spec.ts', 'tests/auth.spec.ts', 'tests/e2e/checkout.ts'],
  design: ['design/tokens.json', 'src/styles/theme.css', 'design/flow.fig'],
  infra: ['.github/workflows/ci.yml', 'infra/deploy.tf', 'Dockerfile'],
  ricerca: ['docs/ricerca/opzioni.md', 'docs/adr/0007.md'],
  docs: ['README.md', 'docs/guida-utente.md', 'docs/api.md'],
};

const ACTIONS = {
  feature: ['implemento', 'collego', 'estraggo il componente in', 'aggiungo lo stato a'],
  bug: ['riproduco il caso in', 'correggo il ramo di errore in', 'aggiungo la guardia in'],
  refactor: ['semplifico', 'rimuovo la duplicazione in', 'rinomino i simboli in'],
  test: ['scrivo i casi in', 'copro i limiti in', 'stabilizzo'],
  design: ['definisco spaziature in', 'aggiorno i token in', 'rifinisco gli stati di'],
  infra: ['aggiorno la pipeline in', 'metto in cache le dipendenze in', 'riduco l\'immagine di'],
  ricerca: ['confronto le opzioni in', 'annoto i vincoli in', 'verifico le fonti di'],
  docs: ['documento', 'aggiungo esempi a', 'riscrivo la sezione di'],
};

const CHECKS = [
  () => `test: ${Math.floor(rand(8, 64))} passati, 0 falliti`,
  () => `build ✓ in ${rand(0.8, 4.2).toFixed(1)}s`,
  () => `lint pulito su ${Math.floor(rand(3, 22))} file`,
  () => `diff +${Math.floor(rand(12, 140))} −${Math.floor(rand(2, 60))}`,
  () => `copertura ${Math.floor(rand(71, 97))}%`,
];

export function techLine(task) {
  const type = TASK_TYPES[task.type] ? task.type : 'feature';
  if (Math.random() < 0.35) return pick(CHECKS)();
  return `${pick(ACTIONS[type])} ${pick(FILES[type])}`;
}

/* ------------------------------------------------------------------ *
 * Backend simulato
 * ------------------------------------------------------------------ */

export class SimulatedBackend {
  constructor() { this.id = 'simulazione'; this.label = 'Simulazione locale'; }

  async start() { /* niente da preparare */ }

  /**
   * @param {object} task
   * @param {object} agent
   * @param {number} dt secondi simulati trascorsi
   * @param {number} rate punti di lavoro al secondo già pesati per affinità/energia
   */
  async progress(task, agent, dt, rate) {
    const delta = rate * dt;
    const out = { delta };
    // Una riga di log ogni ~2.5 secondi di lavoro effettivo.
    if (Math.random() < dt / 2.5) out.line = techLine(task);
    if (Math.random() < SIM.blockChancePerSecond * dt) out.blocked = true;
    return out;
  }

  async finish() { /* nulla */ }
}

/* ------------------------------------------------------------------ *
 * Backend su endpoint HTTP (agenti veri)
 * ------------------------------------------------------------------ */

/**
 * Contratto atteso dal tuo servizio:
 *   POST {endpoint}/start     { task, agent }  -> { runId }
 *   POST {endpoint}/progress  { runId }        -> { progress: 0..1, lines: string[], done: bool, blocked?: string }
 *   POST {endpoint}/finish    { runId }        -> {}
 *
 * Nota di sicurezza: l'endpoint deve stare su un tuo server. Non inserire mai
 * chiavi API nel browser: è il tuo servizio a custodirle.
 */
export class EndpointBackend {
  constructor(baseUrl) {
    this.id = 'endpoint';
    this.label = 'Endpoint remoto';
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.runs = new Map();
  }

  async #post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return res.json();
  }

  async start(task, agent) {
    const data = await this.#post('/start', { task, agent });
    this.runs.set(task.id, { runId: data.runId || task.id, last: 0 });
  }

  async progress(task, agent, dt, rate) {
    const run = this.runs.get(task.id);
    if (!run) return { delta: 0 };
    run.cooldown = (run.cooldown || 0) - dt;
    if (run.cooldown > 0) return { delta: 0 };
    run.cooldown = 1.2; // interroga il servizio ~una volta al secondo
    try {
      const data = await this.#post('/progress', { runId: run.runId });
      const pct = Math.max(0, Math.min(1, Number(data.progress) || 0));
      const delta = Math.max(0, pct - run.last) * task.workTotal;
      run.last = pct;
      return {
        delta,
        line: Array.isArray(data.lines) && data.lines.length ? data.lines.join(' · ').slice(0, 160) : undefined,
        done: Boolean(data.done),
        blocked: data.blocked ? String(data.blocked) : false,
      };
    } catch (err) {
      return { delta: 0, line: `⚠️ endpoint non raggiungibile (${err.message})`, blocked: 'endpoint non raggiungibile' };
    }
  }

  async finish(task) {
    const run = this.runs.get(task.id);
    if (!run) return;
    this.runs.delete(task.id);
    try { await this.#post('/finish', { runId: run.runId }); } catch { /* best effort */ }
  }
}
