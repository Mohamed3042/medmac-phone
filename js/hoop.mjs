// The company's "basketball upload" for the phone (ported from the app's src/renderer/js/basketball-upload.js).
// The file is a ball in the lower corner of a dashed zone with a hoop. A file from the picker (camera roll, files) or a
// plain drop flies into the hoop by itself; only a ball grabbed by hand is aimed (drag back, a dotted arc, release).
// Errors bounce off the rim with the reason. Reduced motion: no flight, just the row. Sound off by default, the toggle
// remembers. RTL mirrors the corner and the arc. Several files queue. A missed shot never loses a file.
import { h, clear } from './dom.mjs';
import { fmtSize, fileExt } from './core.mjs';

const SVGNS = 'http://www.w3.org/2000/svg';
const AUTO_MS = 600; // a picked file waits this long for a hand to grab it, then shoots by itself
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const errText = (e) => String((e && e.message) || e || '').slice(0, 200);

function svg(tag, attrs, ...kids) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  kids.forEach((k) => n.appendChild(k));
  return n;
}
function hoopSvg() {
  return svg('svg', { class: 'bb-hoop', viewBox: '0 0 92 96', fill: 'none', 'aria-hidden': 'true' },
    svg('rect', { x: 14, y: 2, width: 64, height: 44, rx: 2, fill: '#FFFFFF', stroke: '#C9B98F', 'stroke-width': 2 }),
    svg('rect', { x: 33, y: 20, width: 26, height: 20, stroke: '#98151A', 'stroke-width': 2 }),
    svg('ellipse', { cx: 46, cy: 48, rx: 21, ry: 5, stroke: '#98151A', 'stroke-width': 3 }),
    svg('g', { class: 'bb-net', stroke: '#B99762', 'stroke-width': 1.3 },
      svg('path', { d: 'M26 50 L34 84 M36 52 L40 86 M46 53 L46 87 M56 52 L52 86 M66 50 L58 84' }),
      svg('path', { d: 'M28 60 H64 M31 71 H61 M34 82 H58' })));
}
function speakerSvg(on) {
  return svg('svg', { viewBox: '0 0 20 20', width: 18, height: 18, fill: 'none', 'aria-hidden': 'true', stroke: 'currentColor', 'stroke-width': 1.5 },
    svg('path', { d: 'M3 8 H6 L10 4.5 V15.5 L6 12 H3 Z', 'stroke-linejoin': 'round' }),
    on ? svg('path', { d: 'M13 7 Q15.5 10 13 13 M15 5 Q19 10 15 15', 'stroke-linecap': 'round' })
      : svg('path', { d: 'M13.5 7.5 L18 12.5 M18 7.5 L13.5 12.5', 'stroke-linecap': 'round' }));
}

let ac = null;
function blip(kind, on) {
  if (!on) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = ac || new AC();
    const t = ac.currentTime;
    if (kind === 'swish') {
      const len = Math.floor(ac.sampleRate * 0.28), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.Q.value = 0.9;
      f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.26);
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      src.connect(f); f.connect(g); g.connect(ac.destination); src.start(t);
    } else {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.22);
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.26);
    }
  } catch { /* no sound is fine */ }
}
function animate(ms, fn) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let done = false;
    const end = () => { if (done) return; done = true; clearTimeout(guard); try { fn(1); } catch { /* ignore */ } resolve(); };
    const guard = setTimeout(end, ms + 400);
    (function step(now) {
      if (done) return;
      const k = Math.min(1, (now - t0) / ms);
      fn(k);
      if (k < 1) requestAnimationFrame(step); else end();
    })(t0);
  });
}
const later = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * mountHoop(el, { label, hint, check(file) -> '' | reason, onFile(file, { progress(frac) }) -> Promise, onDone?(file, result),
 *                 soundSlot, storage })
 * Returns { take(file), pick() }.
 */
export function mountHoop(el, opts) {
  const store = opts.storage || { getItem: () => null, setItem() {} };
  const soundOn = () => { try { return store.getItem(opts.soundSlot) === '1'; } catch { return false; } };
  let made = 0;
  clear(el);
  el.classList.add('bb');
  const count = h('span', { class: 'bb-count', 'aria-live': 'polite' });
  const snd = h('button', { type: 'button', class: 'bb-snd' });
  const msg = h('div', { class: 'bb-msg', 'aria-hidden': 'true' });
  const arcPath = svg('path', { fill: 'none', stroke: '#98151A', 'stroke-width': 2, 'stroke-dasharray': '2 7', 'stroke-linecap': 'round' });
  const arc = svg('svg', { class: 'bb-arc', 'aria-hidden': 'true' }, arcPath);
  const hoop = hoopSvg();
  const net = hoop.querySelector('.bb-net');
  const zone = h('div', { class: 'bb-zone', tabindex: '0', role: 'button', 'aria-label': `${opts.label}: choose a file or drop it here` });
  zone.append(hoop, arc, msg);
  const input = h('input', { type: 'file', multiple: true, hidden: true, tabindex: '-1' });
  const rows = h('div', { class: 'bb-rows' });
  el.append(
    h('div', { class: 'bb-h' },
      h('div', { class: 'bb-t' }, opts.title ? h('span', null, opts.title) : null, opts.hint ? h('small', null, opts.hint) : null),
      count, snd),
    opts.between || null,
    zone, input, rows);

  const idle = () => clear(msg).append(h('span', null, 'Tap to choose a file'), h('small', null, 'or take the shot'));
  const say = (text, small) => { clear(msg).append(h('span', null, text)); if (small) msg.append(h('small', null, small)); };
  const paintCount = () => { count.textContent = `Sent ${made}`; };
  function paintSnd() {
    const on = soundOn();
    clear(snd).append(speakerSvg(on));
    snd.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    snd.title = on ? 'Sound on' : 'Sound off';
    snd.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  idle(); paintCount(); paintSnd();
  snd.addEventListener('click', (e) => { e.stopPropagation(); try { store.setItem(opts.soundSlot, soundOn() ? '0' : '1'); } catch { /* ignore */ } paintSnd(); });

  const isRtl = () => getComputedStyle(el).direction === 'rtl';
  function hoopPoint() {
    const z = zone.getBoundingClientRect(), r = hoop.getBoundingClientRect();
    return { x: r.left - z.left + r.width / 2, y: r.top - z.top + r.height * 0.5 };
  }
  function startPoint() { const z = zone.getBoundingClientRect(); return { x: isRtl() ? z.width - 52 : 52, y: z.height - 46 }; }
  const place = (ball, p, extra = '') => { ball.style.transform = `translate(${p.x - 27}px,${p.y - 32}px) ${extra}`; };
  const ctrl = (a, b) => ({ x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 105 });
  const bez = (a, c, b, u) => { const v = 1 - u; return { x: v * v * a.x + 2 * v * u * c.x + u * u * b.x, y: v * v * a.y + 2 * v * u * c.y + u * u * b.y }; };

  function addRow(file) {
    const badge = (fileExt(file.name) || 'FILE').slice(0, 4).toUpperCase();
    const bar = h('i');
    const st = h('span', { class: 'st1' }, 'Sending…');
    const row = h('div', { class: 'bb-row' },
      h('b', { class: 'badge' }, badge),
      h('div', { class: 'bb-row-tx' },
        h('div', { class: 'nm', dir: 'auto', title: file.name }, file.name),
        h('div', { class: 'bb-prog' }, bar),
        h('div', { class: 'st' }, st, h('span', null, fmtSize(file.size)))));
    let real = 0, shown = 0, timer = 0;
    const paint = () => { bar.style.width = `${shown.toFixed(1)}%`; };
    return {
      show() { if (!row.parentNode) rows.prepend(row); },
      // creep towards the real progress (and a little past it while a piece is on the way), never to 100 before Done
      run() { timer = setInterval(() => { const goal = Math.min(96, Math.max(real, shown + (96 - shown) * 0.04)); shown += (goal - shown) * 0.35; paint(); }, 160); },
      progress(frac) { real = clamp(frac * 100, 0, 96); if (real > shown) { shown = real; paint(); } },
      ok(text = 'Done') { clearInterval(timer); shown = 100; paint(); clear(st).append(h('span', { class: 'ok' }, text)); },
      bad(reason) { clearInterval(timer); row.classList.add('err'); shown = 100; paint(); st.textContent = reason; st.setAttribute('role', 'alert'); },
    };
  }

  const queue = [];
  let busy = false;
  function take(file, how = 'picked') {
    if (!file) return;
    queue.push({ file, how });
    if (!busy) pump();
  }
  async function pump() {
    busy = true;
    while (queue.length) {
      const it = queue.shift();
      try { await play(it.file, queue.length); } catch { /* play never loses a file */ }
    }
    busy = false;
    idle();
  }
  function startWork(file, row) {
    const bad = opts.check ? opts.check(file) : '';
    const w = { settled: false, ok: false, reason: '', result: null };
    const p = bad ? Promise.reject(new Error(bad)) : Promise.resolve().then(() => opts.onFile(file, { progress: (f) => row && row.progress(f) }));
    w.promise = p.then((res) => { w.ok = true; w.result = res; }, (e) => { w.reason = errText(e); }).then(() => { w.settled = true; });
    return w;
  }
  function finish(row, w, file) {
    if (w.ok) { made++; paintCount(); row.ok(); if (opts.onDone) opts.onDone(file, w.result); } else row.bad(w.reason || 'It did not send.');
  }
  // the row exists from the first moment, so progress has somewhere to go; it shows after the flight
  async function play(file, waiting) {
    if (reducedMotion()) {
      const row = addRow(file); row.show(); row.run();
      const w = startWork(file, row); await w.promise; finish(row, w, file);
      return;
    }
    const rtl = isRtl();
    const badge = (fileExt(file.name) || 'FILE').slice(0, 4).toUpperCase();
    const ball = h('div', { class: 'bb-ball', 'aria-hidden': 'true' }, h('b', null, badge), h('i'));
    zone.appendChild(ball);
    const from = startPoint();
    place(ball, from);
    say('Shooting…', waiting ? `${waiting} more waiting` : 'grab it to aim yourself');

    const released = await new Promise((resolve) => {
      let grabbed = false;
      const auto = setTimeout(() => { if (!grabbed) resolve(from); }, AUTO_MS);
      ball.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        grabbed = true; clearTimeout(auto);
        e.stopPropagation(); e.preventDefault();
        try { ball.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        ball.classList.add('grab');
        const z = zone.getBoundingClientRect();
        let cur = from;
        say('Aim the file & let go to shoot');
        const move = (ev) => {
          cur = { x: clamp(ev.clientX - z.left, 24, z.width - 24), y: clamp(ev.clientY - z.top, 34, z.height - 24) };
          place(ball, cur);
          const b = hoopPoint(), c = ctrl(cur, b);
          arcPath.setAttribute('d', `M${cur.x} ${cur.y} Q${c.x} ${c.y} ${b.x} ${b.y}`);
          say('Let go to shoot!');
        };
        const up = () => {
          ball.removeEventListener('pointermove', move);
          ball.removeEventListener('pointerup', up);
          ball.removeEventListener('pointercancel', up);
          ball.removeEventListener('lostpointercapture', up);
          ball.classList.remove('grab');
          resolve(cur); // a release always counts
        };
        ball.addEventListener('pointermove', move);
        ball.addEventListener('pointerup', up);
        ball.addEventListener('pointercancel', up);
        ball.addEventListener('lostpointercapture', up);
      });
      ball.addEventListener('click', (e) => e.stopPropagation());
    });
    arcPath.setAttribute('d', '');

    const row = addRow(file);
    row.run();
    const w = startWork(file, row);
    const b = hoopPoint(), c = ctrl(released, b);
    const spin = rtl ? -1 : 1;
    await animate(620, (u) => place(ball, bez(released, c, b, u), `scale(${1 - 0.45 * u}) rotate(${spin * u * 300}deg)`));
    row.show(); // the shot is made: its row appears (the bytes started at the release)

    if (!w.settled) {
      say('Sending…', file.name);
      let rolling = true;
      const t0 = performance.now();
      (function roll(now) {
        if (!rolling) return;
        const k = (now - t0) / 260;
        place(ball, { x: b.x + Math.sin(k) * 9, y: b.y - 4 - Math.abs(Math.cos(k)) * 3 }, `scale(.55) rotate(${spin * k * 60}deg)`);
        requestAnimationFrame(roll);
      })(t0);
      await w.promise;
      rolling = false;
    }
    if (w.ok) {
      blip('swish', soundOn());
      net.classList.remove('swish'); void net.getBoundingClientRect(); net.classList.add('swish');
      await animate(260, (k) => { place(ball, { x: b.x, y: b.y + 46 * k }, 'scale(.5)'); ball.style.opacity = String(1 - k); });
    } else {
      blip('miss', soundOn());
      await animate(440, (k) => {
        place(ball, { x: b.x + (rtl ? 1 : -1) * 80 * k, y: b.y - 42 * Math.sin(k * Math.PI) + 70 * k * k }, `scale(.55) rotate(${-spin * k * 200}deg)`);
        ball.style.opacity = String(1 - k);
      });
    }
    ball.remove();
    finish(row, w, file);
    if (!w.ok) { say('That one bounced off the rim.', w.reason); await later(1400); }
  }

  const pick = () => input.click();
  zone.addEventListener('click', pick);
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  input.addEventListener('change', () => { [...input.files].forEach((f) => take(f)); input.value = ''; });
  ['dragenter', 'dragover'].forEach((n) => zone.addEventListener(n, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((n) => zone.addEventListener(n, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => { [...((e.dataTransfer && e.dataTransfer.files) || [])].forEach((f) => take(f, 'dropped')); });
  el._take = take;
  return { take, pick, rows };
}
