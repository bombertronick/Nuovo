/**
 * ui.js — Pannelli, bacheca, registro e finestre modali.
 *
 * Nessun framework: piccole funzioni di render che ridisegnano solo la
 * porzione interessata quando lo stato cambia.
 */

import {
  ROLES, TASK_TYPES, PRIORITIES, STATUS_META, TASK_STATUS, MAX_AGENTS, DIRECTOR,
} from './config.js';
import { state, on, getAgent, getTask, save, reset, seedOffice } from './store.js';
import * as orch from './orchestrator.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ora = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

let world = null;
let filtro = 'tutti';

export function initUI(worldRef) {
  world = worldRef;

  $('#nome-progetto').textContent = state.project;
  buildFilters();
  bindTopbar();
  bindPanels();
  bindTabbar();

  on('agents', () => { renderAgents(); renderDossier(); renderKpi(); });
  on('tasks', () => { renderTasks(); renderAgents(); renderKpi(); renderDossier(); syncScene(); });
  on('feed', () => renderFeed());
  on('progress', () => { renderTasks(); renderAgents(); });
  on('hired', () => syncScene());
  on('despawn', () => syncScene());
  on('reset', () => renderAll());

  world.onSelect(() => { renderDossier(); renderAgents(); });

  renderAll();
  syncScene();
  // aggiornamento leggero delle barre di avanzamento
  setInterval(() => { renderTasks(); renderAgents(); renderKpi(); }, 900);
}

function renderAll() {
  firmaSquadra = '';
  firmaBacheca = '';
  renderKpi();
  renderAgents();
  renderTasks();
  renderFeed();
  renderDossier();
}

/** Allinea la scena 3D ai dati (targhette scrivania, post-it in lavagna). */
function syncScene() {
  for (let i = 0; i < MAX_AGENTS; i += 1) {
    const agent = state.agents.find((a) => a.deskIndex === i);
    world.setDeskLabel(i, agent ? agent.name : null, agent ? ROLES[agent.role].look.body : null);
  }
  const aperti = state.tasks
    .filter((t) => t.status !== TASK_STATUS.DONE)
    .slice(0, 12)
    .map((t) => ({ title: t.title, color: TASK_TYPES[t.type].color }));
  world.updateBoard(aperti);
}

/* ------------------------------------------------------------------ *
 * Indicatori
 * ------------------------------------------------------------------ */

function renderKpi() {
  const s = orch.summary();
  const chips = [
    { emoji: '👥', label: 'agenti', value: state.agents.length },
    { emoji: '⚙️', label: 'in lavorazione', value: s.inCorso },
    { emoji: '🔍', label: 'in revisione', value: s.inRevisione },
    { emoji: '⛔', label: 'bloccati', value: s.bloccati, alert: s.bloccati > 0 },
    { emoji: '📥', label: 'in bacheca', value: s.bacheca },
    { emoji: '✅', label: 'completati', value: s.completati },
  ];
  $('#kpi').innerHTML = chips.map((c) => `
    <div class="kpi-chip${c.alert ? ' alert' : ''}">
      <span>${c.emoji}</span><b>${c.value}</b><span>${c.label}</span>
    </div>`).join('');
}

/* ------------------------------------------------------------------ *
 * Squadra
 * ------------------------------------------------------------------ */

const STATUS_AGENTE = {
  inattivo: { label: 'disponibile', color: '#8b93a7' },
  lavora: { label: 'al lavoro', color: '#31c48d' },
  revisione: { label: 'in revisione', color: '#a78bfa' },
  bloccato: { label: 'bloccato', color: '#f97066' },
  riunione: { label: 'in riunione', color: '#4f8cff' },
  caffe: { label: 'pausa caffè', color: '#f2b441' },
  attesa: { label: 'in attesa', color: '#8b93a7' },
  cammina: { label: 'in movimento', color: '#8b93a7' },
};

/**
 * Le schede non vengono ricostruite a ogni giro: si aggiornano sul posto.
 * Così i clic non cadono mai su un nodo appena rimosso e non c'è sfarfallio.
 */
const cardsAgenti = new Map();
let firmaSquadra = '';

function renderAgents() {
  const box = $('#lista-agenti');
  const firma = state.agents.map((a) => a.id).join(',');

  if (firma !== firmaSquadra) {
    firmaSquadra = firma;
    cardsAgenti.clear();
    box.innerHTML = '';
    if (!state.agents.length) {
      box.appendChild(el('div', 'nota', 'Lo studio è vuoto. Assumi il primo agente per iniziare.'));
      return;
    }
    state.agents.forEach((agent) => {
      const role = ROLES[agent.role];
      const card = el('div', 'card');
      card.innerHTML = `
        <div class="avatar" style="--c:${role.look.body}">${role.emoji}</div>
        <div class="card-main">
          <div class="card-row">
            <span class="card-name">${esc(agent.name)}</span>
            <span class="pill js-stato"></span>
          </div>
          <div class="card-sub">${esc(role.label)}</div>
          <div class="card-task js-task" hidden></div>
          <div class="bar js-bar" hidden><i></i></div>
        </div>`;
      card.addEventListener('click', () => {
        state.selectedAgentId = state.selectedAgentId === agent.id ? null : agent.id;
        if (state.selectedAgentId) world.focusOn(agent.id);
        renderAgents();
        renderDossier();
      });
      box.appendChild(card);
      cardsAgenti.set(agent.id, {
        card,
        stato: card.querySelector('.js-stato'),
        task: card.querySelector('.js-task'),
        bar: card.querySelector('.js-bar'),
      });
    });
  }

  state.agents.forEach((agent) => {
    const nodi = cardsAgenti.get(agent.id);
    if (!nodi) return;
    // chi sta attraversando l'ufficio non è "disponibile": è in cammino
    const inCammino = agent.body.at !== agent.body.goal;
    const stato = inCammino ? STATUS_AGENTE.cammina : (STATUS_AGENTE[agent.status] || STATUS_AGENTE.inattivo);
    const task = agent.taskId ? getTask(agent.taskId) : null;

    nodi.card.classList.toggle('on', state.selectedAgentId === agent.id);
    nodi.stato.textContent = `● ${stato.label}`;
    nodi.stato.style.color = stato.color;

    if (task) {
      const meta = STATUS_META[task.status];
      const pct = Math.round((task.work / task.workTotal) * 100);
      nodi.task.hidden = false;
      nodi.task.textContent = `${TASK_TYPES[task.type].emoji} ${task.title}`;
      nodi.bar.hidden = false;
      const barra = nodi.bar.firstElementChild;
      barra.style.width = `${pct}%`;
      barra.style.background = meta.color;
    } else {
      nodi.task.hidden = true;
      nodi.bar.hidden = true;
    }
  });
}

/* ------------------------------------------------------------------ *
 * Bacheca incarichi
 * ------------------------------------------------------------------ */

function buildFilters() {
  const voci = [
    ['tutti', 'Tutti'],
    [TASK_STATUS.BACKLOG, 'Da assegnare'],
    [TASK_STATUS.WORKING, 'In corso'],
    [TASK_STATUS.REVIEW, 'Revisione'],
    [TASK_STATUS.BLOCKED, 'Bloccati'],
    [TASK_STATUS.DONE, 'Fatti'],
  ];
  const box = $('#filtri');
  box.innerHTML = '';
  voci.forEach(([key, label]) => {
    const b = el('button', key === filtro ? 'on' : '', label);
    b.addEventListener('click', () => { filtro = key; firmaBacheca = ''; buildFilters(); renderTasks(); });
    box.appendChild(b);
  });
}

const cardsTask = new Map();
let firmaBacheca = '';

function tasksVisibili() {
  let tasks = [...state.tasks].reverse();
  if (filtro !== 'tutti') {
    tasks = tasks.filter((t) => (filtro === TASK_STATUS.WORKING
      ? [TASK_STATUS.WORKING, TASK_STATUS.ASSIGNED].includes(t.status)
      : t.status === filtro));
  }
  return tasks.slice(0, 60);
}

function renderTasks() {
  const box = $('#lista-incarichi');
  const tasks = tasksVisibili();
  // la struttura si ricostruisce solo quando cambia davvero qualcosa
  const firma = `${filtro}|${tasks.map((t) => `${t.id}:${t.status}:${t.assignee}:${t.reviewer}`).join(',')}`;

  if (firma !== firmaBacheca) {
    firmaBacheca = firma;
    cardsTask.clear();
    box.innerHTML = '';

    if (!tasks.length) {
      box.appendChild(el('div', 'nota', 'Nessun incarico in questa vista. Creane uno con «＋ Incarico».'));
      return;
    }

    tasks.forEach((task) => {
      const type = TASK_TYPES[task.type];
      const meta = STATUS_META[task.status];
      const assignee = task.assignee ? getAgent(task.assignee) : null;
      const reviewer = task.reviewer ? getAgent(task.reviewer) : null;

      const node = el('div', 'task');
      node.style.setProperty('--c', type.color);
      node.innerHTML = `
        <div class="task-title"><span>${type.emoji}</span><span>${esc(task.title)}</span></div>
        <div class="task-meta">
          <span class="pill" style="color:${meta.color}">${meta.emoji} ${meta.label}</span>
          <span class="pill" style="color:${PRIORITIES[task.priority].color}">▲ ${PRIORITIES[task.priority].label}</span>
          ${assignee ? `<span>👤 ${esc(assignee.name)}</span>` : ''}
          ${reviewer ? `<span>🔍 ${esc(reviewer.name)}</span>` : ''}
        </div>
        ${task.status !== TASK_STATUS.DONE ? '<div class="bar js-bar"><i></i></div>' : ''}
        ${task.blockedReason ? `<div class="task-meta" style="color:#ffc9c4">⛔ ${esc(task.blockedReason)}</div>` : ''}`;

      const actions = el('div', 'task-actions');
      if (task.status === TASK_STATUS.BLOCKED) {
        const b = el('button', 'mini-btn primary', '🔓 Sblocca');
        b.addEventListener('click', () => orch.unblock(task.id));
        actions.appendChild(b);
      }
      if (task.status !== TASK_STATUS.DONE) {
        const b = el('button', 'mini-btn', assignee ? '🔁 Riassegna' : '👉 Assegna');
        b.addEventListener('click', () => openAssign(task.id));
        actions.appendChild(b);
      }
      const diario = el('button', 'mini-btn', '📄 Diario');
      diario.addEventListener('click', () => openTaskLog(task.id));
      actions.appendChild(diario);
      node.appendChild(actions);

      box.appendChild(node);
      cardsTask.set(task.id, { node, bar: node.querySelector('.js-bar i') });
    });
  }

  tasks.forEach((task) => {
    const nodi = cardsTask.get(task.id);
    if (!nodi?.bar) return;
    nodi.bar.style.width = `${Math.round((task.work / task.workTotal) * 100)}%`;
    nodi.bar.style.background = STATUS_META[task.status].color;
  });
}

/* ------------------------------------------------------------------ *
 * Registro
 * ------------------------------------------------------------------ */

function renderFeed() {
  const box = $('#registro');
  if (!box) return;
  box.innerHTML = state.feed.slice(0, 60).map((e) => `
    <div class="evento ${e.kind}">
      <span class="ora">${ora(e.at)}</span>
      ${e.who ? `<span class="chi">${esc(e.who)}</span>` : ''}
      <span class="testo">${esc(e.text)}</span>
    </div>`).join('');
}

/* ------------------------------------------------------------------ *
 * Scheda dell'agente selezionato
 * ------------------------------------------------------------------ */

function renderDossier() {
  const box = $('#dossier');
  const agent = state.selectedAgentId ? getAgent(state.selectedAgentId) : null;
  document.body.classList.toggle('con-dossier', Boolean(agent));
  if (!agent) { box.hidden = true; box.innerHTML = ''; return; }

  const role = ROLES[agent.role];
  const task = agent.taskId ? getTask(agent.taskId) : null;
  const stato = (agent.body.at !== agent.body.goal)
    ? STATUS_AGENTE.cammina
    : (STATUS_AGENTE[agent.status] || STATUS_AGENTE.inattivo);

  box.hidden = false;
  box.innerHTML = `
    <div class="dossier-head">
      <div class="avatar" style="--c:${role.look.body};width:48px;height:48px;font-size:22px">${role.emoji}</div>
      <div style="flex:1;min-width:0">
        <h3>${esc(agent.name)}</h3>
        <div class="role">${esc(role.label)} · <span style="color:${stato.color}">${stato.label}</span></div>
      </div>
      <button class="icon-btn small" data-chiudi aria-label="Chiudi">✕</button>
    </div>

    <div class="stat-grid">
      <div class="stat"><b>${agent.stats.completati}</b><span>consegne</span></div>
      <div class="stat"><b>${agent.stats.revisioni}</b><span>revisioni</span></div>
      <div class="stat"><b>${agent.stats.bugTrovati}</b><span>bug trovati</span></div>
      <div class="stat"><b>${Math.round(agent.stats.secondiLavorati / 60)}</b><span>min lavoro</span></div>
    </div>

    <div class="meter">Energia<div class="bar"><i style="width:${Math.round(agent.energy * 100)}%;background:#f2b441"></i></div></div>
    <div class="meter">Morale<div class="bar"><i style="width:${Math.round(agent.mood * 100)}%;background:#31c48d"></i></div></div>
    <div class="meter">Specialità: ${Object.entries(role.skills)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k]) => `${TASK_TYPES[k].emoji} ${TASK_TYPES[k].label}`).join(' · ')}</div>

    ${task ? `<div class="task" style="--c:${TASK_TYPES[task.type].color};margin-top:10px">
        <div class="task-title"><span>${TASK_TYPES[task.type].emoji}</span><span>${esc(task.title)}</span></div>
        <div class="bar"><i style="width:${Math.round((task.work / task.workTotal) * 100)}%;background:${STATUS_META[task.status].color}"></i></div>
      </div>` : '<div class="nota" style="margin-top:8px">Nessun incarico in corso: è disponibile.</div>'}

    <div class="task-actions" style="margin-top:12px">
      <button class="mini-btn primary" data-azione="assegna">📋 Assegna incarico</button>
      <button class="mini-btn" data-azione="inquadra">🎥 Inquadra</button>
      <button class="mini-btn" data-azione="complimenti">👏 Complimenti</button>
      <button class="mini-btn" data-azione="caffe">☕ Pausa</button>
      <button class="mini-btn danger" data-azione="licenzia">👋 Saluta</button>
    </div>`;

  box.querySelector('[data-chiudi]').addEventListener('click', () => {
    state.selectedAgentId = null;
    renderDossier(); renderAgents();
  });

  box.querySelectorAll('[data-azione]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const azione = btn.dataset.azione;
      if (azione === 'assegna') openAssignToAgent(agent.id);
      if (azione === 'inquadra') world.focusOn(agent.id);
      if (azione === 'complimenti') orch.praise(agent.id);
      if (azione === 'caffe') orch.sendToCoffee(agent.id);
      if (azione === 'licenzia') {
        openConfirm(`Salutare ${agent.name}?`, 'L\'incarico in corso torna in bacheca.', () => orch.fire(agent.id));
      }
    });
  });
}

/* ------------------------------------------------------------------ *
 * Comandi della barra e dei pannelli
 * ------------------------------------------------------------------ */

function bindTopbar() {
  $('#velocita').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    [...ev.currentTarget.children].forEach((b) => b.classList.toggle('on', b === btn));
    orch.setSpeed(Number(btn.dataset.speed));
  });

  $('#viste').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    [...ev.currentTarget.children].forEach((b) => b.classList.toggle('on', b === btn));
    world.setView(btn.dataset.view);
  });

  $('#btn-impostazioni').addEventListener('click', openSettings);
}

function bindPanels() {
  $('#btn-nuovo').addEventListener('click', openNewTask);
  $('#btn-assumi').addEventListener('click', openHire);
  $('#btn-riunione').addEventListener('click', () => { orch.standup(); world.setView('riunione'); });
  $('#btn-riduci-feed').addEventListener('click', (ev) => {
    const panel = $('#pannello-registro');
    panel.classList.toggle('collassato');
    ev.currentTarget.textContent = panel.classList.contains('collassato') ? '▴' : '▾';
  });
}

function bindTabbar() {
  const tabbar = $('#tabbar');
  tabbar.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    [...tabbar.children].forEach((b) => b.classList.toggle('on', b === btn));
    const tab = btn.dataset.tab;
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('aperto', p.dataset.panel === tab);
    });
  });
}

/* ------------------------------------------------------------------ *
 * Finestre modali
 * ------------------------------------------------------------------ */

function openModal(titolo, build) {
  const modal = $('#modal');
  $('#modal-titolo').textContent = titolo;
  const body = $('#modal-body');
  body.innerHTML = '';
  build(body, () => closeModal());
  modal.hidden = false;
  modal.onclick = (ev) => { if (ev.target === modal || ev.target.closest('[data-close]')) closeModal(); };
  document.addEventListener('keydown', escClose);
}

function closeModal() {
  $('#modal').hidden = true;
  document.removeEventListener('keydown', escClose);
}

function escClose(ev) { if (ev.key === 'Escape') closeModal(); }

function openNewTask() {
  openModal('Nuovo incarico', (body, close) => {
    let tipo = 'feature';
    let priorita = 'media';
    let taglia = 'media';

    body.innerHTML = `
      <label class="field">Titolo
        <input type="text" id="f-titolo" placeholder="Es. Esportazione PDF del report" maxlength="90">
      </label>
      <label class="field">Descrizione per l'agente
        <textarea id="f-brief" placeholder="Cosa deve fare, vincoli, criteri di accettazione…" maxlength="600"></textarea>
      </label>
      <div class="field">Tipo di lavoro<div class="opzioni" id="f-tipo"></div></div>
      <div class="field">Priorità<div class="opzioni" id="f-prio"></div></div>
      <div class="field">Dimensione<div class="opzioni" id="f-size"></div></div>
      <button class="big-btn" id="f-ok">Metti in bacheca</button>
      <p class="nota">La Direttrice sceglierà l'agente con l'affinità più alta e aprirà la revisione a consegna avvenuta.</p>`;

    const gruppo = (host, voci, corrente, onPick) => {
      host.innerHTML = '';
      voci.forEach(([key, label, emoji, sub]) => {
        const b = el('button', `opzione${key === corrente() ? ' on' : ''}`,
          `<span class="big">${emoji}</span>${label}${sub ? `<small>${sub}</small>` : ''}`);
        b.type = 'button';
        b.addEventListener('click', () => { onPick(key); gruppo(host, voci, corrente, onPick); });
        host.appendChild(b);
      });
    };

    gruppo(body.querySelector('#f-tipo'),
      Object.entries(TASK_TYPES).map(([k, v]) => [k, v.label, v.emoji]),
      () => tipo, (v) => { tipo = v; });
    gruppo(body.querySelector('#f-prio'),
      Object.entries(PRIORITIES).map(([k, v]) => [k, v.label, '▲']),
      () => priorita, (v) => { priorita = v; });
    gruppo(body.querySelector('#f-size'),
      [['piccola', 'Piccola', '🟢', 'poche ore'], ['media', 'Media', '🟡', 'una giornata'], ['grande', 'Grande', '🔴', 'più giorni']],
      () => taglia, (v) => { taglia = v; });

    body.querySelector('#f-ok').addEventListener('click', () => {
      const titolo = body.querySelector('#f-titolo').value.trim();
      if (!titolo) { body.querySelector('#f-titolo').focus(); return; }
      orch.addTask({ title: titolo, brief: body.querySelector('#f-brief').value, type: tipo, priority: priorita, size: taglia });
      close();
    });
    setTimeout(() => body.querySelector('#f-titolo').focus(), 60);
  });
}

function openHire() {
  openModal('Assumi un agente', (body, close) => {
    if (state.agents.length >= MAX_AGENTS) {
      body.innerHTML = `<p class="nota">Tutte le ${MAX_AGENTS} scrivanie sono occupate. Saluta qualcuno prima di assumere.</p>`;
      return;
    }
    let ruolo = 'frontend';
    body.innerHTML = `
      <div class="field">Ruolo<div class="opzioni" id="h-ruolo"></div></div>
      <label class="field">Nome (facoltativo)
        <input type="text" id="h-nome" placeholder="Lascia vuoto per un nome a caso" maxlength="18">
      </label>
      <button class="big-btn" id="h-ok">Firma il contratto ✍️</button>
      <p class="nota" id="h-nota"></p>`;

    const host = body.querySelector('#h-ruolo');
    const nota = body.querySelector('#h-nota');
    const disegna = () => {
      host.innerHTML = '';
      Object.entries(ROLES).forEach(([key, role]) => {
        const b = el('button', `opzione${key === ruolo ? ' on' : ''}`,
          `<span class="big">${role.emoji}</span>${role.short}`);
        b.type = 'button';
        b.addEventListener('click', () => { ruolo = key; disegna(); });
        host.appendChild(b);
      });
      const r = ROLES[ruolo];
      nota.innerHTML = `<b>${r.label}</b> — ${r.traits.join(', ')}.<br>Migliore su: ${
        Object.entries(r.skills).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([k]) => `${TASK_TYPES[k].emoji} ${TASK_TYPES[k].label}`).join(' · ')}`;
    };
    disegna();

    body.querySelector('#h-ok').addEventListener('click', () => {
      const nome = body.querySelector('#h-nome').value.trim();
      const agent = orch.hire(ruolo);
      if (agent && nome) { agent.name = nome.slice(0, 18); save(); }
      close();
    });
  });
}

function openAssign(taskId) {
  const task = getTask(taskId);
  if (!task) return;
  openModal(`Assegna «${task.title}»`, (body, close) => {
    if (!state.agents.length) {
      body.innerHTML = '<p class="nota">Non c\'è nessuno in studio: assumi prima un agente.</p>';
      return;
    }
    const lista = el('div', 'opzioni');
    [...state.agents]
      .sort((a, b) => orch.affinity(b, task) - orch.affinity(a, task))
      .forEach((agent) => {
        const fit = Math.round(orch.affinity(agent, task) * 100);
        const b = el('button', 'opzione',
          `<span class="big">${ROLES[agent.role].emoji}</span>${esc(agent.name)}<small>affinità ${fit}%</small>`);
        b.type = 'button';
        b.addEventListener('click', () => { orch.assign(task.id, agent.id); close(); });
        lista.appendChild(b);
      });
    body.appendChild(lista);
    body.appendChild(el('p', 'nota', 'L\'affinità combina il ruolo, l\'energia e il morale dell\'agente.'));
  });
}

function openAssignToAgent(agentId) {
  const agent = getAgent(agentId);
  if (!agent) return;
  const aperti = state.tasks.filter((t) => ![TASK_STATUS.DONE, TASK_STATUS.REVIEW].includes(t.status));
  openModal(`Cosa affidiamo a ${agent.name}?`, (body, close) => {
    if (!aperti.length) {
      body.innerHTML = '<p class="nota">La bacheca è vuota. Crea un incarico e poi assegnalo.</p>';
      const b = el('button', 'big-btn', '＋ Nuovo incarico');
      b.addEventListener('click', () => { close(); openNewTask(); });
      body.appendChild(b);
      return;
    }
    aperti.sort((a, b) => orch.affinity(agent, b) - orch.affinity(agent, a)).forEach((task) => {
      const row = el('button', 'opzione',
        `<span class="big">${TASK_TYPES[task.type].emoji}</span>${esc(task.title)}<small>affinità ${Math.round(orch.affinity(agent, task) * 100)}%</small>`);
      row.type = 'button';
      row.addEventListener('click', () => { orch.assign(task.id, agent.id); close(); });
      body.appendChild(row);
    });
  });
}

function openTaskLog(taskId) {
  const task = getTask(taskId);
  if (!task) return;
  openModal(`Diario · ${task.title}`, (body) => {
    body.innerHTML = `<div class="panel-body" style="padding:0;max-height:52vh">${
      task.log.slice().reverse().map((l) => `
        <div class="evento">
          <span class="ora">${ora(l.at)}</span>
          ${l.who ? `<span class="chi">${esc(l.who)}</span>` : ''}
          <span>${esc(l.text)}</span>
        </div>`).join('') || '<p class="nota">Ancora nessuna attività registrata.</p>'}</div>`;
  });
}

function openConfirm(titolo, testo, onOk) {
  openModal(titolo, (body, close) => {
    body.innerHTML = `<p class="nota">${esc(testo)}</p>`;
    const ok = el('button', 'big-btn', 'Confermo');
    ok.addEventListener('click', () => { onOk(); close(); });
    body.appendChild(ok);
  });
}

function openSettings() {
  openModal('Impostazioni dello studio', (body, close) => {
    body.innerHTML = `
      <label class="field">Nome del progetto
        <input type="text" id="s-progetto" value="${esc(state.project)}" maxlength="40">
      </label>

      <div class="field">Motore degli agenti
        <div class="opzioni" id="s-modo">
          <button type="button" class="opzione${state.mode === 'simulazione' ? ' on' : ''}" data-modo="simulazione">
            <span class="big">🎬</span>Simulazione<small>tutto locale</small></button>
          <button type="button" class="opzione${state.mode === 'endpoint' ? ' on' : ''}" data-modo="endpoint">
            <span class="big">🔌</span>Endpoint<small>agenti veri</small></button>
        </div>
      </div>

      <label class="field">Indirizzo dell'endpoint
        <input type="url" id="s-endpoint" placeholder="https://tuo-servizio.example/agenti" value="${esc(state.endpoint)}">
      </label>
      <p class="nota">L'endpoint riceve <code>POST /start</code>, <code>/progress</code> e <code>/finish</code>
        e riporta l'avanzamento reale dei tuoi agenti. Le chiavi API restano sul tuo server:
        non inserirle mai qui nel browser.</p>

      <button class="big-btn" id="s-ok">Salva</button>

      <hr style="border:0;border-top:1px solid var(--panel-line);margin:4px 0">
      <button class="mini-btn danger" id="s-reset" style="align-self:flex-start">🗑️ Azzera lo studio</button>
      <p class="nota">Cancella agenti, incarichi e statistiche salvati su questo dispositivo.</p>`;

    let modo = state.mode;
    body.querySelector('#s-modo').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-modo]');
      if (!btn) return;
      modo = btn.dataset.modo;
      body.querySelectorAll('[data-modo]').forEach((b) => b.classList.toggle('on', b === btn));
    });

    body.querySelector('#s-ok').addEventListener('click', () => {
      state.project = body.querySelector('#s-progetto').value.trim() || state.project;
      $('#nome-progetto').textContent = state.project;
      orch.setBackend(modo, body.querySelector('#s-endpoint').value.trim());
      save();
      close();
    });

    body.querySelector('#s-reset').addEventListener('click', () => {
      openConfirm('Azzerare lo studio?', 'Tutti i dati locali verranno cancellati e si riparte dalla squadra iniziale.', () => {
        reset();
        seedOffice();
        save();
        renderAll();
        syncScene();
      });
    });
  });
}

export { openNewTask, openHire };
