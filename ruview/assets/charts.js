/* =========================================================================
   charts.js — Grafici su canvas, senza librerie
   - timeSeries: serie temporali con griglia, fascia di normalità e buchi
   - sparkline:  mini andamento per riquadri e nodi
   - heatmap:    campo del segnale (vista dall'alto) con il picco evidenziato
   - skeleton:   scheletro a 17 punti COCO per ogni persona
   Colori presi dalle variabili CSS, così seguono il tema chiaro/scuro.
   ========================================================================= */
(function (global) {
  'use strict';

  function css(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback || '#888';
  }

  // Adatta il canvas alla densità dello schermo; null se non è visibile.
  function prep(canvas) {
    if (!canvas || !canvas.isConnected) return null;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return null;
    const dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function niceStep(span, target) {
    const raw = span / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  function fmtTick(v, step) {
    const d = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
    return v.toFixed(d).replace('.', ',');
  }

  function withAlpha(color, a) {
    if (color.startsWith('#')) {
      let h = color.slice(1);
      if (h.length === 3) h = h.split('').map(x => x + x).join('');
      const n = parseInt(h, 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    return color;
  }

  /* ------------------------------ Serie temporale ------------------------------ */
  // o = { series: [{ points: [[t, v|null]], color, fill }], tMin, tMax,
  //       yMin, yMax (fissi) | softMin, softMax, minSpan (automatici),
  //       band: [lo, hi] fascia di normalità, gapMs, unit }
  function timeSeries(canvas, o) {
    const c = prep(canvas);
    if (!c) return;
    const { ctx, w, h } = c;
    const padL = 38, padR = 10, padT = 8, padB = 20;
    const pw = w - padL - padR, ph = h - padT - padB;
    const tMin = o.tMin, tMax = o.tMax, tSpan = Math.max(1, tMax - tMin);

    let lo = Infinity, hi = -Infinity;
    o.series.forEach(s => s.points.forEach(p => {
      if (p[1] != null && p[0] >= tMin) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
    }));
    const hasData = lo !== Infinity;
    if (o.yMin != null) lo = o.yMin; else if (!hasData) lo = o.softMin != null ? o.softMin : 0; else if (o.softMin != null) lo = Math.min(lo, o.softMin);
    if (o.yMax != null) hi = o.yMax; else if (!hasData) hi = o.softMax != null ? o.softMax : 1; else if (o.softMax != null) hi = Math.max(hi, o.softMax);
    const minSpan = o.minSpan || 1e-6;
    if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
    if (o.yMin == null && o.yMax == null) {
      // Margine sopra e sotto, ma senza scendere sotto il minimo naturale (es. 0)
      const pad = (hi - lo) * 0.08;
      hi += pad;
      if (!(o.softMin != null && lo >= o.softMin)) lo -= pad;
    }
    const X = t => padL + (t - tMin) / tSpan * pw;
    const Y = v => padT + (1 - (v - lo) / (hi - lo)) * ph;

    const grid = css('--chart-grid'), text = css('--chart-text');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    if (o.band) {
      const b0 = Math.max(lo, o.band[0]), b1 = Math.min(hi, o.band[1]);
      if (b1 > b0) {
        ctx.fillStyle = withAlpha(css('--live', '#16a34a'), 0.07);
        ctx.fillRect(padL, Y(b1), pw, Y(b0) - Y(b1));
      }
    }

    const step = niceStep(hi - lo, 4);
    ctx.strokeStyle = grid; ctx.fillStyle = text; ctx.lineWidth = 1; ctx.textAlign = 'right';
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText(fmtTick(v, step), padL - 6, y);
    }
    // Etichette del tempo: secondi/minuti fa
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const secs = tSpan / 1000;
    const tStep = secs <= 70 ? 15 : secs <= 330 ? 60 : secs <= 1900 ? 300 : 900;
    for (let s = 0; s <= secs + 0.1; s += tStep) {
      const x = X(tMax - s * 1000);
      if (x < padL - 1) break;
      const label = s === 0 ? 'ora' : s < 60 ? '−' + s + ' s' : '−' + Math.round(s / 60) + ' min';
      ctx.fillText(label, Math.min(Math.max(x, padL + 12), w - padR - 12), h - 5);
    }

    const gap = o.gapMs || 4000;
    o.series.forEach(s => {
      const pts = s.points.filter(p => p[0] >= tMin - gap);
      if (!pts.length) return;
      const segs = [];
      let cur = [];
      let prevT = null;
      pts.forEach(p => {
        if (p[1] == null || (prevT !== null && p[0] - prevT > gap)) { if (cur.length) segs.push(cur); cur = []; }
        if (p[1] != null) cur.push(p);
        prevT = p[0];
      });
      if (cur.length) segs.push(cur);
      ctx.save();
      ctx.beginPath(); ctx.rect(padL, padT, pw, ph); ctx.clip();
      segs.forEach(seg => {
        if (s.fill && seg.length > 1) {
          const g = ctx.createLinearGradient(0, padT, 0, padT + ph);
          g.addColorStop(0, withAlpha(s.color, 0.22)); g.addColorStop(1, withAlpha(s.color, 0));
          ctx.beginPath();
          ctx.moveTo(X(seg[0][0]), padT + ph);
          seg.forEach(p => ctx.lineTo(X(p[0]), Y(p[1])));
          ctx.lineTo(X(seg[seg.length - 1][0]), padT + ph);
          ctx.closePath(); ctx.fillStyle = g; ctx.fill();
        }
        ctx.beginPath();
        seg.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.lineJoin = 'round'; ctx.stroke();
        if (seg.length === 1) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(X(seg[0][0]), Y(seg[0][1]), 2.5, 0, Math.PI * 2); ctx.fill(); }
      });
      ctx.restore();
      const last = pts[pts.length - 1];
      if (last && last[1] != null && tMax - last[0] < gap) {
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(X(last[0]), Y(last[1]), 3.5, 0, Math.PI * 2); ctx.fill();
      }
    });

    if (!hasData) {
      ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(o.emptyText || 'In attesa di dati', padL + pw / 2, padT + ph / 2);
    }
  }

  /* --------------------------------- Sparkline --------------------------------- */
  function sparkline(canvas, values, color, opts) {
    const c = prep(canvas);
    if (!c) return;
    const { ctx, w, h } = c;
    const v = values.filter(x => x != null);
    if (v.length < 2) return;
    let lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    const minSpan = (opts && opts.minSpan) || 1e-6;
    if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
    const n = values.length;
    ctx.beginPath();
    let started = false;
    values.forEach((x, i) => {
      if (x == null) { started = false; return; }
      const px = i / (n - 1) * (w - 4) + 2;
      const py = 3 + (1 - (x - lo) / (hi - lo)) * (h - 6);
      if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();
  }

  /* --------------------------------- Heatmap --------------------------------- */
  const RAMP = [[11, 29, 81], [59, 44, 143], [161, 47, 127], [227, 97, 63], [251, 211, 77]];
  function ramp(v) {
    v = Math.max(0, Math.min(1, v));
    const x = v * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
    const a = RAMP[i], b = RAMP[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  let off = null;
  function heatmap(canvas, field) {
    const c = prep(canvas);
    if (!c || !field) return null;
    const { ctx, w, h } = c;
    const { nx, nz, values } = field;
    let lo = Infinity, hi = -Infinity, peak = 0;
    for (let i = 0; i < nx * nz; i++) {
      const v = values[i];
      if (v < lo) lo = v;
      if (v > hi) { hi = v; peak = i; }
    }
    // Valori già in 0..1 (come quelli del sensing-server): scala assoluta, così
    // una stanza vuota resta scura invece di amplificare il rumore.
    if (lo >= 0 && hi <= 1) lo = 0;
    const span = Math.max(lo === 0 && hi <= 1 ? 0.35 : 1e-9, hi - lo);
    if (!off) off = document.createElement('canvas');
    off.width = nx; off.height = nz;
    const octx = off.getContext('2d');
    const img = octx.createImageData(nx, nz);
    for (let i = 0; i < nx * nz; i++) {
      const col = ramp((values[i] - lo) / span);
      img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    const s = Math.min(w / nx, h / nz);
    const dw = nx * s, dh = nz * s, ox = (w - dw) / 2, oy = (h - dh) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, ox, oy, dw, dh);

    // Griglia leggera e picco di perturbazione
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(ox + dw * i / 4, oy); ctx.lineTo(ox + dw * i / 4, oy + dh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + dh * i / 4); ctx.lineTo(ox + dw, oy + dh * i / 4); ctx.stroke();
    }
    const px = ox + ((peak % nx) + 0.5) * s, py = oy + (Math.floor(peak / nx) + 0.5) * s;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, Math.max(7, s * 0.9), 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px - 13, py); ctx.lineTo(px - 5, py); ctx.moveTo(px + 5, py); ctx.lineTo(px + 13, py);
    ctx.moveTo(px, py - 13); ctx.lineTo(px, py - 5); ctx.moveTo(px, py + 5); ctx.lineTo(px, py + 13); ctx.stroke();
    return { lo, hi, peak: { ix: peak % nx, iz: Math.floor(peak / nx), value: hi } };
  }

  /* --------------------------------- Scheletro --------------------------------- */
  const EDGES = [[0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
    [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];

  function skeleton(canvas, people) {
    const c = prep(canvas);
    if (!c) return;
    const { ctx, w, h } = c;
    const grid = css('--chart-grid');
    // Pavimento in prospettiva, solo come riferimento visivo
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    const horizon = h * 0.55;
    for (let i = 0; i <= 6; i++) {
      const y = horizon + (h - horizon) * Math.pow(i / 6, 1.6);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let i = -6; i <= 6; i++) {
      ctx.beginPath(); ctx.moveTo(w / 2 + i * w * 0.04, horizon); ctx.lineTo(w / 2 + i * w * 0.22, h); ctx.stroke();
    }
    if (!people || !people.length) return;

    // Spazio delle coordinate: normalizzato (0..1) oppure pixel 640 × 480
    // come nel sensing-server; si allarga se i punti escono dal riquadro.
    let maxAbs = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    people.forEach(p => p.keypoints.forEach(k => {
      if (typeof k.x !== 'number' || typeof k.y !== 'number') return;
      maxAbs = Math.max(maxAbs, Math.abs(k.x), Math.abs(k.y));
      minX = Math.min(minX, k.x); maxX = Math.max(maxX, k.x); minY = Math.min(minY, k.y); maxY = Math.max(maxY, k.y);
    }));
    if (minX === Infinity) return;
    let fw = 640, fh = 480, fx = 0, fy = 0;
    if (maxAbs <= 1.5) { fw = 1; fh = 0.75; }
    if (minX < fx) fx = minX; if (minY < fy) fy = minY;
    if (maxX > fx + fw) fw = maxX - fx; if (maxY > fy + fh) fh = maxY - fy;
    const s = Math.min(w / fw, h / fh) * 0.94;
    const ox = (w - fw * s) / 2 - fx * s, oy = (h - fh * s) / 2 - fy * s;
    const colors = [css('--c-br'), css('--c-hr'), css('--c-motion'), css('--c-rssi'), css('--c-quality')];

    people.forEach((p, pi) => {
      const col = colors[pi % colors.length];
      const kp = p.keypoints;
      const P = i => kp[i] && typeof kp[i].x === 'number' ? [ox + kp[i].x * s, oy + kp[i].y * s, kp[i].c == null ? 1 : kp[i].c] : null;
      ctx.lineCap = 'round';
      EDGES.forEach(([a, b]) => {
        const A = P(a), B = P(b);
        if (!A || !B) return;
        ctx.globalAlpha = Math.max(0.25, Math.min(1, Math.min(A[2], B[2])));
        ctx.strokeStyle = col; ctx.lineWidth = 3.2;
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      });
      for (let i = 0; i < kp.length; i++) {
        const A = P(i);
        if (!A) continue;
        ctx.globalAlpha = Math.max(0.3, Math.min(1, A[2]));
        ctx.fillStyle = i === 0 ? col : css('--surface', '#fff');
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(A[0], A[1], i === 0 ? 6 : 3.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const head = P(0) || P(5);
      if (head) {
        ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = col;
        ctx.fillText('#' + p.id, head[0], head[1] - 14);
      }
    });
    ctx.globalAlpha = 1;
  }

  global.Charts = { timeSeries, sparkline, heatmap, skeleton, ramp, css };
})(window);
