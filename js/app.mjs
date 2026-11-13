// The Medmac phone page: a read-only copy of the Internal System's main lists for when the PC is off.
// Shell: header with "As of …", the screen, a bottom bar. Data: the snapshot the PC pushes to the private data repo,
// read with a key kept on this phone, kept in IndexedDB so the page opens with no network.
import { DATA_REPO, SNAPSHOT_PATH, SLOT, BORROW } from './config.mjs';
import * as C from './core.mjs';
import { getFile, tryKey, rate } from './gh.mjs';
import * as store from './store.mjs';
import * as media from './media.mjs';
import * as V from './views.mjs';
import { h, clear, icon } from './dom.mjs';

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};
const S = { snap: null, checkedAt: 0, checking: false, problem: '', key: '', keyFrom: '', screenState: new Map(), scroll: new Map(), depth: 0 };

// ---------- the key ----------
function borrowed() {
  if (ls.get(SLOT.noBorrow)) return [];
  const out = [];
  const from = ls.get(BORROW.launcherFrom);
  for (const k of from === 'mkc' ? [BORROW.cinema, BORROW.launcher] : [BORROW.launcher, BORROW.cinema]) {
    const v = C.cleanKey(ls.get(k));
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}
async function findKey() {
  const own = C.cleanKey(ls.get(SLOT.key));
  if (own) { S.key = own; S.keyFrom = ls.get(SLOT.keyFrom) || 'own'; return true; }
  return borrowKey();
}
async function borrowKey(except = '') {
  for (const k of borrowed()) {
    if (k === except) continue;
    if ((await tryKey(k, SNAPSHOT_PATH)).ok) { ls.set(SLOT.key, k); ls.set(SLOT.keyFrom, 'launcher'); S.key = k; S.keyFrom = 'launcher'; return true; }
  }
  return false;
}
media.setup({ key: () => S.key, onKeyError: () => keyFailed() });

let keyFailing = null;
function keyFailed() {
  if (keyFailing) return keyFailing;
  keyFailing = (async () => {
    const bad = S.key;
    if (await borrowKey(bad)) { keyFailing = null; return refresh(); }
    ls.del(SLOT.key); ls.del(SLOT.keyFrom); S.key = '';
    showConnect('That key is wrong or has expired. Paste a new one.');
    keyFailing = null;
  })();
  return keyFailing;
}

// ---------- the snapshot: from the phone first, then GitHub ----------
async function loadKept() {
  const e = await store.getSnap(SNAPSHOT_PATH);
  if (!e || !e.json) return null;
  try {
    return await C.readSnapshot(e.json, async (file) => { const p = await store.getSnap(`_phone/${file}`); if (!p) throw new Error('not kept'); return p.json; });
  } catch { return null; }
}
async function fetchJson(path) {
  const kept = await store.getSnap(path);
  const r = await getFile(path, { key: S.key, etag: kept && kept.json ? kept.etag : '' });
  if (r.status === 304) return { json: kept.json, changed: false };
  let json;
  try { json = JSON.parse(r.body); } catch { throw Object.assign(new Error(C.ERRORS.invalid), { code: 'invalid' }); }
  await store.putSnap(path, { json, etag: r.etag, at: Date.now() });
  return { json, changed: true };
}
let refreshing = null;
function refresh() {
  if (!S.key) return Promise.resolve();
  if (refreshing) return refreshing;
  S.checking = true; drawStatus();
  refreshing = (async () => {
    try {
      const entry = await fetchJson(SNAPSHOT_PATH);
      let changed = entry.changed;
      const snap = await C.readSnapshot(entry.json, async (file) => { const p = await fetchJson(`_phone/${file}`); changed = changed || p.changed; return p.json; });
      S.checkedAt = Date.now(); S.problem = '';
      if (changed || !S.snap) { S.snap = snap; render(); }
    } catch (e) {
      if (e.code === 'key') { S.checking = false; refreshing = null; return keyFailed(); }
      S.problem = e.code === 'missing' ? 'access' : e.code || 'down';
      if (!S.snap && S.problem === 'access') { showConnect(C.ERRORS.access); }
      else if (!S.snap) render();
    } finally { S.checking = false; refreshing = null; drawStatus(); }
  })();
  return refreshing;
}

// ---------- the shell ----------
const root = document.getElementById('app');
let statusEl, mainEl, barEl;
function shell() {
  clear(root);
  statusEl = h('p', { class: 'asof', 'aria-live': 'polite' });
  const refreshBtn = h('button', { class: 'refresh', type: 'button', 'aria-label': 'Check for a newer copy', onclick: () => refresh() }, icon('refresh'));
  const hd = h('header', { class: 'hd' },
    h('a', { class: 'wordmark', href: '#/projects', 'aria-label': 'Medmac, projects' }, h('i'), 'MEDMAC'),
    statusEl, refreshBtn);
  mainEl = h('main', { id: 'main', tabindex: '-1' });
  const tab = (id, label) => h('a', { href: `#/${id}`, dataset: { tab: id } }, icon(id, 'ic tab-ic'), h('span', null, label));
  barEl = h('nav', { class: 'tabbar', 'aria-label': 'Areas' }, tab('projects', 'Projects'), tab('customers', 'Customers'), tab('dues', 'Dues'), tab('equipment', 'Equipment'), tab('more', 'More'));
  root.append(h('div', { class: 'ptr', 'aria-hidden': 'true' }, icon('refresh')), hd, mainEl, barEl);
  drawStatus();
}
function drawStatus() {
  if (!statusEl) return;
  const btn = root.querySelector('.refresh');
  if (btn) { btn.classList.toggle('spin', S.checking); btn.disabled = S.checking; }
  clear(statusEl);
  if (!S.snap) { statusEl.textContent = S.checking ? 'Getting the copy from the PC…' : ''; return; }
  const level = C.ageLevel(S.snap.madeAt);
  statusEl.className = `asof ${level}${S.problem ? ' problem' : ''}`;
  statusEl.append(h('span', { class: 'asof-main' }, C.asOf(S.snap.madeAt)));
  const why = S.problem === 'offline' ? 'Offline' : S.problem === 'rate' ? 'GitHub limit reached' : S.problem === 'access' ? 'Key can’t see the data' : S.problem ? 'GitHub unreachable' : S.checking ? 'checking…' : '';
  if (why) statusEl.append(h('span', { class: 'asof-why' }, why));
}
setInterval(drawStatus, 60000);

// ---------- connect ----------
function showConnect(error = '') {
  document.documentElement.classList.add('connecting');
  clear(root);
  const input = h('input', { id: 'key', type: 'password', class: 'keyin', placeholder: 'github_pat_…', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
    'aria-describedby': error ? 'key-err' : 'key-help', 'aria-invalid': error ? 'true' : null });
  const go = h('button', { class: 'btn pri wide', type: 'submit' }, error ? 'Try again' : 'Connect');
  const err = h('p', { class: 'cn-err', id: 'key-err', role: 'alert', hidden: !error }, error);
  const form = h('form', { class: 'cn-form', autocomplete: 'off' },
    h('label', { for: 'key' }, 'GitHub key'), input, err, go);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const k = C.cleanKey(input.value);
    if (!k) { err.hidden = false; err.textContent = 'That doesn’t look like a GitHub key.'; input.focus(); return; }
    go.disabled = true; go.textContent = 'Checking…'; err.hidden = true;
    const r = await tryKey(k, SNAPSHOT_PATH);
    if (!r.ok) {
      go.disabled = false; go.textContent = 'Try again'; err.hidden = false;
      err.textContent = r.code === 'missing' ? C.ERRORS.access : r.message; input.setAttribute('aria-invalid', 'true'); input.focus(); return;
    }
    ls.set(SLOT.key, k); ls.set(SLOT.keyFrom, 'own'); ls.del(SLOT.noBorrow);
    S.key = k; S.keyFrom = 'own';
    start();
  });
  const launcher = ls.get(SLOT.noBorrow) && (C.cleanKey(ls.get(BORROW.launcher)) || C.cleanKey(ls.get(BORROW.cinema)));
  const useLauncher = launcher ? h('button', { class: 'btn wide', type: 'button', onclick: async () => {
    ls.del(SLOT.noBorrow);
    if (await borrowKey()) start(); else { ls.set(SLOT.noBorrow, '1'); showConnect('The MK Launcher key can’t open the company data.'); }
  } }, 'Use the MK Launcher key') : null;
  const repo = DATA_REPO.split('/').pop();
  root.append(h('main', { class: 'connect' }, h('div', { class: 'cn-card' },
    h('div', { class: 'cn-mark', 'aria-hidden': 'true' }, h('i')),
    h('p', { class: 'kick' }, h('i'), 'Medmac Internal System'),
    h('h1', null, 'Open the company copy'),
    h('p', { class: 'cn-lede', id: 'key-help' }, 'Paste a GitHub key once. It stays on this phone.'),
    h('p', { class: 'cn-lede' }, 'Make it as a fine-grained key with read-only “Contents” on ', h('b', { class: 'nowrap' }, repo), '.'),
    form,
    useLauncher ? h('p', { class: 'cn-or' }, h('span', null, 'or')) : null, useLauncher,
    h('a', { class: 'cn-make', href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer' }, icon('open', 'ic tiny'), 'Make a key on GitHub'),
    h('p', { class: 'cn-ro' }, icon('lock', 'ic tiny'), 'Read-only copy. Changes are made on the PC or through the live link.'))));
  setTimeout(() => input.focus(), 50);
}

// ---------- forget ----------
function confirmForget() {
  const veil = h('div', { class: 'veil' });
  const close = () => { veil.remove(); document.documentElement.classList.remove('locked'); };
  veil.addEventListener('click', (e) => { if (e.target === veil) close(); });
  veil.append(h('div', { class: 'sheet', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Forget this phone' },
    h('div', { class: 'sh-grip' }),
    h('h3', null, 'Forget this phone?'),
    h('p', { class: 'fs-sub' }, 'The key and every saved list, photo and paper are removed from this phone. The data on the PC and on GitHub is not touched.'),
    h('div', { class: 'fs-acts' },
      h('button', { class: 'btn pri wide', type: 'button', onclick: async () => { close(); await forget(); } }, 'Forget'),
      h('button', { class: 'btn ghost wide', type: 'button', onclick: close }, 'Keep'))));
  document.body.append(veil);
  document.documentElement.classList.add('locked');
  veil.querySelector('.btn.ghost').focus();
}
async function forget() {
  ls.del(SLOT.key); ls.del(SLOT.keyFrom); ls.del(SLOT.ui);
  ls.set(SLOT.noBorrow, '1'); // the launcher's key stays the launcher's; this page stops using it until asked
  S.key = ''; S.snap = null; S.checkedAt = 0; S.screenState.clear(); S.scroll.clear();
  media.revokeAll(); media.closeViewer(); media.closeSheet();
  await store.wipe();
  try { for (const k of await caches.keys()) if (k.startsWith('mmis-')) await caches.delete(k); } catch { /* no Cache Storage */ }
  history.replaceState(null, '', location.pathname);
  showConnect();
}

// ---------- routes ----------
const ui = {
  state(key) { if (!S.screenState.has(key)) S.screenState.set(key, {}); return S.screenState.get(key); },
  back(fallback) { if (S.depth > 0) history.back(); else replaceTo(fallback); },
  viewer(items, at, base) {
    if (!items.length) return;
    queueMicrotask(() => media.openViewer(items, at, {
      onClose: () => ui.back(base),
      onMove: (i) => replaceTo(`${base}/photo/${i}`),
    }));
  },
};
function parse() {
  const raw = location.hash.replace(/^#\/?/, '');
  return raw.split('/').map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
}
async function render() {
  if (!mainEl) shell();
  const parts = parse();
  const [area, id, ...sub] = parts;
  const isViewer = sub[0] === 'photo';
  media.closeSheet();
  if (!isViewer) media.closeViewer();
  if (!S.snap) {
    clear(mainEl).append(h('section', { class: 'page' }, h('div', { class: 'loading' }, S.problem
      ? h('div', { class: 'callout warn' }, h('p', null, h('b', null, C.ERRORS[S.problem] || C.ERRORS.down)), h('p', null, 'Nothing is kept on this phone yet, so there is nothing to show. Try again when you have a connection.'),
        h('button', { class: 'btn', type: 'button', onclick: () => refresh() }, icon('refresh'), 'Try again'))
      : h('p', { class: 'wait' }, h('span', { class: 'spinner' }), 'Getting the copy from the PC…'))));
    markTab(area);
    return;
  }
  const snap = S.snap;
  let node;
  switch (area || 'projects') {
    case 'projects': node = id ? V.projectPage(ui, snap, id, sub) : V.projectsList(ui, snap); break;
    case 'customers': node = id === 'people' ? V.customersList(ui, snap, 'people') : id ? V.customerPage(ui, snap, id) : V.customersList(ui, snap); break;
    case 'dues': node = V.duesScreen(ui, snap, id); break;
    case 'suppliers': node = id ? V.supplierPage(ui, snap, id) : V.suppliersList(ui, snap); break;
    case 'equipment': node = id === 'stock' ? V.equipmentScreen(ui, snap, 'stock') : id ? V.equipmentPage(ui, snap, id, sub) : V.equipmentScreen(ui, snap); break;
    case 'workforce': node = id ? V.workerPage(ui, snap, id) : V.workforceList(ui, snap); break;
    case 'quotations': node = id ? V.quotationPage(ui, snap, id) : V.quotationsList(ui, snap); break;
    case 'drawings': node = id ? V.drawingPage(ui, snap, id) : V.drawingsList(ui, snap); break;
    case 'more': node = V.moreScreen(ui, snap, { checkedAt: S.checkedAt, keyFrom: S.keyFrom, cache: C.fmtSize(await store.cacheBytes()), refresh: () => refresh(), forget: confirmForget }); break;
    default: replaceTo('#/projects'); return;
  }
  clear(mainEl).append(node);
  markTab(area || 'projects');
  const key = isViewer ? location.hash.replace(/\/photo\/\d+$/, '') : location.hash;
  const y = S.scroll.get(key);
  window.scrollTo(0, y || 0);
}
function markTab(area) {
  const home = { suppliers: 'more', workforce: 'more', quotations: 'more', drawings: 'more' }[area] || area || 'projects';
  for (const a of barEl.querySelectorAll('a')) if (a.dataset.tab === home) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
}
window.addEventListener('hashchange', (e) => {
  // remember where each screen was scrolled, so Back lands on the same row
  const prev = new URL(e.oldURL).hash;
  if (!/\/photo\/\d+$/.test(prev)) S.scroll.set(prev, window.scrollY);
  // how deep inside this page we are: a Back button only goes back while it stays inside
  if (history.state && Number.isFinite(history.state.d)) S.depth = history.state.d;
  else { S.depth += 1; history.replaceState({ d: S.depth }, '', location.href); }
  if (!S.key) return;
  render();
});
/** Swap the current entry (no new Back step) and draw it. */
function replaceTo(hash) {
  S.scroll.set(location.hash, window.scrollY);
  history.replaceState({ d: S.depth }, '', hash);
  render();
}

// ---------- refresh triggers: open, pull, the button, back to the page ----------
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.key && Date.now() - S.checkedAt > 60000) refresh(); });
window.addEventListener('online', () => { if (S.key) refresh(); });
function pullToRefresh() {
  let y0 = null, pulled = 0;
  const ptr = () => root.querySelector('.ptr');
  window.addEventListener('touchstart', (e) => { y0 = window.scrollY <= 0 && !document.documentElement.classList.contains('locked') ? e.touches[0].clientY : null; pulled = 0; }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    pulled = Math.max(0, e.touches[0].clientY - y0);
    const p = ptr(); if (!p) return;
    p.style.transform = `translate(-50%, ${Math.min(pulled, 110) * 0.6}px) rotate(${pulled * 2}deg)`;
    p.classList.toggle('on', pulled > 80);
    p.style.opacity = String(Math.min(1, pulled / 80));
  }, { passive: true });
  window.addEventListener('touchend', () => {
    const p = ptr();
    if (y0 != null && pulled > 80 && S.key) refresh();
    if (p) { p.style.transform = ''; p.style.opacity = ''; p.classList.remove('on'); }
    y0 = null; pulled = 0;
  }, { passive: true });
}

// ---------- start ----------
async function start() {
  document.documentElement.classList.remove('connecting');
  mainEl = null;
  S.snap = S.snap || await loadKept();
  shell();
  history.replaceState({ d: 0 }, '', !location.hash || location.hash === '#' ? '#/projects' : location.href);
  S.depth = 0;
  await render();
  refresh();
}
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* the page still works without it */ });
  pullToRefresh();
  if (await findKey()) return start();
  // no key on this phone: a kept copy is never shown without one (Forget wipes both)
  showConnect();
}
boot();
export { rate };
