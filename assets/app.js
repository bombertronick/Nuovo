/* =========================================================================
   app.js — Gestionale Cantieri
   Logica dell'applicazione, calcolo IVA, interfaccia.
   Nessun framework: JavaScript puro, funziona offline e da file locale.
   ========================================================================= */
(function () {
  'use strict';

  /* --------------------------- Stato applicazione ---------------------------
     state = {
       azienda: string,
       categorie: [ {id, nome, colore} ],
       cantieri: [ {
          id, nome, cliente, indirizzo, categoriaId, stato('attivo'|'completato'),
          dataInizio, dataFine, note,
          fatturaOrigine: {numero, data, imponibile, aliquota, fileId, fileName} | null,
          spese: [ {id, descrizione, tipo('materiale'|'utensile'), fornitore, numeroDoc,
                    data, imponibile, aliquota, fileId, fileName} ]
       } ],
       speseGenerali: [ ...come spese ]
     }
  --------------------------------------------------------------------------- */

  let state = null;

  const DEFAULT_STATE = () => ({
    azienda: 'La mia impresa',
    categorie: [
      { id: uid(), nome: 'Ristrutturazioni', colore: '#1e5eff' },
      { id: uid(), nome: 'Impianti elettrici', colore: '#ffb300' },
      { id: uid(), nome: 'Manutenzioni', colore: '#16a34a' },
      { id: uid(), nome: 'Nuove costruzioni', colore: '#8b5cf6' }
    ],
    cantieri: [],
    speseGenerali: []
  });

  const ALIQUOTE = [22, 10, 4, 0]; // aliquote IVA italiane comuni
  const DEFAULT_ALIQUOTA = 22;

  /* --------------------------------- Router --------------------------------- */
  let route = { name: 'dashboard', id: null };
  let dashboardFilter = 'tutte'; // id categoria oppure 'tutte'

  /* --------------------------------- Utilità -------------------------------- */
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function euro(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  }

  function num(v) {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    return parseFloat(String(v).replace(',', '.')) || 0;
  }

  function ivaOf(imponibile, aliquota) {
    return num(imponibile) * (num(aliquota) / 100);
  }
  function totaleOf(imponibile, aliquota) {
    return num(imponibile) + ivaOf(imponibile, aliquota);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function todayISO() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getCategoria(id) {
    return state.categorie.find(c => c.id === id) || null;
  }

  function categoriaColore(id) {
    const c = getCategoria(id);
    return c ? c.colore : '#94a3b8';
  }
  function categoriaNome(id) {
    const c = getCategoria(id);
    return c ? c.nome : 'Senza categoria';
  }

  /* ------------------------- Calcoli IVA aggregati -------------------------- */
  // Riepilogo IVA per un cantiere: debito (fattura al cliente) - credito (spese)
  function cantiereRiepilogo(cant) {
    const debito = cant.fatturaOrigine ? ivaOf(cant.fatturaOrigine.imponibile, cant.fatturaOrigine.aliquota) : 0;
    let credito = 0, costiImponibile = 0;
    (cant.spese || []).forEach(s => {
      credito += ivaOf(s.imponibile, s.aliquota);
      costiImponibile += num(s.imponibile);
    });
    const ricavoImponibile = cant.fatturaOrigine ? num(cant.fatturaOrigine.imponibile) : 0;
    return {
      ivaDebito: debito,
      ivaCredito: credito,
      ivaNetta: debito - credito,       // > 0 = IVA da versare, < 0 = credito IVA
      ricavoImponibile,
      costiImponibile,
      margine: ricavoImponibile - costiImponibile
    };
  }

  // Riepilogo globale: tutti i cantieri + spese generali
  function globalRiepilogo() {
    let debito = 0, credito = 0, ricavo = 0, costi = 0;
    state.cantieri.forEach(c => {
      const r = cantiereRiepilogo(c);
      debito += r.ivaDebito; credito += r.ivaCredito;
      ricavo += r.ricavoImponibile; costi += r.costiImponibile;
    });
    (state.speseGenerali || []).forEach(s => {
      credito += ivaOf(s.imponibile, s.aliquota);
      costi += num(s.imponibile);
    });
    return {
      ivaDebito: debito, ivaCredito: credito, ivaNetta: debito - credito,
      ricavoImponibile: ricavo, costiImponibile: costi, margine: ricavo - costi
    };
  }

  /* ------------------------------ Persistenza ------------------------------- */
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      DB.saveState(state).catch(err => {
        console.error(err);
        toast('⚠️ Errore nel salvataggio dati');
      });
    }, 120);
  }

  /* -------------------------------- Toast ----------------------------------- */
  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast'; el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ============================== RENDERING ================================= */
  const app = () => document.getElementById('app');

  function render() {
    updateHeader();
    if (route.name === 'dashboard') renderDashboard();
    else if (route.name === 'cantiere') renderCantiere(route.id);
    else if (route.name === 'archivio') renderArchivio();
    else renderDashboard();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function updateHeader() {
    const sub = document.getElementById('header-sub');
    if (sub) sub.textContent = state.azienda || 'Gestionale Cantieri';
  }

  /* ----------------------------- DASHBOARD ---------------------------------- */
  function renderDashboard() {
    const attivi = state.cantieri.filter(c => c.stato === 'attivo');
    const completati = state.cantieri.filter(c => c.stato === 'completato');
    const g = globalRiepilogo();

    // filtro categorie
    let filtered = attivi;
    if (dashboardFilter !== 'tutte') {
      filtered = attivi.filter(c => (c.categoriaId || 'nessuna') === dashboardFilter);
    }

    // raggruppa per categoria
    const groups = {};
    filtered.forEach(c => {
      const k = c.categoriaId || 'nessuna';
      (groups[k] = groups[k] || []).push(c);
    });
    // ordina categorie secondo l'ordine definito, poi "senza categoria"
    const orderedKeys = state.categorie.map(c => c.id).filter(k => groups[k]);
    if (groups['nessuna']) orderedKeys.push('nessuna');

    let html = '';

    // --- Riepilogo IVA azienda ---
    html += `<section class="view">`;
    html += `<div class="section-title">📊 Riepilogo IVA azienda</div>`;
    html += summaryGrid(g, true);

    // --- Spese generali (non legate a un cantiere) ---
    const speseGen = state.speseGenerali || [];
    html += `<div class="section-title">🧾 Fatture e spese generali <span class="count">${speseGen.length}</span></div>`;
    html += `<div class="card">`;
    html += `<p class="mini-note">Spese di materiali/utensili non collegate a un cantiere specifico. L'IVA viene scalata dal totale azienda.</p>`;
    if (speseGen.length) {
      html += `<div style="margin-top:12px">` + speseGen.map(s => expenseRow(s, 'generale')).join('') + `</div>`;
    }
    html += `<button class="btn btn-ghost btn-block" data-action="add-spesa-generale" style="margin-top:12px">➕ Aggiungi spesa generale</button>`;
    html += `</div>`;

    // --- Categorie / filtro ---
    html += `<div class="section-title">🏗️ Cantieri attivi <span class="count">${attivi.length}</span></div>`;
    html += `<div class="chips">`;
    html += chip('tutte', 'Tutte', null, dashboardFilter === 'tutte');
    state.categorie.forEach(c => {
      const n = attivi.filter(x => x.categoriaId === c.id).length;
      html += chip(c.id, `${c.nome}${n ? ' · ' + n : ''}`, c.colore, dashboardFilter === c.id);
    });
    const senza = attivi.filter(x => !x.categoriaId).length;
    if (senza) html += chip('nessuna', `Senza categoria · ${senza}`, '#94a3b8', dashboardFilter === 'nessuna');
    html += `<button class="chip manage" data-action="manage-categorie">⚙️ Categorie</button>`;
    html += `</div>`;

    // --- Lista cantieri raggruppati ---
    if (!attivi.length) {
      html += emptyState('🏗️', 'Nessun cantiere attivo', 'Tocca il pulsante + in basso per aggiungere il tuo primo cantiere.');
    } else if (!filtered.length) {
      html += emptyState('🔍', 'Nessun cantiere in questa categoria', 'Cambia filtro oppure aggiungi un nuovo cantiere.');
    } else {
      orderedKeys.forEach(k => {
        const cat = getCategoria(k);
        const nome = cat ? cat.nome : 'Senza categoria';
        const col = cat ? cat.colore : '#94a3b8';
        html += `<div class="cantiere-group">`;
        html += `<div class="section-title"><span class="dot" style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span> ${esc(nome)} <span class="count">${groups[k].length}</span></div>`;
        groups[k].forEach(c => { html += cantiereCard(c); });
        html += `</div>`;
      });
    }

    // --- Archivio completati ---
    html += `<div class="section-title" style="margin-top:26px">✅ Cantieri completati <span class="count">${completati.length}</span></div>`;
    html += `<button class="btn btn-ghost btn-block" data-action="open-archivio">📁 Apri archivio completati (${completati.length})</button>`;

    html += `</section>`;
    app().innerHTML = html;

    caricaAllegatiVisibili();
    document.getElementById('fab').classList.remove('hidden');
  }

  function summaryGrid(r, showMargine) {
    const nettaFavore = r.ivaNetta < 0;
    return `<div class="summary-grid">
      <div class="stat debito">
        <div class="label">↗ IVA a debito</div>
        <div class="value">${euro(r.ivaDebito)}</div>
        <div class="hint">incassata dai clienti</div>
      </div>
      <div class="stat credito">
        <div class="label">↘ IVA a credito</div>
        <div class="value">${euro(r.ivaCredito)}</div>
        <div class="hint">su materiali e utensili</div>
      </div>
      <div class="stat netta ${nettaFavore ? 'credito-favore' : ''}">
        <div class="label">= IVA netta</div>
        <div class="value">${euro(Math.abs(r.ivaNetta))}</div>
        <div class="hint">${nettaFavore ? 'a tuo credito' : 'da versare'}</div>
      </div>
      ${showMargine ? `<div class="stat margine">
        <div class="label">€ Margine</div>
        <div class="value">${euro(r.margine)}</div>
        <div class="hint">ricavi − costi (imponibile)</div>
      </div>` : ''}
    </div>`;
  }

  function chip(id, label, colore, active) {
    const dot = colore ? `<span class="dot" style="background:${colore}"></span>` : '';
    return `<button class="chip ${active ? 'active' : ''}" data-action="filter" data-id="${id}">${dot}${esc(label)}</button>`;
  }

  function cantiereCard(c) {
    const col = categoriaColore(c.categoriaId);
    const r = cantiereRiepilogo(c);
    const hasFattura = !!c.fatturaOrigine;
    const nSpese = (c.spese || []).length;
    return `<button class="cantiere-card" style="--cat:${col}" data-action="open-cantiere" data-id="${c.id}">
      <div class="cc-top">
        <div style="flex:1 1 auto;min-width:0">
          <div class="cc-name">${esc(c.nome)}</div>
          <div class="cc-client">${c.cliente ? esc(c.cliente) : 'Cliente non indicato'}${c.indirizzo ? ' · ' + esc(c.indirizzo) : ''}</div>
        </div>
        <span class="badge cat" style="background:${col}">${esc(categoriaNome(c.categoriaId))}</span>
      </div>
      <div class="cc-meta">
        <span>${hasFattura ? '🧾 Fattura: <b>' + euro(totaleOf(c.fatturaOrigine.imponibile, c.fatturaOrigine.aliquota)) + '</b>' : '🧾 <span style="color:var(--warn)">Fattura mancante</span>'}</span>
        <span>🛠️ Spese: <b>${nSpese}</b></span>
        <span>IVA netta: <b style="color:${r.ivaNetta < 0 ? 'var(--ok)' : 'var(--warn)'}">${euro(Math.abs(r.ivaNetta))}</b> ${r.ivaNetta < 0 ? '(credito)' : '(da versare)'}</span>
      </div>
    </button>`;
  }

  /* ----------------------------- DETTAGLIO CANTIERE ------------------------- */
  function renderCantiere(id) {
    const c = state.cantieri.find(x => x.id === id);
    if (!c) { route = { name: 'dashboard' }; return renderDashboard(); }
    const r = cantiereRiepilogo(c);
    const col = categoriaColore(c.categoriaId);
    const completato = c.stato === 'completato';

    let html = `<section class="view">`;
    html += `<div class="detail-header">
      <button class="back-btn" data-action="back">←</button>
      <div style="flex:1 1 auto;min-width:0">
        <h2>${esc(c.nome)}</h2>
        <div class="dh-sub">
          <span class="badge cat" style="background:${col}">${esc(categoriaNome(c.categoriaId))}</span>
          <span class="badge ${completato ? 'stato-completato' : 'stato-attivo'}">${completato ? '✅ Completato' : '🏗️ In corso'}</span>
        </div>
      </div>
      <button class="icon-btn" style="background:var(--surface);border:1px solid var(--border);color:var(--text)" data-action="edit-cantiere" data-id="${c.id}">✏️</button>
    </div>`;

    // Riepilogo IVA cantiere
    html += `<div class="section-title">📊 Riepilogo IVA cantiere</div>`;
    html += summaryGrid(r, true);

    // Info cantiere
    html += `<div class="section-title">ℹ️ Informazioni</div>`;
    html += `<div class="card">`;
    html += infoRow('Cliente', c.cliente || '—');
    html += infoRow('Indirizzo', c.indirizzo || '—');
    html += infoRow('Categoria', categoriaNome(c.categoriaId));
    html += infoRow('Inizio lavori', fmtDate(c.dataInizio));
    if (completato) html += infoRow('Fine lavori', fmtDate(c.dataFine));
    if (c.note) html += infoRow('Note', esc(c.note));
    html += `</div>`;

    // Fattura d'origine
    html += `<div class="section-title">🧾 Fattura d'origine (al cliente)</div>`;
    html += `<div class="card">`;
    if (c.fatturaOrigine) {
      const f = c.fatturaOrigine;
      html += infoRow('Numero fattura', f.numero || '—');
      html += infoRow('Data', fmtDate(f.data));
      html += infoRow('Imponibile', euro(f.imponibile));
      html += infoRow(`IVA (${f.aliquota}%)`, euro(ivaOf(f.imponibile, f.aliquota)));
      html += infoRow('Totale fattura', `<b>${euro(totaleOf(f.imponibile, f.aliquota))}</b>`);
      if (f.fileId) {
        html += `<div style="margin-top:10px"><a class="attachment-link" data-action="open-file" data-file="${f.fileId}" href="#">📎 ${esc(f.fileName || 'Allegato')}</a></div>`;
      }
      html += `<div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-action="edit-fattura" data-id="${c.id}">✏️ Modifica</button>
        <button class="btn btn-danger btn-sm" data-action="del-fattura" data-id="${c.id}">🗑️ Rimuovi</button>
      </div>`;
    } else {
      html += `<p class="mini-note">Nessuna fattura d'origine. È la fattura che emetti al cliente per questo cantiere: da qui parte l'IVA a debito.</p>`;
      html += `<button class="btn btn-primary btn-block" style="margin-top:12px" data-action="edit-fattura" data-id="${c.id}">➕ Allega fattura d'origine</button>`;
    }
    html += `</div>`;

    // Spese materiali / utensili
    const spese = c.spese || [];
    html += `<div class="section-title">🛠️ Spese materiali e utensili <span class="count">${spese.length}</span></div>`;
    html += `<div class="card">`;
    html += `<p class="mini-note">Ogni spesa scala la sua IVA dalla fattura d'origine (IVA a credito).</p>`;
    if (spese.length) {
      html += `<div style="margin-top:12px">` + spese.map(s => expenseRow(s, c.id)).join('') + `</div>`;
      const totSpese = spese.reduce((a, s) => a + totaleOf(s.imponibile, s.aliquota), 0);
      const totIva = spese.reduce((a, s) => a + ivaOf(s.imponibile, s.aliquota), 0);
      html += `<div class="iva-preview"><span>Totale spese: ${euro(totSpese)}</span><span>IVA scalata: ${euro(totIva)}</span></div>`;
    }
    html += `<button class="btn btn-accent btn-block" style="margin-top:12px" data-action="add-spesa" data-id="${c.id}">➕ Aggiungi spesa (materiale/utensile)</button>`;
    html += `</div>`;

    // Azioni cantiere
    html += `<hr class="divider">`;
    html += `<div class="row-actions">`;
    if (completato) {
      html += `<button class="btn btn-ghost btn-block" data-action="riapri" data-id="${c.id}">↩️ Riapri cantiere (riporta tra gli attivi)</button>`;
    } else {
      html += `<button class="btn btn-ok btn-block" data-action="completa" data-id="${c.id}">✅ Segna come completato e archivia</button>`;
    }
    html += `</div>`;
    html += `<div class="row-actions">
      <button class="btn btn-danger btn-block" data-action="del-cantiere" data-id="${c.id}">🗑️ Elimina cantiere</button>
    </div>`;

    html += `</section>`;
    app().innerHTML = html;
    caricaAllegatiVisibili();
    document.getElementById('fab').classList.add('hidden');
  }

  function infoRow(k, v) {
    return `<div class="info-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  }

  function expenseRow(s, ownerId) {
    const icon = s.tipo === 'utensile' ? '🔧' : '📦';
    const iva = ivaOf(s.imponibile, s.aliquota);
    const tot = totaleOf(s.imponibile, s.aliquota);
    const sub = [s.fornitore, s.numeroDoc ? 'n.' + s.numeroDoc : '', fmtDate(s.data)].filter(Boolean).join(' · ');
    const fileLink = s.fileId ? `<a class="attachment-link" data-action="open-file" data-file="${s.fileId}" href="#">📎 ${esc(s.fileName || 'Allegato')}</a>` : '';
    return `<div class="expense-row">
      <div class="ex-icon">${icon}</div>
      <div class="ex-body">
        <div class="ex-title">${esc(s.descrizione || (s.tipo === 'utensile' ? 'Utensile' : 'Materiale'))} <span class="tag-tipo">${s.tipo === 'utensile' ? 'UTENSILE' : 'MATERIALE'}</span></div>
        <div class="ex-sub">${esc(sub || '—')}</div>
        ${fileLink}
      </div>
      <div class="ex-amount">
        <div class="tot">${euro(tot)}</div>
        <div class="iva">IVA ${euro(iva)} (${s.aliquota}%)</div>
        <div style="margin-top:6px;display:flex;gap:6px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" data-action="edit-spesa" data-owner="${ownerId}" data-id="${s.id}" style="padding:5px 8px">✏️</button>
          <button class="btn btn-danger btn-sm" data-action="del-spesa" data-owner="${ownerId}" data-id="${s.id}" style="padding:5px 8px">🗑️</button>
        </div>
      </div>
    </div>`;
  }

  /* -------------------------------- ARCHIVIO -------------------------------- */
  function renderArchivio() {
    const completati = state.cantieri.filter(c => c.stato === 'completato')
      .sort((a, b) => (b.dataFine || '').localeCompare(a.dataFine || ''));

    let html = `<section class="view">`;
    html += `<div class="detail-header">
      <button class="back-btn" data-action="back">←</button>
      <div style="flex:1 1 auto"><h2>Archivio completati</h2>
      <div class="dh-sub">${completati.length} cantieri conclusi</div></div>
    </div>`;

    if (!completati.length) {
      html += emptyState('📁', 'Archivio vuoto', 'I cantieri che segni come completati compaiono qui, con tutte le informazioni e la fattura allegata.');
    } else {
      completati.forEach(c => { html += cantiereCard(c); });
    }
    html += `</section>`;
    app().innerHTML = html;
    caricaAllegatiVisibili();
    document.getElementById('fab').classList.add('hidden');
  }

  function emptyState(icon, title, text) {
    return `<div class="empty"><div class="big">${icon}</div><h3 style="margin:0">${esc(title)}</h3><p>${esc(text)}</p></div>`;
  }

  /* ====================== ALLEGATI (apertura da IndexedDB) ================== */
  const objectUrls = [];
  function releaseUrls() { objectUrls.forEach(u => URL.revokeObjectURL(u)); objectUrls.length = 0; }

  async function openFile(fileId) {
    try {
      const blob = await DB.getFile(fileId);
      if (!blob) return toast('Allegato non trovato');
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      window.open(url, '_blank');
    } catch (e) { toast('Impossibile aprire l\'allegato'); }
  }
  // (I link agli allegati usano data-action=open-file gestito dal delegato)
  function caricaAllegatiVisibili() { /* placeholder: gli allegati si aprono on-demand */ }

  /* ============================== MODALI =================================== */
  function openModal(title, bodyHtml, footHtml) {
    closeModal();
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.id = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="close" data-action="close-modal">✕</button></div>
      <div class="modal-body">${bodyHtml}</div>
      ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
    </div>`;
    back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
    document.body.appendChild(back);
  }
  function closeModal() {
    const b = document.getElementById('modal-backdrop');
    if (b) b.remove();
  }

  /* ------- Form CANTIERE (nuovo / modifica) ------- */
  function cantiereForm(existing) {
    const c = existing || {};
    const opts = state.categorie.map(cat =>
      `<option value="${cat.id}" ${c.categoriaId === cat.id ? 'selected' : ''}>${esc(cat.nome)}</option>`).join('');
    const body = `
      <div class="field">
        <label>Nome cantiere *</label>
        <input id="f-nome" type="text" value="${esc(c.nome || '')}" placeholder="Es. Ristrutturazione Via Roma 12">
      </div>
      <div class="field-row">
        <div class="field"><label>Cliente</label><input id="f-cliente" type="text" value="${esc(c.cliente || '')}" placeholder="Nome / ragione sociale"></div>
        <div class="field"><label>Indirizzo</label><input id="f-indirizzo" type="text" value="${esc(c.indirizzo || '')}" placeholder="Via, città"></div>
      </div>
      <div class="field">
        <label>Categoria</label>
        <select id="f-categoria"><option value="">Senza categoria</option>${opts}</select>
      </div>
      <div class="field-row">
        <div class="field"><label>Data inizio</label><input id="f-inizio" type="date" value="${esc(c.dataInizio || todayISO())}"></div>
        <div class="field"><label>Data fine (se conclusa)</label><input id="f-fine" type="date" value="${esc(c.dataFine || '')}"></div>
      </div>
      <div class="field"><label>Note</label><textarea id="f-note" placeholder="Dettagli, promemoria...">${esc(c.note || '')}</textarea></div>
    `;
    const foot = `<button class="btn btn-ghost" data-action="close-modal">Annulla</button>
      <button class="btn btn-primary btn-block" data-action="save-cantiere" data-id="${c.id || ''}">💾 Salva cantiere</button>`;
    openModal(existing ? 'Modifica cantiere' : 'Nuovo cantiere', body, foot);
  }

  function saveCantiere(id) {
    const nome = document.getElementById('f-nome').value.trim();
    if (!nome) { toast('Inserisci il nome del cantiere'); return; }
    const data = {
      nome,
      cliente: document.getElementById('f-cliente').value.trim(),
      indirizzo: document.getElementById('f-indirizzo').value.trim(),
      categoriaId: document.getElementById('f-categoria').value || '',
      dataInizio: document.getElementById('f-inizio').value || '',
      dataFine: document.getElementById('f-fine').value || '',
      note: document.getElementById('f-note').value.trim()
    };
    if (id) {
      const c = state.cantieri.find(x => x.id === id);
      Object.assign(c, data);
      toast('Cantiere aggiornato');
    } else {
      const c = Object.assign({ id: uid(), stato: 'attivo', fatturaOrigine: null, spese: [] }, data);
      state.cantieri.unshift(c);
      route = { name: 'cantiere', id: c.id };
      toast('Cantiere creato');
    }
    persist();
    closeModal();
    render();
  }

  /* ------- Form FATTURA D'ORIGINE ------- */
  let pendingFile = null; // {blob, name} in attesa di salvataggio

  function fatturaForm(cantId) {
    const c = state.cantieri.find(x => x.id === cantId);
    const f = c.fatturaOrigine || {};
    pendingFile = null;
    const body = `
      <div class="field-row">
        <div class="field"><label>Numero fattura</label><input id="ff-numero" type="text" value="${esc(f.numero || '')}" placeholder="Es. 2026/014"></div>
        <div class="field"><label>Data</label><input id="ff-data" type="date" value="${esc(f.data || todayISO())}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Imponibile (€) *</label><input id="ff-imponibile" type="number" inputmode="decimal" step="0.01" value="${f.imponibile != null ? f.imponibile : ''}" placeholder="0,00"></div>
        <div class="field"><label>Aliquota IVA</label>${aliquotaSelect('ff-aliquota', f.aliquota)}</div>
      </div>
      <div class="iva-preview" id="ff-preview"><span>IVA: —</span><span>Totale: —</span></div>
      <div class="field" style="margin-top:14px">
        <label>Allega fattura (foto o PDF)</label>
        ${fileDrop('ff-file', f.fileName)}
      </div>
    `;
    const foot = `<button class="btn btn-ghost" data-action="close-modal">Annulla</button>
      <button class="btn btn-primary btn-block" data-action="save-fattura" data-id="${cantId}">💾 Salva fattura</button>`;
    openModal('Fattura d\'origine', body, foot);
    wireIvaPreview('ff-imponibile', 'ff-aliquota', 'ff-preview');
    wireFileDrop('ff-file');
  }

  async function saveFattura(cantId) {
    const c = state.cantieri.find(x => x.id === cantId);
    const imponibile = num(document.getElementById('ff-imponibile').value);
    if (!imponibile) { toast('Inserisci l\'imponibile della fattura'); return; }
    const prev = c.fatturaOrigine || {};
    let fileId = prev.fileId || null;
    let fileName = prev.fileName || null;
    if (pendingFile === 'REMOVE') {
      if (fileId) await DB.deleteFile(fileId);
      fileId = null; fileName = null;
    } else if (pendingFile) {
      if (fileId) await DB.deleteFile(fileId);
      fileId = uid();
      await DB.saveFile(fileId, pendingFile.blob);
      fileName = pendingFile.name;
    }
    c.fatturaOrigine = {
      numero: document.getElementById('ff-numero').value.trim(),
      data: document.getElementById('ff-data').value || '',
      imponibile,
      aliquota: num(document.getElementById('ff-aliquota').value),
      fileId, fileName
    };
    pendingFile = null;
    persist(); closeModal(); render();
    toast('Fattura salvata');
  }

  async function delFattura(cantId) {
    const c = state.cantieri.find(x => x.id === cantId);
    if (!confirm('Rimuovere la fattura d\'origine di questo cantiere?')) return;
    if (c.fatturaOrigine && c.fatturaOrigine.fileId) await DB.deleteFile(c.fatturaOrigine.fileId);
    c.fatturaOrigine = null;
    persist(); render(); toast('Fattura rimossa');
  }

  /* ------- Form SPESA (materiale/utensile) ------- */
  let speseTipoSel = 'materiale';

  function spesaForm(ownerId, existing) {
    // ownerId = id cantiere oppure 'generale'
    const s = existing || {};
    speseTipoSel = s.tipo || 'materiale';
    pendingFile = null;
    const body = `
      <div class="field">
        <label>Tipo</label>
        <div class="seg" id="sp-seg">
          <button type="button" data-tipo="materiale" class="${speseTipoSel === 'materiale' ? 'active' : ''}">📦 Materiale</button>
          <button type="button" data-tipo="utensile" class="${speseTipoSel === 'utensile' ? 'active' : ''}">🔧 Utensile</button>
        </div>
      </div>
      <div class="field"><label>Descrizione *</label><input id="sp-desc" type="text" value="${esc(s.descrizione || '')}" placeholder="Es. Cavo FS17 3x2,5 / Trapano"></div>
      <div class="field-row">
        <div class="field"><label>Fornitore</label><input id="sp-forn" type="text" value="${esc(s.fornitore || '')}" placeholder="Es. Elettroforniture SRL"></div>
        <div class="field"><label>N° documento</label><input id="sp-doc" type="text" value="${esc(s.numeroDoc || '')}" placeholder="Es. 1234"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Imponibile (€) *</label><input id="sp-imp" type="number" inputmode="decimal" step="0.01" value="${s.imponibile != null ? s.imponibile : ''}" placeholder="0,00"></div>
        <div class="field"><label>Aliquota IVA</label>${aliquotaSelect('sp-aliq', s.aliquota)}</div>
      </div>
      <div class="field"><label>Data</label><input id="sp-data" type="date" value="${esc(s.data || todayISO())}"></div>
      <div class="iva-preview" id="sp-preview"><span>IVA scalata: —</span><span>Totale: —</span></div>
      <div class="field" style="margin-top:14px">
        <label>Allega documento di spesa (foto/PDF)</label>
        ${fileDrop('sp-file', s.fileName)}
      </div>
    `;
    const foot = `<button class="btn btn-ghost" data-action="close-modal">Annulla</button>
      <button class="btn btn-accent btn-block" data-action="save-spesa" data-owner="${ownerId}" data-id="${s.id || ''}">💾 Salva spesa</button>`;
    openModal(existing ? 'Modifica spesa' : 'Nuova spesa', body, foot);
    // segmented control
    document.getElementById('sp-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tipo]');
      if (!b) return;
      speseTipoSel = b.dataset.tipo;
      document.querySelectorAll('#sp-seg button').forEach(x => x.classList.toggle('active', x === b));
    });
    wireIvaPreview('sp-imp', 'sp-aliq', 'sp-preview', 'IVA scalata');
    wireFileDrop('sp-file');
  }

  async function saveSpesa(ownerId, id) {
    const desc = document.getElementById('sp-desc').value.trim();
    const imponibile = num(document.getElementById('sp-imp').value);
    if (!desc) { toast('Inserisci una descrizione'); return; }
    if (!imponibile) { toast('Inserisci l\'imponibile'); return; }

    const list = ownerId === 'generale'
      ? (state.speseGenerali = state.speseGenerali || [])
      : state.cantieri.find(x => x.id === ownerId).spese;

    let existing = id ? list.find(x => x.id === id) : null;
    let fileId = existing ? existing.fileId : null;
    let fileName = existing ? existing.fileName : null;

    if (pendingFile === 'REMOVE') {
      if (fileId) await DB.deleteFile(fileId);
      fileId = null; fileName = null;
    } else if (pendingFile) {
      if (fileId) await DB.deleteFile(fileId);
      fileId = uid();
      await DB.saveFile(fileId, pendingFile.blob);
      fileName = pendingFile.name;
    }

    const data = {
      descrizione: desc,
      tipo: speseTipoSel,
      fornitore: document.getElementById('sp-forn').value.trim(),
      numeroDoc: document.getElementById('sp-doc').value.trim(),
      imponibile,
      aliquota: num(document.getElementById('sp-aliq').value),
      data: document.getElementById('sp-data').value || '',
      fileId, fileName
    };

    if (existing) { Object.assign(existing, data); toast('Spesa aggiornata'); }
    else { list.unshift(Object.assign({ id: uid() }, data)); toast('Spesa aggiunta'); }

    pendingFile = null;
    persist(); closeModal(); render();
  }

  async function delSpesa(ownerId, id) {
    const list = ownerId === 'generale'
      ? state.speseGenerali
      : state.cantieri.find(x => x.id === ownerId).spese;
    const idx = list.findIndex(x => x.id === id);
    if (idx < 0) return;
    if (!confirm('Eliminare questa spesa?')) return;
    if (list[idx].fileId) await DB.deleteFile(list[idx].fileId);
    list.splice(idx, 1);
    persist(); render(); toast('Spesa eliminata');
  }

  /* ------- Helper form: aliquote, anteprima IVA, file ------- */
  function aliquotaSelect(id, val) {
    const v = val != null ? num(val) : DEFAULT_ALIQUOTA;
    return `<select id="${id}">${ALIQUOTE.map(a => `<option value="${a}" ${a === v ? 'selected' : ''}>${a}%</option>`).join('')}</select>`;
  }

  function wireIvaPreview(impId, aliqId, previewId, label) {
    const upd = () => {
      const imp = num(document.getElementById(impId).value);
      const aliq = num(document.getElementById(aliqId).value);
      const iva = ivaOf(imp, aliq);
      const tot = totaleOf(imp, aliq);
      document.getElementById(previewId).innerHTML =
        `<span>${label || 'IVA'}: ${euro(iva)}</span><span>Totale: ${euro(tot)}</span>`;
    };
    document.getElementById(impId).addEventListener('input', upd);
    document.getElementById(aliqId).addEventListener('change', upd);
    upd();
  }

  function fileDrop(id, currentName) {
    if (currentName) {
      return `<div class="file-drop has-file" id="${id}-drop">
        <div class="file-current">📎 ${esc(currentName)}
          <button type="button" class="btn btn-danger btn-sm" data-removefile="${id}" style="padding:4px 8px;margin-left:6px">Rimuovi</button>
        </div>
        <div style="margin-top:6px;font-size:.76rem">Tocca per sostituire</div>
      </div>
      <input id="${id}" type="file" accept="image/*,application/pdf" capture="environment" class="hidden">`;
    }
    return `<div class="file-drop" id="${id}-drop">📷 Tocca per scattare una foto o scegliere un file<br><span style="font-size:.74rem">Immagine o PDF</span></div>
      <input id="${id}" type="file" accept="image/*,application/pdf" capture="environment" class="hidden">`;
  }

  function wireFileDrop(id) {
    const drop = document.getElementById(id + '-drop');
    const input = document.getElementById(id);
    if (!drop || !input) return;
    drop.addEventListener('click', (e) => {
      if (e.target.closest('[data-removefile]')) return;
      input.click();
    });
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      pendingFile = { blob: file, name: file.name };
      drop.classList.add('has-file');
      drop.innerHTML = `<div class="file-current">📎 ${esc(file.name)}</div><div style="margin-top:6px;font-size:.76rem">Tocca per sostituire</div>`;
    });
  }

  /* ------- Gestione CATEGORIE ------- */
  function categorieManager() {
    const rows = state.categorie.map(c => `
      <div class="cat-item" data-catrow="${c.id}">
        <input type="color" value="${c.colore}" data-catcolor="${c.id}">
        <input type="text" value="${esc(c.nome)}" data-catname="${c.id}" placeholder="Nome categoria">
        <button data-delcat="${c.id}" title="Elimina">🗑️</button>
      </div>`).join('');
    const body = `
      <p class="mini-note">Rinomina, cambia colore o elimina le categorie. Le modifiche si applicano subito ai cantieri.</p>
      <div id="cat-list" style="margin-top:12px">${rows || '<p class="mini-note">Nessuna categoria.</p>'}</div>
      <button class="btn btn-ghost btn-block" data-action="add-categoria" style="margin-top:6px">➕ Aggiungi categoria</button>
    `;
    const foot = `<button class="btn btn-primary btn-block" data-action="save-categorie">💾 Fatto</button>`;
    openModal('Gestione categorie', body, foot);
  }

  function saveCategorie() {
    // aggiorna nomi e colori dai campi
    state.categorie.forEach(c => {
      const n = document.querySelector(`[data-catname="${c.id}"]`);
      const col = document.querySelector(`[data-catcolor="${c.id}"]`);
      if (n) c.nome = n.value.trim() || c.nome;
      if (col) c.colore = col.value;
    });
    persist();
    closeModal();
    // se il filtro punta a una categoria eliminata, torna a "tutte"
    if (dashboardFilter !== 'tutte' && dashboardFilter !== 'nessuna' && !getCategoria(dashboardFilter)) {
      dashboardFilter = 'tutte';
    }
    render();
    toast('Categorie aggiornate');
  }

  function addCategoria() {
    const cat = { id: uid(), nome: 'Nuova categoria', colore: randomColor() };
    state.categorie.push(cat);
    // ripiega i valori correnti dei campi prima di ri-renderizzare la modale
    state.categorie.forEach(c => {
      const n = document.querySelector(`[data-catname="${c.id}"]`);
      const col = document.querySelector(`[data-catcolor="${c.id}"]`);
      if (n) c.nome = n.value.trim() || c.nome;
      if (col) c.colore = col.value;
    });
    categorieManager();
    // focus sull'ultimo campo
    const last = document.querySelector(`[data-catname="${cat.id}"]`);
    if (last) { last.focus(); last.select(); }
  }

  function delCategoria(id) {
    const cat = getCategoria(id);
    const usati = state.cantieri.filter(c => c.categoriaId === id).length;
    const msg = usati
      ? `Eliminare "${cat.nome}"? ${usati} cantiere/i passeranno a "Senza categoria".`
      : `Eliminare la categoria "${cat.nome}"?`;
    if (!confirm(msg)) return;
    // salva prima i valori correnti degli altri campi
    state.categorie.forEach(c => {
      const n = document.querySelector(`[data-catname="${c.id}"]`);
      const col = document.querySelector(`[data-catcolor="${c.id}"]`);
      if (n && c.id !== id) c.nome = n.value.trim() || c.nome;
      if (col && c.id !== id) c.colore = col.value;
    });
    state.categorie = state.categorie.filter(c => c.id !== id);
    state.cantieri.forEach(c => { if (c.categoriaId === id) c.categoriaId = ''; });
    if (dashboardFilter === id) dashboardFilter = 'tutte';
    persist();
    categorieManager();
  }

  function randomColor() {
    const palette = ['#1e5eff', '#ffb300', '#16a34a', '#8b5cf6', '#ef4444', '#0ea5e9', '#f97316', '#14b8a6', '#ec4899'];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  /* ------- Impostazioni / Backup ------- */
  function settingsModal() {
    const g = globalRiepilogo();
    const body = `
      <div class="field">
        <label>Nome impresa</label>
        <input id="set-azienda" type="text" value="${esc(state.azienda || '')}" placeholder="La tua impresa">
      </div>
      <hr class="divider">
      <div class="section-title" style="margin-top:0">💾 Backup dei dati</div>
      <p class="mini-note">I dati sono salvati solo su questo dispositivo. Esporta un backup per non perderli e per spostarli su un altro dispositivo.</p>
      <div class="row-actions">
        <button class="btn btn-primary" data-action="export-backup">⬇️ Esporta backup</button>
        <button class="btn btn-ghost" data-action="import-backup">⬆️ Importa backup</button>
      </div>
      <input id="import-input" type="file" accept="application/json,.json" class="hidden">
      <hr class="divider">
      <div class="section-title" style="margin-top:0">📈 Totali</div>
      <div class="card">
        ${infoRow('Cantieri totali', String(state.cantieri.length))}
        ${infoRow('Attivi', String(state.cantieri.filter(c => c.stato === 'attivo').length))}
        ${infoRow('Completati', String(state.cantieri.filter(c => c.stato === 'completato').length))}
        ${infoRow('IVA netta azienda', euro(Math.abs(g.ivaNetta)) + (g.ivaNetta < 0 ? ' (credito)' : ' (da versare)'))}
        ${infoRow('Margine totale', euro(g.margine))}
      </div>
    `;
    const foot = `<button class="btn btn-primary btn-block" data-action="save-settings">💾 Salva</button>`;
    openModal('Impostazioni', body, foot);
    const imp = document.getElementById('import-input');
    imp.addEventListener('change', doImport);
  }

  function saveSettings() {
    const v = document.getElementById('set-azienda').value.trim();
    if (v) state.azienda = v;
    persist(); closeModal(); updateHeader(); render();
    toast('Impostazioni salvate');
  }

  async function exportBackup() {
    try {
      const backup = await DB.exportAll(state);
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `backup-gestionale-${d}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Backup esportato');
    } catch (e) { console.error(e); toast('Errore durante l\'esportazione'); }
  }

  function doImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('Importare questo backup? I dati attuali verranno sostituiti.')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const backup = JSON.parse(reader.result);
        const newState = await DB.importAll(backup);
        state = normalizeState(newState);
        persist(); closeModal(); updateHeader();
        route = { name: 'dashboard' }; dashboardFilter = 'tutte';
        render();
        toast('Backup importato con successo');
      } catch (err) { console.error(err); toast('File di backup non valido'); }
    };
    reader.readAsText(file);
  }

  /* ============================ EVENT DELEGATION =========================== */
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;
    const id = t.dataset.id;
    const owner = t.dataset.owner;

    switch (action) {
      case 'filter': dashboardFilter = t.dataset.id; render(); break;
      case 'manage-categorie': categorieManager(); break;
      case 'add-categoria': addCategoria(); break;
      case 'save-categorie': saveCategorie(); break;
      case 'open-cantiere': releaseUrls(); route = { name: 'cantiere', id }; render(); break;
      case 'open-archivio': route = { name: 'archivio' }; render(); break;
      case 'back': releaseUrls(); route = { name: 'dashboard' }; render(); break;
      case 'edit-cantiere': cantiereForm(state.cantieri.find(x => x.id === id)); break;
      case 'save-cantiere': saveCantiere(id); break;
      case 'edit-fattura': fatturaForm(id); break;
      case 'save-fattura': await saveFattura(id); break;
      case 'del-fattura': await delFattura(id); break;
      case 'add-spesa': spesaForm(id); break;
      case 'add-spesa-generale': spesaForm('generale'); break;
      case 'edit-spesa': {
        const list = owner === 'generale' ? state.speseGenerali : state.cantieri.find(x => x.id === owner).spese;
        spesaForm(owner, list.find(x => x.id === id));
        break;
      }
      case 'save-spesa': await saveSpesa(owner, id); break;
      case 'del-spesa': await delSpesa(owner, id); break;
      case 'completa': completaCantiere(id); break;
      case 'riapri': riapriCantiere(id); break;
      case 'del-cantiere': await delCantiere(id); break;
      case 'open-file': e.preventDefault(); openFile(t.dataset.file); break;
      case 'del-categoria': delCategoria(id); break;
      case 'close-modal': closeModal(); break;
      case 'settings': settingsModal(); break;
      case 'save-settings': saveSettings(); break;
      case 'export-backup': exportBackup(); break;
      case 'import-backup': document.getElementById('import-input').click(); break;
      case 'new-cantiere': cantiereForm(null); break;
    }
  });

  // pulsanti dinamici dentro modale categorie (elimina)
  document.addEventListener('click', (e) => {
    const del = e.target.closest('[data-delcat]');
    if (del) delCategoria(del.dataset.delcat);
    const rem = e.target.closest('[data-removefile]');
    if (rem) {
      pendingFile = 'REMOVE';
      const dropId = rem.dataset.removefile + '-drop';
      const drop = document.getElementById(dropId);
      if (drop) {
        drop.classList.remove('has-file');
        drop.innerHTML = '📷 Tocca per scattare una foto o scegliere un file<br><span style="font-size:.74rem">Immagine o PDF</span>';
      }
    }
  });

  function completaCantiere(id) {
    const c = state.cantieri.find(x => x.id === id);
    if (!c.fatturaOrigine && !confirm('Questo cantiere non ha una fattura d\'origine allegata. Vuoi comunque segnarlo come completato?')) return;
    c.stato = 'completato';
    if (!c.dataFine) c.dataFine = todayISO();
    persist(); route = { name: 'archivio' }; render();
    toast('Cantiere archiviato tra i completati');
  }
  function riapriCantiere(id) {
    const c = state.cantieri.find(x => x.id === id);
    c.stato = 'attivo';
    persist(); render(); toast('Cantiere riaperto');
  }
  async function delCantiere(id) {
    const c = state.cantieri.find(x => x.id === id);
    if (!confirm(`Eliminare definitivamente il cantiere "${c.nome}" e tutti i suoi dati?`)) return;
    // elimina allegati collegati
    if (c.fatturaOrigine && c.fatturaOrigine.fileId) await DB.deleteFile(c.fatturaOrigine.fileId);
    for (const s of (c.spese || [])) if (s.fileId) await DB.deleteFile(s.fileId);
    state.cantieri = state.cantieri.filter(x => x.id !== id);
    persist(); route = { name: 'dashboard' }; render();
    toast('Cantiere eliminato');
  }

  /* ------------------------------- Avvio ----------------------------------- */
  function normalizeState(s) {
    s = s || DEFAULT_STATE();
    s.azienda = s.azienda || 'La mia impresa';
    s.categorie = Array.isArray(s.categorie) ? s.categorie : [];
    s.cantieri = Array.isArray(s.cantieri) ? s.cantieri : [];
    s.speseGenerali = Array.isArray(s.speseGenerali) ? s.speseGenerali : [];
    s.cantieri.forEach(c => {
      c.spese = Array.isArray(c.spese) ? c.spese : [];
      if (c.fatturaOrigine === undefined) c.fatturaOrigine = null;
      if (!c.stato) c.stato = 'attivo';
    });
    return s;
  }

  async function boot() {
    try {
      const loaded = await DB.loadState();
      state = normalizeState(loaded || DEFAULT_STATE());
      if (!loaded) await DB.saveState(state); // primo avvio
    } catch (e) {
      console.error(e);
      state = DEFAULT_STATE();
      toast('Attenzione: memoria locale non disponibile');
    }
    // FAB e impostazioni
    document.getElementById('fab').addEventListener('click', () => cantiereForm(null));
    render();
  }

  document.addEventListener('DOMContentLoaded', boot);
  window.addEventListener('beforeunload', releaseUrls);
})();
