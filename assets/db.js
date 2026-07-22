/* =========================================================================
   db.js — Persistenza locale con IndexedDB
   - Un archivio "kv" per lo stato dell'app (JSON: categorie, cantieri, spese)
   - Un archivio "files" per gli allegati (fatture in foto/PDF salvate come Blob)
   Tutto resta sul dispositivo dell'utente. Nessun server, nessun invio online.
   ========================================================================= */
(function (global) {
  'use strict';

  const DB_NAME = 'gestionale-cantieri';
  const DB_VERSION = 1;
  const STORE_KV = 'kv';
  const STORE_FILES = 'files';
  const STATE_KEY = 'state';

  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      if (!global.indexedDB) return reject(new Error('IndexedDB non supportato su questo browser.'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
        if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES);
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- Stato applicazione (JSON) ----
  async function loadState() {
    const store = await tx(STORE_KV, 'readonly');
    return reqToPromise(store.get(STATE_KEY));
  }
  async function saveState(state) {
    const store = await tx(STORE_KV, 'readwrite');
    return reqToPromise(store.put(state, STATE_KEY));
  }

  // ---- Allegati (Blob) ----
  async function saveFile(id, blob) {
    const store = await tx(STORE_FILES, 'readwrite');
    return reqToPromise(store.put(blob, id));
  }
  async function getFile(id) {
    const store = await tx(STORE_FILES, 'readonly');
    return reqToPromise(store.get(id));
  }
  async function deleteFile(id) {
    if (!id) return;
    const store = await tx(STORE_FILES, 'readwrite');
    return reqToPromise(store.delete(id));
  }
  async function getAllFileKeys() {
    const store = await tx(STORE_FILES, 'readonly');
    return reqToPromise(store.getAllKeys());
  }

  // ---- Backup / Ripristino (esporta tutto: dati + allegati in base64) ----
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  function dataURLToBlob(dataURL) {
    const [head, b64] = dataURL.split(',');
    const mime = (head.match(/data:(.*?);base64/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  async function exportAll(state) {
    const keys = await getAllFileKeys();
    const files = {};
    for (const k of keys) {
      const blob = await getFile(k);
      if (blob) files[k] = await blobToDataURL(blob);
    }
    return { format: 'gestionale-cantieri-backup', version: 1, exportedAt: new Date().toISOString(), state, files };
  }

  async function importAll(backup) {
    if (!backup || backup.format !== 'gestionale-cantieri-backup') {
      throw new Error('File di backup non valido.');
    }
    // ripristina allegati
    if (backup.files) {
      for (const k of Object.keys(backup.files)) {
        await saveFile(k, dataURLToBlob(backup.files[k]));
      }
    }
    if (backup.state) await saveState(backup.state);
    return backup.state;
  }

  global.DB = {
    loadState, saveState,
    saveFile, getFile, deleteFile, getAllFileKeys,
    exportAll, importAll
  };
})(window);
