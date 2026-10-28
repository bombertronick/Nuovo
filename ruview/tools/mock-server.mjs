/* =========================================================================
   mock-server.mjs — Finto sensing-server di RuView, solo per sviluppo/test
   Imita gli endpoint usati da RuView Monitor (stessi formati JSON del server
   Rust): /health, /api/v1/status, /api/v1/nodes, /api/v1/ws-ticket,
   /api/v1/recording/*, WebSocket /ws/sensing, e serve l'app su /ui/monitor/.
   Nessuna dipendenza: solo Node.js (18+).

   Uso:  node ruview/tools/mock-server.mjs [--port 8080] [--source simulated|esp32]
                                           [--token SEGRETO] [--ws-port 8765]
   Poi apri http://localhost:8080/ui/monitor/

   ATTENZIONE: i dati sono generati. Con --source esp32 il finto server si
   dichiara "live" per provare quel percorso dell'interfaccia: non usarlo mai
   per presentare dati come reali.
   ========================================================================= */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
  return acc;
}, []));
const PORT = Number(args.port || 8080);
const WS_PORT = args['ws-port'] ? Number(args['ws-port']) : null;
const TOKEN = args.token || process.env.RUVIEW_API_TOKEN || '';
let source = args.source || 'simulated';
let paused = false;

// Riusa la sorgente demo dell'app per generare frame realistici.
const sandbox = { window: {}, setInterval, clearInterval, Date, Math, console };
vm.runInNewContext(fs.readFileSync(path.join(appDir, 'assets/client.js'), 'utf8'), sandbox);
const { DemoSource } = sandbox.window.RuView;

const clients = new Set();
const tickets = new Map();
const recordings = [];
let recording = null;
let lastFrame = null;

const demo = new DemoSource(msg => {
  if (paused) return;
  const m = Object.assign({}, msg);
  delete m._simulated;
  if (m.type === 'sensing_update') { m.source = source; lastFrame = m; if (recording) recording.frames++; }
  const text = JSON.stringify(m);
  clients.forEach(sock => { try { sock.write(wsFrame(text)); } catch (e) { clients.delete(sock); } });
});
demo.start();

function sourceState() {
  if (paused) return 'stale';
  if (/simul/.test(source)) return 'synthetic';
  if (/offline/.test(source)) return 'stale';
  return 'live_verified';
}

function authorized(req) {
  if (!TOKEN) return true;
  return (req.headers.authorization || '') === 'Bearer ' + TOKEN;
}

function send(res, status, body, type) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' });
  res.end(data);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

function serveStatic(req, res, rel) {
  const file = path.resolve(appDir, '.' + (rel.endsWith('/') ? rel + 'index.html' : rel));
  if (!file.startsWith(appDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

async function body(req) {
  let s = '';
  for await (const c of req) s += c;
  try { return s ? JSON.parse(s) : {}; } catch (e) { return {}; }
}

async function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (p === '/' || p === '/ui' || p === '/ui/') { res.writeHead(302, { Location: '/ui/monitor/' }); return res.end(); }
  if (p.startsWith('/ui/monitor/')) return serveStatic(req, res, p.slice('/ui/monitor'.length));
  if (p === '/health') return send(res, 200, { status: 'ok' });

  // Comandi del test (non esistono nel server vero)
  if (p === '/__mock/set') {
    if (u.searchParams.has('source')) source = u.searchParams.get('source');
    if (u.searchParams.has('pause')) paused = u.searchParams.get('pause') === '1';
    return send(res, 200, { source, paused });
  }
  if (p === '/__mock/fall') {
    const text = JSON.stringify({ type: 'edge_vitals', node_id: Number(u.searchParams.get('node') || 1), presence: true, fall_detected: true, motion: false, breathing_rate_bpm: null, heartrate_bpm: null, n_persons: 1, person_count_valid: true, motion_energy: 0.9, presence_score: 0.8, rssi: -50, numeric_vitals_authorized: false, abstention_reason: 'calibration_stale' });
    clients.forEach(sock => sock.write(wsFrame(text)));
    return send(res, 200, { sent: true });
  }

  if (p === '/api/v1/ws-ticket' && req.method === 'POST') {
    if (!TOKEN) return send(res, 404, { error: 'auth disabled' });
    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
    const t = crypto.randomBytes(16).toString('hex');
    tickets.set(t, Date.now() + 30000);
    return send(res, 200, { ticket: t, expires_in_secs: 30 });
  }
  if (p.startsWith('/api/') && !authorized(req)) return send(res, 401, { error: 'unauthorized' });

  if (p === '/api/v1/status') return send(res, 200, { status: 'ready', source, source_state: sourceState(), waiting_for_frames: false, last_frame_age_ms: paused ? 9000 : 60 });
  if (p === '/api/v1/sensing/latest') return send(res, 200, lastFrame || {});
  if (p === '/api/v1/nodes') {
    const nodes = (lastFrame ? lastFrame.node_features : []).map(n => ({ node_id: n.node_id, status: paused ? 'stale' : 'active', last_seen_ms: paused ? 9000 : n.last_seen_ms, csi_status: paused ? 'stale' : 'active', rssi_dbm: n.rssi_dbm, motion_level: n.classification.motion_level, person_count: lastFrame.estimated_persons || 0 }));
    return send(res, 200, { nodes, count: nodes.length });
  }
  if (p === '/api/v1/recording/list') return send(res, 200, { recordings: recordings.concat(recording ? [Object.assign({}, recording, { status: 'recording' })] : []) });
  if (p === '/api/v1/recording/start' && req.method === 'POST') {
    if (recording) return send(res, 200, { success: false, error: 'recording already in progress', recording_id: recording.id });
    const b = await body(req);
    recording = { id: b.id || 'rec_' + Date.now(), name: b.id || 'rec_' + Date.now(), frames: 0, size_bytes: 0, modified_epoch: Math.floor(Date.now() / 1000), status: 'recording', watermark: sourceState() === 'synthetic' ? 'SYNTHETIC' : null };
    return send(res, 200, { success: true, recording_id: recording.id, watermark: recording.watermark });
  }
  if (p === '/api/v1/recording/stop' && req.method === 'POST') {
    if (!recording) return send(res, 200, { success: false, error: 'no recording in progress' });
    recording.status = 'completed'; recording.size_bytes = recording.frames * 2100; recordings.push(recording);
    const id = recording.id; recording = null;
    return send(res, 200, { success: true, recording_id: id });
  }
  if (p.startsWith('/api/v1/recording/') && req.method === 'DELETE') {
    const id = decodeURIComponent(p.split('/').pop());
    const i = recordings.findIndex(r => r.id === id);
    if (i >= 0) recordings.splice(i, 1);
    return send(res, 200, { success: i >= 0 });
  }
  return send(res, 404, { error: 'not found' });
}

/* ------------------------------- WebSocket ------------------------------- */
function wsFrame(text) {
  const payload = Buffer.from(text);
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, payload]);
}

function upgrade(req, socket) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/ws/sensing') { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
  if (TOKEN) {
    const t = u.searchParams.get('ticket');
    const exp = t && tickets.get(t);
    if (!exp || exp < Date.now()) { socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'); return; }
    tickets.delete(t); // monouso
  }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  clients.add(socket);
  socket.on('data', buf => {
    const op = buf[0] & 0x0f;
    if (op === 0x8) { try { socket.end(Buffer.from([0x88, 0])); } catch (e) { /* */ } clients.delete(socket); }
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

const server = http.createServer((req, res) => handle(req, res).catch(e => send(res, 500, { error: e.message })));
server.on('upgrade', upgrade);
server.listen(PORT, () => console.log('[mock] RuView finto su http://localhost:' + PORT + '/ui/monitor/  sorgente=' + source + (TOKEN ? '  token attivo' : '')));
if (WS_PORT) {
  const ws = http.createServer((req, res) => send(res, 404, {}));
  ws.on('upgrade', upgrade);
  ws.listen(WS_PORT, () => console.log('[mock] WebSocket dedicato su ws://localhost:' + WS_PORT + '/ws/sensing'));
}
