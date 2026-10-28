/* =========================================================================
   app.js — RuView Monitor
   Interfaccia, regole di allarme, registro eventi, registrazioni e report.
   Nessun framework: JavaScript puro, funziona offline e anche servita dal
   sensing-server di RuView (--ui-path).
   Regola d'oro (la stessa del progetto RuView): i dati sintetici o
   dimostrativi non vengono MAI presentati come misure reali.
   ========================================================================= */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const HISTORY_MAX = 3600;        // campioni (2 al secondo → 30 minuti)
  const HISTORY_STEP_MS = 500;
  const NODE_HIST_MAX = 90;        // un campione al secondo per nodo
  const REC_CHUNK = 300;           // frame per blocco salvato
  const EDGE_FRESH_MS = 10000;

  const DEFAULTS = {
    base: '', wsUrl: '', token: '', rememberToken: true, autoConnect: true, demo: false,
    theme: 'auto', window: 60,
    th: { brMin: 8, brMax: 25, hrMin: 45, hrMax: 120, minConf: 0.5, sustainSec: 20, inactivityMin: 30, debounceSec: 3, staleSec: 5 },
    al: { sound: true, notify: false, fall: true, vitals: true, inactivity: true, presence: true, nodes: true, edgeModules: false }
  };

  const SOURCE_INFO = {
    'live': { tone: 'live', pill: 'Live', tag: 't-live', name: 'Dati reali (verificati)' },
    'live-unverified': { tone: 'live', pill: 'Live', tag: 't-live', name: 'Dati reali dai sensori' },
    'synthetic': { tone: 'synthetic', pill: 'Simulato', tag: 't-syn', name: 'Dati sintetici del server' },
    'stale': { tone: 'danger', pill: 'Sensori fermi', tag: 't-danger', name: 'Sensori non attivi' },
    'waiting': { tone: 'busy', pill: 'In attesa', tag: '', name: 'In attesa dei sensori' },
    'unknown': { tone: 'synthetic', pill: 'Origine ?', tag: 't-syn', name: 'Origine non verificata' },
    'demo': { tone: 'demo', pill: 'Demo', tag: 't-demo', name: 'Dati dimostrativi' }
  };
  const MOTION = { absent: 'Nessuno presente', still: 'Presenza, ferma', active: 'In movimento' };
  const POSTURE = { standing: 'in piedi', sitting: 'seduto', walking: 'in cammino', lying: 'sdraiato', fallen: 'a terra', crouching: 'accovacciato', unknown: 'non determinata' };
  const VERDICT = { excellent: 'ottima', good: 'buona', fair: 'discreta', poor: 'scarsa', bad: 'pessima', unusable: 'inutilizzabile', degraded: 'degradata', ok: 'buona' };
  const EVENT_ICON = { conn: '🔌', presence: '👤', persons: '👥', fall: '⚠', vital: '♥', inactivity: '⏱', node: '⌖', stream: '📡', source: 'ℹ', rec: '⏺', edge: '◆' };

  /* --------------------------------- Utilità -------------------------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toLocaleString('it-IT', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function pct(v) { return v == null || !isFinite(v) ? '—' : Math.round(Math.max(0, Math.min(1, v)) * 100) + '%'; }
  function ago(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    const s = Math.max(0, ms / 1000);
    if (s < 1.5) return 'adesso';
    if (s < 60) return Math.round(s) + ' s fa';
    if (s < 3600) return Math.round(s / 60) + ' min fa';
    return Math.round(s / 3600) + ' h fa';
  }
  function duration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    if (h) return h + ' h ' + String(m).padStart(2, '0') + ' min';
    if (m) return m + ' min ' + String(r).padStart(2, '0') + ' s';
    return r + ' s';
  }
  function clock(t) { return new Date(t).toLocaleTimeString('it-IT'); }
  function dateTime(t) { return new Date(t).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'medium' }); }
  function isoLocal(t) { const d = new Date(t); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' '); }
  function stamp() { return isoLocal(Date.now()).replace(/[: ]/g, '-'); }
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function numIn(v, fallback) { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : fallback; }
  function isSimulated(ds) { return ds === 'demo' || ds === 'synthetic'; }
  function hostOf(base) { try { return new URL(base).host; } catch (e) { return base || ''; } }
  function servedByRuView() {
    try { return location.protocol.startsWith('http') && /\/ui(\/|$)/.test(location.pathname); } catch (e) { return false; }
  }
  function defaultBase() { return servedByRuView() ? RuView.normalizeBase(location.href) : 'http://localhost:8080'; }
  function deepMerge(base, extra) {
    const out = JSON.parse(JSON.stringify(base));
    if (!extra || typeof extra !== 'object') return out;
    Object.keys(extra).forEach(k => {
      if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) && extra[k] && typeof extra[k] === 'object') out[k] = deepMerge(out[k], extra[k]);
      else if (k in out) out[k] = extra[k];
    });
    return out;
  }

  /* ---------------------------------- Stato ---------------------------------- */
  const client = new RuView.Client();
  const S = {
    settings: deepMerge(DEFAULTS, {}),
    firstRun: false,
    view: 'stato',
    conn: client.snapshot(),
    frame: null,
    lastFrameAt: 0,
    history: [],
    lastHist: 0,
    nodeHist: {},
    lastNodeHist: 0,
    edge: {},
    events: [],
    unseen: 0,
    eventFilter: 'all',
    rec: null,
    recordings: [],
    serverRecs: null,
    serverRecsMsg: '',
    restNodes: null,
    status: null,
    streamStale: false,
    diag: null,
    dirty: true,
    lastChartAt: 0,
    wasm: {}
  };

  /* --------------------------------- Impostazioni --------------------------------- */
  async function loadSettings() {
    let saved;
    try { saved = await Store.getKV('settings'); } catch (e) { saved = null; }
    S.firstRun = !saved;
    S.settings = deepMerge(DEFAULTS, saved || {});
    if (!S.settings.base) S.settings.base = defaultBase();
    if (servedByRuView() && S.firstRun) S.settings.base = defaultBase();

    const q = new URLSearchParams(location.search);
    if (q.get('server')) {
      try { S.settings.base = RuView.normalizeBase(q.get('server')); S.firstRun = false; } catch (e) { /* ignorato */ }
    }
    if (q.get('demo') === '1') { S.settings.demo = true; S.firstRun = false; }
    if (q.get('demo') === '0') S.settings.demo = false;
  }
  async function saveSettings() {
    const copy = JSON.parse(JSON.stringify(S.settings));
    if (!copy.rememberToken) copy.token = '';
    try { await Store.setKV('settings', copy); } catch (e) { console.warn('Impostazioni non salvate', e); }
    S.firstRun = false;
  }

  function applyTheme() {
    const t = S.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    const dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0b1220' : '#ffffff');
    S.dirty = true; S.lastChartAt = 0;
  }

  function connect() {
    try {
      client.configure({ base: S.settings.base, wsUrl: S.settings.wsUrl, token: S.settings.token });
    } catch (e) {
      toast('Indirizzo non valido', e.message, 'warn');
      return;
    }
    resetLive();
    if (S.settings.demo) client.startDemo(); else client.start();
  }
  function resetLive() {
    S.frame = null; S.lastFrameAt = 0; S.history = []; S.nodeHist = {}; S.edge = {}; S.streamStale = false;
    S.restNodes = null; S.status = null; S.serverRecs = null; S.serverRecsMsg = ''; Rules.reset(); S.dirty = true;
  }

  /* --------------------------------- Storico --------------------------------- */
  function vitalsOf(f) {
    const out = { br: f ? f.br : null, brConf: f ? f.brConf : null, brSrc: 'server', hr: f ? f.hr : null, hrConf: f ? f.hrConf : null, hrSrc: 'server', abstention: null };
    const now = Date.now();
    Object.keys(S.edge).forEach(id => {
      const e = S.edge[id];
      if (now - e.t > EDGE_FRESH_MS) return;
      if (!e.vitalsAuthorized && e.abstention) out.abstention = e.abstention;
      if (out.br == null && e.br != null && e.vitalsAuthorized) { out.br = e.br; out.brConf = e.fusionConfidence; out.brSrc = 'nodo ' + id; }
      if (out.hr == null && e.hr != null && e.vitalsAuthorized) { out.hr = e.hr; out.hrConf = e.fusionConfidence; out.hrSrc = 'nodo ' + id; }
    });
    return out;
  }

  function pushHistory(f) {
    if (f.t - S.lastHist >= HISTORY_STEP_MS) {
      S.lastHist = f.t;
      const v = vitalsOf(f);
      S.history.push({
        t: f.t, ds: f.dataSource, presence: f.presence ? 1 : 0, cls: motionClass(f), persons: f.persons, conf: f.confidence,
        br: v.br, brConf: v.brConf, hr: v.hr, hrConf: v.hrConf,
        rssi: f.rssi, mp: f.motionPower, bp: f.breathPower, q: f.quality, vq: f.vitalQuality
      });
      if (S.history.length > HISTORY_MAX) S.history.splice(0, S.history.length - HISTORY_MAX);
    }
    if (f.t - S.lastNodeHist >= 1000) {
      S.lastNodeHist = f.t;
      f.nodes.forEach(n => {
        const h = S.nodeHist[n.id] || (S.nodeHist[n.id] = []);
        h.push(n.rssi);
        if (h.length > NODE_HIST_MAX) h.shift();
      });
    }
  }

  function motionClass(f) {
    if (!f || !f.presence) return 'absent';
    const m = String(f.motion || '').toLowerCase();
    return (m === 'active' || m.indexOf('activ') >= 0 || m.indexOf('moving') >= 0) ? 'active' : 'still';
  }

  function fresh() {
    return S.lastFrameAt && Date.now() - S.lastFrameAt < S.settings.th.staleSec * 1000;
  }

  function windowSamples(seconds) {
    const from = Date.now() - seconds * 1000;
    let i = S.history.length;
    while (i > 0 && S.history[i - 1].t >= from) i--;
    return S.history.slice(i);
  }

  function statsOf(samples, key, confKey, minConf) {
    let n = 0, sum = 0, lo = Infinity, hi = -Infinity;
    samples.forEach(s => {
      const v = s[key];
      if (v == null || !isFinite(v)) return;
      if (confKey && minConf != null && (s[confKey] == null || s[confKey] < minConf)) return;
      n++; sum += v; if (v < lo) lo = v; if (v > hi) hi = v;
    });
    return n ? { n, avg: sum / n, min: lo, max: hi } : { n: 0, avg: null, min: null, max: null };
  }

  /* ------------------------------ Regole e allarmi ------------------------------ */
  const Rules = {
    reset() {
      this.cls = null; this.cand = null; this.candSince = 0; this.since = Date.now();
      this.persons = null; this.pCand = null; this.pCandSince = 0;
      this.lastActive = Date.now(); this.inactFired = false;
      this.br = { since: 0, fired: false }; this.hr = { since: 0, fired: false };
      this.nodes = {}; this.falls = {};
    },
    frame(f) {
      const th = S.settings.th, al = S.settings.al, now = f.t;
      const deb = th.debounceSec * 1000;
      // Presenza con antirimbalzo: lo stato deve reggere per "debounceSec".
      const cls = motionClass(f);
      if (this.cls === null) { this.cls = cls; this.since = now; }
      else if (cls !== this.cls) {
        if (this.cand !== cls) { this.cand = cls; this.candSince = now; }
        else if (now - this.candSince >= deb) {
          const prev = this.cls;
          this.cls = cls; this.since = this.candSince; this.cand = null;
          if (al.presence) {
            if (prev === 'absent') logEvent('info', 'presence', 'Presenza rilevata', f.persons > 1 ? f.persons + ' persone' : 'Una persona nell\'ambiente');
            else if (cls === 'absent') logEvent('info', 'presence', 'Ambiente vuoto', 'Nessuna persona rilevata');
          }
        }
      } else this.cand = null;

      // Numero di persone (solo se lo stato è stabile)
      const n = f.presence ? Math.max(1, f.persons || 1) : 0;
      if (this.persons === null) this.persons = n;
      else if (n !== this.persons) {
        if (this.pCand !== n) { this.pCand = n; this.pCandSince = now; }
        else if (now - this.pCandSince >= deb) {
          const prev = this.persons;
          this.persons = n; this.pCand = null;
          if (al.presence && prev > 0 && n > 0) logEvent('info', 'persons', 'Persone rilevate: ' + n, 'Prima: ' + prev);
        }
      } else this.pCand = null;

      // Inattività prolungata con persona presente
      if (cls !== 'still') { this.lastActive = now; this.inactFired = false; }
      else if (al.inactivity && !this.inactFired && now - this.lastActive >= th.inactivityMin * 60000) {
        this.inactFired = true;
        logEvent('warn', 'inactivity', 'Nessun movimento da ' + th.inactivityMin + ' min', 'Una persona è presente ma non si muove. Verifica che stia bene.');
      }

      // Parametri vitali fuori soglia per almeno "sustainSec"
      if (al.vitals) {
        const v = vitalsOf(f);
        this.range(this.br, v.br, v.brConf, th.brMin, th.brMax, now, 'Respiro', 'atti/min');
        this.range(this.hr, v.hr, v.hrConf, th.hrMin, th.hrMax, now, 'Battito', 'bpm');
      }

      // Nodi che smettono di trasmettere
      f.nodes.forEach(nd => {
        const was = this.nodes[nd.id];
        const stale = !!nd.stale;
        if (was === undefined) { this.nodes[nd.id] = stale; return; }
        if (stale !== was) {
          this.nodes[nd.id] = stale;
          if (al.nodes) {
            if (stale) logEvent('warn', 'node', 'Nodo ' + nd.id + ' non invia dati', 'Controlla alimentazione e Wi-Fi del sensore.');
            else logEvent('info', 'node', 'Nodo ' + nd.id + ' di nuovo attivo', '');
          }
        }
      });
    },
    range(st, value, conf, lo, hi, now, label, unit) {
      const th = S.settings.th;
      const reliable = value != null && conf != null && conf >= th.minConf;
      const out = reliable && (value < lo || value > hi);
      if (!out) { if (reliable) { st.since = 0; st.fired = false; } return; }
      if (!st.since) st.since = now;
      if (!st.fired && now - st.since >= th.sustainSec * 1000) {
        st.fired = true;
        const dir = value < lo ? 'basso' : 'alto';
        logEvent('warn', 'vital', label + ' ' + dir + ': ' + fmt(value, 0) + ' ' + unit,
          'Fuori dall\'intervallo ' + lo + '–' + hi + ' ' + unit + ' da almeno ' + th.sustainSec + ' s (affidabilità ' + pct(conf) + '). Stima non clinica.');
      }
    },
    edge(e) {
      if (!e.fall || !S.settings.al.fall) return;
      const last = this.falls[e.nodeId] || 0;
      this.falls[e.nodeId] = e.t;
      if (e.t - last < 60000) return; // un solo allarme al minuto per nodo
      logEvent('critical', 'fall', 'Possibile caduta', 'Rilevata dal nodo ' + e.nodeId + '. Verifica subito la persona.');
    }
  };
  Rules.reset();

  /* ------------------------------ Registro eventi ------------------------------ */
  async function logEvent(level, kind, title, detail) {
    const ds = S.conn.dataSource;
    const ev = { t: Date.now(), level, kind, title, detail: detail || '', ack: level !== 'critical', source: ds, simulated: isSimulated(ds) && kind !== 'conn' && kind !== 'rec' };
    S.events.unshift(ev);
    if (S.events.length > 500) S.events.length = 500;
    if (S.view !== 'eventi' && level !== 'info') S.unseen++;
    try { ev.id = await Store.addEvent(ev); } catch (e) { /* solo in memoria */ }

    const tag = ev.simulated ? ' (' + (ds === 'demo' ? 'DEMO' : 'SIMULATO') + ')' : '';
    if (level === 'critical' || level === 'warn' || kind === 'conn') toast(title + tag, detail, level);
    if (!ev.simulated && level !== 'info') {
      if (S.settings.al.sound) beep(level);
      if (S.settings.al.notify) notify(title, detail);
    }
    S.dirty = true;
    renderShell();
    if (S.view === 'eventi') renderView();
  }

  async function ackEvent(ev) {
    if (ev.ack) return;
    ev.ack = true;
    try { if (ev.id != null) await Store.putEvent(ev); } catch (e) { /* */ }
  }
  async function ackAll() {
    for (const ev of S.events) if (!ev.ack) await ackEvent(ev);
    renderShell();
    if (S.view === 'eventi') renderView();
  }
  function unackedCritical() { return S.events.filter(e => e.level === 'critical' && !e.ack); }

  // Suoni (Web Audio): si sblocca al primo tocco dell'utente.
  let audio = null;
  function unlockAudio() {
    if (audio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { try { audio = new AC(); } catch (e) { audio = null; } }
  }
  function beep(level) {
    if (!audio) return;
    try {
      if (audio.state === 'suspended') audio.resume();
      const n = level === 'critical' ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const o = audio.createOscillator(), g = audio.createGain();
        const t = audio.currentTime + i * 0.28;
        o.type = 'sine'; o.frequency.value = level === 'critical' ? 880 : 660;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.24);
      }
    } catch (e) { /* audio non disponibile */ }
  }
  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body: body || '', icon: 'icons/icon-192.png', tag: 'ruview-' + title };
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg && reg.showNotification) reg.showNotification('RuView · ' + title, opts);
        else new Notification('RuView · ' + title, opts);
      }).catch(() => { try { new Notification('RuView · ' + title, opts); } catch (e) { /* */ } });
    } else { try { new Notification('RuView · ' + title, opts); } catch (e) { /* */ } }
  }

  /* --------------------------------- Registrazione --------------------------------- */
  function compactFrame(f) {
    const p = f.people[0];
    return {
      t: f.t, ts: f.ts, src: f.dataSource, p: f.presence ? 1 : 0, m: f.motion, n: f.persons, c: r3(f.confidence),
      rssi: r3(f.rssi), var: r3(f.variance), mp: r3(f.motionPower), bp: r3(f.breathPower), dhz: r3(f.dominantHz),
      br: r3(f.br), brc: r3(f.brConf), hr: r3(f.hr), hrc: r3(f.hrConf), q: r3(f.quality), v: f.verdict, pos: f.posture,
      kp: p && p.keypoints.length ? p.keypoints.map(k => [r3(k.x), r3(k.y), r3(k.c)]) : undefined,
      nodes: f.nodes.map(n => [n.id, r3(n.rssi), r3(n.fps)])
    };
  }
  function r3(v) { return v == null || !isFinite(v) ? null : Math.round(v * 1000) / 1000; }

  async function startRecording(name) {
    if (S.rec) return;
    const meta = {
      id: 'rec-' + Date.now().toString(36), name: name || 'Sessione ' + dateTime(Date.now()),
      start: Date.now(), end: null, frames: 0, chunks: 0, sources: {}, server: S.conn.state === 'demo' ? '' : S.conn.base || '', app: 'RuView Monitor ' + VERSION
    };
    S.rec = { meta, buffer: [] };
    try { await Store.putRecording(meta); } catch (e) { /* */ }
    logEvent('info', 'rec', 'Registrazione avviata', meta.name);
    renderShell();
  }
  function recordFrame(f) {
    const r = S.rec;
    r.buffer.push(compactFrame(f));
    r.meta.frames++;
    r.meta.sources[f.dataSource] = (r.meta.sources[f.dataSource] || 0) + 1;
    if (r.buffer.length >= REC_CHUNK) flushRecording();
  }
  async function flushRecording() {
    const r = S.rec;
    if (!r || !r.buffer.length) return;
    const frames = r.buffer; r.buffer = [];
    const seq = r.meta.chunks++;
    try { await Store.addChunk(r.meta.id, seq, frames); await Store.putRecording(r.meta); }
    catch (e) { toast('Registrazione', 'Spazio di archiviazione insufficiente: ' + e.message, 'warn'); }
  }
  async function stopRecording() {
    if (!S.rec) return;
    await flushRecording();
    const meta = S.rec.meta;
    meta.end = Date.now();
    try { await Store.putRecording(meta); } catch (e) { /* */ }
    S.rec = null;
    logEvent('info', 'rec', 'Registrazione salvata', meta.name + ' · ' + meta.frames + ' frame · ' + duration(meta.end - meta.start));
    await refreshRecordings();
    renderShell();
  }
  async function refreshRecordings() {
    try { S.recordings = (await Store.listRecordings()).sort((a, b) => b.start - a.start); } catch (e) { S.recordings = []; }
    if (S.view === 'registrazioni') renderView();
  }
  async function recordingFrames(id) {
    const chunks = await Store.getChunks(id);
    chunks.sort((a, b) => a.seq - b.seq);
    const out = [];
    chunks.forEach(c => c.frames.forEach(f => out.push(f)));
    if (S.rec && S.rec.meta.id === id) S.rec.buffer.forEach(f => out.push(f));
    return out;
  }
  function recWatermark(meta) {
    const keys = Object.keys(meta.sources || {});
    if (keys.indexOf('demo') >= 0) return 'DEMO';
    if (keys.indexOf('synthetic') >= 0) return 'SYNTHETIC';
    if (keys.indexOf('unknown') >= 0) return 'UNVERIFIED';
    return null;
  }
  async function exportRecording(id, format) {
    const meta = S.recordings.find(r => r.id === id) || await Store.getRecording(id);
    if (!meta) return;
    const frames = await recordingFrames(id);
    const wm = recWatermark(meta);
    const base = 'ruview_' + meta.id + (wm ? '_' + (wm === 'DEMO' ? 'DEMO' : wm === 'SYNTHETIC' ? 'SINTETICO' : 'NON-VERIFICATO') : '');
    if (format === 'jsonl') {
      const head = { _meta: Object.assign({}, meta, { watermark: wm, synthetic: wm === 'DEMO' || wm === 'SYNTHETIC', exported_at: new Date().toISOString(),
        fields: { t: 'ms epoch (ricezione)', ts: 'ms epoch (server)', src: 'origine dati', p: 'presenza', m: 'motion_level', n: 'persone', c: 'affidabilità', rssi: 'dBm', var: 'varianza', mp: 'motion_band_power', bp: 'breathing_band_power', dhz: 'frequenza dominante Hz', br: 'respiro atti/min', brc: 'affidabilità respiro', hr: 'battito bpm', hrc: 'affidabilità battito', q: 'signal_quality_score', v: 'quality_verdict', pos: 'postura', kp: 'punti chiave [x,y,conf] persona 1', nodes: '[id, rssi, fps]' } }) };
      download(base + '.jsonl', [JSON.stringify(head)].concat(frames.map(f => JSON.stringify(f))).join('\n') + '\n', 'application/x-ndjson');
    } else {
      const cols = ['ora', 'origine_dati', 'presenza', 'movimento', 'persone', 'affidabilita', 'rssi_dbm', 'varianza', 'potenza_movimento', 'potenza_respiro', 'freq_dominante_hz', 'respiro_atti_min', 'affid_respiro', 'battito_bpm', 'affid_battito', 'qualita_segnale', 'giudizio_qualita', 'postura'];
      const rows = frames.map(f => [isoLocal(f.t), f.src, f.p, f.m, f.n, f.c, f.rssi, f.var, f.mp, f.bp, f.dhz, f.br, f.brc, f.hr, f.hrc, f.q, f.v, f.pos]);
      download(base + '.csv', toCSV(cols, rows), 'text/csv;charset=utf-8');
    }
  }
  function toCSV(cols, rows) {
    const cell = v => {
      if (v == null) return '';
      if (typeof v === 'number') return String(v).replace('.', ',');
      const s = String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + [cols.join(';')].concat(rows.map(r => r.map(cell).join(';'))).join('\r\n') + '\r\n';
  }

  /* ----------------------------- Registrazioni sul server ----------------------------- */
  async function refreshServerRecs() {
    if (S.conn.state === 'idle' || !S.conn.base) { S.serverRecs = null; S.serverRecsMsg = 'Non connesso a un server.'; return renderViewIf('registrazioni'); }
    if (S.conn.state === 'demo') { S.serverRecs = null; S.serverRecsMsg = 'Non disponibile in modalità demo.'; return renderViewIf('registrazioni'); }
    try {
      const r = await client.api('/api/v1/recording/list');
      if (r.ok && r.data) { S.serverRecs = Array.isArray(r.data.recordings) ? r.data.recordings : []; S.serverRecsMsg = ''; }
      else { S.serverRecs = null; S.serverRecsMsg = r.status === 401 || r.status === 403 ? 'Token API mancante o non valido.' : 'Il server ha risposto ' + r.status + '.'; }
    } catch (e) {
      S.serverRecs = null;
      S.serverRecsMsg = client.sameOrigin ? 'Server non raggiungibile.' : 'Il server non consente richieste da questa pagina (CORS). Apri RuView Monitor dal server stesso per gestire le registrazioni sul server (vedi Guida).';
    }
    renderViewIf('registrazioni');
  }
  async function serverRecAction(kind, id) {
    try {
      let r;
      if (kind === 'start') r = await client.api('/api/v1/recording/start', { method: 'POST', body: id ? { id } : {} });
      else if (kind === 'stop') r = await client.api('/api/v1/recording/stop', { method: 'POST', body: {} });
      else if (kind === 'delete') r = await client.api('/api/v1/recording/' + encodeURIComponent(id), { method: 'DELETE' });
      const d = r && r.data && typeof r.data === 'object' ? r.data : {};
      if (!r.ok || d.success === false || d.status === 'error') toast('Server', d.error || d.message || ('Errore ' + r.status), 'warn');
      else toast('Server', kind === 'start' ? 'Registrazione avviata sul server' + (d.watermark ? ' (dati ' + d.watermark + ')' : '') : kind === 'stop' ? 'Registrazione fermata sul server' : 'Registrazione eliminata', 'info');
    } catch (e) { toast('Server', e.message, 'warn'); }
    refreshServerRecs();
  }

  /* ------------------------------ Interfaccia: guscio ------------------------------ */
  function toast(title, detail, level) {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.level = level || 'info';
    el.innerHTML = '<b>' + esc(title) + '</b>' + (detail ? '<span>' + esc(detail) + '</span>' : '');
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), level === 'critical' ? 9000 : 4500);
  }

  function modal(html, onMount) {
    const root = $('#modal-root');
    root.innerHTML = '<div class="modal-back" data-action="modal-close-bg"><div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>';
    if (onMount) onMount(root.querySelector('.modal'));
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(resolve => {
      modal('<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="actions"><button class="btn" data-k="no">Annulla</button><button class="btn ' + (danger ? 'danger solid' : 'primary') + '" data-k="ok">' + esc(okLabel || 'Conferma') + '</button></div>', m => {
        m.querySelector('[data-k="no"]').onclick = () => { closeModal(); resolve(false); };
        m.querySelector('[data-k="ok"]').onclick = () => { closeModal(); resolve(true); };
      });
    });
  }

  function streamStale() {
    if (S.conn.state !== 'open') return false;
    const limit = S.settings.th.staleSec * 1000;
    if (!S.lastFrameAt) return S.conn.connectedAt && Date.now() - S.conn.connectedAt > limit + 3000;
    return Date.now() - S.lastFrameAt > limit;
  }

  function pillInfo() {
    const c = S.conn;
    switch (c.state) {
      case 'idle': return { tone: '', text: 'Non connesso' };
      case 'connecting': return { tone: 'busy', text: 'Connessione…' };
      case 'reconnecting': return { tone: 'busy', text: 'Riconnessione…' };
      case 'auth': return { tone: 'danger', text: 'Token richiesto' };
      case 'blocked': return { tone: 'danger', text: 'Bloccato' };
      case 'demo': return { tone: 'demo', text: 'Demo' };
      default: break;
    }
    if (streamStale()) return { tone: 'danger', text: 'Nessun dato' };
    const info = SOURCE_INFO[c.dataSource] || SOURCE_INFO.unknown;
    return { tone: info.tone, text: info.pill };
  }

  function bannerInfo() {
    const c = S.conn;
    const age = S.lastFrameAt ? ago(Date.now() - S.lastFrameAt) : null;
    if (c.state === 'blocked') return { tone: 'danger', icon: '⛔', title: 'Il browser blocca la connessione', text: 'Questa pagina è aperta in HTTPS e non può collegarsi a un server HTTP della rete locale (' + hostOf(c.base) + '). Apri RuView Monitor direttamente dal server RuView, oppure usa il server sullo stesso computer (localhost).', btn: ['goto', 'Come risolvere', 'guida'] };
    if (c.state === 'auth') return { tone: 'danger', icon: '🔑', title: c.authReason === 'rejected' ? 'Token API rifiutato' : 'Il server richiede un token API', text: 'Il sensing-server è protetto (RUVIEW_API_TOKEN). Inserisci il token in Impostazioni → Connessione.', btn: ['goto', 'Inserisci token', 'impostazioni'] };
    if (c.state === 'reconnecting') return { tone: 'danger', icon: '📡', title: 'Server non raggiungibile — nuovo tentativo in corso', text: (c.lastError ? c.lastError + '. ' : '') + (age ? 'I valori mostrati sono gli ultimi ricevuti (' + age + ').' : 'Verifica che il sensing-server sia avviato e l\'indirizzo sia corretto.'), btn: ['reconnect', 'Riprova ora'] };
    if (c.state === 'idle' && !S.firstRun) return { tone: 'muted', icon: '○', title: 'Non connesso', text: 'Collega il server RuView o prova la modalità dimostrativa.', btn: ['connect', 'Connetti'] };
    if (c.state === 'demo') return { tone: 'demo', icon: '◆', title: 'Modalità dimostrativa', text: 'Tutti i valori sono generati da questa app per mostrarne il funzionamento: non sono misure reali.', btn: ['demo-stop', 'Esci dalla demo'] };
    if (c.state !== 'open') return null;
    if (streamStale()) return { tone: 'danger', icon: '📡', title: 'Nessun dato dal server', text: S.lastFrameAt ? 'Ultimo frame ricevuto ' + age + '. I valori mostrati potrebbero non essere aggiornati.' : 'Connesso, ma il server non ha ancora inviato frame.', btn: ['reconnect', 'Riconnetti'] };
    switch (c.dataSource) {
      case 'synthetic': return { tone: 'synthetic', icon: '⚠', title: 'Il server sta generando dati sintetici', text: 'RuView è avviato in simulazione (--source simulate): i valori NON sono misure reali. Collega i nodi ESP32 e riavvia con --source esp32 (o auto).' };
      case 'stale': return { tone: 'danger', icon: '⚠', title: 'I nodi sensore non inviano dati', text: 'Il server è raggiungibile ma non riceve frame CSI da oltre 5 secondi. Controlla alimentazione e Wi-Fi dei nodi ESP32.' };
      case 'waiting': return { tone: 'muted', icon: '…', title: 'In attesa dei nodi sensore', text: 'La sorgente live è configurata ma nessun nodo ha ancora inviato dati.' };
      case 'unknown': return { tone: 'synthetic', icon: '?', title: 'Origine dei dati non verificata', text: 'Il server non ha dichiarato se i dati sono reali' + (c.rest === 'ok' ? '' : ' e le API di stato non sono leggibili da questa pagina') + '. Considera i valori come non verificati.' };
      default: return null;
    }
  }

  function renderShell() {
    const c = S.conn;
    const pill = $('#conn-pill');
    const pi = pillInfo();
    pill.dataset.tone = pi.tone;
    $('.pill-text', pill).textContent = pi.text;
    pill.title = (SOURCE_INFO[c.dataSource] || {}).name || pi.text;

    const lbl = $('#server-label');
    lbl.textContent = c.state === 'demo' ? 'Dati dimostrativi' : c.state === 'idle' ? 'Non connesso' : hostOf(c.base) + (c.serverSource ? ' · ' + c.serverSource : '');

    const b = bannerInfo();
    const sb = $('#source-banner');
    if (b) {
      sb.hidden = false; sb.dataset.tone = b.tone;
      const btn = b.btn ? '<button class="btn sm" data-action="' + b.btn[0] + '"' + (b.btn[2] ? ' data-view="' + b.btn[2] + '"' : '') + '>' + esc(b.btn[1]) + '</button>' : '';
      const html = '<span class="bi">' + b.icon + '</span><div class="bt"><b>' + esc(b.title) + '</b>' + esc(b.text) + '</div>' + btn;
      if (sb._html !== html) { sb.innerHTML = html; sb._html = html; }
    } else { sb.hidden = true; sb._html = ''; }

    const crit = unackedCritical();
    const ab = $('#alert-banner');
    if (crit.length) {
      const e = crit[0];
      const tag = e.simulated ? ' (' + (e.source === 'demo' ? 'DEMO' : 'SIMULATO') + ')' : '';
      const html = '<span class="bi">⚠</span><div class="bt"><b>' + esc(e.title + tag) + '</b>' + esc(e.detail) + ' · ' + esc(clock(e.t)) + (crit.length > 1 ? ' · altri ' + (crit.length - 1) : '') + '</div><button class="btn sm" data-action="ack-all">Ho verificato</button>';
      ab.hidden = false;
      if (ab._html !== html) { ab.innerHTML = html; ab._html = html; }
    } else { ab.hidden = true; ab._html = ''; }

    const badge = $('#nav-badge');
    const count = crit.length + S.unseen;
    badge.hidden = !count;
    badge.textContent = count > 99 ? '99+' : String(count);
    $$('#nav .nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === S.view || (el.dataset.view === 'altro' && ['nodi', 'registrazioni', 'impostazioni', 'guida', 'altro'].indexOf(S.view) >= 0 && window.innerWidth < 900)));
    $('#rec-indicator').hidden = !S.rec;
  }

  /* --------------------------------- Viste --------------------------------- */
  function navigate(view) {
    if (!VIEWS[view]) view = 'stato';
    S.view = view;
    if (view === 'eventi') S.unseen = 0;
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    renderView();
    renderShell();
    const main = $('#view');
    if (main) main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  function renderView() {
    const v = VIEWS[S.view];
    $('#view').innerHTML = v.render();
    if (v.mount) v.mount();
    S.lastChartAt = 0;
    S.dirty = true;
    updateView(true);
  }
  function renderViewIf(name) { if (S.view === name) renderView(); }
  function updateView(force) {
    const v = VIEWS[S.view];
    if (!v.update) return;
    const now = Date.now();
    const charts = force || now - S.lastChartAt > 500;
    if (charts) S.lastChartAt = now;
    v.update(charts);
  }
  function setText(id, text) { const el = document.getElementById(id); if (el && el.textContent !== text) el.textContent = text; }
  function setHTML(id, html) { const el = document.getElementById(id); if (el && el._html !== html) { el.innerHTML = html; el._html = html; } }
  function setDim(id, dim) { const el = document.getElementById(id); if (el) el.classList.toggle('dim', !!dim); }
  function css(name) { return Charts.css(name); }

  function sourceTag(ds) {
    const info = SOURCE_INFO[ds] || SOURCE_INFO.unknown;
    return '<span class="tag ' + info.tag + '">' + esc(info.name) + '</span>';
  }
  function confColor(c) { return c == null ? 'var(--muted)' : c >= 0.7 ? 'var(--live)' : c >= 0.45 ? 'var(--primary)' : 'var(--synthetic)'; }

  function kpi(id, label, unit) {
    return '<div class="card kpi" id="' + id + '"><div class="k-label">' + label + '</div>' +
      '<div class="k-value"><span id="' + id + '-v">—</span><small>' + unit + '</small></div>' +
      '<div class="k-meta" id="' + id + '-m">&nbsp;</div><div class="conf-bar"><i id="' + id + '-b"></i></div></div>';
  }
  function setKpi(id, value, meta, conf, dim) {
    setText(id + '-v', value);
    setText(id + '-m', meta || ' ');
    const bar = document.getElementById(id + '-b');
    if (bar) { bar.style.width = conf == null ? '0' : Math.round(clamp(conf, 0, 1) * 100) + '%'; bar.style.background = confColor(conf); }
    setDim(id, dim);
  }

  const VIEWS = {};

  /* ----------------------------------- Stato ----------------------------------- */
  VIEWS.stato = {
    render() {
      const welcome = S.firstRun && S.conn.state === 'idle' ? welcomeCard() : '';
      return '<div class="view-head"><div><h2>Stato dell\'ambiente</h2><p id="st-upd">In attesa di dati</p></div>' +
        '<div class="row"><button class="btn sm" data-action="goto" data-view="vitali">Vitali</button><button class="btn sm" data-action="goto" data-view="spazio">Spazio</button></div></div>' +
        welcome +
        '<div class="card hero" id="hero" data-state="none">' +
        '<div class="hero-ring" id="hero-ring"><div><div><div class="big" id="hero-n">–</div><div class="lbl">persone</div></div></div></div>' +
        '<div><div class="hero-state" id="hero-state">Nessun dato</div><div class="hero-sub" id="hero-sub">Collega il server per iniziare</div><div class="hero-tags" id="hero-tags"></div></div>' +
        '</div>' +
        '<div class="grid g4 mt">' + kpi('k-br', 'Respiro', 'atti/min') + kpi('k-hr', 'Battito', 'bpm') + kpi('k-rssi', 'Segnale medio', 'dBm') + kpi('k-q', 'Qualità segnale', '') + '</div>' +
        '<div class="grid g2 mt">' +
        '<div class="card"><h3>Movimento · ultimo minuto</h3><div class="chart-wrap"><canvas id="st-motion"></canvas></div><div class="legend"><span><i style="background:var(--c-motion)"></i>potenza banda movimento</span><span><i style="background:var(--c-br)"></i>banda respiro</span></div></div>' +
        '<div class="card"><h3>Ultimi eventi<span class="spacer"></span><button class="btn sm" data-action="goto" data-view="eventi">Tutti</button></h3><div class="list" id="st-events"></div></div>' +
        '</div>' +
        '<div class="grid g4 mt">' +
        miniKpi('m-nodes', 'Nodi attivi') + miniKpi('m-fps', 'Frame al secondo') + miniKpi('m-last', 'Ultimo frame') + miniKpi('m-src', 'Sorgente dichiarata') +
        '</div>' +
        '<p class="card-note">Le stime di respiro e battito sono indicative e non cliniche: RuView e RuView Monitor non sono dispositivi medici.</p>';
    },
    update(charts) {
      const f = S.frame, ok = fresh();
      const cls = f ? motionClass(f) : 'none';
      const hero = $('#hero');
      if (!hero) return;
      hero.dataset.state = f ? cls : 'none';
      setDim('hero', f && !ok);
      setText('hero-n', f ? String(f.presence ? Math.max(1, f.persons || 1) : 0) : '–');
      const ring = $('#hero-ring');
      ring.style.setProperty('--p', f && f.confidence != null ? Math.round(clamp(f.confidence, 0, 1) * 100) : 0);
      setText('hero-state', f ? MOTION[cls] : (S.conn.state === 'open' || S.conn.state === 'demo' ? 'In attesa del primo frame' : 'Nessun dato'));
      if (f) {
        const parts = ['Affidabilità ' + pct(f.confidence)];
        if (f.posture) parts.push('postura: ' + (POSTURE[f.posture] || f.posture));
        if (Rules.cls === cls && Rules.since) parts.push('da ' + duration(Date.now() - Rules.since));
        setText('hero-sub', parts.join(' · '));
      } else setText('hero-sub', S.conn.state === 'idle' ? 'Collega il server per iniziare' : 'Connessione in corso…');
      const tags = [];
      if (f) tags.push(sourceTag(f.dataSource));
      if (f && f.poseSource) tags.push('<span class="tag t-primary">' + (f.poseSource === 'model' ? 'Posa: modello addestrato' : 'Posa: derivata dal segnale') + '</span>');
      const fall = Object.keys(S.edge).map(k => S.edge[k]).find(e => e.fall && Date.now() - e.t < 60000);
      if (fall) tags.push('<span class="tag t-danger">⚠ Possibile caduta · nodo ' + esc(fall.nodeId) + '</span>');
      if (f && !ok) tags.push('<span class="tag t-danger">Dato non aggiornato · ' + esc(ago(Date.now() - S.lastFrameAt)) + '</span>');
      setHTML('hero-tags', tags.join(''));
      setText('st-upd', f ? 'Aggiornato ' + ago(Date.now() - S.lastFrameAt) + ' · ' + clock(S.lastFrameAt) : 'In attesa di dati');

      const v = vitalsOf(f);
      const th = S.settings.th;
      setKpi('k-br', fmt(v.br, 1), v.br == null ? (v.abstention ? 'Stima sospesa dal server' : 'Nessuna stima') : 'Affidabilità ' + pct(v.brConf) + (v.brSrc !== 'server' ? ' · ' + v.brSrc : ''), v.brConf, !ok || (v.brConf != null && v.brConf < th.minConf));
      setKpi('k-hr', fmt(v.hr, 0), v.hr == null ? (v.abstention ? 'Stima sospesa dal server' : 'Nessuna stima') : 'Affidabilità ' + pct(v.hrConf) + (v.hrSrc !== 'server' ? ' · ' + v.hrSrc : ''), v.hrConf, !ok || (v.hrConf != null && v.hrConf < th.minConf));
      setKpi('k-rssi', f ? fmt(f.rssi, 1) : '—', f && f.variance != null ? 'Varianza ' + fmt(f.variance, 2) : ' ', f && f.rssi != null ? clamp((f.rssi + 95) / 60, 0, 1) : null, !ok);
      setKpi('k-q', f && f.quality != null ? pct(f.quality) : '—', f && f.verdict ? 'Giudizio: ' + (VERDICT[String(f.verdict).toLowerCase()] || f.verdict) : (f && f.vitalQuality != null ? 'Qualità vitali ' + pct(f.vitalQuality) : ' '), f ? (f.quality != null ? f.quality : f.vitalQuality) : null, !ok);

      const nodes = f ? f.nodes : [];
      const active = nodes.filter(n => !n.stale).length;
      setText('m-nodes-v', f ? active + ' / ' + nodes.length : '—');
      setText('m-fps-v', S.conn.state === 'open' || S.conn.state === 'demo' ? fmt(client.fps, 1) : '—');
      setText('m-last-v', S.lastFrameAt ? ago(Date.now() - S.lastFrameAt) : '—');
      setText('m-src-v', S.conn.serverSource || '—');

      setHTML('st-events', eventsList(S.events.slice(0, 5), true));
      if (charts) {
        const now = Date.now(), s = windowSamples(60);
        Charts.timeSeries($('#st-motion'), {
          tMin: now - 60000, tMax: now, softMin: 0, minSpan: 0.05,
          series: [{ points: s.map(x => [x.t, x.mp]), color: css('--c-motion'), fill: true }, { points: s.map(x => [x.t, x.bp]), color: css('--c-br') }]
        });
      }
    }
  };
  function miniKpi(id, label) { return '<div class="card kpi"><div class="k-label">' + label + '</div><div class="k-value" style="font-size:20px"><span id="' + id + '-v">—</span></div></div>'; }

  function welcomeCard() {
    const https = location.protocol === 'https:';
    return '<div class="card" id="welcome" style="margin-bottom:12px"><h3>Benvenuto in RuView Monitor</h3>' +
      '<p style="margin:0 0 12px">Collega il <b>sensing-server</b> di RuView (nodi ESP32 che rilevano presenza, respiro e movimento tramite Wi-Fi) oppure prova l\'app con dati dimostrativi.</p>' +
      '<div class="field"><label for="w-base">Indirizzo del server RuView</label><input class="input" id="w-base" inputmode="url" autocomplete="off" placeholder="http://192.168.1.50:8080" value="' + esc(S.settings.base) + '"><span class="hint">Porta 8080 per il server avviato a mano, 3000 per Docker.</span></div>' +
      '<div class="field"><label for="w-token">Token API (se il server ne usa uno)</label><input class="input" id="w-token" type="password" autocomplete="off" placeholder="RUVIEW_API_TOKEN"></div>' +
      '<div class="row"><button class="btn primary" data-action="welcome-connect">Connetti</button><button class="btn" data-action="demo-start">Prova la demo</button><button class="btn" data-action="goto" data-view="guida">Come si installa</button></div>' +
      (https ? '<p class="card-note">Stai usando la versione online (HTTPS): il browser permette di collegarsi solo a un server sullo stesso computer (localhost) o in HTTPS. Per i server della rete locale apri l\'app dal server RuView: istruzioni nella Guida.</p>' : '') +
      '</div>';
  }

  function eventsList(list, compact) {
    if (!list.length) return '<div class="empty" style="padding:18px 8px"><p style="margin:0">Nessun evento</p></div>';
    return list.map(e => {
      const tag = e.simulated ? '<span class="tag ' + (e.source === 'demo' ? 't-demo' : 't-syn') + '">' + (e.source === 'demo' ? 'DEMO' : 'SIMULATO') + '</span>' : '';
      const ack = !e.ack && !compact ? '<button class="btn sm" data-action="ack" data-id="' + esc(e.id) + '" data-t="' + e.t + '">Conferma</button>' : '';
      return '<div class="li' + (e.ack ? '' : ' unacked') + '" data-level="' + esc(e.level) + '"><div class="lic">' + (EVENT_ICON[e.kind] || '•') + '</div>' +
        '<div style="min-width:0"><div class="lt">' + esc(e.title) + '</div>' + (e.detail && !compact ? '<div class="ld">' + esc(e.detail) + '</div>' : '') + '</div>' +
        '<div class="lr"><span>' + esc(compact ? clock(e.t) : dateTime(e.t)) + '</span>' + tag + ack + '</div></div>';
    }).join('');
  }

  /* ---------------------------------- Vitali ---------------------------------- */
  VIEWS.vitali = {
    render() {
      const w = S.settings.window;
      const seg = [[60, '1 min'], [300, '5 min'], [1800, '30 min']].map(([v, l]) => '<button data-action="window" data-w="' + v + '" class="' + (w === v ? 'on' : '') + '">' + l + '</button>').join('');
      const th = S.settings.th;
      const card = (id, title, unit, color, band) => '<div class="card"><h3>' + title + '<span class="spacer"></span><span class="tag" id="' + id + '-src"></span></h3>' +
        '<div class="kpi"><div class="k-value"><span id="' + id + '-v">—</span><small>' + unit + '</small></div><div class="k-meta" id="' + id + '-m">&nbsp;</div></div>' +
        '<div class="chart-wrap tall"><canvas id="' + id + '-c"></canvas></div>' +
        '<div class="legend"><span><i style="background:' + color + '"></i>stima (affidabilità ≥ ' + pct(th.minConf) + ')</span>' + (band ? '<span><i style="background:var(--live);opacity:.4"></i>intervallo normale ' + band + '</span>' : '') + '</div>' +
        '<div class="stats"><div><span>Min</span><b id="' + id + '-min">—</b></div><div><span>Media</span><b id="' + id + '-avg">—</b></div><div><span>Max</span><b id="' + id + '-max">—</b></div></div></div>';
      return '<div class="view-head"><div><h2>Parametri vitali</h2><p>Stime contactless dal segnale Wi-Fi · finestra selezionata</p></div>' +
        '<div class="row"><div class="seg">' + seg + '</div><button class="btn sm" data-action="report-session">Report PDF</button></div></div>' +
        '<div class="grid g2">' +
        card('v-br', 'Respiro', 'atti/min', 'var(--c-br)', th.brMin + '–' + th.brMax) +
        card('v-hr', 'Battito', 'bpm', 'var(--c-hr)', th.hrMin + '–' + th.hrMax) +
        '<div class="card"><h3>Movimento</h3><div class="chart-wrap"><canvas id="v-mp"></canvas></div><div class="legend"><span><i style="background:var(--c-motion)"></i>banda movimento</span><span><i style="background:var(--c-br)"></i>banda respiro</span></div><div class="stats"><div><span>Presenza</span><b id="v-pres">—</b></div><div><span>In movimento</span><b id="v-act">—</b></div><div><span>Persone max</span><b id="v-pmax">—</b></div></div></div>' +
        '<div class="card"><h3>Segnale</h3><div class="chart-wrap"><canvas id="v-rssi"></canvas></div><div class="legend"><span><i style="background:var(--c-rssi)"></i>RSSI medio (dBm)</span></div><div class="chart-wrap mt"><canvas id="v-q" style="height:110px"></canvas></div><div class="legend"><span><i style="background:var(--c-quality)"></i>qualità del segnale (0–1)</span></div></div>' +
        '</div>' +
        '<p class="card-note">Le stime sono più affidabili con la persona ferma, a 1–3 metri dai nodi. Valori con affidabilità bassa sono mostrati in grigio e non generano allarmi. Non è un dispositivo medico.</p>';
    },
    update(charts) {
      const f = S.frame, ok = fresh(), v = vitalsOf(f), th = S.settings.th;
      setText('v-br-v', fmt(v.br, 1)); setText('v-hr-v', fmt(v.hr, 0));
      setText('v-br-m', v.br == null ? 'Nessuna stima disponibile' : 'Affidabilità ' + pct(v.brConf));
      setText('v-hr-m', v.hr == null ? (v.abstention ? 'Stima sospesa dal server (' + v.abstention + ')' : 'Nessuna stima disponibile') : 'Affidabilità ' + pct(v.hrConf));
      setDim('v-br-v', !ok || (v.brConf != null && v.brConf < th.minConf));
      setDim('v-hr-v', !ok || (v.hrConf != null && v.hrConf < th.minConf));
      setText('v-br-src', v.br != null ? (v.brSrc === 'server' ? 'server' : v.brSrc) : '');
      setText('v-hr-src', v.hr != null ? (v.hrSrc === 'server' ? 'server' : v.hrSrc) : '');
      if (!charts) return;
      const win = S.settings.window, now = Date.now(), s = windowSamples(win), tMin = now - win * 1000;
      const conf = (key, ck) => s.map(x => [x.t, x[ck] != null && x[ck] >= th.minConf ? x[key] : null]);
      const sb = statsOf(s, 'br', 'brConf', th.minConf), sh = statsOf(s, 'hr', 'hrConf', th.minConf);
      [['v-br', sb, 1], ['v-hr', sh, 0]].forEach(([id, st, d]) => { setText(id + '-min', fmt(st.min, d)); setText(id + '-avg', fmt(st.avg, d)); setText(id + '-max', fmt(st.max, d)); });
      Charts.timeSeries($('#v-br-c'), { tMin, tMax: now, softMin: th.brMin - 2, softMax: th.brMax + 2, band: [th.brMin, th.brMax], series: [{ points: conf('br', 'brConf'), color: css('--c-br'), fill: true }], emptyText: 'Nessuna stima affidabile nella finestra' });
      Charts.timeSeries($('#v-hr-c'), { tMin, tMax: now, softMin: th.hrMin - 5, softMax: th.hrMax + 5, band: [th.hrMin, th.hrMax], series: [{ points: conf('hr', 'hrConf'), color: css('--c-hr'), fill: true }], emptyText: 'Nessuna stima affidabile nella finestra' });
      Charts.timeSeries($('#v-mp'), { tMin, tMax: now, softMin: 0, minSpan: 0.05, series: [{ points: s.map(x => [x.t, x.mp]), color: css('--c-motion'), fill: true }, { points: s.map(x => [x.t, x.bp]), color: css('--c-br') }] });
      Charts.timeSeries($('#v-rssi'), { tMin, tMax: now, minSpan: 4, series: [{ points: s.map(x => [x.t, x.rssi]), color: css('--c-rssi') }] });
      Charts.timeSeries($('#v-q'), { tMin, tMax: now, yMin: 0, yMax: 1, series: [{ points: s.map(x => [x.t, x.q != null ? x.q : x.vq]), color: css('--c-quality'), fill: true }] });
      const n = s.length || 1;
      setText('v-pres', s.length ? pct(s.filter(x => x.presence).length / n) : '—');
      setText('v-act', s.length ? pct(s.filter(x => x.cls === 'active').length / n) : '—');
      setText('v-pmax', s.length ? String(Math.max.apply(null, s.map(x => x.presence ? x.persons || 1 : 0))) : '—');
    }
  };

  /* ---------------------------------- Spazio ---------------------------------- */
  VIEWS.spazio = {
    render() {
      return '<div class="view-head"><div><h2>Spazio e posa</h2><p>Scheletro stimato e perturbazione del campo Wi-Fi</p></div></div>' +
        '<div class="grid g2">' +
        '<div class="card"><h3>Posa · 17 punti chiave</h3><div class="canvas-box"><canvas id="sp-skel"></canvas><div class="overlay" id="sp-skel-tags"></div><div class="empty-msg" id="sp-skel-empty">Nessuna persona rilevata</div></div>' +
        '<p class="card-note" id="sp-skel-note"></p></div>' +
        '<div class="card"><h3>Campo del segnale · vista dall\'alto</h3><div class="canvas-box"><canvas id="sp-field"></canvas><div class="empty-msg" id="sp-field-empty">Il server non ha inviato il campo del segnale</div></div>' +
        '<div class="ramp"></div><div class="ramp-labels"><span>perturbazione bassa</span><span>alta</span></div><p class="card-note" id="sp-field-note">Il cerchio bianco indica il punto di massima perturbazione: dove il corpo disturba di più le onde radio.</p></div>' +
        '</div>' +
        '<div class="card mt"><h3>Persone rilevate</h3><div id="sp-people"></div></div>';
    },
    update() {
      const f = S.frame;
      const people = f && f.presence ? f.people : [];
      Charts.skeleton($('#sp-skel'), people);
      $('#sp-skel-empty').hidden = people.length > 0;
      const tags = [];
      if (f && f.poseSource) tags.push('<span class="tag t-primary">' + (f.poseSource === 'model' ? 'Modello addestrato' : 'Derivata dal segnale') + '</span>');
      if (f) tags.push(sourceTag(f.dataSource));
      setHTML('sp-skel-tags', tags.join(''));
      setText('sp-skel-note', f && f.poseSource === 'model'
        ? 'Posa da inferenza del modello (.rvf) caricato sul server.'
        : 'Senza un modello addestrato lo scheletro è ricostruito dalle caratteristiche del segnale: indica posizione e movimento in modo approssimativo, non i singoli arti. Per la posa completa servono 4+ nodi e un modello (--model).');
      const res = f && f.field ? Charts.heatmap($('#sp-field'), f.field) : null;
      $('#sp-field-empty').hidden = !!res;
      if (!res) { const c = $('#sp-field'); const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); }
      if (res) setText('sp-field-note', 'Griglia ' + f.field.nx + ' × ' + f.field.nz + ' · picco nella cella (' + res.peak.ix + ', ' + res.peak.iz + '). Il cerchio bianco indica il punto di massima perturbazione.');
      const rows = (f ? f.people : []).map(p => '<div class="li"><div class="lic">👤</div><div><div class="lt">Persona #' + esc(p.id) + (p.pose ? ' · ' + esc(POSTURE[p.pose] || p.pose) : '') + '</div>' +
        '<div class="ld">' + (p.position ? 'Posizione x ' + fmt(p.position[0], 1) + ' m · z ' + fmt(p.position[2], 1) + ' m · ' : '') + (p.zone ? 'zona ' + esc(p.zone) + ' · ' : '') + (p.motion != null ? 'movimento ' + fmt(p.motion, 0) + '/100' : '') + '</div></div>' +
        '<div class="lr"><span>Affidabilità</span><b>' + pct(p.confidence) + '</b></div></div>').join('');
      setHTML('sp-people', rows || '<div class="empty" style="padding:16px"><p style="margin:0">' + (f && f.presence ? 'Presenza rilevata, dettaglio per persona non disponibile' : 'Nessuna persona') + '</p></div>');
    }
  };

  /* ----------------------------------- Nodi ----------------------------------- */
  function restNodeList() {
    const d = S.restNodes;
    if (!d) return [];
    const list = Array.isArray(d) ? d : Array.isArray(d.nodes) ? d.nodes : [];
    return list.filter(n => n && n.node_id != null);
  }
  VIEWS.nodi = {
    render() {
      return '<div class="view-head"><div><h2>Nodi sensore</h2><p id="nd-sum">—</p></div></div><div class="grid g3" id="nd-grid"></div>' +
        '<p class="card-note">RSSI: potenza del segnale ricevuto (più vicino a 0 = più forte). Novità: quanto il segnale attuale differisce dalla stanza "normale" (0 = uguale, 1 = completamente diverso).</p>';
    },
    update(charts) {
      const f = S.frame;
      const map = new Map();
      (f ? f.nodes : []).forEach(n => map.set(n.id, Object.assign({}, n)));
      restNodeList().forEach(r => {
        const o = map.get(r.node_id) || { id: r.node_id };
        o.rest = r;
        if (o.rssi == null) o.rssi = r.rssi_dbm;
        if (o.lastSeenMs == null) o.lastSeenMs = r.last_seen_ms;
        if (o.stale == null) o.stale = r.status === 'stale';
        map.set(r.node_id, o);
      });
      const nodes = Array.from(map.values()).sort((a, b) => a.id - b.id);
      const active = nodes.filter(n => !n.stale).length;
      setText('nd-sum', nodes.length ? active + ' attivi su ' + nodes.length + (fresh() ? '' : ' · dati non aggiornati') : 'Nessun nodo ancora visto');
      const grid = $('#nd-grid');
      if (!nodes.length) { grid.dataset.ids = ''; setHTML('nd-grid', '<div class="card empty" style="grid-column:1/-1"><div class="big">⌖</div><p>Nessun nodo sensore ha ancora inviato dati.<br>Controlla che gli ESP32 siano accesi e configurati con l\'IP del server (porta UDP 5005).</p></div>'); return; }
      const ids = nodes.map(n => n.id).join(',');
      if (grid.dataset.ids !== ids) {
        grid.dataset.ids = ids; grid._html = '';
        grid.innerHTML = nodes.map(n => '<div class="card node-card"><div class="node-head"><span class="node-dot" id="nd-' + esc(n.id) + '-dot"></span><span class="node-id">Nodo ' + esc(n.id) + '</span><span class="spacer"></span><span class="tag" id="nd-' + esc(n.id) + '-st"></span></div>' +
          '<dl class="kv" id="nd-' + esc(n.id) + '-kv"></dl><canvas id="nd-' + esc(n.id) + '-c"></canvas></div>').join('');
      }
      nodes.forEach(n => {
        const id = 'nd-' + n.id;
        const dot = document.getElementById(id + '-dot');
        if (dot) dot.classList.toggle('stale', !!n.stale);
        setText(id + '-st', n.stale ? 'Inattivo' : 'Attivo');
        const e = S.edge[n.id];
        const rows = [
          ['RSSI', n.rssi != null ? fmt(n.rssi, 1) + ' dBm' : '—'],
          ['Frame/s', n.fps != null ? fmt(n.fps, 1) : '—'],
          ['Ultimo frame', n.lastSeenMs != null ? fmt(n.lastSeenMs, 0) + ' ms' : '—'],
          ['Novità', n.novelty != null ? fmt(n.novelty, 2) : '—'],
          ['Movimento', n.motion ? esc(MOTION[n.motion === 'active' ? 'active' : n.motion === 'absent' ? 'absent' : 'still'] || n.motion) : '—']
        ];
        if (n.position) rows.push(['Posizione', n.position.map(x => fmt(x, 1)).join(' · ') + ' m']);
        if (n.subcarriers) rows.push(['Sottoportanti', fmt(n.subcarriers, 0)]);
        if (n.rest && n.rest.csi_status) rows.push(['CSI', esc(n.rest.csi_status === 'active' ? 'attivo' : n.rest.csi_status)]);
        if (e && Date.now() - e.t < EDGE_FRESH_MS) {
          if (e.br != null && e.vitalsAuthorized) rows.push(['Respiro (nodo)', fmt(e.br, 1)]);
          if (e.hr != null && e.vitalsAuthorized) rows.push(['Battito (nodo)', fmt(e.hr, 0)]);
          if (e.fall) rows.push(['Caduta', '<span class="tag t-danger">rilevata</span>']);
        }
        setHTML(id + '-kv', rows.map(r => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join(''));
        if (charts) Charts.sparkline(document.getElementById(id + '-c'), S.nodeHist[n.id] || [], css('--c-rssi'), { minSpan: 3 });
      });
    }
  };

  /* ---------------------------------- Eventi ---------------------------------- */
  VIEWS.eventi = {
    render() {
      const fl = S.eventFilter;
      const seg = [['all', 'Tutti'], ['critical', 'Allarmi'], ['warn', 'Avvisi'], ['info', 'Info']].map(([v, l]) => '<button data-action="ev-filter" data-f="' + v + '" class="' + (fl === v ? 'on' : '') + '">' + l + '</button>').join('');
      const list = S.events.filter(e => fl === 'all' || e.level === fl);
      return '<div class="view-head"><div><h2>Eventi e allarmi</h2><p>' + S.events.length + ' eventi registrati su questo dispositivo</p></div>' +
        '<div class="row"><button class="btn sm" data-action="ack-all">Conferma tutti</button><button class="btn sm" data-action="ev-export">Esporta CSV</button><button class="btn sm danger" data-action="ev-clear">Svuota</button></div></div>' +
        '<div class="seg" style="margin-bottom:12px">' + seg + '</div>' +
        '<div class="card"><div class="list">' + eventsList(list.slice(0, 300), false) + '</div></div>' +
        '<p class="card-note">Gli eventi generati da dati dimostrativi o sintetici sono etichettati e non attivano suoni o notifiche.</p>';
    }
  };

  /* ------------------------------- Registrazioni ------------------------------- */
  VIEWS.registrazioni = {
    render() {
      const r = S.rec;
      const local = r
        ? '<div class="row"><span class="rec-dot">● REC</span><b>' + esc(r.meta.name) + '</b></div><div class="stats"><div><span>Durata</span><b id="rc-dur">—</b></div><div><span>Frame</span><b id="rc-fr">—</b></div><div><span>Origine</span><b id="rc-src">—</b></div></div><div class="row mt"><button class="btn danger solid" data-action="rec-stop">■ Ferma e salva</button></div>'
        : '<div class="field"><label for="rc-name">Nome della sessione</label><input class="input" id="rc-name" placeholder="Es. Camera da letto, notte 12/10"></div><button class="btn primary" data-action="rec-start"' + (S.conn.state === 'open' || S.conn.state === 'demo' ? '' : ' disabled') + '>● Avvia registrazione</button>' +
          (S.conn.state === 'open' || S.conn.state === 'demo' ? '' : '<p class="card-note">Connettiti al server (o avvia la demo) per registrare.</p>');
      const saved = S.recordings.filter(m => !S.rec || m.id !== S.rec.meta.id);
      const list = saved.length ? saved.map(m => {
        const wm = recWatermark(m);
        const tag = wm === 'DEMO' ? '<span class="tag t-demo">DEMO</span>' : wm === 'SYNTHETIC' ? '<span class="tag t-syn">SINTETICO</span>' : wm === 'UNVERIFIED' ? '<span class="tag t-syn">non verificato</span>' : '<span class="tag t-live">reale</span>';
        return '<div class="li"><div class="lic">⏺</div><div style="min-width:0"><div class="lt">' + esc(m.name) + '</div><div class="ld">' + esc(dateTime(m.start)) + ' · ' + esc(duration((m.end || Date.now()) - m.start)) + ' · ' + esc(m.frames) + ' frame</div>' +
          '<div class="row" style="margin-top:6px">' + tag + '<button class="btn sm" data-action="rec-export" data-id="' + esc(m.id) + '" data-f="csv">CSV</button><button class="btn sm" data-action="rec-export" data-id="' + esc(m.id) + '" data-f="jsonl">JSONL</button><button class="btn sm" data-action="rec-report" data-id="' + esc(m.id) + '">Report</button><button class="btn sm danger" data-action="rec-delete" data-id="' + esc(m.id) + '">Elimina</button></div></div><div></div></div>';
      }).join('') : '<div class="empty" style="padding:18px"><p style="margin:0">Nessuna registrazione salvata</p></div>';

      let server;
      if (S.serverRecs) {
        server = '<div class="row" style="margin-bottom:8px"><input class="input" id="srv-id" placeholder="ID (facoltativo)" style="max-width:220px"><button class="btn sm primary" data-action="srv-start">Avvia sul server</button><button class="btn sm" data-action="srv-stop">Ferma</button><button class="btn sm" data-action="srv-refresh">Aggiorna</button></div>' +
          (S.serverRecs.length ? S.serverRecs.map(x => '<div class="li"><div class="lic">🗄</div><div style="min-width:0"><div class="lt">' + esc(x.name || x.id) + '</div><div class="ld">' +
            [x.frames != null ? x.frames + ' frame' : '', x.size_bytes != null ? fmt(x.size_bytes / 1024, 0) + ' KB' : '', x.modified_epoch ? dateTime(x.modified_epoch * 1000) : '', x.watermark ? 'dati ' + x.watermark : '', x.status || ''].filter(Boolean).map(esc).join(' · ') +
            '</div></div><div class="lr"><button class="btn sm danger" data-action="srv-delete" data-id="' + esc(x.id || x.name) + '">Elimina</button></div></div>').join('') : '<p class="card-note">Nessuna registrazione sul server.</p>') +
          '<p class="card-note">Le registrazioni sul server sono file .jsonl nella cartella dati di RuView, utilizzabili per addestrare un modello (wifi-densepose-train).</p>';
      } else {
        server = '<p class="card-note" style="margin-top:0">' + esc(S.serverRecsMsg || 'Caricamento…') + '</p><button class="btn sm" data-action="srv-refresh">Riprova</button>';
      }
      return '<div class="view-head"><div><h2>Registrazioni</h2><p>Sessioni salvate per analisi, report e addestramento</p></div></div>' +
        '<div class="grid g2"><div class="card"><h3>Registrazione su questo dispositivo</h3>' + local + '</div>' +
        '<div class="card"><h3>Registrazioni sul server RuView</h3>' + server + '</div></div>' +
        '<div class="card mt"><h3>Sessioni salvate</h3><div class="list">' + list + '</div>' +
        (Store.persistent ? '' : '<p class="card-note">⚠ Il browser non consente l\'archiviazione permanente: le registrazioni andranno perse alla chiusura.</p>') + '</div>';
    },
    mount() { if (!S.serverRecs && !S.serverRecsMsg) refreshServerRecs(); },
    update() {
      if (!S.rec) return;
      setText('rc-dur', duration(Date.now() - S.rec.meta.start));
      setText('rc-fr', fmt(S.rec.meta.frames, 0));
      const ds = Object.keys(S.rec.meta.sources);
      setText('rc-src', ds.map(k => (SOURCE_INFO[k] || {}).pill || k).join(', ') || '—');
    }
  };

  /* -------------------------------- Impostazioni -------------------------------- */
  VIEWS.impostazioni = {
    render() {
      const s = S.settings, th = s.th, al = s.al;
      const sw = (key, label, hint) => '<label class="switch-row"><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span><span class="switch"><input type="checkbox" data-al="' + key + '"' + (al[key] ? ' checked' : '') + '><i></i></span></label>';
      const num = (key, label, step, unit) => '<div class="field"><label for="th-' + key + '">' + label + (unit ? ' (' + unit + ')' : '') + '</label><input class="input" id="th-' + key + '" data-th="' + key + '" inputmode="decimal" value="' + esc(key === 'minConf' ? Math.round(th[key] * 100) : th[key]) + '" step="' + step + '"></div>';
      const theme = [['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([v, l]) => '<button data-action="theme" data-t="' + v + '" class="' + (s.theme === v ? 'on' : '') + '">' + l + '</button>').join('');
      const conn = S.conn;
      return '<div class="view-head"><div><h2>Impostazioni</h2><p>Connessione, soglie di allarme e dati</p></div></div>' +
        '<div class="grid g2 top">' +
        '<div class="card"><h3>Connessione al server RuView</h3>' +
        '<div class="field"><label for="cf-base">Indirizzo del sensing-server</label><input class="input" id="cf-base" inputmode="url" autocomplete="off" value="' + esc(s.base) + '" placeholder="http://192.168.1.50:8080"><span class="hint">Porta HTTP del server: 8080 (avvio manuale) o 3000 (Docker). Il WebSocket viene trovato in automatico.</span></div>' +
        '<div class="field"><label for="cf-token">Token API</label><div class="input-row"><input class="input" id="cf-token" type="password" autocomplete="off" value="' + esc(s.token) + '" placeholder="RUVIEW_API_TOKEN (se impostato sul server)"><button class="btn" data-action="toggle-token" type="button">Mostra</button></div><span class="hint">Resta solo su questo dispositivo. Non viene mai inserito negli indirizzi: per il WebSocket si usa un ticket monouso.</span></div>' +
        '<details><summary class="hint" style="cursor:pointer;margin-bottom:8px">Avanzate</summary><div class="field"><label for="cf-ws">Indirizzo WebSocket (facoltativo)</label><input class="input" id="cf-ws" autocomplete="off" value="' + esc(s.wsUrl) + '" placeholder="automatico, es. ws://192.168.1.50:8765/ws/sensing"></div></details>' +
        '<label class="switch-row"><span>Connetti all\'avvio</span><span class="switch"><input type="checkbox" id="cf-auto"' + (s.autoConnect ? ' checked' : '') + '><i></i></span></label>' +
        '<label class="switch-row"><span>Ricorda il token</span><span class="switch"><input type="checkbox" id="cf-remember"' + (s.rememberToken ? ' checked' : '') + '><i></i></span></label>' +
        '<div class="row mt"><button class="btn primary" data-action="save-connect">Salva e connetti</button><button class="btn" data-action="diagnose">Verifica connessione</button>' +
        (conn.state === 'idle' ? '' : '<button class="btn" data-action="disconnect">Disconnetti</button>') +
        (conn.state === 'demo' ? '<button class="btn" data-action="demo-stop">Esci dalla demo</button>' : '<button class="btn" data-action="demo-start">Modalità demo</button>') + '</div>' +
        '<div id="diag">' + diagHTML() + '</div>' +
        '<div class="kv mt" style="font-size:12.5px"><dt>Stato</dt><dd id="cf-state">—</dd><dt>WebSocket</dt><dd id="cf-ws-url">—</dd><dt>API REST</dt><dd id="cf-rest">—</dd><dt>source_state</dt><dd id="cf-ss">—</dd></div>' +
        '</div>' +
        '<div class="stack"><div class="card"><h3>Soglie di allarme</h3><div class="fields-2">' +
        num('brMin', 'Respiro minimo', 1, 'atti/min') + num('brMax', 'Respiro massimo', 1, 'atti/min') +
        num('hrMin', 'Battito minimo', 1, 'bpm') + num('hrMax', 'Battito massimo', 1, 'bpm') +
        num('minConf', 'Affidabilità minima', 5, '%') + num('sustainSec', 'Durata fuori soglia', 1, 's') +
        num('inactivityMin', 'Inattività', 1, 'min') + num('debounceSec', 'Antirimbalzo presenza', 1, 's') +
        num('staleSec', 'Dato vecchio dopo', 1, 's') +
        '</div><p class="card-note" style="margin-top:0">Gli allarmi sui parametri vitali scattano solo se la stima ha almeno l\'affidabilità minima e resta fuori soglia per la durata indicata.</p></div>' +
        '<div class="card"><h3>Avvisi</h3>' +
        sw('fall', 'Possibile caduta', 'Allarme dai nodi ESP32 (edge vitals)') + sw('vitals', 'Respiro e battito fuori soglia') + sw('inactivity', 'Inattività prolungata') +
        sw('presence', 'Ingressi e uscite', 'Presenza rilevata / ambiente vuoto') + sw('nodes', 'Nodi non attivi') + sw('edgeModules', 'Eventi dei moduli edge (WASM)', 'Registra gli eventi dei moduli installati sui nodi') +
        sw('sound', 'Suono', 'Non suona per dati dimostrativi o sintetici') + sw('notify', 'Notifiche del sistema', 'Richiede il permesso del browser') +
        '<div class="row mt"><button class="btn sm" data-action="test-alert">Prova avviso</button></div></div>' +
        '<div class="card"><h3>Aspetto</h3><div class="seg">' + theme + '</div></div>' +
        '<div class="card"><h3>Dati</h3><div class="row"><button class="btn sm" data-action="backup-export">Esporta impostazioni ed eventi</button><label class="btn sm" for="backup-file">Importa…</label><input type="file" id="backup-file" accept="application/json,.json" hidden><button class="btn sm danger" data-action="wipe">Cancella tutto</button></div>' +
        '<p class="card-note">' + (Store.persistent ? 'Dati salvati in modo permanente su questo dispositivo (IndexedDB).' : '⚠ Archiviazione permanente non disponibile: i dati restano solo finché la pagina è aperta.') + ' Il token non viene incluso nell\'esportazione.</p></div>' +
        '<div class="card"><h3>Informazioni</h3><div class="kv"><dt>Versione</dt><dd>' + VERSION + '</dd><dt>Compatibilità</dt><dd>RuView sensing-server, API v1</dd><dt>Progetto</dt><dd><a href="https://github.com/ruvnet/RuView" target="_blank" rel="noopener">ruvnet/RuView</a></dd></div>' +
        '<p class="card-note">Client indipendente e non ufficiale per RuView. Non è un dispositivo medico.</p></div>' +
        '</div></div>';
    },
    mount() {
      $$('[data-th]').forEach(el => el.addEventListener('change', () => {
        const k = el.dataset.th;
        let v = numIn(el.value, DEFAULTS.th[k]);
        if (k === 'minConf') v = clamp(v / 100, 0, 1);
        else v = Math.max(0, v);
        S.settings.th[k] = v;
        saveSettings();
        toast('Soglia aggiornata', '', 'info');
      }));
      $$('[data-al]').forEach(el => el.addEventListener('change', async () => {
        const k = el.dataset.al;
        S.settings.al[k] = el.checked;
        if (k === 'notify' && el.checked) {
          if (!('Notification' in window)) { toast('Notifiche', 'Non supportate da questo browser', 'warn'); el.checked = false; S.settings.al.notify = false; }
          else {
            const p = await Notification.requestPermission();
            if (p !== 'granted') { toast('Notifiche', 'Permesso negato dal browser', 'warn'); el.checked = false; S.settings.al.notify = false; }
          }
        }
        if (k === 'sound' && el.checked) unlockAudio();
        saveSettings();
      }));
      const file = $('#backup-file');
      if (file) file.addEventListener('change', () => { if (file.files[0]) importBackup(file.files[0]); file.value = ''; });
    },
    update() {
      const c = S.conn;
      const names = { idle: 'Non connesso', connecting: 'Connessione…', open: 'Connesso', reconnecting: 'Riconnessione (tentativo ' + c.attempt + ')', auth: 'Token richiesto', blocked: 'Bloccato dal browser', demo: 'Demo' };
      setText('cf-state', names[c.state] || c.state);
      setText('cf-ws-url', c.wsUrl || '—');
      setText('cf-rest', { unknown: '—', ok: 'raggiungibili', auth: 'token richiesto', error: 'errore', unreachable: 'non raggiungibili da questa pagina' }[c.rest] || c.rest);
      setText('cf-ss', c.sourceState || '—');
    }
  };
  function diagHTML() {
    if (!S.diag) return '';
    return '<ul class="diag">' + S.diag.map(s => '<li><span class="' + (s.ok === true ? 'ok' : s.ok === false ? 'ko' : 'na') + '">' + (s.ok === true ? '✓' : s.ok === false ? '✕' : '–') + '</span><span>' + esc(s.label) + '<small>' + esc(s.detail) + '</small></span></li>').join('') + '</ul>';
  }
  function readConnForm() {
    const base = ($('#cf-base') || $('#w-base')).value;
    const tokenEl = $('#cf-token') || $('#w-token');
    return { base, token: tokenEl ? tokenEl.value.trim() : S.settings.token, wsUrl: $('#cf-ws') ? $('#cf-ws').value.trim() : S.settings.wsUrl };
  }

  /* ---------------------------------- Guida ---------------------------------- */
  VIEWS.guida = {
    render() {
      const here = location.href.split('#')[0];
      return '<div class="view-head"><div><h2>Guida</h2><p>Dall\'hardware alla prima misura</p></div></div><div class="stack prose">' +
        '<div class="card"><h3>Cos\'è RuView</h3><p><a href="https://github.com/ruvnet/RuView" target="_blank" rel="noopener">RuView</a> trasforma il Wi-Fi in un sensore: piccoli nodi <b>ESP32-S3</b> leggono come il corpo disturba le onde radio (CSI) e il <b>sensing-server</b> ne ricava presenza, numero di persone, movimento, respiro, battito e una posa stimata — senza telecamere. RuView Monitor è il pannello che mostra questi dati, genera gli allarmi e salva le sessioni.</p>' +
        '<table><tr><th>Nodi</th><th>Cosa si ottiene</th></tr><tr><td>1 ESP32</td><td>Presenza, respiro, movimento generale</td></tr><tr><td>2–3 ESP32</td><td>Localizzazione nella stanza, direzione del movimento</td></tr><tr><td>4+ ESP32 + modello</td><td>Posa completa a 17 punti</td></tr></table></div>' +
        '<div class="card"><h3>1 · Avvia il server</h3><p><b>Senza hardware (Docker, dati simulati):</b></p><pre><code>docker pull ruvnet/wifi-densepose:latest\nexport RUVIEW_API_TOKEN=$(openssl rand -hex 32)\ndocker run -p 127.0.0.1:3000:3000 -e RUVIEW_API_TOKEN ruvnet/wifi-densepose:latest</code></pre>' +
        '<p><b>Con i nodi ESP32</b> (dopo aver installato il firmware e configurato Wi-Fi e IP del server, vedi la documentazione di RuView):</p><pre><code>cd v2\ncargo build --release -p wifi-densepose-sensing-server\n./target/release/sensing-server --source esp32 \\\n  --bind-addr 0.0.0.0 --http-port 8080 --ui-path ../ui</code></pre>' +
        '<p>I nodi inviano i dati al server sulla porta UDP <code>5005</code>. In modalità <code>--source simulate</code> il server genera dati finti: RuView Monitor lo segnala sempre con un avviso arancione.</p></div>' +
        '<div class="card"><h3>2 · Apri RuView Monitor dal server (consigliato)</h3><p>Così pagina e API hanno la stessa origine: funzionano token, stato, nodi e registrazioni sul server, da PC e telefono.</p>' +
        '<ol><li>Copia la cartella <code>ruview/</code> di questo progetto dentro la cartella <code>ui/</code> di RuView, rinominandola <code>monitor</code>.</li><li>Riavvia il server e apri <code>http://IP-DEL-SERVER:8080/ui/monitor/</code> (con Docker: porta 3000, montando la cartella con <code>-v "$PWD/ruview:/app/ui/monitor:ro"</code>).</li><li>Dal telefono: menu del browser → <i>Aggiungi a schermata Home</i>.</li></ol>' +
        '<p>Per raggiungere il server da altri dispositivi avvialo con <code>--bind-addr 0.0.0.0</code> e, se usi un nome o un IP non locale, aggiungilo con <code>--allowed-host 192.168.1.50</code> (o la variabile <code>SENSING_ALLOWED_HOSTS</code>).</p></div>' +
        '<div class="card"><h3>3 · Altri modi</h3><ul><li><b>Versione online (HTTPS)</b>: funziona con un server sullo <b>stesso computer</b> (<code>http://localhost:8080</code>) o pubblicato in HTTPS. Verso un IP della rete locale il browser blocca la connessione (contenuto misto).</li>' +
        '<li><b>File locale</b>: <code>cd ruview && python3 -m http.server 5500</code> e apri <code>http://localhost:5500</code>. La diretta via WebSocket funziona; stato, nodi e registrazioni sul server richiedono la stessa origine (il server non abilita CORS).</li>' +
        '<li><b>Link diretto</b>: aggiungi <code>?server=http://IP:8080</code> all\'indirizzo per preconfigurare il server, <code>?demo=1</code> per la demo. Esempio: <code>' + esc(here) + '?server=http://192.168.1.50:8080</code></li></ul></div>' +
        '<div class="card"><h3>Sicurezza e privacy</h3><ul><li>Se il server usa <code>RUVIEW_API_TOKEN</code>, inserisci il token in Impostazioni: l\'app chiede al server un <b>ticket monouso</b> (30 s) per aprire il WebSocket, il token non finisce mai negli indirizzi.</li><li>Tutti i dati di RuView Monitor (impostazioni, eventi, registrazioni) restano su questo dispositivo.</li><li>In modalità privacy del server (<code>--privacy-mode</code>) i punti chiave della posa vengono rimossi: lo scheletro non viene mostrato.</li></ul></div>' +
        '<div class="card"><h3>Risoluzione problemi</h3><table><tr><th>Messaggio</th><th>Cosa fare</th></tr>' +
        '<tr><td>Bloccato</td><td>Pagina HTTPS verso server HTTP: apri l\'app dal server (passo 2) o usa localhost.</td></tr>' +
        '<tr><td>Token richiesto</td><td>Inserisci il valore di <code>RUVIEW_API_TOKEN</code> in Impostazioni.</td></tr>' +
        '<tr><td>Riconnessione…</td><td>Server spento, IP/porta errati, firewall, oppure server avviato senza <code>--bind-addr 0.0.0.0</code>.</td></tr>' +
        '<tr><td>Simulato</td><td>Il server usa <code>--source simulate</code> o non trova nodi in modalità auto.</td></tr>' +
        '<tr><td>Sensori fermi</td><td>Nessun frame dagli ESP32 da 5 s: alimentazione, Wi-Fi, IP del server nel firmware, porta UDP 5005.</td></tr>' +
        '<tr><td>Origine ?</td><td>Il server non dichiara l\'origine e le API di stato non sono leggibili: apri l\'app dal server.</td></tr></table>' +
        '<p>Usa <b>Impostazioni → Verifica connessione</b> per un controllo passo per passo.</p></div>' +
        '</div>';
    }
  };

  /* ---------------------------------- Altro ---------------------------------- */
  VIEWS.altro = {
    render() {
      const item = (v, i, t, d) => '<button data-action="goto" data-view="' + v + '"><span class="mi">' + i + '</span><span><b>' + t + '</b><small>' + d + '</small></span></button>';
      return '<div class="view-head"><div><h2>Altro</h2></div></div><div class="menu-list">' +
        item('nodi', '⌖', 'Nodi sensore', 'Stato, segnale e frame rate di ogni ESP32') +
        item('registrazioni', '⏺', 'Registrazioni', 'Sessioni, esportazione CSV/JSONL e report') +
        item('impostazioni', '⚙', 'Impostazioni', 'Server, token, soglie, avvisi, tema') +
        item('guida', '?', 'Guida', 'Installazione e risoluzione problemi') +
        '</div>';
    }
  };

  /* ---------------------------------- Report ---------------------------------- */
  async function printReport(o) {
    const root = $('#print-root');
    const th = S.settings.th;
    const samples = o.samples;
    const wm = o.watermark;
    const sb = statsOf(samples, 'br', 'brConf', th.minConf), sh = statsOf(samples, 'hr', 'hrConf', th.minConf);
    const n = samples.length || 1;
    const presence = samples.filter(x => x.presence).length / n, activeP = samples.filter(x => x.cls === 'active').length / n;
    const pmax = samples.length ? Math.max.apply(null, samples.map(x => x.presence ? x.persons || 1 : 0)) : 0;

    // Grafici disegnati in tema chiaro e convertiti in immagini per la stampa
    const prevTheme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px';
    document.body.appendChild(box);
    const img = (series, opts) => {
      const c = document.createElement('canvas');
      c.style.cssText = 'width:900px;height:200px;display:block';
      box.appendChild(c);
      Charts.timeSeries(c, Object.assign({ tMin: o.from, tMax: o.to, gapMs: Math.max(4000, (o.to - o.from) / 200), series, emptyText: 'Nessuna stima affidabile nel periodo' }, opts));
      return c.toDataURL('image/png');
    };
    const conf = (key, ck) => samples.map(x => [x.t, x[ck] != null && x[ck] >= th.minConf ? x[key] : null]);
    const charts = [
      ['Respiro (atti/min)', img([{ points: conf('br', 'brConf'), color: css('--c-br'), fill: true }], { band: [th.brMin, th.brMax], softMin: th.brMin - 2, softMax: th.brMax + 2 })],
      ['Battito (bpm)', img([{ points: conf('hr', 'hrConf'), color: css('--c-hr'), fill: true }], { band: [th.hrMin, th.hrMax], softMin: th.hrMin - 5, softMax: th.hrMax + 5 })],
      ['Movimento (potenza di banda)', img([{ points: samples.map(x => [x.t, x.mp]), color: css('--c-motion'), fill: true }], { softMin: 0, minSpan: 0.05 })]
    ];
    box.remove();
    if (prevTheme) document.documentElement.setAttribute('data-theme', prevTheme); else document.documentElement.removeAttribute('data-theme');

    const evs = o.events.filter(e => e.t >= o.from && e.t <= o.to + 1000).slice(0, 80);
    root.innerHTML = '<h1>' + esc(o.title) + '</h1><div>' + esc(dateTime(o.from)) + ' → ' + esc(dateTime(o.to)) + ' · durata ' + esc(duration(o.to - o.from)) + ' · ' + esc(o.subtitle || '') + '</div>' +
      (wm ? '<div class="wm">ATTENZIONE: report generato da dati ' + (wm === 'DEMO' ? 'DIMOSTRATIVI' : wm === 'SYNTHETIC' ? 'SINTETICI' : 'DI ORIGINE NON VERIFICATA') + ' — non rappresenta misure reali.</div>' : '') +
      '<h2>Riepilogo</h2><table><tr><th>Presenza</th><td>' + pct(presence) + ' del tempo</td><th>In movimento</th><td>' + pct(activeP) + '</td></tr>' +
      '<tr><th>Persone (max)</th><td>' + pmax + '</td><th>Campioni</th><td>' + samples.length + '</td></tr>' +
      '<tr><th>Respiro</th><td>media ' + fmt(sb.avg, 1) + ' · min ' + fmt(sb.min, 1) + ' · max ' + fmt(sb.max, 1) + ' atti/min</td><th>Battito</th><td>media ' + fmt(sh.avg, 0) + ' · min ' + fmt(sh.min, 0) + ' · max ' + fmt(sh.max, 0) + ' bpm</td></tr></table>' +
      charts.map(c => '<h2>' + esc(c[0]) + '</h2><img src="' + c[1] + '" alt="">').join('') +
      '<h2>Eventi (' + evs.length + ')</h2>' + (evs.length ? '<table><tr><th>Ora</th><th>Livello</th><th>Evento</th><th>Dettaglio</th></tr>' + evs.map(e => '<tr><td>' + esc(dateTime(e.t)) + '</td><td>' + esc({ critical: 'Allarme', warn: 'Avviso', info: 'Info' }[e.level] || e.level) + '</td><td>' + esc(e.title) + (e.simulated ? ' (simulato)' : '') + '</td><td>' + esc(e.detail) + '</td></tr>').join('') + '</table>' : '<p>Nessun evento nel periodo.</p>') +
      '<p style="margin-top:16px;color:#555">Generato da RuView Monitor ' + VERSION + ' il ' + esc(dateTime(Date.now())) + '. Respiro e battito sono stime contactless (affidabilità ≥ ' + pct(th.minConf) + '), non misure cliniche.</p>';
    await Promise.all($$('img', root).map(i => i.decode ? i.decode().catch(() => {}) : Promise.resolve()));
    window.print();
  }
  function reportCurrentSession() {
    const win = S.settings.window, now = Date.now();
    const samples = windowSamples(win);
    if (!samples.length) { toast('Report', 'Nessun dato nella finestra selezionata', 'warn'); return; }
    const ds = new Set(samples.map(x => x.ds));
    const wm = ds.has('demo') ? 'DEMO' : ds.has('synthetic') ? 'SYNTHETIC' : ds.has('unknown') ? 'UNVERIFIED' : null;
    printReport({ title: 'Report RuView — ultimi ' + duration(win * 1000), subtitle: S.conn.state === 'demo' ? 'dati dimostrativi' : hostOf(S.conn.base), from: samples[0].t, to: now, samples, events: S.events, watermark: wm });
  }
  async function reportRecording(id) {
    const meta = S.recordings.find(r => r.id === id);
    if (!meta) return;
    const frames = await recordingFrames(id);
    if (!frames.length) { toast('Report', 'Registrazione vuota', 'warn'); return; }
    // Ricampiona a 2 Hz per i grafici
    const samples = [];
    let last = 0;
    frames.forEach(f => {
      if (f.t - last < HISTORY_STEP_MS) return;
      last = f.t;
      samples.push({ t: f.t, presence: f.p, cls: !f.p ? 'absent' : (f.m === 'active' ? 'active' : 'still'), persons: f.n, br: f.br, brConf: f.brc, hr: f.hr, hrConf: f.hrc, mp: f.mp });
    });
    let events = S.events;
    try { events = await Store.listEvents(2000); } catch (e) { /* */ }
    printReport({ title: 'Report — ' + meta.name, subtitle: meta.frames + ' frame · ' + (meta.server ? hostOf(meta.server) : 'dati dimostrativi'), from: meta.start, to: meta.end || Date.now(), samples, events, watermark: recWatermark(meta) });
  }

  /* --------------------------------- Backup --------------------------------- */
  async function exportBackup() {
    const settings = JSON.parse(JSON.stringify(S.settings));
    settings.token = '';
    let events = S.events;
    try { events = await Store.listEvents(5000); } catch (e) { /* */ }
    download('ruview-monitor-backup_' + stamp() + '.json', JSON.stringify({ app: 'ruview-monitor', version: VERSION, exportedAt: new Date().toISOString(), settings, events }, null, 2), 'application/json');
  }
  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== 'ruview-monitor') throw new Error('Il file non è un backup di RuView Monitor');
      const token = S.settings.token;
      S.settings = deepMerge(DEFAULTS, data.settings || {});
      S.settings.token = token;
      await saveSettings();
      let added = 0;
      for (const ev of (data.events || [])) {
        if (!ev || !ev.t || !ev.title) continue;
        try { await Store.addEvent(ev); added++; } catch (e) { /* */ }
      }
      await loadEvents();
      applyTheme();
      toast('Backup importato', 'Impostazioni e ' + added + ' eventi ripristinati', 'info');
      renderView();
    } catch (e) { toast('Importazione non riuscita', e.message, 'warn'); }
  }
  async function loadEvents() {
    try { S.events = await Store.listEvents(500); } catch (e) { S.events = []; }
  }
  function exportEvents() {
    const cols = ['data_ora', 'livello', 'tipo', 'evento', 'dettaglio', 'origine_dati', 'confermato'];
    download('ruview-eventi_' + stamp() + '.csv', toCSV(cols, S.events.map(e => [isoLocal(e.t), e.level, e.kind, e.title, e.detail, e.source, e.ack ? 'sì' : 'no'])), 'text/csv;charset=utf-8');
  }

  /* --------------------------------- Azioni --------------------------------- */
  const ACTIONS = {
    'goto': el => navigate(el.dataset.view),
    'reconnect': () => { if (S.conn.state === 'demo') return; client.reconnect(); },
    'connect': () => connect(),
    'disconnect': () => { client.stop(); S.settings.autoConnect = false; saveSettings(); renderView(); },
    'demo-start': async () => { S.settings.demo = true; await saveSettings(); connect(); if (S.view === 'stato' || S.view === 'impostazioni') renderView(); },
    'demo-stop': async () => { S.settings.demo = false; await saveSettings(); connect(); renderView(); },
    'welcome-connect': async () => {
      const f = readConnForm();
      try { S.settings.base = RuView.normalizeBase(f.base); } catch (e) { toast('Indirizzo non valido', e.message, 'warn'); return; }
      S.settings.token = f.token; S.settings.demo = false; S.settings.autoConnect = true;
      await saveSettings(); connect(); renderView();
    },
    'save-connect': async () => {
      const f = readConnForm();
      try { S.settings.base = RuView.normalizeBase(f.base); } catch (e) { toast('Indirizzo non valido', e.message, 'warn'); return; }
      S.settings.token = f.token; S.settings.wsUrl = f.wsUrl; S.settings.demo = false;
      S.settings.autoConnect = $('#cf-auto') ? $('#cf-auto').checked : true;
      S.settings.rememberToken = $('#cf-remember') ? $('#cf-remember').checked : true;
      await saveSettings(); connect(); toast('Impostazioni salvate', 'Connessione a ' + hostOf(S.settings.base), 'info'); renderView();
    },
    'diagnose': async (el) => {
      el.disabled = true;
      const f = readConnForm();
      S.diag = [{ label: 'Verifica in corso…', ok: null, detail: '' }];
      setHTML('diag', diagHTML());
      S.diag = await client.diagnose(f, steps => { S.diag = steps; setHTML('diag', diagHTML()); });
      setHTML('diag', diagHTML());
      el.disabled = false;
    },
    'toggle-token': el => { const i = $('#cf-token'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? 'Nascondi' : 'Mostra'; },
    'window': async el => { S.settings.window = parseInt(el.dataset.w, 10) || 60; await saveSettings(); renderView(); },
    'theme': async el => { S.settings.theme = el.dataset.t; await saveSettings(); applyTheme(); renderView(); },
    'ack': async el => {
      const id = el.dataset.id, t = Number(el.dataset.t);
      const ev = S.events.find(e => String(e.id) === id && e.t === t) || S.events.find(e => e.t === t);
      if (ev) await ackEvent(ev);
      renderShell(); renderView();
    },
    'ack-all': () => ackAll(),
    'ev-filter': el => { S.eventFilter = el.dataset.f; renderView(); },
    'ev-export': () => exportEvents(),
    'ev-clear': async () => {
      if (!await confirmBox('Svuotare il registro?', 'Tutti gli eventi salvati su questo dispositivo verranno eliminati.', 'Svuota', true)) return;
      try { await Store.clearEvents(); } catch (e) { /* */ }
      S.events = []; S.unseen = 0; renderShell(); renderView();
    },
    'rec-start': () => startRecording(($('#rc-name') || {}).value).then(() => renderView()),
    'rec-stop': () => stopRecording().then(() => renderView()),
    'rec-export': el => exportRecording(el.dataset.id, el.dataset.f),
    'rec-report': el => reportRecording(el.dataset.id),
    'rec-delete': async el => {
      if (!await confirmBox('Eliminare la registrazione?', 'L\'operazione non si può annullare.', 'Elimina', true)) return;
      try { await Store.deleteRecording(el.dataset.id); } catch (e) { /* */ }
      refreshRecordings();
    },
    'srv-refresh': () => refreshServerRecs(),
    'srv-start': () => serverRecAction('start', ($('#srv-id') || {}).value ? $('#srv-id').value.trim() : ''),
    'srv-stop': () => serverRecAction('stop'),
    'srv-delete': async el => {
      if (!await confirmBox('Eliminare dal server?', 'Il file ' + el.dataset.id + ' verrà eliminato dal server RuView.', 'Elimina', true)) return;
      serverRecAction('delete', el.dataset.id);
    },
    'report-session': () => reportCurrentSession(),
    'test-alert': () => { unlockAudio(); beep('warn'); toast('Avviso di prova', 'Così appariranno gli avvisi', 'warn'); if (S.settings.al.notify) notify('Avviso di prova', 'Le notifiche funzionano'); },
    'backup-export': () => exportBackup(),
    'wipe': async () => {
      if (!await confirmBox('Cancellare tutti i dati?', 'Impostazioni, eventi e registrazioni salvati su questo dispositivo verranno eliminati.', 'Cancella tutto', true)) return;
      if (S.rec) S.rec = null;
      try { await Store.wipe(); } catch (e) { /* */ }
      location.hash = ''; location.reload();
    },
    'fullscreen': async () => {
      const root = document.documentElement;
      const on = !root.classList.contains('kiosk');
      root.classList.toggle('kiosk', on);
      try {
        if (on && root.requestFullscreen && !document.fullscreenElement) await root.requestFullscreen();
        else if (!on && document.fullscreenElement) await document.exitFullscreen();
      } catch (e) { /* non supportato (es. iPhone): resta la modalità senza menu */ }
      try { if (on && navigator.wakeLock) S.wakeLock = await navigator.wakeLock.request('screen'); else if (S.wakeLock) { S.wakeLock.release(); S.wakeLock = null; } } catch (e) { /* */ }
      if (on && S.view !== 'stato') navigate('stato');
    },
    'modal-close-bg': (el, e) => { if (e.target === el) closeModal(); }
  };

  /* ---------------------------------- Avvio ---------------------------------- */
  function wire() {
    document.addEventListener('click', e => {
      unlockAudio();
      const el = e.target.closest('[data-action], #nav [data-view]');
      if (!el) return;
      const a = el.dataset.action || 'goto';
      if (ACTIONS[a]) { e.preventDefault(); ACTIONS[a](el, e); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.documentElement.classList.remove('kiosk'); });
    window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== S.view) navigate(v); });
    window.addEventListener('resize', () => { S.lastChartAt = 0; S.dirty = true; renderShell(); });
    window.addEventListener('afterprint', () => { $('#print-root').innerHTML = ''; });
    window.addEventListener('beforeunload', () => { if (S.rec) flushRecording(); });
    if (window.matchMedia) {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const fn = () => { if (S.settings.theme === 'auto') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn);
    }

    client.on('state', snap => {
      const prev = S.conn;
      S.conn = snap;
      if (snap.state !== 'idle') { const w = $('#welcome'); if (w) w.remove(); }
      connEvents(prev, snap);
      S.dirty = true;
      renderShell();
    });
    client.on('frame', f => {
      if (S.streamStale) { S.streamStale = false; logEvent('info', 'stream', 'Flusso dati ripristinato', ''); }
      S.frame = f; S.lastFrameAt = f.t;
      pushHistory(f);
      Rules.frame(f);
      if (S.rec) recordFrame(f);
      S.dirty = true;
    });
    client.on('edge', e => { S.edge[e.nodeId] = e; Rules.edge(e); S.dirty = true; });
    client.on('wasm', w => {
      if (!S.settings.al.edgeModules) return;
      const last = S.wasm[w.moduleId] || 0;
      if (w.t - last < 5000) return;
      S.wasm[w.moduleId] = w.t;
      logEvent('info', 'edge', 'Modulo edge ' + w.moduleId + ' (nodo ' + w.nodeId + ')', w.events.map(x => 'tipo ' + x.event_type + ' = ' + fmt(x.value, 2)).join(', '));
    });
    client.on('status', st => { S.status = st; });
    client.on('nodes', n => { S.restNodes = n; S.dirty = true; });
  }

  // Classi di origine per non segnalare ogni piccolo assestamento iniziale.
  function sourceClass(ds) { return ds === 'live' || ds === 'live-unverified' ? 'live' : ds; }
  let lastSourceClass = null;
  function connEvents(prev, snap) {
    if (prev.state !== 'open' && snap.state === 'open') { logEvent('info', 'conn', 'Connesso al server', hostOf(snap.base)); lastSourceClass = null; }
    if (prev.state === 'open' && snap.state === 'reconnecting') logEvent('warn', 'conn', 'Connessione al server persa', 'Nuovo tentativo in corso…');
    if (snap.state === 'auth' && prev.state !== 'auth') logEvent('warn', 'conn', snap.authReason === 'rejected' ? 'Token API rifiutato' : 'Il server richiede un token API', 'Impostazioni → Connessione');
    if (snap.state === 'blocked' && prev.state !== 'blocked') logEvent('warn', 'conn', 'Connessione bloccata dal browser', snap.lastError);
    if (snap.state === 'open' && snap.connectedAt && Date.now() - snap.connectedAt > 3000) {
      const cls = sourceClass(snap.dataSource);
      if (cls !== 'unknown' && cls !== lastSourceClass) {
        if (lastSourceClass !== null) {
          if (cls === 'synthetic') logEvent('warn', 'source', 'Il server è passato a dati sintetici', 'I valori non sono misure reali');
          else if (cls === 'live') logEvent('info', 'source', 'Dati reali dai sensori', snap.serverSource || '');
          else if (cls === 'stale') logEvent('warn', 'source', 'I nodi hanno smesso di inviare dati', 'Il server non riceve frame CSI');
        }
        lastSourceClass = cls;
      }
    }
  }

  function loop() {
    // Flusso fermo: avviso una sola volta finché non riprende.
    if (streamStale() && !S.streamStale) {
      S.streamStale = true;
      logEvent('warn', 'stream', 'Nessun dato dal server', 'Nessun frame da oltre ' + S.settings.th.staleSec + ' s');
    }
    renderShell();
    if (S.dirty || Date.now() - S.lastChartAt > 1000) { S.dirty = false; updateView(false); }
  }

  async function init() {
    await Store.ready();
    await loadSettings();
    applyTheme();
    if (new URLSearchParams(location.search).get('kiosk') === '1') document.documentElement.classList.add('kiosk');
    await loadEvents();
    await refreshRecordings();
    // Una registrazione interrotta (pagina chiusa) viene chiusa al riavvio.
    for (const m of S.recordings) if (!m.end) { m.end = m.start + Math.max(1000, m.frames * 100); try { await Store.putRecording(m); } catch (e) { /* */ } }
    if (S.firstRun && servedByRuView()) await saveSettings(); // aperta dal server: si collega a lui
    wire();
    const v = location.hash.slice(1);
    navigate(VIEWS[v] ? v : 'stato');
    if (S.settings.demo || (S.settings.autoConnect && !S.firstRun)) connect();
    setInterval(loop, 120);
  }

  init().catch(e => {
    console.error(e);
    $('#view').innerHTML = '<div class="empty"><div class="big">⚠</div><p>Errore di avvio: ' + esc(e.message) + '</p></div>';
  });
})();
