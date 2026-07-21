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
  // Ritenuta d'acconto (es. 4% ritenuta condominiale): calcolata sull'imponibile
  function ritenutaOf(f) { return f ? num(f.imponibile) * (num(f.ritenuta) / 100) : 0; }
  // Netto effettivamente incassato dal cliente = totale fattura − ritenuta
  function nettoIncassoFattura(f) { return f ? totaleOf(f.imponibile, f.aliquota) - ritenutaOf(f) : 0; }

  // Numerazione automatica: cerca il progressivo massimo dell'anno e incrementa
  function prossimoProgressivo(kind) {
    const y = annoOf(todayISO());
    let max = 0;
    state.cantieri.forEach(c => {
      const n = kind === 'preventivo' ? (c.preventivo && c.preventivo.numero) : (c.fatturaOrigine && c.fatturaOrigine.numero);
      if (!n) return;
      const m = String(n).match(/(\d{4})\s*[\/\-]\s*0*(\d+)/);
      if (m && parseInt(m[1], 10) === y) max = Math.max(max, parseInt(m[2], 10));
    });
    return max + 1;
  }
  function prossimoNumeroFattura() { return annoOf(todayISO()) + '/' + String(prossimoProgressivo('fattura')).padStart(3, '0'); }
  function prossimoNumeroPreventivo() { return 'P-' + annoOf(todayISO()) + '/' + String(prossimoProgressivo('preventivo')).padStart(2, '0'); }

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
    else if (route.name === 'scadenzario') renderScadenzario();
    else if (route.name === 'riepilogo') renderRiepilogoPeriodo();
    else if (route.name === 'statistiche') renderStatistiche();
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
    html += scadenzeBanner();

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

    // --- Strumenti ---
    html += `<div class="section-title" style="margin-top:22px">🧰 Strumenti</div>`;
    html += `<div class="tools-grid tools-3">
      <button class="tool-btn" data-action="open-scadenzario"><span class="ti">💰</span><span>Scadenzario<br>pagamenti</span></button>
      <button class="tool-btn" data-action="open-riepilogo"><span class="ti">📅</span><span>Riepilogo<br>IVA</span></button>
      <button class="tool-btn" data-action="open-statistiche"><span class="ti">📈</span><span>Statistiche<br>azienda</span></button>
    </div>`;

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

    // Preventivo
    html += preventivoSection(c);

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
      if (num(f.ritenuta) > 0) {
        html += infoRow(`Ritenuta d'acconto (${f.ritenuta}%)`, `−${euro(ritenutaOf(f))}`);
        html += infoRow('Netto a incassare', `<b>${euro(nettoIncassoFattura(f))}</b>`);
      }
      html += infoRow('Stato incasso', f.incassato
        ? `<span class="pay-badge paid">✅ Incassata</span>`
        : `<span class="pay-badge due">⏳ Da incassare</span>`);
      if (f.fileId) {
        html += `<div style="margin-top:10px"><a class="attachment-link" data-action="open-file" data-file="${f.fileId}" href="#">📎 ${esc(f.fileName || 'Allegato')}</a></div>`;
      }
      html += `<div class="row-actions">
        <button class="btn ${f.incassato ? 'btn-ghost' : 'btn-ok'} btn-sm" data-action="toggle-incasso" data-id="${c.id}">${f.incassato ? '↩️ Segna da incassare' : '💰 Segna incassata'}</button>
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

    // Galleria foto
    html += fotoSection(c);

    // Azioni cantiere
    html += `<hr class="divider">`;
    html += `<div class="row-actions">
      <button class="btn btn-ghost btn-block" data-action="stampa-cantiere" data-id="${c.id}">🖨️ Stampa scheda / salva PDF</button>
    </div>`;
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
    const payBadge = s.pagato ? `<span class="pay-badge paid">✅ Pagata</span>` : `<span class="pay-badge due">⏳ Da pagare</span>`;
    return `<div class="expense-row">
      <div class="ex-icon">${icon}</div>
      <div class="ex-body">
        <div class="ex-title">${esc(s.descrizione || (s.tipo === 'utensile' ? 'Utensile' : 'Materiale'))} <span class="tag-tipo">${s.tipo === 'utensile' ? 'UTENSILE' : 'MATERIALE'}</span></div>
        <div class="ex-sub">${esc(sub || '—')}</div>
        <div style="margin-top:4px">${payBadge}</div>
        ${fileLink}
      </div>
      <div class="ex-amount">
        <div class="tot">${euro(tot)}</div>
        <div class="iva">IVA ${euro(iva)} (${s.aliquota}%)</div>
        <div style="margin-top:6px;display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn ${s.pagato ? 'btn-ghost' : 'btn-ok'} btn-sm" data-action="toggle-pagato" data-owner="${ownerId}" data-id="${s.id}" style="padding:5px 8px" title="${s.pagato ? 'Segna da pagare' : 'Segna pagata'}">${s.pagato ? '↩️' : '💶'}</button>
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
  // Carica le miniature delle foto (Blob da IndexedDB -> object URL) dopo il render.
  async function caricaAllegatiVisibili() {
    const imgs = document.querySelectorAll('img[data-thumb]');
    for (const img of imgs) {
      if (img.dataset.loaded) continue;
      const id = img.dataset.thumb;
      try {
        const blob = await DB.getFile(id);
        if (blob) {
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          img.src = url;
          img.dataset.loaded = '1';
        }
      } catch (e) { /* ignora */ }
    }
  }

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
      const c = Object.assign({ id: uid(), stato: 'attivo', fatturaOrigine: null, preventivo: null, spese: [], foto: [] }, data);
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
    const numeroVal = c.fatturaOrigine ? (f.numero || '') : prossimoNumeroFattura();
    pendingFile = null;
    const body = `
      <div class="field-row">
        <div class="field"><label>Numero fattura</label><input id="ff-numero" type="text" value="${esc(numeroVal)}" placeholder="Es. 2026/014"></div>
        <div class="field"><label>Data</label><input id="ff-data" type="date" value="${esc(f.data || todayISO())}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Imponibile (€) *</label><input id="ff-imponibile" type="number" inputmode="decimal" step="0.01" value="${f.imponibile != null ? f.imponibile : ''}" placeholder="0,00"></div>
        <div class="field"><label>Aliquota IVA</label>${aliquotaSelect('ff-aliquota', f.aliquota)}</div>
      </div>
      <div class="field">
        <label>Ritenuta d'acconto (%)</label>
        <input id="ff-ritenuta" type="number" inputmode="decimal" step="0.01" value="${f.ritenuta != null ? f.ritenuta : 0}" placeholder="0">
        <div class="hint">Es. 4% ritenuta condominiale. Lascia 0 se non si applica.</div>
      </div>
      <div class="iva-preview" id="ff-preview"><span>IVA: —</span><span>Totale: —</span></div>
      <div class="iva-preview" id="ff-netto" style="margin-top:6px;display:none"></div>
      <div class="field" style="margin-top:14px">
        <label>Allega fattura (foto o PDF)</label>
        ${fileDrop('ff-file', f.fileName)}
      </div>
    `;
    const foot = `<button class="btn btn-ghost" data-action="close-modal">Annulla</button>
      <button class="btn btn-primary btn-block" data-action="save-fattura" data-id="${cantId}">💾 Salva fattura</button>`;
    openModal('Fattura d\'origine', body, foot);
    wireFatturaPreview();
    wireFileDrop('ff-file');
  }

  function wireFatturaPreview() {
    const upd = () => {
      const imp = num(document.getElementById('ff-imponibile').value);
      const aliq = num(document.getElementById('ff-aliquota').value);
      const rit = num(document.getElementById('ff-ritenuta').value);
      const iva = ivaOf(imp, aliq);
      const tot = imp + iva;
      document.getElementById('ff-preview').innerHTML = `<span>IVA: ${euro(iva)}</span><span>Totale: ${euro(tot)}</span>`;
      const nettoEl = document.getElementById('ff-netto');
      const ritImporto = imp * rit / 100;
      if (rit > 0) {
        nettoEl.style.display = '';
        nettoEl.innerHTML = `<span>Ritenuta ${rit}%: −${euro(ritImporto)}</span><span>Netto a incassare: ${euro(tot - ritImporto)}</span>`;
      } else {
        nettoEl.style.display = 'none';
      }
    };
    document.getElementById('ff-imponibile').addEventListener('input', upd);
    document.getElementById('ff-aliquota').addEventListener('change', upd);
    document.getElementById('ff-ritenuta').addEventListener('input', upd);
    upd();
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
      ritenuta: num(document.getElementById('ff-ritenuta').value),
      incassato: prev.incassato || false,
      dataIncasso: prev.dataIncasso || null,
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
  let pendingLogo = null; // null = invariato, 'REMOVE' = rimuovi, dataURL = nuovo

  function settingsModal() {
    const g = globalRiepilogo();
    pendingLogo = null;
    const body = `
      <div class="section-title" style="margin-top:0">🏢 Dati impresa</div>
      <div class="logo-setting">
        <div class="logo-preview" id="logo-preview">${state.logo ? `<img src="${state.logo}" alt="logo">` : '<span>Nessun<br>logo</span>'}</div>
        <div style="flex:1">
          <button class="btn btn-ghost btn-sm" data-action="upload-logo" type="button">🖼️ ${state.logo ? 'Cambia' : 'Carica'} logo</button>
          <button class="btn btn-danger btn-sm" data-action="remove-logo" type="button" id="btn-remove-logo" style="margin-left:6px;${state.logo ? '' : 'display:none'}">Rimuovi</button>
          <div class="hint" style="margin-top:6px">Comparirà in cima ai PDF (scheda cantiere e report).</div>
        </div>
      </div>
      <input id="logo-input" type="file" accept="image/*" class="hidden">
      <div class="field" style="margin-top:12px">
        <label>Nome impresa</label>
        <input id="set-azienda" type="text" value="${esc(state.azienda || '')}" placeholder="La tua impresa">
      </div>
      <div class="field-row">
        <div class="field"><label>P.IVA / C.F.</label><input id="set-piva" type="text" value="${esc(state.partitaIva || '')}" placeholder="IT01234567890"></div>
        <div class="field"><label>Telefono</label><input id="set-tel" type="text" value="${esc(state.telefono || '')}" placeholder="333 1234567"></div>
      </div>
      <div class="field"><label>Indirizzo</label><input id="set-indirizzo" type="text" value="${esc(state.indirizzoAzienda || '')}" placeholder="Via, città"></div>
      <div class="field"><label>Email</label><input id="set-email" type="email" value="${esc(state.email || '')}" placeholder="info@impresa.it"></div>
      <hr class="divider">
      <div class="section-title" style="margin-top:0">💾 Backup dei dati</div>
      <p class="mini-note">I dati sono salvati solo su questo dispositivo. Esporta un backup per non perderli e per spostarli su un altro dispositivo.</p>
      <div class="row-actions">
        <button class="btn btn-primary" data-action="export-backup">⬇️ Esporta backup</button>
        <button class="btn btn-ghost" data-action="import-backup">⬆️ Importa backup</button>
      </div>
      <input id="import-input" type="file" accept="application/json,.json" class="hidden">
      <hr class="divider">
      <div class="section-title" style="margin-top:0">🧪 Prova rapida</div>
      <p class="mini-note">Carica alcuni cantieri di esempio già compilati (fatture, spese, preventivo, cantiere completato) per esplorare tutte le funzioni. Potrai eliminarli quando vuoi.</p>
      <button class="btn btn-ghost btn-block" data-action="carica-demo" style="margin-top:10px">🧪 Carica dati dimostrativi</button>
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
    const logoInput = document.getElementById('logo-input');
    if (logoInput) logoInput.addEventListener('change', () => {
      const file = logoInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        pendingLogo = reader.result;
        const pv = document.getElementById('logo-preview');
        if (pv) pv.innerHTML = `<img src="${reader.result}" alt="logo">`;
        const rb = document.getElementById('btn-remove-logo');
        if (rb) rb.style.display = '';
      };
      reader.readAsDataURL(file);
    });
  }

  function saveSettings() {
    const v = document.getElementById('set-azienda').value.trim();
    if (v) state.azienda = v;
    state.partitaIva = document.getElementById('set-piva').value.trim();
    state.telefono = document.getElementById('set-tel').value.trim();
    state.indirizzoAzienda = document.getElementById('set-indirizzo').value.trim();
    state.email = document.getElementById('set-email').value.trim();
    if (pendingLogo === 'REMOVE') state.logo = null;
    else if (pendingLogo) state.logo = pendingLogo;
    pendingLogo = null;
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
      case 'carica-demo': caricaDatiDemo(); break;
      case 'upload-logo': document.getElementById('logo-input').click(); break;
      case 'remove-logo': {
        pendingLogo = 'REMOVE';
        const pv = document.getElementById('logo-preview');
        if (pv) pv.innerHTML = '<span>Nessun<br>logo</span>';
        const rb = document.getElementById('btn-remove-logo');
        if (rb) rb.style.display = 'none';
        break;
      }
      case 'new-cantiere': cantiereForm(null); break;
      // --- nuove funzionalità ---
      case 'open-scadenzario': releaseUrls(); route = { name: 'scadenzario' }; render(); break;
      case 'open-riepilogo': releaseUrls(); route = { name: 'riepilogo' }; render(); break;
      case 'open-statistiche': releaseUrls(); route = { name: 'statistiche' }; render(); break;
      case 'set-anno-stats': statsAnno = t.dataset.anno ? parseInt(t.dataset.anno, 10) : null; render(); break;
      case 'stampa-report': stampaReportAnnuale(statsAnno); break;
      case 'toggle-incasso': toggleIncasso(id); break;
      case 'toggle-pagato': togglePagato(owner, id); break;
      case 'set-anno': riepilogoAnno = parseInt(t.dataset.anno, 10); render(); break;
      case 'stampa-riepilogo': stampaRiepilogo(riepilogoAnno); break;
      case 'export-csv-riepilogo': exportCSVRiepilogo(riepilogoAnno); break;
      case 'export-csv-movimenti': exportCSVMovimenti(riepilogoAnno); break;
      case 'add-preventivo': case 'edit-preventivo': preventivoForm(id); break;
      case 'save-preventivo': savePreventivo(id); break;
      case 'del-preventivo': delPreventivo(id); break;
      case 'converti-preventivo': convertiPreventivo(id); break;
      case 'pv-add-voce':
        preventivoVoci.push({ descrizione: '', quantita: 1, prezzoUnitario: 0 });
        renderVociInputs();
        break;
      case 'add-foto': addFoto(id); break;
      case 'del-foto': await delFoto(id, t.dataset.foto); break;
      case 'stampa-cantiere': stampaCantiere(id); break;
    }
  });

  // Sincronizza le voci del preventivo mentre si digita
  document.addEventListener('input', (e) => {
    const vf = e.target.closest('[data-vfield]');
    if (!vf) return;
    const i = parseInt(vf.dataset.i, 10);
    if (!preventivoVoci[i]) return;
    const field = vf.dataset.vfield;
    preventivoVoci[i][field] = field === 'descrizione' ? vf.value : vf.value;
    updatePvTotal();
  });

  // pulsanti dinamici dentro modale categorie (elimina)
  document.addEventListener('click', (e) => {
    const del = e.target.closest('[data-delcat]');
    if (del) delCategoria(del.dataset.delcat);
    const dv = e.target.closest('[data-delvoce]');
    if (dv) {
      const i = parseInt(dv.dataset.delvoce, 10);
      preventivoVoci.splice(i, 1);
      if (!preventivoVoci.length) preventivoVoci.push({ descrizione: '', quantita: 1, prezzoUnitario: 0 });
      renderVociInputs();
    }
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
    for (const f of (c.foto || [])) if (f.fileId) await DB.deleteFile(f.fileId);
    state.cantieri = state.cantieri.filter(x => x.id !== id);
    persist(); route = { name: 'dashboard' }; render();
    toast('Cantiere eliminato');
  }

  /* ------------------------------- Avvio ----------------------------------- */
  function normalizeState(s) {
    s = s || DEFAULT_STATE();
    s.azienda = s.azienda || 'La mia impresa';
    s.partitaIva = s.partitaIva || '';
    s.telefono = s.telefono || '';
    s.indirizzoAzienda = s.indirizzoAzienda || '';
    s.email = s.email || '';
    s.logo = s.logo || null;
    s.categorie = Array.isArray(s.categorie) ? s.categorie : [];
    s.cantieri = Array.isArray(s.cantieri) ? s.cantieri : [];
    s.speseGenerali = Array.isArray(s.speseGenerali) ? s.speseGenerali : [];
    s.cantieri.forEach(c => {
      c.spese = Array.isArray(c.spese) ? c.spese : [];
      c.foto = Array.isArray(c.foto) ? c.foto : [];
      if (c.fatturaOrigine === undefined) c.fatturaOrigine = null;
      if (c.preventivo === undefined) c.preventivo = null;
      if (c.fatturaOrigine && c.fatturaOrigine.incassato === undefined) c.fatturaOrigine.incassato = false;
      if (c.fatturaOrigine && c.fatturaOrigine.ritenuta === undefined) c.fatturaOrigine.ritenuta = 0;
      c.spese.forEach(sp => { if (sp.pagato === undefined) sp.pagato = false; });
      if (!c.stato) c.stato = 'attivo';
    });
    (s.speseGenerali || []).forEach(sp => { if (sp.pagato === undefined) sp.pagato = false; });
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

  /* =========================================================================
     NUOVE FUNZIONALITÀ
     - Scadenzario pagamenti (fatture da incassare / spese da pagare)
     - Riepilogo IVA per trimestre/anno
     - Preventivi (con conversione in fattura d'origine)
     - Galleria foto per cantiere
     - Esportazione CSV (Excel) e stampa/PDF
     ========================================================================= */

  /* ------------------------ Helper periodo (anno/trimestre) --------------- */
  function annoOf(iso) { return iso ? parseInt(String(iso).slice(0, 4), 10) : 0; }
  function trimestreOf(iso) {
    const m = iso ? parseInt(String(iso).slice(5, 7), 10) : 0; // 1-12
    return Math.floor((m - 1) / 3) + 1; // 1-4
  }
  function anniDisponibili() {
    const set = new Set();
    const add = d => { const y = annoOf(d); if (y) set.add(y); };
    state.cantieri.forEach(c => { if (c.fatturaOrigine) add(c.fatturaOrigine.data); (c.spese || []).forEach(s => add(s.data)); });
    (state.speseGenerali || []).forEach(s => add(s.data));
    set.add(annoOf(todayISO()));
    return Array.from(set).filter(Boolean).sort((a, b) => b - a);
  }
  function datiTrimestrali(year) {
    const tri = [{ debito: 0, credito: 0 }, { debito: 0, credito: 0 }, { debito: 0, credito: 0 }, { debito: 0, credito: 0 }];
    state.cantieri.forEach(c => {
      const f = c.fatturaOrigine;
      if (f && annoOf(f.data) === year) tri[trimestreOf(f.data) - 1].debito += ivaOf(f.imponibile, f.aliquota);
      (c.spese || []).forEach(s => { if (annoOf(s.data) === year) tri[trimestreOf(s.data) - 1].credito += ivaOf(s.imponibile, s.aliquota); });
    });
    (state.speseGenerali || []).forEach(s => { if (annoOf(s.data) === year) tri[trimestreOf(s.data) - 1].credito += ivaOf(s.imponibile, s.aliquota); });
    return tri;
  }

  /* ------------------------------ Scadenzario ----------------------------- */
  function scadenzeTotali() {
    let daIncassare = 0, daPagare = 0;
    state.cantieri.forEach(c => {
      if (c.fatturaOrigine && !c.fatturaOrigine.incassato) daIncassare += nettoIncassoFattura(c.fatturaOrigine);
      (c.spese || []).forEach(s => { if (!s.pagato) daPagare += totaleOf(s.imponibile, s.aliquota); });
    });
    (state.speseGenerali || []).forEach(s => { if (!s.pagato) daPagare += totaleOf(s.imponibile, s.aliquota); });
    return { daIncassare, daPagare };
  }

  function scadenzeBanner() {
    const t = scadenzeTotali();
    if (!t.daIncassare && !t.daPagare) return '';
    return `<button class="scad-banner" data-action="open-scadenzario">
      <span>💰 Da incassare<br><b>${euro(t.daIncassare)}</b></span>
      <span class="sep"></span>
      <span>💶 Da pagare<br><b>${euro(t.daPagare)}</b></span>
    </button>`;
  }

  function renderScadenzario() {
    const daIncassare = [], incassate = [], daPagare = [], pagate = [];
    state.cantieri.forEach(c => {
      if (c.fatturaOrigine) {
        const f = c.fatturaOrigine;
        const item = {
          kind: 'fattura', cantId: c.id, titolo: c.nome,
          sub: [f.numero ? 'Fatt. ' + f.numero : 'Fattura', c.cliente, fmtDate(f.data)].filter(Boolean).join(' · '),
          tot: nettoIncassoFattura(f)
        };
        (f.incassato ? incassate : daIncassare).push(item);
      }
      (c.spese || []).forEach(s => {
        const item = {
          kind: 'spesa', owner: c.id, id: s.id, cantId: c.id, titolo: s.descrizione || 'Spesa',
          sub: [c.nome, s.fornitore, fmtDate(s.data)].filter(Boolean).join(' · '),
          tot: totaleOf(s.imponibile, s.aliquota)
        };
        (s.pagato ? pagate : daPagare).push(item);
      });
    });
    (state.speseGenerali || []).forEach(s => {
      const item = {
        kind: 'spesa', owner: 'generale', id: s.id, titolo: s.descrizione || 'Spesa generale',
        sub: ['Spesa generale', s.fornitore, fmtDate(s.data)].filter(Boolean).join(' · '),
        tot: totaleOf(s.imponibile, s.aliquota)
      };
      (s.pagato ? pagate : daPagare).push(item);
    });

    const sum = arr => arr.reduce((a, i) => a + i.tot, 0);

    let html = `<section class="view">`;
    html += `<div class="detail-header">
      <button class="back-btn" data-action="back">←</button>
      <div style="flex:1 1 auto"><h2>💰 Scadenzario pagamenti</h2>
      <div class="dh-sub">Fatture da incassare e spese da pagare</div></div>
    </div>`;

    html += `<div class="summary-grid" style="grid-template-columns:repeat(2,1fr)">
      <div class="stat netta"><div class="label">Da incassare</div><div class="value" style="color:var(--ok)">${euro(sum(daIncassare))}</div><div class="hint">${daIncassare.length} fatture</div></div>
      <div class="stat netta"><div class="label">Da pagare</div><div class="value" style="color:var(--warn)">${euro(sum(daPagare))}</div><div class="hint">${daPagare.length} spese</div></div>
    </div>`;

    html += scadGroup('⏳ Fatture da incassare', daIncassare, false);
    html += scadGroup('⏳ Spese da pagare', daPagare, false);
    html += scadGroup('✅ Fatture incassate', incassate, true);
    html += scadGroup('✅ Spese pagate', pagate, true);

    if (!daIncassare.length && !incassate.length && !daPagare.length && !pagate.length) {
      html += emptyState('💰', 'Nessun movimento', 'Aggiungi fatture e spese ai cantieri per vedere qui lo scadenzario.');
    }
    html += `</section>`;
    app().innerHTML = html;
    document.getElementById('fab').classList.add('hidden');
  }

  function scadGroup(title, items, done) {
    if (!items.length) return '';
    let h = `<div class="section-title">${title} <span class="count">${items.length}</span></div>`;
    h += `<div class="card">`;
    h += items.map(i => {
      const toggle = i.kind === 'fattura'
        ? `<button class="btn ${done ? 'btn-ghost' : 'btn-ok'} btn-sm" data-action="toggle-incasso" data-id="${i.cantId}" style="padding:6px 10px">${done ? '↩️' : '✅'}</button>`
        : `<button class="btn ${done ? 'btn-ghost' : 'btn-ok'} btn-sm" data-action="toggle-pagato" data-owner="${i.owner}" data-id="${i.id}" style="padding:6px 10px">${done ? '↩️' : '✅'}</button>`;
      const openAttr = i.cantId ? `data-action="open-cantiere" data-id="${i.cantId}"` : '';
      return `<div class="expense-row">
        <div class="ex-body" ${openAttr} style="cursor:${i.cantId ? 'pointer' : 'default'}">
          <div class="ex-title">${esc(i.titolo)}</div>
          <div class="ex-sub">${esc(i.sub)}</div>
        </div>
        <div class="ex-amount">
          <div class="tot">${euro(i.tot)}</div>
          <div style="margin-top:6px">${toggle}</div>
        </div>
      </div>`;
    }).join('');
    h += `</div>`;
    return h;
  }

  function toggleIncasso(cantId) {
    const c = state.cantieri.find(x => x.id === cantId);
    if (!c || !c.fatturaOrigine) return;
    c.fatturaOrigine.incassato = !c.fatturaOrigine.incassato;
    if (c.fatturaOrigine.incassato) c.fatturaOrigine.dataIncasso = todayISO();
    persist(); render();
    toast(c.fatturaOrigine.incassato ? 'Fattura incassata ✅' : 'Fattura da incassare');
  }
  function togglePagato(owner, id) {
    const list = owner === 'generale' ? state.speseGenerali : state.cantieri.find(x => x.id === owner).spese;
    const s = list.find(x => x.id === id);
    if (!s) return;
    s.pagato = !s.pagato;
    if (s.pagato) s.dataPagamento = todayISO();
    persist(); render();
    toast(s.pagato ? 'Spesa pagata ✅' : 'Spesa da pagare');
  }

  /* -------------------------- Riepilogo IVA periodo ----------------------- */
  let riepilogoAnno = null;

  function renderRiepilogoPeriodo() {
    const anni = anniDisponibili();
    if (riepilogoAnno == null || anni.indexOf(riepilogoAnno) < 0) riepilogoAnno = anni[0];
    const tri = datiTrimestrali(riepilogoAnno);
    const totDeb = tri.reduce((a, t) => a + t.debito, 0);
    const totCre = tri.reduce((a, t) => a + t.credito, 0);

    let html = `<section class="view">`;
    html += `<div class="detail-header">
      <button class="back-btn" data-action="back">←</button>
      <div style="flex:1 1 auto"><h2>📅 Riepilogo IVA</h2>
      <div class="dh-sub">Liquidazione per trimestre e anno</div></div>
    </div>`;

    html += `<div class="chips">` + anni.map(y =>
      `<button class="chip ${y === riepilogoAnno ? 'active' : ''}" data-action="set-anno" data-anno="${y}">${y}</button>`).join('') + `</div>`;

    html += `<div class="card" style="margin-top:8px">`;
    html += `<div class="tri-head"><span>Periodo ${riepilogoAnno}</span><span>Debito</span><span>Credito</span><span>Netta</span></div>`;
    const nomiTri = ['1° trim. (gen–mar)', '2° trim. (apr–giu)', '3° trim. (lug–set)', '4° trim. (ott–dic)'];
    tri.forEach((t, i) => {
      const netta = t.debito - t.credito;
      html += `<div class="tri-row">
        <span class="tri-nome">${nomiTri[i]}</span>
        <span>${euro(t.debito)}</span>
        <span style="color:var(--ok)">${euro(t.credito)}</span>
        <span style="font-weight:800;color:${netta < 0 ? 'var(--ok)' : 'var(--warn)'}">${euro(Math.abs(netta))}${netta < 0 ? ' C' : ''}</span>
      </div>`;
    });
    const nettaAnno = totDeb - totCre;
    html += `<div class="tri-row tri-tot">
      <span class="tri-nome">Totale ${riepilogoAnno}</span>
      <span>${euro(totDeb)}</span>
      <span style="color:var(--ok)">${euro(totCre)}</span>
      <span style="font-weight:800;color:${nettaAnno < 0 ? 'var(--ok)' : 'var(--warn)'}">${euro(Math.abs(nettaAnno))}${nettaAnno < 0 ? ' C' : ''}</span>
    </div>`;
    html += `</div>`;
    html += `<p class="mini-note" style="text-align:center">Netta = IVA a debito − IVA a credito. "C" = a tuo credito. I movimenti sono attribuiti al trimestre in base alla loro data.</p>`;

    html += `<div class="section-title">📤 Esporta</div>`;
    html += `<div class="tools-grid tools-3">
      <button class="tool-btn" data-action="stampa-riepilogo"><span class="ti">🖨️</span><span>Stampa /<br>PDF</span></button>
      <button class="tool-btn" data-action="export-csv-riepilogo"><span class="ti">📊</span><span>CSV<br>riepilogo</span></button>
      <button class="tool-btn" data-action="export-csv-movimenti"><span class="ti">📋</span><span>CSV<br>movimenti</span></button>
    </div>`;

    html += `</section>`;
    app().innerHTML = html;
    document.getElementById('fab').classList.add('hidden');
  }

  /* ------------------------------ Preventivi ------------------------------ */
  let preventivoVoci = [];

  function statoPreventivoLabel(s) {
    return { bozza: '📝 Bozza', inviato: '📤 Inviato', accettato: '✅ Accettato', rifiutato: '❌ Rifiutato' }[s] || s;
  }
  function preventivoImponibile(p) {
    return (p.voci || []).reduce((a, v) => a + num(v.quantita) * num(v.prezzoUnitario), 0);
  }

  function preventivoSection(c) {
    let h = `<div class="section-title">📝 Preventivo</div>`;
    h += `<div class="card">`;
    if (c.preventivo) {
      const p = c.preventivo;
      const imp = preventivoImponibile(p);
      h += infoRow('Numero', p.numero || '—');
      h += infoRow('Data', fmtDate(p.data));
      h += infoRow('Stato', `<span class="prev-badge s-${p.stato}">${statoPreventivoLabel(p.stato)}</span>`);
      if (p.voci && p.voci.length) {
        h += `<div class="voci-table">` + p.voci.map(v =>
          `<div class="voce-line"><span class="d">${esc(v.descrizione || '—')}</span><span class="q">${num(v.quantita)} × ${euro(v.prezzoUnitario)}</span><span class="t">${euro(num(v.quantita) * num(v.prezzoUnitario))}</span></div>`).join('') + `</div>`;
      }
      h += infoRow('Imponibile', euro(imp));
      h += infoRow(`IVA (${p.aliquota}%)`, euro(ivaOf(imp, p.aliquota)));
      h += infoRow('Totale preventivo', `<b>${euro(totaleOf(imp, p.aliquota))}</b>`);
      if (p.note) h += `<p class="mini-note" style="margin-top:8px">${esc(p.note)}</p>`;
      h += `<div class="row-actions">
        <button class="btn btn-ok btn-sm" data-action="converti-preventivo" data-id="${c.id}">➡️ Converti in fattura</button>
        <button class="btn btn-ghost btn-sm" data-action="edit-preventivo" data-id="${c.id}">✏️ Modifica</button>
        <button class="btn btn-danger btn-sm" data-action="del-preventivo" data-id="${c.id}">🗑️</button>
      </div>`;
    } else {
      h += `<p class="mini-note">Crea un preventivo con le voci di lavoro. Quando il cliente accetta, lo converti in fattura d'origine con un tocco.</p>`;
      h += `<button class="btn btn-ghost btn-block" style="margin-top:12px" data-action="add-preventivo" data-id="${c.id}">➕ Crea preventivo</button>`;
    }
    h += `</div>`;
    return h;
  }

  function preventivoForm(cantId) {
    const c = state.cantieri.find(x => x.id === cantId);
    const p = c.preventivo || { numero: prossimoNumeroPreventivo(), data: todayISO(), aliquota: DEFAULT_ALIQUOTA, stato: 'bozza', note: '', voci: [] };
    preventivoVoci = (p.voci && p.voci.length) ? p.voci.map(v => ({ descrizione: v.descrizione, quantita: v.quantita, prezzoUnitario: v.prezzoUnitario }))
      : [{ descrizione: '', quantita: 1, prezzoUnitario: 0 }];
    const body = `
      <div class="field-row">
        <div class="field"><label>Numero preventivo</label><input id="pv-num" type="text" value="${esc(p.numero || '')}" placeholder="Es. P-2026/07"></div>
        <div class="field"><label>Data</label><input id="pv-data" type="date" value="${esc(p.data || todayISO())}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Aliquota IVA</label>${aliquotaSelect('pv-aliq', p.aliquota)}</div>
        <div class="field"><label>Stato</label>
          <select id="pv-stato">${['bozza', 'inviato', 'accettato', 'rifiutato'].map(s => `<option value="${s}" ${p.stato === s ? 'selected' : ''}>${statoPreventivoLabel(s)}</option>`).join('')}</select>
        </div>
      </div>
      <label style="display:block;font-size:.8rem;font-weight:700;color:var(--text-soft);margin-bottom:6px">Voci del preventivo</label>
      <div id="pv-voci"></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="pv-add-voce" style="margin-top:4px">➕ Aggiungi voce</button>
      <div class="iva-preview" id="pv-tot" style="margin-top:12px"></div>
      <div class="field" style="margin-top:12px"><label>Note</label><textarea id="pv-note" placeholder="Condizioni, tempi, validità offerta...">${esc(p.note || '')}</textarea></div>
    `;
    const foot = `<button class="btn btn-ghost" data-action="close-modal">Annulla</button>
      <button class="btn btn-primary btn-block" data-action="save-preventivo" data-id="${cantId}">💾 Salva preventivo</button>`;
    openModal(c.preventivo ? 'Modifica preventivo' : 'Nuovo preventivo', body, foot);
    renderVociInputs();
    const aliq = document.getElementById('pv-aliq');
    if (aliq) aliq.addEventListener('change', updatePvTotal);
  }

  function renderVociInputs() {
    const box = document.getElementById('pv-voci');
    if (!box) return;
    box.innerHTML = preventivoVoci.map((v, i) => `
      <div class="voce-input" data-voce="${i}">
        <input type="text" data-vfield="descrizione" data-i="${i}" value="${esc(v.descrizione || '')}" placeholder="Descrizione voce">
        <div class="voce-nums">
          <input type="number" inputmode="decimal" step="0.01" data-vfield="quantita" data-i="${i}" value="${v.quantita}" placeholder="Q.tà" aria-label="Quantità">
          <span class="times">×</span>
          <input type="number" inputmode="decimal" step="0.01" data-vfield="prezzoUnitario" data-i="${i}" value="${v.prezzoUnitario}" placeholder="Prezzo €" aria-label="Prezzo unitario">
          <button type="button" class="voce-del" data-delvoce="${i}" title="Rimuovi voce">🗑️</button>
        </div>
      </div>`).join('');
    updatePvTotal();
  }

  function updatePvTotal() {
    const el = document.getElementById('pv-tot');
    if (!el) return;
    const imp = preventivoVoci.reduce((a, v) => a + num(v.quantita) * num(v.prezzoUnitario), 0);
    const aliqEl = document.getElementById('pv-aliq');
    const aliq = aliqEl ? num(aliqEl.value) : DEFAULT_ALIQUOTA;
    el.innerHTML = `<span>Imponibile: ${euro(imp)}</span><span>Totale: ${euro(totaleOf(imp, aliq))}</span>`;
  }

  function savePreventivo(cantId) {
    const c = state.cantieri.find(x => x.id === cantId);
    const voci = preventivoVoci
      .map(v => ({ descrizione: (v.descrizione || '').trim(), quantita: num(v.quantita), prezzoUnitario: num(v.prezzoUnitario) }))
      .filter(v => v.descrizione || v.prezzoUnitario);
    if (!voci.length) { toast('Aggiungi almeno una voce con descrizione o prezzo'); return; }
    c.preventivo = {
      numero: document.getElementById('pv-num').value.trim(),
      data: document.getElementById('pv-data').value || '',
      aliquota: num(document.getElementById('pv-aliq').value),
      stato: document.getElementById('pv-stato').value,
      note: document.getElementById('pv-note').value.trim(),
      voci
    };
    persist(); closeModal(); render(); toast('Preventivo salvato');
  }

  function delPreventivo(cantId) {
    const c = state.cantieri.find(x => x.id === cantId);
    if (!confirm('Eliminare il preventivo di questo cantiere?')) return;
    c.preventivo = null;
    persist(); render(); toast('Preventivo eliminato');
  }

  function convertiPreventivo(cantId) {
    const c = state.cantieri.find(x => x.id === cantId);
    if (!c.preventivo) return;
    if (c.fatturaOrigine && !confirm('Esiste già una fattura d\'origine: sostituire imponibile e aliquota con quelli del preventivo? (l\'allegato viene mantenuto)')) return;
    const imp = preventivoImponibile(c.preventivo);
    const prevFile = c.fatturaOrigine ? { fileId: c.fatturaOrigine.fileId, fileName: c.fatturaOrigine.fileName } : { fileId: null, fileName: null };
    c.fatturaOrigine = {
      numero: c.fatturaOrigine ? c.fatturaOrigine.numero : '',
      data: todayISO(),
      imponibile: imp,
      aliquota: c.preventivo.aliquota,
      incassato: c.fatturaOrigine ? !!c.fatturaOrigine.incassato : false,
      fileId: prevFile.fileId, fileName: prevFile.fileName
    };
    c.preventivo.stato = 'accettato';
    persist(); render(); toast('Preventivo convertito in fattura d\'origine');
  }

  /* ------------------------------ Galleria foto --------------------------- */
  function fotoSection(c) {
    const foto = c.foto || [];
    let h = `<div class="section-title">🖼️ Foto del cantiere <span class="count">${foto.length}</span></div>`;
    h += `<div class="card">`;
    if (foto.length) {
      h += `<div class="foto-grid">` + foto.map(f =>
        `<div class="foto-item">
          <img data-thumb="${f.fileId}" data-action="open-file" data-file="${f.fileId}" alt="${esc(f.caption || 'Foto cantiere')}">
          <button class="foto-del" data-action="del-foto" data-id="${c.id}" data-foto="${f.id}" title="Elimina foto">✕</button>
        </div>`).join('') + `</div>`;
    } else {
      h += `<p class="mini-note">Documenta i lavori con foto (prima / durante / dopo). Tocca una foto per aprirla a schermo intero.</p>`;
    }
    h += `<input id="foto-input-${c.id}" type="file" accept="image/*" capture="environment" class="hidden" multiple>`;
    h += `<button class="btn btn-ghost btn-block" style="margin-top:12px" data-action="add-foto" data-id="${c.id}">📷 Aggiungi foto</button>`;
    h += `</div>`;
    return h;
  }

  function addFoto(cantId) {
    const input = document.getElementById('foto-input-' + cantId);
    if (!input) return;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      const c = state.cantieri.find(x => x.id === cantId);
      for (const file of files) {
        const fileId = uid();
        await DB.saveFile(fileId, file);
        c.foto.push({ id: uid(), fileId, fileName: file.name, data: todayISO(), caption: '' });
      }
      persist(); render();
      toast(files.length > 1 ? files.length + ' foto aggiunte' : 'Foto aggiunta');
    };
    input.click();
  }

  async function delFoto(cantId, fotoId) {
    const c = state.cantieri.find(x => x.id === cantId);
    const idx = c.foto.findIndex(f => f.id === fotoId);
    if (idx < 0) return;
    if (!confirm('Eliminare questa foto?')) return;
    if (c.foto[idx].fileId) await DB.deleteFile(c.foto[idx].fileId);
    c.foto.splice(idx, 1);
    persist(); render(); toast('Foto eliminata');
  }

  /* --------------------------- Esportazione CSV --------------------------- */
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvNum(n) { return (Number(n) || 0).toFixed(2).replace('.', ','); }
  function downloadTextFile(name, content, mime) {
    const blob = new Blob(['﻿' + content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function exportCSVRiepilogo(year) {
    const tri = datiTrimestrali(year);
    const nomi = ['1° trimestre', '2° trimestre', '3° trimestre', '4° trimestre'];
    let rows = ['Periodo;IVA a debito;IVA a credito;IVA netta'];
    tri.forEach((t, i) => rows.push(`${nomi[i]} ${year};${csvNum(t.debito)};${csvNum(t.credito)};${csvNum(t.debito - t.credito)}`));
    const td = tri.reduce((a, t) => a + t.debito, 0), tc = tri.reduce((a, t) => a + t.credito, 0);
    rows.push(`Totale ${year};${csvNum(td)};${csvNum(tc)};${csvNum(td - tc)}`);
    downloadTextFile(`riepilogo-iva-${year}.csv`, rows.join('\n'), 'text/csv');
    toast('CSV riepilogo esportato');
  }

  function exportCSVMovimenti(year) {
    let rows = ['Data;Tipo;Cantiere;Descrizione;Controparte;Imponibile;Aliquota;IVA;Totale;Stato'];
    const push = (data, tipo, cant, descr, contro, imp, aliq, stato) =>
      rows.push([data, tipo, csvCell(cant), csvCell(descr), csvCell(contro), csvNum(imp), aliq + '%', csvNum(ivaOf(imp, aliq)), csvNum(totaleOf(imp, aliq)), stato].join(';'));
    state.cantieri.forEach(c => {
      const f = c.fatturaOrigine;
      if (f && annoOf(f.data) === year) push(f.data, 'Fattura emessa', c.nome, 'Fattura ' + (f.numero || ''), c.cliente || '', f.imponibile, f.aliquota, f.incassato ? 'Incassata' : 'Da incassare');
      (c.spese || []).forEach(s => { if (annoOf(s.data) === year) push(s.data, s.tipo === 'utensile' ? 'Spesa utensile' : 'Spesa materiale', c.nome, s.descrizione || '', s.fornitore || '', s.imponibile, s.aliquota, s.pagato ? 'Pagata' : 'Da pagare'); });
    });
    (state.speseGenerali || []).forEach(s => { if (annoOf(s.data) === year) push(s.data, s.tipo === 'utensile' ? 'Spesa utensile' : 'Spesa materiale', '(generale)', s.descrizione || '', s.fornitore || '', s.imponibile, s.aliquota, s.pagato ? 'Pagata' : 'Da pagare'); });
    if (rows.length === 1) { toast('Nessun movimento per il ' + year); return; }
    downloadTextFile(`movimenti-${year}.csv`, rows.join('\n'), 'text/csv');
    toast('CSV movimenti esportato');
  }

  /* ------------------------------ Stampa / PDF ---------------------------- */
  const PRINT_CSS = `
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 28px; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    h2 { font-size: 15px; margin: 0 0 16px; color: #444; font-weight: 600; }
    h3 { font-size: 13px; margin: 18px 0 6px; border-bottom: 2px solid #1e5eff; padding-bottom: 3px; color: #1e5eff; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; font-size: 12px; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background: #f0f4ff; }
    td.n, th.n { text-align: right; }
    .tot td { font-weight: bold; background: #fafafa; }
    .kv { font-size: 12px; margin: 2px 0; }
    .kv b { display: inline-block; min-width: 130px; color: #555; font-weight: 600; }
    .foot { margin-top: 24px; font-size: 10px; color: #999; border-top: 1px solid #eee; padding-top: 8px; }
    .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #eef; }
    .head { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #1e5eff; padding-bottom: 10px; margin-bottom: 4px; }
    .head .logo { max-height: 62px; max-width: 170px; object-fit: contain; }
    .head .dett { font-size: 11px; color: #666; margin-top: 3px; }
  `;
  function openPrint(title, inner) {
    const w = window.open('', '_blank');
    if (!w) { toast('Consenti i popup per stampare / salvare PDF'); return; }
    const logo = state.logo ? `<img class="logo" src="${state.logo}" alt="logo">` : '';
    const dett = [state.indirizzoAzienda, state.partitaIva ? 'P.IVA ' + state.partitaIva : '', state.telefono, state.email].filter(Boolean).join(' · ');
    w.document.write(`<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>
      <div class="head">
        ${logo}
        <div><h1>${esc(state.azienda || 'Impresa')}</h1>${dett ? `<div class="dett">${esc(dett)}</div>` : ''}</div>
      </div>
      <h2>${esc(title)}</h2>
      ${inner}
      <div class="foot">Documento generato dal Gestionale Cantieri — ${fmtDate(todayISO())}</div>
    </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (e) {} }, 350);
  }

  function stampaCantiere(cantId) {
    const c = state.cantieri.find(x => x.id === cantId);
    if (!c) return;
    const r = cantiereRiepilogo(c);
    let h = `<div class="kv"><b>Cantiere:</b> ${esc(c.nome)}</div>`;
    h += `<div class="kv"><b>Cliente:</b> ${esc(c.cliente || '—')}</div>`;
    h += `<div class="kv"><b>Indirizzo:</b> ${esc(c.indirizzo || '—')}</div>`;
    h += `<div class="kv"><b>Categoria:</b> ${esc(categoriaNome(c.categoriaId))}</div>`;
    h += `<div class="kv"><b>Stato:</b> ${c.stato === 'completato' ? 'Completato' : 'In corso'}</div>`;
    h += `<div class="kv"><b>Inizio lavori:</b> ${fmtDate(c.dataInizio)}</div>`;
    if (c.stato === 'completato') h += `<div class="kv"><b>Fine lavori:</b> ${fmtDate(c.dataFine)}</div>`;

    if (c.preventivo) {
      const p = c.preventivo, imp = preventivoImponibile(p);
      h += `<h3>Preventivo ${esc(p.numero || '')} — ${statoPreventivoLabel(p.stato).replace(/^[^ ]+ /, '')}</h3>`;
      h += `<table><thead><tr><th>Voce</th><th class="n">Q.tà</th><th class="n">Prezzo</th><th class="n">Importo</th></tr></thead><tbody>`;
      (p.voci || []).forEach(v => h += `<tr><td>${esc(v.descrizione || '')}</td><td class="n">${num(v.quantita)}</td><td class="n">${euro(v.prezzoUnitario)}</td><td class="n">${euro(num(v.quantita) * num(v.prezzoUnitario))}</td></tr>`);
      h += `<tr class="tot"><td colspan="3">Imponibile</td><td class="n">${euro(imp)}</td></tr>`;
      h += `<tr class="tot"><td colspan="3">Totale (IVA ${p.aliquota}%)</td><td class="n">${euro(totaleOf(imp, p.aliquota))}</td></tr>`;
      h += `</tbody></table>`;
    }

    if (c.fatturaOrigine) {
      const f = c.fatturaOrigine;
      h += `<h3>Fattura d'origine</h3>`;
      h += `<div class="kv"><b>Numero:</b> ${esc(f.numero || '—')} &nbsp; <b style="min-width:auto">Data:</b> ${fmtDate(f.data)}</div>`;
      h += `<table><tbody>
        <tr><td>Imponibile</td><td class="n">${euro(f.imponibile)}</td></tr>
        <tr><td>IVA (${f.aliquota}%)</td><td class="n">${euro(ivaOf(f.imponibile, f.aliquota))}</td></tr>
        <tr class="tot"><td>Totale fattura</td><td class="n">${euro(totaleOf(f.imponibile, f.aliquota))}</td></tr>
        ${num(f.ritenuta) > 0 ? `<tr><td>Ritenuta d'acconto (${f.ritenuta}%)</td><td class="n">−${euro(ritenutaOf(f))}</td></tr>
        <tr class="tot"><td>Netto a incassare</td><td class="n">${euro(nettoIncassoFattura(f))}</td></tr>` : ''}
        <tr><td>Stato incasso</td><td class="n">${f.incassato ? 'Incassata' : 'Da incassare'}</td></tr>
      </tbody></table>`;
    }

    const spese = c.spese || [];
    if (spese.length) {
      h += `<h3>Spese materiali e utensili</h3>`;
      h += `<table><thead><tr><th>Descrizione</th><th>Tipo</th><th>Fornitore</th><th>Data</th><th class="n">Imponibile</th><th class="n">IVA</th><th class="n">Totale</th><th>Pagata</th></tr></thead><tbody>`;
      spese.forEach(s => h += `<tr><td>${esc(s.descrizione || '')}</td><td>${s.tipo === 'utensile' ? 'Utensile' : 'Materiale'}</td><td>${esc(s.fornitore || '')}</td><td>${fmtDate(s.data)}</td><td class="n">${euro(s.imponibile)}</td><td class="n">${euro(ivaOf(s.imponibile, s.aliquota))}</td><td class="n">${euro(totaleOf(s.imponibile, s.aliquota))}</td><td>${s.pagato ? 'Sì' : 'No'}</td></tr>`);
      h += `</tbody></table>`;
    }

    h += `<h3>Riepilogo IVA cantiere</h3>`;
    h += `<table><tbody>
      <tr><td>IVA a debito (fattura)</td><td class="n">${euro(r.ivaDebito)}</td></tr>
      <tr><td>IVA a credito (spese)</td><td class="n">${euro(r.ivaCredito)}</td></tr>
      <tr class="tot"><td>IVA netta ${r.ivaNetta < 0 ? '(a credito)' : '(da versare)'}</td><td class="n">${euro(Math.abs(r.ivaNetta))}</td></tr>
      <tr class="tot"><td>Margine (ricavi − costi)</td><td class="n">${euro(r.margine)}</td></tr>
    </tbody></table>`;
    if (c.note) h += `<h3>Note</h3><div class="kv">${esc(c.note)}</div>`;

    openPrint('Scheda cantiere — ' + c.nome, h);
  }

  function stampaRiepilogo(year) {
    const tri = datiTrimestrali(year);
    const nomi = ['1° trimestre (gen–mar)', '2° trimestre (apr–giu)', '3° trimestre (lug–set)', '4° trimestre (ott–dic)'];
    let h = `<h3>Liquidazione IVA ${year}</h3>`;
    h += `<table><thead><tr><th>Periodo</th><th class="n">IVA a debito</th><th class="n">IVA a credito</th><th class="n">IVA netta</th></tr></thead><tbody>`;
    let td = 0, tc = 0;
    tri.forEach((t, i) => { td += t.debito; tc += t.credito; const n = t.debito - t.credito; h += `<tr><td>${nomi[i]}</td><td class="n">${euro(t.debito)}</td><td class="n">${euro(t.credito)}</td><td class="n">${euro(Math.abs(n))}${n < 0 ? ' (cr.)' : ''}</td></tr>`; });
    const nAnno = td - tc;
    h += `<tr class="tot"><td>Totale ${year}</td><td class="n">${euro(td)}</td><td class="n">${euro(tc)}</td><td class="n">${euro(Math.abs(nAnno))}${nAnno < 0 ? ' (cr.)' : ''}</td></tr>`;
    h += `</tbody></table>`;
    h += `<p style="font-size:11px;color:#666">IVA netta = IVA a debito − IVA a credito. "(cr.)" indica un credito IVA a tuo favore.</p>`;
    openPrint('Riepilogo IVA ' + year, h);
  }

  /* ------------------------------ Statistiche ----------------------------- */
  let statsAnno = null; // null = tutti gli anni

  function statsPeriodo(year) {
    const inYear = d => year == null || annoOf(d) === year;
    let fatturato = 0, costi = 0, ivaDeb = 0, ivaCre = 0, matImp = 0, uteImp = 0, nFatture = 0, nSpese = 0, daIncassare = 0, daPagare = 0;
    const perCat = {};
    const cantieriFatt = new Set();
    state.cantieri.forEach(c => {
      const f = c.fatturaOrigine;
      if (f && inYear(f.data)) {
        fatturato += num(f.imponibile); ivaDeb += ivaOf(f.imponibile, f.aliquota); nFatture++;
        const cat = c.categoriaId || 'nessuna';
        perCat[cat] = perCat[cat] || { fatturato: 0, count: 0 };
        perCat[cat].fatturato += num(f.imponibile); perCat[cat].count++;
        if (!f.incassato) daIncassare += totaleOf(f.imponibile, f.aliquota);
        cantieriFatt.add(c.id);
      }
      (c.spese || []).forEach(s => {
        if (!inYear(s.data)) return;
        costi += num(s.imponibile); ivaCre += ivaOf(s.imponibile, s.aliquota); nSpese++;
        if (s.tipo === 'utensile') uteImp += num(s.imponibile); else matImp += num(s.imponibile);
        if (!s.pagato) daPagare += totaleOf(s.imponibile, s.aliquota);
      });
    });
    (state.speseGenerali || []).forEach(s => {
      if (!inYear(s.data)) return;
      costi += num(s.imponibile); ivaCre += ivaOf(s.imponibile, s.aliquota); nSpese++;
      if (s.tipo === 'utensile') uteImp += num(s.imponibile); else matImp += num(s.imponibile);
      if (!s.pagato) daPagare += totaleOf(s.imponibile, s.aliquota);
    });
    return {
      fatturato, costi, margine: fatturato - costi, ivaDeb, ivaCre, ivaNetta: ivaDeb - ivaCre,
      matImp, uteImp, nFatture, nSpese, perCat, daIncassare, daPagare,
      nCantieri: cantieriFatt.size,
      margineMedio: cantieriFatt.size ? (fatturato - costi) / cantieriFatt.size : 0,
      marginePct: fatturato ? (fatturato - costi) / fatturato * 100 : 0
    };
  }

  function barChart(items) {
    const max = Math.max(1, ...items.map(i => i.value));
    if (!items.length) return `<p class="mini-note">Nessun dato nel periodo.</p>`;
    return `<div class="bars">` + items.map(i => `
      <div class="bar-row">
        <div class="bar-label">${esc(i.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, i.value / max * 100).toFixed(1)}%;background:${i.color || 'var(--primary)'}"></div></div>
        <div class="bar-val">${euro(i.value)}</div>
      </div>`).join('') + `</div>`;
  }

  function renderStatistiche() {
    const anni = anniDisponibili();
    const st = statsPeriodo(statsAnno);

    let html = `<section class="view">`;
    html += `<div class="detail-header">
      <button class="back-btn" data-action="back">←</button>
      <div style="flex:1 1 auto"><h2>📈 Statistiche azienda</h2>
      <div class="dh-sub">Fatturato, costi e margini</div></div>
    </div>`;

    // selettore anno (Tutti + anni)
    html += `<div class="chips">`;
    html += `<button class="chip ${statsAnno == null ? 'active' : ''}" data-action="set-anno-stats" data-anno="">Tutti gli anni</button>`;
    html += anni.map(y => `<button class="chip ${y === statsAnno ? 'active' : ''}" data-action="set-anno-stats" data-anno="${y}">${y}</button>`).join('');
    html += `</div>`;

    // KPI
    html += `<div class="summary-grid" style="margin-top:8px">
      <div class="stat"><div class="label">💶 Fatturato</div><div class="value" style="color:var(--primary)">${euro(st.fatturato)}</div><div class="hint">imponibile, ${st.nFatture} fatture</div></div>
      <div class="stat"><div class="label">🧾 Costi</div><div class="value" style="color:var(--warn)">${euro(st.costi)}</div><div class="hint">${st.nSpese} spese</div></div>
      <div class="stat"><div class="label">📊 Margine</div><div class="value" style="color:var(--ok)">${euro(st.margine)}</div><div class="hint">${st.marginePct.toFixed(0)}% sul fatturato</div></div>
      <div class="stat"><div class="label">🏗️ Cantieri</div><div class="value">${st.nCantieri}</div><div class="hint">con fattura nel periodo</div></div>
    </div>`;

    // Fatturato per categoria
    const catItems = Object.keys(st.perCat).map(k => ({
      label: k === 'nessuna' ? 'Senza categoria' : categoriaNome(k),
      value: st.perCat[k].fatturato,
      color: k === 'nessuna' ? '#94a3b8' : categoriaColore(k)
    })).sort((a, b) => b.value - a.value);
    html += `<div class="section-title">🏷️ Fatturato per categoria</div>`;
    html += `<div class="card">${barChart(catItems)}</div>`;

    // Ripartizione costi materiali/utensili
    html += `<div class="section-title">🛠️ Costi: materiali vs utensili</div>`;
    html += `<div class="card">${barChart([
      { label: '📦 Materiali', value: st.matImp, color: 'var(--primary)' },
      { label: '🔧 Utensili', value: st.uteImp, color: 'var(--accent)' }
    ])}</div>`;

    // Altri indicatori
    html += `<div class="section-title">📌 Altri indicatori</div>`;
    html += `<div class="card">`;
    html += infoRow('Margine medio per cantiere', euro(st.margineMedio));
    html += infoRow('IVA netta del periodo', euro(Math.abs(st.ivaNetta)) + (st.ivaNetta < 0 ? ' (a credito)' : ' (da versare)'));
    html += infoRow('Da incassare', euro(st.daIncassare));
    html += infoRow('Da pagare', euro(st.daPagare));
    html += `</div>`;

    // Report PDF
    html += `<div class="section-title">📤 Report</div>`;
    html += `<button class="btn btn-primary btn-block" data-action="stampa-report">🖨️ ${statsAnno ? 'Report ' + statsAnno : 'Report completo'} — stampa / PDF</button>`;

    html += `</section>`;
    app().innerHTML = html;
    document.getElementById('fab').classList.add('hidden');
  }

  function stampaReportAnnuale(year) {
    const st = statsPeriodo(year);
    const titolo = year ? 'Report annuale ' + year : 'Report complessivo';
    let h = `<h3>Riepilogo economico</h3>`;
    h += `<table><tbody>
      <tr><td>Fatturato (imponibile)</td><td class="n">${euro(st.fatturato)}</td></tr>
      <tr><td>Costi materiali e utensili (imponibile)</td><td class="n">${euro(st.costi)}</td></tr>
      <tr class="tot"><td>Margine (ricavi − costi)</td><td class="n">${euro(st.margine)} (${st.marginePct.toFixed(0)}%)</td></tr>
      <tr><td>Cantieri fatturati</td><td class="n">${st.nCantieri}</td></tr>
      <tr><td>Margine medio per cantiere</td><td class="n">${euro(st.margineMedio)}</td></tr>
    </tbody></table>`;

    h += `<h3>Liquidazione IVA</h3>`;
    h += `<table><tbody>
      <tr><td>IVA a debito (fatture)</td><td class="n">${euro(st.ivaDeb)}</td></tr>
      <tr><td>IVA a credito (spese)</td><td class="n">${euro(st.ivaCre)}</td></tr>
      <tr class="tot"><td>IVA netta ${st.ivaNetta < 0 ? '(a credito)' : '(da versare)'}</td><td class="n">${euro(Math.abs(st.ivaNetta))}</td></tr>
    </tbody></table>`;

    // dettaglio trimestrale se anno specifico
    if (year) {
      const tri = datiTrimestrali(year);
      const nomi = ['1° trim.', '2° trim.', '3° trim.', '4° trim.'];
      h += `<h3>IVA per trimestre ${year}</h3>`;
      h += `<table><thead><tr><th>Periodo</th><th class="n">Debito</th><th class="n">Credito</th><th class="n">Netta</th></tr></thead><tbody>`;
      tri.forEach((t, i) => { const n = t.debito - t.credito; h += `<tr><td>${nomi[i]}</td><td class="n">${euro(t.debito)}</td><td class="n">${euro(t.credito)}</td><td class="n">${euro(Math.abs(n))}${n < 0 ? ' (cr.)' : ''}</td></tr>`; });
      h += `</tbody></table>`;
    }

    // fatturato per categoria
    const cats = Object.keys(st.perCat).map(k => ({ nome: k === 'nessuna' ? 'Senza categoria' : categoriaNome(k), v: st.perCat[k].fatturato, n: st.perCat[k].count })).sort((a, b) => b.v - a.v);
    if (cats.length) {
      h += `<h3>Fatturato per categoria</h3>`;
      h += `<table><thead><tr><th>Categoria</th><th class="n">Cantieri</th><th class="n">Fatturato</th></tr></thead><tbody>`;
      cats.forEach(c => h += `<tr><td>${esc(c.nome)}</td><td class="n">${c.n}</td><td class="n">${euro(c.v)}</td></tr>`);
      h += `</tbody></table>`;
    }

    // elenco cantieri del periodo
    const inYear = d => year == null || annoOf(d) === year;
    const righe = state.cantieri.filter(c => c.fatturaOrigine && inYear(c.fatturaOrigine.data));
    if (righe.length) {
      h += `<h3>Dettaglio cantieri</h3>`;
      h += `<table><thead><tr><th>Cantiere</th><th>Cliente</th><th class="n">Fatturato</th><th class="n">Costi</th><th class="n">Margine</th><th class="n">IVA netta</th></tr></thead><tbody>`;
      righe.forEach(c => {
        const r = cantiereRiepilogo(c);
        h += `<tr><td>${esc(c.nome)}</td><td>${esc(c.cliente || '')}</td><td class="n">${euro(r.ricavoImponibile)}</td><td class="n">${euro(r.costiImponibile)}</td><td class="n">${euro(r.margine)}</td><td class="n">${euro(Math.abs(r.ivaNetta))}</td></tr>`;
      });
      h += `</tbody></table>`;
    }

    openPrint(titolo, h);
  }

  /* --------------------------- Dati dimostrativi -------------------------- */
  function caricaDatiDemo() {
    const hasData = state.cantieri.length > 0 || (state.speseGenerali || []).length > 0;
    const msg = hasData
      ? 'Aggiungere alcuni cantieri di esempio ai tuoi dati attuali? Potrai eliminarli quando vuoi.'
      : 'Caricare alcuni cantieri di esempio per provare tutte le funzioni?';
    if (!confirm(msg)) return;

    const y = annoOf(todayISO());
    const dt = (m, g) => `${y}-${String(m).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
    const catId = i => (state.categorie[i] ? state.categorie[i].id : '');
    const spesa = (descr, tipo, forn, imp, aliq, data, pagato) =>
      ({ id: uid(), descrizione: descr, tipo, fornitore: forn, numeroDoc: '', imponibile: imp, aliquota: aliq, data, fileId: null, fileName: null, pagato });

    const demo = [
      {
        id: uid(), stato: 'attivo', categoriaId: catId(0),
        nome: 'Ristrutturazione Via Verdi 8', cliente: 'Sig. Bianchi', indirizzo: 'Via Verdi 8, Milano',
        dataInizio: dt(2, 1), dataFine: '', note: 'Rifacimento completo impianto e finiture.',
        preventivo: {
          numero: 'P-' + y + '/03', data: dt(1, 25), aliquota: 22, stato: 'accettato',
          note: 'Offerta valida 30 giorni.',
          voci: [
            { descrizione: 'Rifacimento impianto elettrico', quantita: 1, prezzoUnitario: 11000 },
            { descrizione: 'Punti luce e prese aggiuntivi', quantita: 20, prezzoUnitario: 200 }
          ]
        },
        fatturaOrigine: { numero: y + '/041', data: dt(2, 10), imponibile: 15000, aliquota: 22, incassato: false, fileId: null, fileName: null },
        spese: [
          spesa('Cavi, canaline e frutti', 'materiale', 'Elettroforniture SRL', 3200, 22, dt(2, 12), true),
          spesa('Avvitatore a batteria', 'utensile', 'Utensilteria SPA', 450, 22, dt(2, 5), false)
        ],
        foto: []
      },
      {
        id: uid(), stato: 'attivo', categoriaId: catId(1),
        nome: 'Impianto elettrico Villa Blu', cliente: 'Fam. Verdi', indirizzo: 'Via del Mare 3, Genova',
        dataInizio: dt(5, 3), dataFine: '', note: '',
        preventivo: null,
        fatturaOrigine: { numero: y + '/052', data: dt(5, 15), imponibile: 9500, aliquota: 22, incassato: true, dataIncasso: dt(6, 1), fileId: null, fileName: null },
        spese: [ spesa('Quadro elettrico e magnetotermici', 'materiale', 'Elettroforniture SRL', 2100, 22, dt(5, 10), true) ],
        foto: []
      },
      {
        id: uid(), stato: 'attivo', categoriaId: catId(2),
        nome: 'Manutenzione Condominio Sole', cliente: 'Amm. Neri', indirizzo: 'Corso Italia 100, Torino',
        dataInizio: dt(7, 1), dataFine: '', note: 'Manutenzione parti comuni.',
        preventivo: null,
        fatturaOrigine: { numero: y + '/060', data: dt(7, 3), imponibile: 3400, aliquota: 10, incassato: false, fileId: null, fileName: null },
        spese: [ spesa('Materiale di consumo', 'materiale', 'Ferramenta Centrale', 600, 22, dt(7, 2), false) ],
        foto: []
      },
      {
        id: uid(), stato: 'completato', categoriaId: catId(3),
        nome: 'Nuova costruzione Capannone', cliente: 'Logistica Rossi Srl', indirizzo: 'Z.I. Nord, Padova',
        dataInizio: dt(1, 10), dataFine: dt(3, 20), note: 'Impianto industriale completato e collaudato.',
        preventivo: null,
        fatturaOrigine: { numero: y + '/018', data: dt(3, 15), imponibile: 42000, aliquota: 22, incassato: true, dataIncasso: dt(4, 10), fileId: null, fileName: null },
        spese: [
          spesa('Materiale industriale e quadri', 'materiale', 'Elettroforniture SRL', 12000, 22, dt(2, 20), true),
          spesa('Trapano e tester professionali', 'utensile', 'Utensilteria SPA', 1500, 22, dt(1, 15), true)
        ],
        foto: []
      }
    ];

    demo.forEach(c => state.cantieri.unshift(c));
    persist();
    closeModal();
    route = { name: 'dashboard' };
    dashboardFilter = 'tutte';
    render();
    toast('Dati di esempio caricati 🧪');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('beforeunload', releaseUrls);
})();
