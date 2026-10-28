/* =========================================================================
   client.js — Connessione al sensing-server di RuView
   - WebSocket /ws/sensing (sulla porta HTTP; in alternativa la porta WS
     dedicata: 8080→8765, 3000→3001 come nel progetto originale)
   - ticket monouso (POST /api/v1/ws-ticket) quando il server ha il token
     attivo (RUVIEW_API_TOKEN): il browser non può mettere l'header
     Authorization sull'upgrade WebSocket
   - riconnessione con attesa crescente, rilevamento token mancante/rifiutato
   - stato canonico dell'origine dati da GET /api/v1/status (source_state)
   - normalizzazione dei messaggi sensing_update / edge_vitals / wasm_event
   - sorgente dimostrativa (DemoSource), sempre marcata come non reale
   ========================================================================= */
(function (global) {
  'use strict';

  const KP_NAMES = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];

  const WS_PORT_MAP = { '8080': '8765', '3000': '3001' };
  const BACKOFF = [1000, 2000, 4000, 8000, 16000];
  const STATUS_POLL_MS = 5000;
  const REST_RETRY_MS = 60000;
  const FETCH_TIMEOUT_MS = 6000;
  const STATUS_FRESH_MS = 20000;

  /* --------------------------------- Utilità --------------------------------- */
  function isLoopback(hostname) {
    const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
    return h === 'localhost' || h === '::1' || /^127\./.test(h) || h.endsWith('.localhost');
  }

  // Accetta "192.168.1.50:8080", "http://host:3000/ui/index.html", ecc. e
  // restituisce la base delle API (origine + eventuale prefisso di un proxy).
  function normalizeBase(input) {
    let s = String(input || '').trim();
    if (!s) throw new Error('Inserisci l\'indirizzo del server');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Usa un indirizzo http:// o https://');
    let path = u.pathname;
    const ui = path.search(/\/ui(\/|$)/);
    if (ui >= 0) path = path.slice(0, ui);
    path = path.replace(/\/[^/]*\.html?$/i, '').replace(/\/+$/, '');
    return u.origin + path;
  }

  function wsCandidates(base, override) {
    if (override) return [override];
    const u = new URL(base);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const prefix = u.pathname.replace(/\/+$/, '');
    const list = [proto + '//' + u.host + prefix + '/ws/sensing'];
    const mapped = WS_PORT_MAP[u.port];
    if (mapped) list.push(proto + '//' + u.hostname + ':' + mapped + '/ws/sensing');
    return list;
  }

  // Una pagina https non può aprire ws:// o http:// verso un host di rete
  // (contenuto misto). Il loopback è l'unica eccezione dei browser.
  function mixedContentBlocked(url) {
    if (typeof location === 'undefined' || location.protocol !== 'https:') return false;
    try {
      const u = new URL(url);
      return (u.protocol === 'ws:' || u.protocol === 'http:') && !isLoopback(u.hostname);
    } catch (e) { return false; }
  }

  function numOrNull(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /* -------------------------- Origine dei dati (ADR-295) -------------------------- */
  // Mai mostrare dati sintetici come misure: in dubbio si resta prudenti.
  function classifySource(rawSource, sourceState, simulatedFlag) {
    if (simulatedFlag) return 'synthetic';
    switch (sourceState) {
      case 'live_verified': return 'live';
      case 'live_unverified': return 'live-unverified';
      case 'synthetic': return 'synthetic';
      case 'stale': return 'stale';
      case 'disconnected': return 'waiting';
      default: break;
    }
    const s = String(rawSource || '').toLowerCase();
    if (!s) return 'unknown';
    if (s.indexOf('offline') >= 0) return 'stale';
    if (/simul|synthetic|mock|demo/.test(s)) return 'synthetic';
    if (/esp32|wifi|live|realtek|mediatek|qualcomm|csi|nexmon|intel|atheros/.test(s)) return 'live-unverified';
    return 'unknown';
  }

  /* ------------------------------ Normalizzazione ------------------------------ */
  function normalizeFrame(raw) {
    const now = Date.now();
    const feat = raw.features || {};
    const cls = raw.classification || {};
    const vs = raw.vital_signs || {};

    let ts = numOrNull(raw.timestamp);
    if (ts !== null && ts < 1e12) ts = ts * 1000; // il server invia secondi

    // Nodi: unisce l'elenco base (posizione, sottoportanti) con le
    // caratteristiche per nodo (frame rate, ultimo frame, novità).
    const nodes = new Map();
    (Array.isArray(raw.nodes) ? raw.nodes : []).forEach(n => {
      if (!n || n.node_id == null) return;
      nodes.set(n.node_id, {
        id: n.node_id, rssi: numOrNull(n.rssi_dbm),
        position: Array.isArray(n.position) ? n.position : null,
        subcarriers: numOrNull(n.subcarrier_count)
      });
    });
    (Array.isArray(raw.node_features) ? raw.node_features : []).forEach(nf => {
      if (!nf || nf.node_id == null) return;
      const o = nodes.get(nf.node_id) || { id: nf.node_id };
      const c = nf.classification || {};
      const f = nf.features || {};
      Object.assign(o, {
        rssi: numOrNull(nf.rssi_dbm) !== null ? nf.rssi_dbm : o.rssi,
        fps: numOrNull(nf.frame_rate_hz),
        lastSeenMs: numOrNull(nf.last_seen_ms),
        stale: !!nf.stale,
        novelty: numOrNull(nf.novelty_score),
        motion: c.motion_level || null,
        presence: typeof c.presence === 'boolean' ? c.presence : null,
        confidence: numOrNull(c.confidence),
        motionPower: numOrNull(f.motion_band_power)
      });
      nodes.set(nf.node_id, o);
    });

    // Persone e punti chiave (17 COCO). Se c'è un modello addestrato il
    // server invia pose_keypoints [x, y, z, confidenza].
    let people = [];
    if (Array.isArray(raw.persons)) {
      people = raw.persons.map((p, i) => ({
        id: p.id != null ? p.id : i + 1,
        confidence: numOrNull(p.confidence),
        keypoints: (Array.isArray(p.keypoints) ? p.keypoints : []).map(k => ({
          name: k.name, x: k.x, y: k.y, z: k.z, c: numOrNull(k.confidence) === null ? 1 : k.confidence
        })),
        position: Array.isArray(p.position) ? p.position : null,
        zone: p.zone || null,
        motion: numOrNull(p.motion_score),
        pose: p.pose || null
      }));
    }
    const hasModelKp = Array.isArray(raw.pose_keypoints) && raw.pose_keypoints.length > 0;
    if (!people.length && hasModelKp) {
      people = [{
        id: 1, confidence: numOrNull(cls.confidence),
        keypoints: raw.pose_keypoints.map((k, i) => ({ name: KP_NAMES[i] || 'kp' + i, x: k[0], y: k[1], z: k[2], c: k[3] })),
        position: null, zone: null, motion: null, pose: raw.posture || null
      }];
    }

    let field = null;
    const sf = raw.signal_field;
    if (sf && Array.isArray(sf.values) && Array.isArray(sf.grid_size)) {
      const nx = sf.grid_size[0] | 0, nz = (sf.grid_size[2] || sf.grid_size[1]) | 0;
      if (nx > 0 && nz > 0 && sf.values.length >= nx * nz) field = { nx, nz, values: sf.values };
    }

    const presence = !!cls.presence;
    const estimated = numOrNull(raw.estimated_persons);
    return {
      t: now,
      ts,
      tick: numOrNull(raw.tick),
      source: raw.source || null,
      simulated: raw._simulated === true,
      presence,
      motion: cls.motion_level || (presence ? 'present_still' : 'absent'),
      confidence: numOrNull(cls.confidence),
      persons: estimated !== null ? estimated : (people.length || (presence ? 1 : 0)),
      rssi: numOrNull(feat.mean_rssi),
      variance: numOrNull(feat.variance),
      motionPower: numOrNull(feat.motion_band_power),
      breathPower: numOrNull(feat.breathing_band_power),
      dominantHz: numOrNull(feat.dominant_freq_hz),
      changePoints: numOrNull(feat.change_points),
      spectralPower: numOrNull(feat.spectral_power),
      br: numOrNull(vs.breathing_rate_bpm),
      brConf: numOrNull(vs.breathing_confidence),
      hr: numOrNull(vs.heart_rate_bpm),
      hrConf: numOrNull(vs.heartbeat_confidence),
      vitalQuality: numOrNull(vs.signal_quality),
      quality: numOrNull(raw.signal_quality_score),
      verdict: raw.quality_verdict || null,
      posture: raw.posture || null,
      bssids: numOrNull(raw.bssid_count),
      modelStatus: raw.model_status || null,
      poseSource: hasModelKp ? 'model' : (people.length ? 'signal' : null),
      people,
      field,
      nodes: Array.from(nodes.values()).sort((a, b) => a.id - b.id)
    };
  }

  function normalizeEdge(msg) {
    return {
      t: Date.now(),
      type: msg.type,
      nodeId: msg.node_id,
      presence: typeof msg.presence === 'boolean' ? msg.presence : null,
      fall: msg.fall_detected === true,
      motion: msg.motion === true,
      br: numOrNull(msg.breathing_rate_bpm),
      hr: numOrNull(msg.heartrate_bpm),
      persons: numOrNull(msg.n_persons),
      personsValid: msg.person_count_valid !== false,
      rssi: numOrNull(msg.rssi),
      presenceScore: numOrNull(msg.presence_score),
      motionEnergy: numOrNull(msg.motion_energy),
      vitalsAuthorized: msg.numeric_vitals_authorized !== false,
      abstention: msg.abstention_reason || null,
      fusionConfidence: numOrNull(msg.fusion_confidence)
    };
  }

  /* --------------------------------- Emettitore --------------------------------- */
  class Emitter {
    constructor() { this._h = {}; }
    on(name, fn) {
      (this._h[name] || (this._h[name] = new Set())).add(fn);
      return () => this._h[name].delete(fn);
    }
    emit(name, arg) {
      const set = this._h[name];
      if (set) set.forEach(fn => { try { fn(arg); } catch (e) { console.error('[client]', name, e); } });
    }
  }

  /* --------------------------------- Client --------------------------------- */
  class RuViewClient extends Emitter {
    constructor() {
      super();
      this.cfg = { base: '', wsUrl: '', token: '' };
      // idle | connecting | open | reconnecting | auth | blocked | demo
      this.state = 'idle';
      this.authReason = null;     // 'missing' | 'rejected'
      this.attempt = 0;
      this.wsIndex = 0;
      this.ws = null;
      this.wsActive = '';
      this.epoch = 0;
      this.timer = null;
      this.statusTimer = null;
      this.rest = 'unknown';      // unknown | ok | auth | error | unreachable
      this.status = null;
      this.statusAt = 0;
      this.restNodes = null;
      this.lastFrameAt = 0;
      this.connectedAt = 0;
      this.frameTimes = [];
      this.framesTotal = 0;
      this.badMessages = 0;
      this.serverSource = null;
      this.lastSimulated = false;
      this.lastError = '';
      this.demo = null;
    }

    configure(cfg) {
      this.cfg = {
        base: cfg.base ? normalizeBase(cfg.base) : '',
        wsUrl: (cfg.wsUrl || '').trim(),
        token: (cfg.token || '').trim()
      };
    }

    get sameOrigin() {
      try { return typeof location !== 'undefined' && new URL(this.cfg.base).origin === location.origin; }
      catch (e) { return false; }
    }

    get dataSource() {
      if (this.state === 'demo') return 'demo';
      const fresh = this.status && Date.now() - this.statusAt < STATUS_FRESH_MS;
      return classifySource(this.serverSource, fresh ? this.status.source_state : null, this.lastSimulated);
    }

    get fps() {
      const now = Date.now();
      while (this.frameTimes.length && now - this.frameTimes[0] > 3000) this.frameTimes.shift();
      if (this.frameTimes.length < 2) return 0;
      return (this.frameTimes.length - 1) / ((this.frameTimes[this.frameTimes.length - 1] - this.frameTimes[0]) / 1000 || 1);
    }

    snapshot() {
      return {
        state: this.state, authReason: this.authReason, attempt: this.attempt,
        dataSource: this.dataSource, serverSource: this.serverSource,
        sourceState: this.status ? this.status.source_state : null,
        waitingForFrames: this.status ? !!this.status.waiting_for_frames : false,
        rest: this.rest, wsUrl: this.wsActive, base: this.cfg.base,
        lastFrameAt: this.lastFrameAt, connectedAt: this.connectedAt,
        lastError: this.lastError, sameOrigin: this.sameOrigin
      };
    }

    _set(state) {
      if (this.state === state) { this.emit('state', this.snapshot()); return; }
      this.state = state;
      this.emit('state', this.snapshot());
    }

    start() {
      this.stop(true);
      if (!this.cfg.base) { this.lastError = 'Indirizzo del server mancante'; this._set('idle'); return; }
      const epoch = ++this.epoch;
      this.attempt = 0;
      this.wsIndex = 0;
      this._connect(epoch);
      this._scheduleStatus(0);
    }

    stop(silent) {
      this.epoch++;
      clearTimeout(this.timer); this.timer = null;
      clearTimeout(this.statusTimer); this.statusTimer = null;
      if (this.demo) { this.demo.stop(); this.demo = null; }
      if (this.ws) { try { this.ws.close(1000, 'client stop'); } catch (e) { /* già chiuso */ } this.ws = null; }
      this.status = null; this.statusAt = 0; this.rest = 'unknown'; this.serverSource = null;
      this.lastSimulated = false; this.frameTimes = []; this.lastFrameAt = 0; this.connectedAt = 0;
      this.authReason = null;
      if (!silent) this._set('idle'); else this.state = 'idle';
    }

    reconnect() { this.start(); }

    startDemo() {
      this.stop(true);
      this.connectedAt = Date.now();
      this._set('demo');
      this.demo = new DemoSource(msg => this._onMessage(msg));
      this.demo.start();
    }

    async _connect(epoch) {
      const urls = wsCandidates(this.cfg.base, this.cfg.wsUrl);
      const url = urls[this.wsIndex % urls.length];
      if (mixedContentBlocked(url)) {
        this.lastError = 'Questa pagina è in HTTPS e il browser blocca la connessione non cifrata verso ' + new URL(url).host + '.';
        this._set('blocked');
        return;
      }
      this._set(this.attempt ? 'reconnecting' : 'connecting');

      let ticket = null;
      if (this.cfg.token) {
        const r = await this._mintTicket();
        if (epoch !== this.epoch) return;
        if (r.rejected) { this.authReason = 'rejected'; this.lastError = 'Il server ha rifiutato il token'; this._set('auth'); return; }
        ticket = r.ticket || null;
      }

      const full = ticket ? url + (url.indexOf('?') >= 0 ? '&' : '?') + 'ticket=' + encodeURIComponent(ticket) : url;
      let ws;
      try { ws = new WebSocket(full); }
      catch (e) { this.lastError = e.message; this._retry(epoch); return; }
      this.ws = ws;
      let opened = false;
      const current = () => epoch === this.epoch && this.ws === ws;

      ws.onopen = () => {
        if (!current()) { try { ws.close(1000, 'superseded'); } catch (e) { /* */ } return; }
        opened = true;
        this.attempt = 0;
        this.authReason = null;
        this.lastError = '';
        this.wsActive = url;
        this.connectedAt = Date.now();
        this._set('open');
        this.emit('connected', url);
        this._scheduleStatus(0);
      };
      ws.onmessage = (ev) => { if (current()) this._onMessage(ev.data); };
      ws.onerror = () => { /* segue sempre onclose */ };
      ws.onclose = async (ev) => {
        if (!current()) return;
        this.ws = null;
        if (opened) {
          this.lastError = 'Connessione chiusa (codice ' + ev.code + ')';
          this.emit('disconnected', ev.code);
          this._retry(epoch);
          return;
        }
        // Mai aperta: può essere un rifiuto per token mancante.
        if (!ticket) {
          const needsToken = await this._probeAuth();
          if (epoch !== this.epoch) return;
          if (needsToken) {
            this.authReason = 'missing';
            this.lastError = 'Il server richiede un token API';
            this._set('auth');
            return;
          }
        }
        this.lastError = 'Server non raggiungibile su ' + new URL(url).host;
        this.wsIndex++; // al prossimo tentativo prova la porta alternativa
        this._retry(epoch);
      };
    }

    _retry(epoch) {
      if (epoch !== this.epoch || this.timer) return;
      const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
      this.attempt++;
      this._set('reconnecting');
      this.timer = setTimeout(() => {
        this.timer = null;
        if (epoch === this.epoch) this._connect(epoch);
      }, delay);
    }

    _onMessage(data) {
      let msg = data;
      if (typeof data === 'string') {
        try { msg = JSON.parse(data); } catch (e) { this.badMessages++; return; }
      }
      if (!msg || typeof msg !== 'object') return;
      const type = msg.type || (msg.features && msg.classification ? 'sensing_update' : '');
      if (type === 'sensing_update') {
        const f = normalizeFrame(msg);
        const now = Date.now();
        this.lastFrameAt = now;
        this.framesTotal++;
        this.frameTimes.push(now);
        if (this.frameTimes.length > 120) this.frameTimes.shift();
        if (f.source && f.source !== this.serverSource) {
          this.serverSource = f.source;
          this.emit('state', this.snapshot());
        }
        if (f.simulated !== this.lastSimulated) {
          this.lastSimulated = f.simulated;
          this.emit('state', this.snapshot());
        }
        f.dataSource = this.dataSource;
        this.emit('frame', f);
      } else if (type === 'edge_vitals' || type === 'edge_fused_vitals') {
        const e = normalizeEdge(msg);
        e.dataSource = this.dataSource;
        this.emit('edge', e);
      } else if (type === 'wasm_event') {
        this.emit('wasm', { t: Date.now(), nodeId: msg.node_id, moduleId: msg.module_id, events: msg.events || [], dataSource: this.dataSource });
      }
    }

    /* ---------------------------------- REST ---------------------------------- */
    async _fetch(path, opts) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
      try {
        return await fetch(this.cfg.base + path, Object.assign({
          credentials: 'same-origin', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined
        }, opts || {}));
      } finally { if (t) clearTimeout(t); }
    }

    headers(extra) {
      const h = Object.assign({}, extra || {});
      if (this.cfg.token) h.Authorization = 'Bearer ' + this.cfg.token;
      return h;
    }

    // Chiamata REST. Restituisce { ok, status, data }; lancia solo per errori
    // di rete (server spento, CORS, contenuto misto, timeout).
    async api(path, opts) {
      opts = opts || {};
      if (!this.cfg.base) throw new Error('Server non configurato');
      if (mixedContentBlocked(this.cfg.base)) throw new Error('Bloccato dal browser (pagina HTTPS → server HTTP)');
      const init = { method: opts.method || 'GET', headers: this.headers(opts.body ? { 'Content-Type': 'application/json' } : null) };
      if (opts.body) init.body = JSON.stringify(opts.body);
      const r = await this._fetch(path, init);
      let data = null;
      const ct = r.headers.get('content-type') || '';
      if (ct.indexOf('json') >= 0) { try { data = await r.json(); } catch (e) { data = null; } }
      else { try { data = await r.text(); } catch (e) { data = null; } }
      return { ok: r.ok, status: r.status, data };
    }

    async _mintTicket() {
      try {
        const r = await this._fetch('/api/v1/ws-ticket', { method: 'POST', headers: this.headers() });
        if (r.status === 404) return {};                       // server precedente all'ADR-272
        if (r.status === 401 || r.status === 403) return { rejected: true };
        if (!r.ok) return {};
        const j = await r.json();
        return { ticket: j && j.ticket ? j.ticket : null };
      } catch (e) { return {}; }                               // rete/CORS: si prova senza ticket
    }

    async _probeAuth() {
      if (this.cfg.token) return false;
      try {
        const r = await this._fetch('/api/v1/ws-ticket', { method: 'POST' });
        return r.status === 401 || r.status === 403;
      } catch (e) { return false; }
    }

    _scheduleStatus(delay) {
      clearTimeout(this.statusTimer);
      const epoch = this.epoch;
      this.statusTimer = setTimeout(async () => {
        if (epoch !== this.epoch || this.state === 'idle' || this.state === 'demo' || this.state === 'blocked') return;
        try {
          const r = await this.api('/api/v1/status');
          if (epoch !== this.epoch) return;
          if (r.ok && r.data && typeof r.data === 'object') {
            this.rest = 'ok'; this.status = r.data; this.statusAt = Date.now();
            this.emit('status', r.data);
            try {
              const n = await this.api('/api/v1/nodes');
              if (n.ok && n.data) { this.restNodes = n.data; this.emit('nodes', n.data); }
            } catch (e) { /* facoltativo */ }
          } else {
            this.rest = (r.status === 401 || r.status === 403) ? 'auth' : 'error';
          }
        } catch (e) {
          this.rest = 'unreachable';
        }
        if (epoch !== this.epoch) return;
        this.emit('state', this.snapshot());
        this._scheduleStatus(this.rest === 'unreachable' ? REST_RETRY_MS : STATUS_POLL_MS);
      }, delay);
    }

    /* ------------------------------- Diagnostica ------------------------------- */
    // Esegue i controlli uno per uno senza toccare la connessione principale.
    async diagnose(cfg, onStep) {
      const steps = [];
      const push = (label, ok, detail) => { const s = { label, ok, detail: detail || '' }; steps.push(s); if (onStep) onStep(steps.slice()); return s; };
      let base;
      try { base = normalizeBase(cfg.base); push('Indirizzo del server', true, base); }
      catch (e) { push('Indirizzo del server', false, e.message); return steps; }
      const probe = new RuViewClient();
      probe.configure({ base, wsUrl: cfg.wsUrl, token: cfg.token });

      if (mixedContentBlocked(base)) {
        push('Sicurezza del browser', false, 'Questa pagina è aperta in HTTPS: il browser blocca le connessioni HTTP/WS verso altri dispositivi della rete. Apri RuView Monitor dal server stesso (vedi Guida) oppure usa un indirizzo https://.');
        return steps;
      }
      push('Sicurezza del browser', true, location.protocol === 'https:' ? 'Server su loopback o HTTPS: consentito' : 'Pagina HTTP: nessun blocco');

      let restOk = false;
      try {
        const r = await probe.api('/health');
        restOk = r.ok;
        push('API REST (/health)', r.ok, r.ok ? 'Il server risponde' : 'Risposta HTTP ' + r.status);
      } catch (e) {
        push('API REST (/health)', null, probe.sameOrigin
          ? 'Nessuna risposta: il server è acceso? (' + e.message + ')'
          : 'Non leggibile da questa origine (il server non abilita CORS). Normale se l\'app non è aperta dal server: la diretta via WebSocket funziona lo stesso, ma stato, nodi e registrazioni sul server no.');
      }

      if (restOk) {
        try {
          const r = await probe.api('/api/v1/status');
          if (r.ok && r.data) {
            const st = r.data.source_state || r.data.source || 'sconosciuta';
            push('Origine dati del server', st === 'live_verified' || st === 'live_unverified', 'source_state: ' + st + (r.data.waiting_for_frames ? ' — nessun frame ancora ricevuto dai nodi' : ''));
          } else if (r.status === 401 || r.status === 403) {
            push('Origine dati del server', false, 'Token API mancante o non valido (HTTP ' + r.status + ')');
          } else push('Origine dati del server', null, 'HTTP ' + r.status);
        } catch (e) { push('Origine dati del server', null, e.message); }

        const t = await probe._mintTicket();
        if (t.rejected) push('Token API', false, 'Il token è stato rifiutato dal server');
        else if (t.ticket) push('Token API', true, 'Token valido: ticket WebSocket ottenuto');
        else if (cfg.token) push('Token API', null, 'Il server non usa i ticket (autenticazione disattivata o versione precedente)');
        else {
          const need = await probe._probeAuth();
          push('Token API', need ? false : true, need ? 'Il server richiede un token (RUVIEW_API_TOKEN): inseriscilo qui sotto' : 'Nessun token richiesto');
        }
      }

      // WebSocket: apre, aspetta il primo sensing_update, misura il frame rate.
      const urls = wsCandidates(base, cfg.wsUrl);
      let wsDone = false;
      for (let i = 0; i < urls.length && !wsDone; i++) {
        const res = await testSocket(probe, urls[i]);
        if (res.ok) {
          wsDone = true;
          push('Flusso in diretta (WebSocket)', true, urls[i] + ' — ' + res.frames + ' frame in ' + (res.ms / 1000).toFixed(1) + ' s' + (res.source ? ', origine "' + res.source + '"' : ''));
          if (res.source) {
            const ds = classifySource(res.source, null, res.simulated);
            if (ds === 'synthetic') push('Dati reali', false, 'Il server sta generando dati sintetici (avviato con --source simulated): non sono misure.');
            else if (ds === 'stale') push('Dati reali', false, 'Il server è attivo ma i nodi ESP32 non inviano dati.');
            else push('Dati reali', true, 'I frame dichiarano una sorgente hardware (' + res.source + ')');
          }
        } else if (i === urls.length - 1) {
          push('Flusso in diretta (WebSocket)', false, res.error || 'Impossibile aprire ' + urls[i]);
        }
      }
      return steps;
    }
  }

  function testSocket(client, url) {
    return new Promise(async (resolve) => {
      let ticket = null;
      if (client.cfg.token) { const t = await client._mintTicket(); ticket = t.ticket || null; }
      const full = ticket ? url + (url.indexOf('?') >= 0 ? '&' : '?') + 'ticket=' + encodeURIComponent(ticket) : url;
      let ws, opened = false, frames = 0, first = 0, source = null, simulated = false, done = false;
      const finish = (res) => { if (done) return; done = true; clearTimeout(timer); try { ws && ws.close(1000); } catch (e) { /* */ } resolve(res); };
      const timer = setTimeout(() => {
        if (opened && frames > 0) finish({ ok: true, frames, ms: Date.now() - first, source, simulated });
        else finish({ ok: false, error: opened ? 'Connesso, ma nessun dato ricevuto in 6 s' : 'Nessuna risposta da ' + url });
      }, 6000);
      try { ws = new WebSocket(full); } catch (e) { finish({ ok: false, error: e.message }); return; }
      ws.onopen = () => { opened = true; };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!m || m.type !== 'sensing_update') return;
        if (!frames) first = Date.now();
        frames++; source = m.source || source; simulated = m._simulated === true || simulated;
        if (frames >= 15) finish({ ok: true, frames, ms: Date.now() - first, source, simulated });
      };
      ws.onclose = (ev) => { if (!done) finish({ ok: frames > 0, frames, ms: Date.now() - first, source, simulated, error: opened ? 'Chiusa dal server (codice ' + ev.code + ')' : 'Connessione rifiutata da ' + url }); };
    });
  }

  /* ------------------------------ Sorgente demo ------------------------------ */
  // Genera frame nel formato del sensing-server per provare l'app senza
  // hardware. Ogni frame è marcato _simulated: l'interfaccia lo mostra sempre
  // come DEMO, mai come misura.
  class DemoSource {
    constructor(emit) {
      this.emit = emit;
      this.timer = null;
      this.t0 = 0;
      this.tick = 0;
      this.fallDone = false;
      this.seed = 1;
    }
    start() {
      this.t0 = Date.now();
      this.timer = setInterval(() => this.step(), 100);
    }
    stop() { clearInterval(this.timer); this.timer = null; }
    rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
    noise(a) { return (this.rnd() - 0.5) * 2 * a; }

    // Copione di 200 s che si ripete: stanza vuota, una persona entra e
    // cammina, si siede, (solo al primo giro) cade, poi arriva una seconda
    // persona ed escono entrambe.
    scene(s) {
      const c = s % 200;
      if (c < 12) return { mode: 'absent', n: 0 };
      if (c < 70) return { mode: 'walk', n: 1 };
      if (c < 95) return { mode: 'sit', n: 1 };
      if (c < 108) return { mode: s < 200 ? 'lie' : 'sit', n: 1 };
      if (c < 150) return { mode: 'sit', n: 1 };
      if (c < 172) return { mode: 'walk', n: 2 };
      if (c < 186) return { mode: 'walk', n: 1 };
      return { mode: 'absent', n: 0 };
    }

    step() {
      const s = (Date.now() - this.t0) / 1000;
      this.tick++;
      const sc = this.scene(s);
      const present = sc.n > 0;
      const active = sc.mode === 'walk';
      const br = 14 + 1.5 * Math.sin(s / 23) + this.noise(0.3);
      const hr = 67 + 4 * Math.sin(s / 31) + this.noise(0.8);
      const motionPower = !present ? 0.012 + this.noise(0.004) : active ? 0.24 + 0.08 * Math.sin(s * 1.7) + this.noise(0.03) : 0.045 + this.noise(0.01);
      const breathPower = present && !active ? 0.09 + 0.02 * Math.sin(s * 2 * Math.PI * br / 60) : 0.015 + this.noise(0.005);

      // Traiettorie (metri, stanza 5 × 4) e scheletri (spazio 640 × 480 px).
      const people = [];
      for (let i = 0; i < sc.n; i++) {
        const ph = s * 0.35 + i * 2.1;
        const pos = active
          ? [2.5 + 1.8 * Math.sin(ph), 0, 2 + 1.3 * Math.sin(ph * 1.6 + i)]
          : [1.6, 0, 1.4];
        const px = 320 + (pos[0] - 2.5) * 70 + (i ? 120 : 0);
        people.push({
          id: i + 1,
          confidence: 0.62 + this.noise(0.05),
          keypoints: demoSkeleton(px, 430, 1.05 - pos[2] * 0.05, s * 5.5 + i, sc.mode),
          bbox: { x: px - 60, y: 210, width: 120, height: 220 },
          zone: 'zone_1',
          position: pos,
          motion_score: Math.round(motionPower * 250),
          pose: sc.mode === 'walk' ? 'walking' : sc.mode === 'sit' ? 'sitting' : sc.mode === 'lie' ? 'lying' : 'standing'
        });
      }

      // Campo del segnale 20 × 20 con una "macchia" per persona.
      const nx = 20, nz = 20, values = new Array(nx * nz);
      for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
          let v = 0.08 + 0.04 * Math.sin(ix * 0.6 + s * 0.3) * Math.cos(iz * 0.5);
          people.forEach(p => {
            const bx = p.position[0] / 5 * nx, bz = p.position[2] / 4 * nz;
            const d2 = (ix - bx) * (ix - bx) + (iz - bz) * (iz - bz);
            v += Math.exp(-d2 / (active ? 7 : 4)) * (active ? 0.85 : 0.55);
          });
          values[iz * nx + ix] = Math.max(0, Math.min(1, v + this.noise(0.03)));
        }
      }

      const nodePos = [[0, 0, 0], [5, 0, 0], [2.5, 0, 4]];
      const nodes = nodePos.map((p, i) => ({
        node_id: i + 1, rssi_dbm: -48 - i * 6 + this.noise(1.5) - (active ? 2 : 0), position: p, amplitude: [], subcarrier_count: 56
      }));
      const nodeFeatures = nodes.map((n, i) => ({
        node_id: n.node_id, rssi_dbm: n.rssi_dbm, frame_rate_hz: 9.6 + this.noise(0.5) - (i === 2 ? 1.5 : 0),
        last_seen_ms: Math.round(40 + this.rnd() * 90), stale: false, novelty_score: Math.max(0, Math.min(1, (active ? 0.45 : 0.08) + this.noise(0.05))),
        classification: { motion_level: !present ? 'absent' : active ? 'active' : 'present_still', presence: present, confidence: 0.7 + this.noise(0.08) },
        features: { mean_rssi: n.rssi_dbm, variance: 1, motion_band_power: motionPower, breathing_band_power: breathPower, dominant_freq_hz: 0.25, change_points: 0, spectral_power: 0.2 }
      }));

      const still = present && !active;
      this.emit({
        type: 'sensing_update',
        timestamp: Date.now() / 1000,
        source: 'demo',
        _simulated: true,
        tick: this.tick,
        nodes,
        node_features: nodeFeatures,
        features: {
          mean_rssi: -53 + this.noise(1.2) - (active ? 2 : 0),
          variance: present ? (active ? 4.2 : 1.6) + this.noise(0.3) : 0.4 + this.noise(0.1),
          motion_band_power: motionPower,
          breathing_band_power: breathPower,
          dominant_freq_hz: still ? br / 60 : active ? 1.1 + this.noise(0.2) : 0.05,
          change_points: active ? Math.round(2 + this.rnd() * 3) : 0,
          spectral_power: motionPower + breathPower
        },
        classification: {
          motion_level: !present ? 'absent' : active ? 'active' : 'present_still',
          presence: present,
          confidence: present ? 0.78 + this.noise(0.08) : 0.82 + this.noise(0.06)
        },
        signal_field: { grid_size: [nx, 1, nz], values },
        vital_signs: present ? {
          breathing_rate_bpm: br,
          heart_rate_bpm: still ? hr : null,
          breathing_confidence: still ? 0.78 + this.noise(0.06) : 0.22,
          heartbeat_confidence: still ? 0.61 + this.noise(0.06) : 0,
          signal_quality: still ? 0.74 : 0.41
        } : { breathing_rate_bpm: null, heart_rate_bpm: null, breathing_confidence: 0, heartbeat_confidence: 0, signal_quality: 0.2 },
        signal_quality_score: 0.72 + this.noise(0.05),
        quality_verdict: 'good',
        posture: people[0] ? people[0].pose : null,
        persons: people,
        estimated_persons: sc.n
      });

      // Caduta dimostrativa (una volta), come pacchetto edge_vitals dal nodo 2.
      if (sc.mode === 'lie' && !this.fallDone) {
        this.fallDone = true;
        this.emit({
          type: 'edge_vitals', node_id: 2, presence: true, fall_detected: true, motion: false,
          breathing_rate_bpm: null, heartrate_bpm: null, n_persons: 1, person_count_valid: true,
          motion_energy: 0.9, presence_score: 0.8, rssi: -54, numeric_vitals_authorized: false,
          abstention_reason: 'demo'
        });
      }
    }
  }

  function demoSkeleton(cx, gy, sc, phase, mode) {
    const k = (x, y) => [cx + x * sc, gy + y * sc];
    const sw = mode === 'walk' ? Math.sin(phase) : 0;
    let pts;
    if (mode === 'sit') {
      pts = [k(0, -150), k(-6, -156), k(6, -156), k(-12, -152), k(12, -152),
        k(-22, -122), k(22, -122), k(-30, -88), k(30, -88), k(-18, -62), k(18, -62),
        k(-14, -62), k(14, -62), k(-40, -58), k(40, -58), k(-42, 0), k(42, 0)];
    } else {
      pts = [k(0, -172), k(-6, -178), k(6, -178), k(-12, -174), k(12, -174),
        k(-22, -142), k(22, -142), k(-28 - sw * 8, -106), k(28 + sw * 8, -106),
        k(-30 - sw * 16, -74), k(30 + sw * 16, -74),
        k(-14, -86), k(14, -86), k(-13 + sw * 12, -44), k(13 - sw * 12, -44),
        k(-13 + sw * 22, 0), k(13 - sw * 22, 0)];
    }
    if (mode === 'lie') {
      // Ruota lo scheletro in piedi di 90° attorno al punto a terra.
      pts = pts.map(([x, y]) => [cx + (gy - y) * 0.95, gy - 8 + (x - cx) * 0.4]);
    }
    return pts.map((p, i) => ({ name: KP_NAMES[i], x: p[0], y: p[1], z: 0, confidence: 0.55 + ((i * 37) % 30) / 100 }));
  }

  global.RuView = {
    Client: RuViewClient,
    DemoSource,
    normalizeBase,
    wsCandidates,
    classifySource,
    normalizeFrame,
    isLoopback,
    mixedContentBlocked,
    KP_NAMES
  };
})(window);
