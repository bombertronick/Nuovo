/* =========================================================================
   store.js — Persistenza locale (IndexedDB) di RuView Monitor
   - "kv"         impostazioni dell'app
   - "events"     registro eventi e allarmi
   - "recordings" metadati delle registrazioni locali
   - "chunks"     frame registrati, salvati a blocchi
   Tutto resta sul dispositivo. Se IndexedDB non è disponibile (navigazione
   privata, file bloccati) si usa un archivio in memoria con la stessa API:
   l'app funziona comunque, ma i dati non sopravvivono alla chiusura.
   ========================================================================= */
(function (global) {
  'use strict';

  const DB_NAME = 'ruview-monitor';
  const DB_VERSION = 1;
  let _db = null;
  let _memory = null; // fallback in memoria

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      if (!global.indexedDB) return reject(new Error('IndexedDB non disponibile'));
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['recId', 'seq'] });
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database bloccato da un\'altra scheda'));
    });
  }

  function p(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function store(name, mode) {
    const db = await open();
    return db.transaction(name, mode || 'readonly').objectStore(name);
  }

  /* ----------------------------- Backend IndexedDB ----------------------------- */
  const idb = {
    async getKV(key) { return p((await store('kv')).get(key)); },
    async setKV(key, value) { return p((await store('kv', 'readwrite')).put(value, key)); },

    async addEvent(ev) { const copy = Object.assign({}, ev); delete copy.id; return p((await store('events', 'readwrite')).add(copy)); },
    async putEvent(ev) { return p((await store('events', 'readwrite')).put(ev)); },
    async listEvents(limit) {
      const s = await store('events');
      return new Promise((resolve, reject) => {
        const out = [];
        const req = s.openCursor(null, 'prev');
        req.onsuccess = () => {
          const c = req.result;
          if (c && out.length < (limit || 500)) { out.push(c.value); c.continue(); } else resolve(out);
        };
        req.onerror = () => reject(req.error);
      });
    },
    async clearEvents() { return p((await store('events', 'readwrite')).clear()); },

    async putRecording(meta) { return p((await store('recordings', 'readwrite')).put(meta)); },
    async listRecordings() { return p((await store('recordings')).getAll()); },
    async getRecording(id) { return p((await store('recordings')).get(id)); },
    async addChunk(recId, seq, frames) { return p((await store('chunks', 'readwrite')).put({ recId, seq, frames })); },
    async getChunks(recId) {
      const range = IDBKeyRange.bound([recId, 0], [recId, Number.MAX_SAFE_INTEGER]);
      return p((await store('chunks')).getAll(range));
    },
    async deleteRecording(id) {
      const db = await open();
      const tx = db.transaction(['recordings', 'chunks'], 'readwrite');
      tx.objectStore('recordings').delete(id);
      tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
      return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    },
    async wipe() {
      const db = await open();
      const names = ['kv', 'events', 'recordings', 'chunks'];
      const tx = db.transaction(names, 'readwrite');
      names.forEach(n => tx.objectStore(n).clear());
      return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    }
  };

  /* ------------------------------ Backend memoria ------------------------------ */
  function memoryBackend() {
    const kv = new Map(), events = [], recs = new Map(), chunks = new Map();
    let nextId = 1;
    return {
      async getKV(k) { return kv.has(k) ? JSON.parse(JSON.stringify(kv.get(k))) : undefined; },
      async setKV(k, v) { kv.set(k, JSON.parse(JSON.stringify(v))); },
      async addEvent(ev) { const e = Object.assign({}, ev, { id: nextId++ }); events.push(e); return e.id; },
      async putEvent(ev) { const i = events.findIndex(e => e.id === ev.id); if (i >= 0) events[i] = Object.assign({}, ev); },
      async listEvents(limit) { return events.slice(-(limit || 500)).reverse(); },
      async clearEvents() { events.length = 0; },
      async putRecording(m) { recs.set(m.id, Object.assign({}, m)); },
      async listRecordings() { return Array.from(recs.values()); },
      async getRecording(id) { return recs.get(id); },
      async addChunk(recId, seq, frames) { chunks.set(recId + '#' + seq, { recId, seq, frames }); },
      async getChunks(recId) { return Array.from(chunks.values()).filter(c => c.recId === recId).sort((a, b) => a.seq - b.seq); },
      async deleteRecording(id) { recs.delete(id); Array.from(chunks.keys()).forEach(k => { if (k.startsWith(id + '#')) chunks.delete(k); }); },
      async wipe() { kv.clear(); events.length = 0; recs.clear(); chunks.clear(); }
    };
  }

  /* --------------------------------- Facciata --------------------------------- */
  let backend = null;
  async function ready() {
    if (backend) return backend;
    try { await open(); backend = idb; }
    catch (e) {
      console.warn('[store] IndexedDB non disponibile, uso la memoria:', e && e.message);
      _memory = memoryBackend();
      backend = _memory;
    }
    return backend;
  }

  const api = {
    ready,
    get persistent() { return backend === idb; }
  };
  ['getKV', 'setKV', 'addEvent', 'putEvent', 'listEvents', 'clearEvents', 'putRecording', 'listRecordings',
    'getRecording', 'addChunk', 'getChunks', 'deleteRecording', 'wipe'].forEach(name => {
    api[name] = async function () {
      const b = await ready();
      return b[name].apply(b, arguments);
    };
  });

  global.Store = api;
})(window);
