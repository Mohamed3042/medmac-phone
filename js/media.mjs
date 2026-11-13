// Photos and papers: fetched through the API with the key (as blobs), kept in IndexedDB (LRU, capped), shown through
// object URLs. Thumbnails load only for what is on screen, a few at a time. A file the repo does not hold says "Only on the PC".
import { PARALLEL_FILES, LOW_RATE } from './config.mjs';
import { fileKind, baseName, fileExt, MIME, ERRORS } from './core.mjs';
import { getFile, GhError, rate } from './gh.mjs';
import { getFileBlob, putFileBlob } from './store.mjs';
import { h, icon, clear } from './dom.mjs';

let ctx = { key: () => '', onKeyError: () => {} };
export function setup(c) { ctx = { ...ctx, ...c }; }

const urls = new Map();   // cache key -> object URL (kept for this visit)
const missing = new Set(); // paths GitHub answered 404 for in this visit
const inflight = new Map();

function urlFor(key, blob) {
  if (urls.has(key)) return urls.get(key);
  const u = URL.createObjectURL(blob);
  urls.set(key, u);
  if (urls.size > 300) { const [k, v] = urls.entries().next().value; URL.revokeObjectURL(v); urls.delete(k); }
  return u;
}
export function revokeAll() { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); missing.clear(); }

/** The file as a Blob: from the phone if kept, else from GitHub (then kept). Throws GhError. */
export async function fileBlob(rel, { onProgress } = {}) {
  if (fileKind(rel) === 'pc-only') throw new GhError('missing');
  if (missing.has(rel)) throw new GhError('missing');
  const kept = await getFileBlob(rel);
  if (kept) return kept;
  if (inflight.has(rel)) return inflight.get(rel);
  const p = (async () => {
    try {
      const r = await getFile(rel, { key: ctx.key(), as: 'blob' });
      let blob = r.body;
      const type = MIME[fileExt(rel)];
      if (type && blob.type !== type) blob = new Blob([blob], { type });
      if (onProgress) onProgress(1);
      await putFileBlob(rel, blob);
      return blob;
    } catch (e) {
      if (e.code === 'missing') missing.add(rel);
      if (e.code === 'key') ctx.onKeyError(e);
      throw e;
    } finally { inflight.delete(rel); }
  })();
  inflight.set(rel, p);
  return p;
}

// ---------- thumbnails ----------
async function makeThumb(blob, size = 240) {
  const src = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    const s = Math.min(1, size / Math.min(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * s)), hh = Math.max(1, Math.round(img.naturalHeight * s));
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    c.getContext('2d').drawImage(img, 0, 0, w, hh);
    return await new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.82));
  } finally { URL.revokeObjectURL(src); }
}
export async function thumbUrl(rel) {
  const tkey = `thumb:${rel}`;
  if (urls.has(tkey)) return urls.get(tkey);
  let t = await getFileBlob(tkey);
  if (!t) {
    const blob = await fileBlob(rel);
    t = await makeThumb(blob);
    if (!t) throw new Error('This picture can’t be shown here.');
    await putFileBlob(tkey, t);
  }
  return urlFor(tkey, t);
}
export async function fullUrl(rel) {
  return urlFor(rel, await fileBlob(rel));
}

// Thumbs on screen only: an IntersectionObserver feeds a small queue; a tile that scrolls away before its turn is skipped.
const queue = [];
let running = 0;
const visible = new Set();
const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    const el = e.target;
    if (e.isIntersecting) { visible.add(el); if (!el.dataset.state) { el.dataset.state = 'queued'; queue.push(el); } }
    else { visible.delete(el); if (el.dataset.state === 'queued') { el.dataset.state = ''; const i = queue.indexOf(el); if (i >= 0) queue.splice(i, 1); } }
  }
  pump();
}, { rootMargin: '120px 0px' }) : null;

function pump() {
  while (running < PARALLEL_FILES && queue.length) {
    if (rate.remaining != null && rate.remaining < LOW_RATE) return; // keep the hour's last calls for the snapshot
    const el = queue.shift();
    if (!el.isConnected || !visible.has(el)) { el.dataset.state = ''; continue; }
    running++;
    el.dataset.state = 'loading';
    loadInto(el).finally(() => { running--; io && io.unobserve(el); pump(); });
  }
}
async function loadInto(el) {
  const rel = el.dataset.rel;
  try {
    const u = el.dataset.full ? await fullUrl(rel) : await thumbUrl(rel);
    const img = h('img', { src: u, alt: '', decoding: 'async' });
    img.addEventListener('load', () => el.classList.add('has-img'), { once: true });
    el.append(img);
    el.dataset.state = 'done';
  } catch (e) {
    el.dataset.state = 'failed';
    el.classList.add(e && e.code === 'missing' ? 'pc-only' : 'no-img');
    if (e && e.code === 'missing') el.title = ERRORS.missing;
  }
}
/** A fixed-size picture box (so the list never jumps), filled lazily when it scrolls into view. */
export function thumb(rel, { label = '', cls = 'thumb', full = false } = {}) {
  const el = h('span', { class: cls, 'aria-hidden': 'true' }, label ? h('span', { class: 'th-lbl' }, label) : null);
  if (rel && fileKind(rel) === 'image') {
    el.dataset.rel = rel;
    if (full) el.dataset.full = '1';
    if (!full && urls.has(`thumb:${rel}`)) { el.append(h('img', { src: urls.get(`thumb:${rel}`), alt: '' })); el.classList.add('has-img'); el.dataset.state = 'done'; }
    else if (io) io.observe(el);
  }
  return el;
}

// ---------- the full-screen picture viewer ----------
let viewerEl = null;
/** items: [{ rel, caption }], at: index. onClose goes back in history (the viewer has its own hash). */
export function openViewer(items, at, { onClose, onMove }) {
  closeViewer();
  const i = Math.max(0, Math.min(items.length - 1, at));
  const it = items[i];
  const stage = h('div', { class: 'vw-stage' }, h('p', { class: 'vw-wait' }, 'Getting the picture…'));
  const save = h('a', { class: 'vw-btn wait', download: baseName(it.rel) }, icon('save'), h('span', null, 'Save'));
  viewerEl = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Picture' },
    h('div', { class: 'vw-top' },
      h('button', { class: 'vw-x', type: 'button', 'aria-label': 'Close', onclick: onClose }, icon('close')),
      h('span', { class: 'vw-n' }, items.length > 1 ? `${i + 1} / ${items.length}` : ''),
      save),
    stage,
    it.caption ? h('p', { class: 'vw-cap', dir: 'auto' }, it.caption) : null);
  document.body.append(viewerEl);
  document.documentElement.classList.add('locked');
  viewerEl.querySelector('.vw-x').focus();
  // swipe to the next / previous picture; tap toggles fit and actual size
  let sx = 0, sy = 0;
  stage.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (stage.classList.contains('zoom') || Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0 && i < items.length - 1) onMove(i + 1);
    if (dx > 0 && i > 0) onMove(i - 1);
  });
  viewerEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowRight' && i < items.length - 1) onMove(i + 1);
    if (e.key === 'ArrowLeft' && i > 0) onMove(i - 1);
  });
  fullUrl(it.rel).then((u) => {
    if (!viewerEl || !stage.isConnected) return;
    const img = h('img', { src: u, alt: it.caption || 'Photo' });
    img.addEventListener('click', () => stage.classList.toggle('zoom'));
    img.addEventListener('error', () => { clear(stage).append(h('p', { class: 'vw-wait' }, 'This picture can’t be shown on this phone.')); });
    clear(stage).append(img);
    save.href = u; save.classList.remove('wait');
  }).catch((e) => { if (stage.isConnected) clear(stage).append(h('p', { class: 'vw-wait' }, icon('pc', 'ic big'), e.message || ERRORS.down)); });
}
export function closeViewer() {
  if (viewerEl) { viewerEl.remove(); viewerEl = null; }
  document.documentElement.classList.remove('locked');
}

// ---------- papers: a sheet with Open and Save ----------
let sheetEl = null;
export function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; document.documentElement.classList.remove('locked'); } }
export function openFile(rel, { title, sub } = {}) {
  closeSheet();
  const name = baseName(rel);
  const status = h('p', { class: 'fs-status' });
  const acts = h('div', { class: 'fs-acts' });
  const card = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || name },
    h('div', { class: 'sh-grip' }),
    h('p', { class: 'kick' }, h('i'), (fileExt(rel) || 'file').toUpperCase()),
    h('h3', { dir: 'auto' }, title || name),
    sub ? h('p', { class: 'fs-sub', dir: 'auto' }, sub) : null,
    status, acts,
    h('button', { class: 'btn ghost wide', type: 'button', onclick: closeSheet }, 'Close'));
  sheetEl = h('div', { class: 'veil', onclick: (e) => { if (e.target === sheetEl) closeSheet(); } }, card);
  document.body.append(sheetEl);
  document.documentElement.classList.add('locked');
  card.querySelector('button').focus();
  if (fileKind(rel) === 'pc-only') { status.className = 'fs-status pc'; status.append(icon('pc'), ERRORS.missing); return; }
  status.textContent = 'Getting the file…';
  fileBlob(rel).then((blob) => {
    if (!card.isConnected) return;
    const u = urlFor(rel, blob);
    status.textContent = `${Math.max(1, Math.round(blob.size / 1024)).toLocaleString('en-GB')} KB · kept on this phone`;
    acts.append(
      h('a', { class: 'btn pri wide', href: u, target: '_blank', rel: 'noopener' }, icon('open'), 'Open'),
      h('a', { class: 'btn wide', href: u, download: name }, icon('save'), 'Save to phone'));
  }).catch((e) => {
    if (!card.isConnected) return;
    status.className = `fs-status ${e.code === 'missing' || e.code === 'big' ? 'pc' : 'err'}`;
    clear(status).append(icon(e.code === 'offline' ? 'offline' : 'pc'), e.message || ERRORS.down);
  });
}
