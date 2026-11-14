// The hub on the phone (docs/HUB.md "The phone page"): the beat and the lights, the row states of every office-server
// file (Open / Ask the office iMac / greyed with the reason / Look in my Drives), the Drop box with the basketball
// upload, Add from Drive and the Drives screen. With no key, or the hub unreachable, nothing here calls anything and the
// page is as before; the lights fall back to what GitHub already gave this visit, and the Drop box entry says "Hub: offline".
import { HUB_BEAT_MS, HUB_ASKS_MS, SLOT, HUB_URL } from './config.mjs';
import * as C from './core.mjs';
import { createHub, xhrPut, SECTIONS, DROP_STATE, dropFrom, MAX_DROP, HUB_WORDS } from './hub.mjs';
import { h, clear, icon, add, txt, pageHead, section, chip, join, driveLogo } from './dom.mjs';
import { mountHoop } from './hoop.mjs';

const { arr } = C;
const st = {
  client: null,
  ctx: { local: () => ({}), storage: null },
  answer: null,          // the last /beat answer: { now, lights }
  up: false, tried: false, problem: '', lastBeat: 0,
  asks: new Map(),       // path -> the newest ask for it
  found: new Map(),      // path -> { id } a Drive hit, or false (looked, none)
  rowMsg: new Map(),     // path -> a short error from the last tap on that row
  accounts: null, accountsCode: '', accountsBusy: false, waitConnect: false,
  drops: null, dropsBusy: false, sentIds: new Set(),
  section: '',
  settings: null, settingsBusy: '', settingsMsg: '', // the bulk upload setting ({ upload, at, by }); busy = the value being sent
};

// ---------- parts of the screen that follow the hub (redrawn in place) ----------
const watchers = new Set();
const listeners = new Set();
/** An element drawn by make(), drawn again in place whenever the hub's state changes. */
export function live(make, p = '') {
  const el = make();
  watchers.add({ el, make, p });
  if (watchers.size > 600) for (const w of [...watchers]) if (!w.el.isConnected) watchers.delete(w);
  return el;
}
export function redraw() {
  for (const w of [...watchers]) {
    if (!w.el.isConnected) { watchers.delete(w); continue; }
    const n = w.make();
    if (w.el.replaceWith) w.el.replaceWith(n);
    w.el = n;
  }
  for (const fn of [...listeners]) fn();
}
const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

// ---------- setup, the beat ----------
export function setup(ctx) {
  st.ctx = { ...st.ctx, ...ctx };
  st.client = createHub({ key: ctx.key, storage: ctx.storage, slot: SLOT.hubDevice, ua: ctx.ua || '', putImpl: ctx.xhr ? xhrPut(ctx.xhr) : undefined });
}
let beatTimer = 0;
export function start() {
  beat();
  if (beatTimer) return;
  beatTimer = setInterval(() => { if (visible()) beat(); }, HUB_BEAT_MS);
  document.addEventListener('visibilitychange', () => {
    if (!visible()) return;
    if (Date.now() - st.lastBeat > 15000) beat();
    if (st.waitConnect) { st.waitConnect = false; loadAccounts(); }
  });
}
const hasKey = () => !!(st.client && st.client.hasKey());
let beating = null;
export function beat() {
  if (beating) return beating;
  if (!hasKey()) { st.up = false; st.problem = 'nokey'; st.tried = true; redraw(); return Promise.resolve(); }
  beating = (async () => {
    const was = st.up;
    try {
      const a = await st.client.beat();
      st.answer = { now: String((a && a.now) || new Date().toISOString()), lights: arr(a && a.lights) };
      st.up = true; st.problem = '';
    } catch (e) { st.up = false; st.problem = e.code || 'down'; }
    st.tried = true; st.lastBeat = Date.now();
    if (st.up && !was) { await Promise.all([loadAsks(), loadAccounts(true), loadSettings()]); }
    redraw();
  })().finally(() => { beating = null; });
  return beating;
}
/** Forget this phone: drop everything the hub gave this visit. */
export function reset() {
  st.answer = null; st.up = false; st.tried = false; st.problem = '';
  st.asks.clear(); st.found.clear(); st.rowMsg.clear();
  st.accounts = null; st.accountsCode = ''; st.drops = null; st.sentIds.clear(); st.section = '';
  st.settings = null; st.settingsBusy = ''; st.settingsMsg = '';
  redraw();
}
function noteErr(e) {
  if (e && (e.code === 'down' || e.code === 'offline' || e.code === 'key' || e.code === 'nokey')) { st.up = false; st.problem = e.code; }
}
export const isUp = () => st.up;
export function hubWord() {
  if (st.up) return 'Hub: connected';
  if (st.problem === 'key') return 'Hub: key not accepted';
  if (!st.tried && hasKey()) return 'Hub: checking…';
  return 'Hub: offline';
}
/** The lights the page shows now (the hub's, or the fallback from GitHub's copy). */
export function lightsNow(local = st.ctx.local()) {
  return C.viewLights(st.up ? st.answer : null, { ...local, now: Date.now() });
}

// ---------- asks, Drive finds, links ----------
async function loadAsks() {
  if (!hasKey()) return;
  try {
    const r = await st.client.asks();
    const next = new Map();
    for (const a of arr(r && r.asks)) if (a && a.p && !next.has(a.p)) next.set(a.p, a);
    st.asks = next;
  } catch (e) { noteErr(e); }
}
const pending = (a) => !!a && (a.state === 'queued' || a.state === 'working');
let pollTimer = 0;
function pollSoon() {
  if (pollTimer) return;
  pollTimer = setTimeout(async () => {
    pollTimer = 0;
    const onScreen = [...watchers].some((w) => w.p && w.el.isConnected && pending(st.asks.get(w.p)));
    if (!onScreen) return;
    if (visible() && st.up) { await loadAsks(); redraw(); }
    pollSoon();
  }, HUB_ASKS_MS);
  if (pollTimer && pollTimer.unref) pollTimer.unref(); // Node (tests) must not wait for it
}
const safeDl = (u) => typeof u === 'string' && u.startsWith(`${HUB_URL}/dl/`);
const safeGoogle = (u) => typeof u === 'string' && u.startsWith('https://accounts.google.com/');
// a window opened in the tap itself, so a phone does not block it; the link arrives a moment later
function openBlank() { try { return window.open('', '_blank'); } catch { return null; } }
function go(win, url) {
  if (win && !win.closed) { try { win.opener = null; } catch { /* fine */ } win.location.replace(url); return; }
  window.location.assign(url);
}
function openVia(get, check, onFail) {
  const win = openBlank();
  get().then((r) => {
    if (!r || !check(r.url)) throw new Error(HUB_WORDS.bad);
    go(win, r.url);
  }).catch((e) => { try { if (win) win.close(); } catch { /* closed */ } onFail(e); });
}
function openCloud(key, name, p) {
  st.rowMsg.delete(p);
  openVia(() => st.client.fileLink(key, name), safeDl, (e) => { noteErr(e); st.rowMsg.set(p, e.message || HUB_WORDS.down); redraw(); });
}
async function askFor(r, btn) {
  st.rowMsg.delete(r.p);
  if (btn) { btn.disabled = true; btn.lastChild.textContent = 'Asking…'; }
  try {
    const a = await st.client.ask(r);
    st.asks.set(r.p, { ...a, p: r.p, state: (a && a.state) || 'queued' });
  } catch (e) { noteErr(e); st.rowMsg.set(r.p, e.message || HUB_WORDS.down); }
  redraw(); pollSoon();
}
async function findIn(r, btn) {
  st.rowMsg.delete(r.p);
  if (btn) { btn.disabled = true; btn.lastChild.textContent = 'Looking…'; }
  try {
    const res = await st.client.driveFind([{ name: C.baseName(r.p), size: r.s }]);
    const f = arr(res && res.found)[0];
    const hit = f && arr(f.hits)[0];
    st.found.set(r.p, hit && hit.id ? { id: String(hit.id) } : false);
  } catch (e) { noteErr(e); st.rowMsg.set(r.p, e.message || HUB_WORDS.down); }
  redraw();
}
const bigDrives = () => st.up && arr(st.accounts).some((a) => a && a.tag === 'big');

// ---------- one file of the server index ----------
const BADGE = { set: 'set', drive: 'drive', cloud: 'cloud', ask: 'ask', offline: 'off' };
/**
 * The row for one file of the server index, by reach(): set (opens from the data repo), drive (a Drive link), cloud (Open:
 * a 5-minute link from the hub), ask (Ask the office iMac, then queued / fetching / Open), offline (greyed, the reason).
 */
export function fileRow(r, { title, openSet } = {}) {
  return live(() => drawRow(r, title, openSet), r.p);
}
function drawRow(r, title, openSet) {
  const now = Date.now();
  const R = C.reach(r, lightsNow(), { ask: st.asks.get(r.p), found: st.found.get(r.p) || null, now });
  const w = C.whereOf(r);
  const name = title || C.baseName(r.p);
  const folder = String(r.p || '').split('/').slice(0, -1).join('/');
  const ext = C.fileExt(r.p);
  const meta = join(r.s ? C.fmtSize(r.s) : '', r.m ? C.fmtDay(Math.min(r.m, now)) : '', w === 'gone' && r.x ? `gone since ${C.fmtDay(r.x)}` : '');
  const msg = st.rowMsg.get(r.p) || '';
  const looked = st.found.get(r.p) === false;
  const acts = [];
  if (R.state === 'ask' && (R.step === '' || R.step === 'failed')) {
    const b = h('button', { class: 'btn rbtn pri', type: 'button', onclick: (e) => askFor(r, e.currentTarget) }, icon('server'), h('span', null, R.step === 'failed' ? 'Ask again' : 'Ask the office iMac'));
    acts.push(b);
  }
  if ((R.state === 'ask' && R.step !== 'queued' && R.step !== 'fetching') || R.state === 'offline') {
    if (bigDrives() && !looked) acts.push(h('button', { class: 'btn rbtn', type: 'button', onclick: (e) => findIn(r, e.currentTarget) }, driveLogo('drive-logo sm'), h('span', null, 'Look in my Drives')));
  }
  const kids = [
    h('span', { class: `fext ${C.fileKind(r.p) === 'pc-only' ? 'file' : C.fileKind(r.p)} ${ext}` }, (ext || '?').toUpperCase().slice(0, 4)),
    h('span', { class: 'rtx' }, txt(name, 'rn'), folder ? h('span', { class: 'rm path', dir: 'auto' }, folder) : null, meta ? h('span', { class: 'rm' }, meta) : null,
      h('span', { class: `wb wb-${w === 'gone' && R.state === 'offline' ? 'gone' : BADGE[R.state]}` }, R.label),
      R.why ? h('span', { class: `rwhy${R.step === 'queued' || R.step === 'fetching' ? ' busy' : ''}`, dir: 'auto' }, R.step === 'queued' || R.step === 'fetching' ? h('span', { class: 'spinner sm' }) : null, R.why) : null,
      looked ? h('span', { class: 'rwhy' }, 'Not in your Drives.') : null,
      msg ? h('span', { class: 'rwhy err', role: 'alert' }, msg) : null,
      acts.length ? h('span', { class: 'racts' }, acts) : null),
  ];
  const cls = `frow srow w-${w} r-${R.state}`;
  if (R.state === 'set') return h('button', { class: cls, type: 'button', onclick: () => openSet && openSet(name, folder) }, kids, icon('chev', 'ic chev'));
  if (R.state === 'drive') return h('a', { class: cls, href: R.url, target: '_blank', rel: 'noopener noreferrer' }, kids, icon('open', 'ic chev'));
  if (R.state === 'cloud') return h('button', { class: cls, type: 'button', onclick: () => openCloud(R.key, name, r.p) }, kids, h('span', { class: 'ropen' }, icon('open', 'ic tiny'), 'Open'));
  if (R.state === 'ask' && (R.step === 'queued' || R.step === 'fetching')) pollSoon();
  return h('div', { class: cls, title: R.words }, kids);
}

// ---------- lights ----------
const DOT = { ok: 'l-ok', late: 'l-amber', down: 'l-red', unknown: 'l-off' };
/** The lights (server, office iMac, GitHub, each PC, phone, hub): a dot, the name, "seen 2 min ago". extra: more rows after them. */
export function lightsBlock(local, extra = []) {
  return live(() => {
    const now = Date.now();
    const list = lightsNow(typeof local === 'function' ? local() : local || st.ctx.local());
    return h('div', { class: 'lights' }, list.map((l) => h('div', { class: `light ${DOT[C.dotOf(l.level)]}` }, h('span', { class: 'ldot', 'aria-hidden': 'true' }),
      h('span', { class: 'rtx' }, h('span', { class: 'rn' }, l.name), l.at ? h('span', { class: 'rm' }, C.seenWords(l.at, now)) : null, l.detail ? h('span', { class: 'rm', dir: 'auto' }, l.detail) : null))), extra);
  });
}

// ---------- the entry on the first screen and the More tiles ----------
export function dropEntry() {
  return live(() => h('a', { class: `hubentry${st.up ? '' : ' off'}`, href: '#/drop' },
    h('span', { class: 'he-ic', 'aria-hidden': 'true' }, icon('drop')),
    h('span', { class: 'rtx' }, h('span', { class: 'rn' }, 'Drop box'), h('span', { class: 'rm' }, st.up ? 'Send a file to the office' : hubWord())),
    icon('chev', 'ic chev')));
}
export const dropTile = () => (st.up ? 'send files' : hubWord().replace(/^Hub: /, 'hub '));
export const drivesTile = () => (!st.up ? hubWord().replace(/^Hub: /, 'hub ') : st.accounts ? `${st.accounts.length} connected` : st.accountsCode === 'drive-not-set-up' ? 'not set up yet' : '');

// ---------- the Drop box ----------
async function loadDrops() {
  if (!hasKey() || st.dropsBusy) return;
  st.dropsBusy = true;
  try { const r = await st.client.inbox(); st.drops = arr(r && r.drops); } catch (e) { noteErr(e); }
  st.dropsBusy = false;
  redraw();
}
function checkFile(file) {
  if (!hasKey()) return HUB_WORDS.nokey;
  if (st.tried && !st.up) return 'Hub: offline. Try again when it is back.';
  if (!file.size) return HUB_WORDS.empty;
  if (file.size > MAX_DROP) return HUB_WORDS.big;
  return '';
}
function sectionChips() {
  const btns = SECTIONS.map(([id, label]) => {
    const b = h('button', { class: 'secchip', type: 'button', role: 'radio', 'aria-checked': st.section === id ? 'true' : 'false', dataset: { id } }, label);
    b.addEventListener('click', () => {
      st.section = st.section === id ? '' : id; // tap again: back to none
      for (const x of btns) x.setAttribute('aria-checked', x.dataset.id === st.section ? 'true' : 'false');
    });
    return b;
  });
  return h('div', { class: 'secpick' }, h('p', { class: 'secpick-l', id: 'secpick-l' }, 'Where does it belong?', h('small', null, 'optional')),
    h('div', { class: 'secchips', role: 'radiogroup', 'aria-labelledby': 'secpick-l' }, btns));
}
function dropRow(d) {
  const ext = C.fileExt(d.name);
  const state = DROP_STATE[d.state] ? d.state : 'uploading';
  const when = d.at ? C.agoWords(C.toMs(d.at)) : '';
  const kids = [
    h('span', { class: `fext ${C.fileKind(d.name) === 'pc-only' ? 'file' : C.fileKind(d.name)}` }, (ext || '?').toUpperCase().slice(0, 4)),
    h('span', { class: 'rtx' }, txt(d.name || 'File', 'rn'), h('span', { class: 'rm' }, join(d.size ? C.fmtSize(d.size) : '', dropFrom(d.from), when)),
      h('span', { class: `wb wb-drop-${state}` }, DROP_STATE[state])),
  ];
  if (state === 'uploading') return h('div', { class: 'frow srow drow' }, kids);
  const open = () => openVia(() => st.client.dropLink(d.id), safeDl, () => {});
  return h('button', { class: 'frow srow drow', type: 'button', onclick: open }, kids, h('span', { class: 'ropen' }, icon('open', 'ic tiny'), 'Open'));
}
export function dropScreen() {
  const page = h('section', { class: 'page drop' }, pageHead('Send to the office', 'Drop box'));
  add(page, live(() => (st.up || !st.tried ? h('div', { hidden: true })
    : h('div', { class: 'callout amber' }, h('p', null, h('b', null, hubWord())), h('p', null, 'Files can be sent when the hub is back.'),
      h('button', { class: 'btn', type: 'button', onclick: () => beat() }, icon('refresh'), 'Try again')))));
  const card = h('div');
  mountHoop(card, {
    label: 'Drop box', hint: 'Photos, PDFs, drawings, anything', between: sectionChips(), soundSlot: SLOT.sound, storage: st.ctx.storage,
    check: checkFile,
    onFile: (file, row) => st.client.upload(file, { section: st.section, onProgress: (s, t) => row.progress(t ? s / t : 0) }).catch((e) => { noteErr(e); throw e; }),
    onDone: (_f, res) => { if (res && res.id) st.sentIds.add(res.id); loadDrops(); },
  });
  add(page, card,
    h('button', { class: 'btn wide drivebtn', type: 'button', onclick: () => openDrivePicker() }, driveLogo(), h('span', null, 'Add from Drive')),
    live(() => {
      const list = arr(st.drops).filter((d) => d && d.id && !st.sentIds.has(d.id));
      if (!list.length) return h('div', { class: 'drops' }, st.drops && st.up ? h('p', { class: 'small quiet' }, 'Nothing else has come in yet.') : null);
      return h('div', { class: 'drops' }, section(`Earlier drops · ${list.length}`, h('div', { class: 'files' }, list.map(dropRow))));
    }));
  loadDrops();
  return page;
}

// ---------- Drive: accounts, connect, the picker ----------
async function loadAccounts(quiet = false) {
  if (!hasKey() || st.accountsBusy) return;
  st.accountsBusy = true;
  try { const r = await st.client.driveAccounts(); st.accounts = arr(r && r.accounts).filter((a) => a && a.id); st.accountsCode = ''; }
  catch (e) { noteErr(e); st.accountsCode = e.code || 'down'; if (e.code === 'drive-not-set-up') st.accounts = null; }
  st.accountsBusy = false;
  if (!quiet) redraw();
}
function connectDrive(onFail) {
  st.waitConnect = true;
  openVia(() => st.client.driveConnect(), safeGoogle, (e) => { st.waitConnect = false; noteErr(e); onFail(e.message || HUB_WORDS.down); });
}
const connectBtn = (onFail, cls = 'btn wide') => h('button', { class: `${cls} drivebtn`, type: 'button', onclick: () => connectDrive(onFail) }, driveLogo(), h('span', null, 'Connect a Drive'));
function sheet(label, ...kids) {
  const veil = h('div', { class: 'veil' });
  const close = () => { veil.remove(); document.documentElement.classList.remove('locked'); };
  veil.addEventListener('click', (e) => { if (e.target === veil) close(); });
  const card = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, h('div', { class: 'sh-grip' }), kids);
  veil.append(card);
  document.body.append(veil);
  document.documentElement.classList.add('locked');
  return { veil, card, close };
}
/** Add from Drive: the connected Drives, folders, a search box; a tapped file goes into the drop box. */
export function openDrivePicker() {
  const P = { acct: '', trail: [{ id: 'root', name: 'My Drive' }], q: '', files: null, next: '', busy: false, err: '', added: new Map(), seq: 0 };
  const body = h('div', { class: 'dp-body' });
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search this Drive', 'aria-label': 'Search this Drive', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'search' });
  let t = 0;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { P.q = search.value.trim(); list(); }, 450); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { search.blur(); clearTimeout(t); P.q = search.value.trim(); list(); } });
  const searchBox = h('label', { class: 'sbox dp-search' }, icon('search', 'ic sic'), search);
  const s = sheet('Add from Drive', h('p', { class: 'kick' }, h('i'), 'Google Drive'), h('h3', { class: 'dp-title' }, driveLogo(), 'Add from Drive'), body,
    h('button', { class: 'btn ghost wide', type: 'button', onclick: () => s.close() }, 'Close'));
  const onAcc = () => { if (!s.veil.isConnected) { listeners.delete(onAcc); return; } draw(); };
  listeners.add(onAcc);

  async function list(more = false) {
    if (!P.acct) return;
    const my = ++P.seq;
    P.busy = true; P.err = ''; if (!more) { P.files = null; P.next = ''; }
    draw();
    try {
      const folder = P.q ? 'root' : P.trail[P.trail.length - 1].id;
      const r = await st.client.driveFiles(P.acct, { folder, q: P.q, page: more ? P.next : '' });
      if (my !== P.seq) return;
      const got = arr(r && r.files).filter((f) => f && f.id);
      P.files = more ? arr(P.files).concat(got) : got; P.next = String((r && r.next) || '');
    } catch (e) { if (my !== P.seq) return; noteErr(e); P.err = e.message || HUB_WORDS.down; P.files = P.files || []; }
    P.busy = false; draw();
  }
  async function addFile(f) {
    P.added.set(f.id, 'adding'); draw();
    try { const d = await st.client.driveAdd(P.acct, f.id, st.section); P.added.set(f.id, 'added'); if (d && d.id) st.drops = [d].concat(arr(st.drops).filter((x) => x.id !== d.id)); redraw(); }
    catch (e) { noteErr(e); P.added.set(f.id, e.message || HUB_WORDS.down); }
    draw();
  }
  function fileEl(f) {
    if (f.folder) return h('button', { class: 'frow dp-row', type: 'button', onclick: () => { P.trail.push({ id: f.id, name: f.name }); P.q = ''; search.value = ''; list(); } },
      h('span', { class: 'fext folder' }, icon('folder')), h('span', { class: 'rtx' }, txt(f.name || 'Folder', 'rn')), icon('chev', 'ic chev'));
    const ext = C.fileExt(f.name);
    const a = P.added.get(f.id);
    const end = a === 'added' ? chip('Added', 'ok') : a === 'adding' ? h('span', { class: 'spinner' }) : h('span', { class: 'dp-add' }, '+ Add');
    return h('button', { class: `frow dp-row${a === 'added' ? ' added' : ''}`, type: 'button', disabled: a === 'adding' || a === 'added', onclick: () => addFile(f) },
      h('span', { class: `fext ${C.fileKind(f.name) === 'pc-only' ? 'file' : C.fileKind(f.name)}` }, (ext || '?').toUpperCase().slice(0, 4)),
      h('span', { class: 'rtx' }, txt(f.name || 'File', 'rn'), h('span', { class: 'rm' }, join(f.size ? C.fmtSize(f.size) : '', f.modified ? C.fmtDay(f.modified) : '')),
        a && a !== 'added' && a !== 'adding' ? h('span', { class: 'rwhy err' }, a) : null),
      end);
  }
  function draw() {
    clear(body);
    const failed = (m) => body.append(h('p', { class: 'fs-status err' }, m));
    if (!st.up) { body.append(h('p', { class: 'fs-status' }, `${hubWord()}. Drive can be used when the hub is back.`)); return; }
    if (st.accountsCode === 'drive-not-set-up') { body.append(h('p', { class: 'fs-status' }, 'Drive is not set up yet.')); return; }
    if (st.accounts == null) { body.append(h('p', { class: 'wait' }, h('span', { class: 'spinner' }), 'Getting your Drives…')); if (!st.accountsBusy) loadAccounts(); return; }
    const accts = st.accounts;
    if (!accts.length) {
      body.append(h('p', { class: 'fs-sub' }, 'No Drive connected yet.'), h('div', { class: 'fs-acts' }, connectBtn(failed, 'btn pri wide')));
      return;
    }
    if (!P.acct || !accts.some((a) => a.id === P.acct)) { P.acct = accts[0].id; P.trail = [{ id: 'root', name: 'My Drive' }]; list(); return; }
    if (accts.length > 1) {
      body.append(h('div', { class: 'secchips dp-accts', role: 'radiogroup', 'aria-label': 'Drive' }, accts.map((a) => h('button', { class: 'secchip', type: 'button', role: 'radio', 'aria-checked': a.id === P.acct ? 'true' : 'false',
        onclick: () => { if (a.id === P.acct) return; P.acct = a.id; P.trail = [{ id: 'root', name: 'My Drive' }]; P.q = ''; search.value = ''; list(); } }, a.email || 'Drive'))));
    } else body.append(h('p', { class: 'fs-sub', dir: 'auto' }, accts[0].email || ''));
    body.append(searchBox);
    if (!P.q && P.trail.length > 1) {
      body.append(h('button', { class: 'back dp-up', type: 'button', onclick: () => { P.trail.pop(); list(); } }, icon('back'), h('span', null, P.trail[P.trail.length - 2].name)));
    }
    body.append(h('p', { class: 'showing' }, P.q ? `Search: ${P.q}` : P.trail[P.trail.length - 1].name));
    if (P.err) failed(P.err);
    const rows = h('div', { class: 'files dp-files' }, arr(P.files).map(fileEl));
    body.append(rows);
    if (P.busy) body.append(h('p', { class: 'wait' }, h('span', { class: 'spinner' }), 'Looking…'));
    else if (P.files && !P.files.length && !P.err) body.append(h('p', { class: 'small quiet' }, P.q ? 'Nothing found.' : 'This folder is empty.'));
    if (P.next && !P.busy) body.append(h('button', { class: 'btn wide showmore', type: 'button', onclick: () => list(true) }, 'Show more'));
    body.append(h('div', { class: 'fs-acts' }, connectBtn(failed)));
  }
  draw();
  if (st.up && st.accounts != null && st.accounts.length) list();
}

// ---------- the Drives screen ----------
const TAGS = [
  ['big', 'Big files', 'Holds the big files', 'The hub lists this Drive to find copies of office files.'],
  ['scraps', 'Scraps', 'Pieces to add by hand', 'Nothing is listed. Pick files from it in Add from Drive.'],
  ['skip', 'Skip', 'I don’t know', 'Stays connected. Nothing is listed. Tag it later.'],
];
async function tagDrive(a, tag) {
  const old = a.tag;
  a.tag = tag; st.rowMsg.delete(`drive:${a.id}`); redraw();
  try { await st.client.driveTag(a.id, tag); await loadAccounts(true); }
  catch (e) { a.tag = old; noteErr(e); st.rowMsg.set(`drive:${a.id}`, e.message || HUB_WORDS.down); }
  redraw();
}
function confirmForgetDrive(a) {
  const s = sheet('Forget this Drive',
    h('h3', { dir: 'auto' }, `Forget ${a.email || 'this Drive'}?`),
    h('p', { class: 'fs-sub' }, 'The hub stops reading it and drops its file list. Nothing in the Drive itself is touched.'),
    h('div', { class: 'fs-acts' },
      h('button', { class: 'btn pri wide', type: 'button', onclick: async () => {
        s.close();
        try { await st.client.driveForget(a.id); st.accounts = arr(st.accounts).filter((x) => x.id !== a.id); }
        catch (e) { noteErr(e); st.rowMsg.set(`drive:${a.id}`, e.message || HUB_WORDS.down); }
        redraw();
      } }, 'Forget'),
      h('button', { class: 'btn ghost wide', type: 'button', onclick: () => s.close() }, 'Keep')));
  s.card.querySelector('.btn.ghost').focus();
}
function scanLine(a) {
  const sc = a.scan || {};
  const n = Number(sc.files) || 0;
  if (sc.state === 'running') return `Listing… ${n.toLocaleString('en-GB')} files so far`;
  if (sc.state === 'done') return `Listed ${n.toLocaleString('en-GB')} files${sc.at ? ` · ${C.agoWords(C.toMs(sc.at))}` : ''}`;
  if (sc.state === 'failed') return 'Listing did not finish.';
  return 'Waiting to be listed';
}
function driveCard(a) {
  const msg = st.rowMsg.get(`drive:${a.id}`);
  const cur = TAGS.find((x) => x[0] === a.tag);
  return h('div', { class: 'drv' },
    h('div', { class: 'drv-h' }, driveLogo(), h('span', { class: 'rtx' }, txt(a.email || 'Drive', 'rn'), a.connectedAt ? h('span', { class: 'rm' }, `Connected ${C.fmtDay(a.connectedAt)}`) : null)),
    h('div', { class: 'tagchips', role: 'radiogroup', 'aria-label': `What ${a.email || 'this Drive'} holds` }, TAGS.map(([tag, title, line]) => h('button', {
      class: 'tagchip', type: 'button', role: 'radio', 'aria-checked': a.tag === tag ? 'true' : 'false', onclick: () => { if (a.tag !== tag) tagDrive(a, tag); },
    }, h('b', null, title), h('small', null, line)))),
    h('p', { class: 'drv-mean' }, cur ? cur[3] : 'Not tagged yet. Tap one.'),
    a.tag === 'big' ? h('p', { class: `drv-scan s-${(a.scan && a.scan.state) || 'none'}` }, (a.scan && a.scan.state === 'running') ? h('span', { class: 'spinner sm' }) : null, scanLine(a)) : null,
    msg ? h('p', { class: 'rwhy err', role: 'alert' }, msg) : null,
    h('button', { class: 'btn ghost drv-forget', type: 'button', onclick: () => confirmForgetDrive(a) }, 'Forget this Drive'));
}
export function drivesScreen() {
  const page = h('section', { class: 'page drives' }, pageHead('Google Drive', 'Drives'));
  const err = h('p', { class: 'rwhy err', role: 'alert', hidden: true });
  const failed = (m) => { err.hidden = false; err.textContent = m; };
  add(page, live(() => {
    const box = h('div', { class: 'drv-list' });
    if (!st.up) return add(box, h('div', { class: 'callout' }, h('p', null, h('b', null, hubWord())), h('p', null, 'Your Drives show here when the hub is back.')));
    if (st.accountsCode === 'drive-not-set-up') return add(box, h('p', { class: 'small quiet' }, 'Drive is not set up yet.'));
    if (st.accounts == null) { if (!st.accountsBusy) loadAccounts(); return add(box, h('p', { class: 'wait' }, h('span', { class: 'spinner' }), 'Getting your Drives…')); }
    if (!st.accounts.length) return add(box, h('p', { class: 'lede' }, 'No Drive connected yet. Connect one, then tell the hub what it holds.'), connectBtn(failed, 'btn pri wide'));
    return add(box, h('p', { class: 'lede' }, 'Tell the hub what each Drive holds.'), st.accounts.map(driveCard), connectBtn(failed));
  }), err);
  if (st.up && st.accounts == null) loadAccounts();
  return page;
}

// ---------- big files to the cloud: pause / resume the bulk upload (the office wifi is weak) ----------
async function loadSettings() {
  if (!hasKey()) return;
  try { const r = await st.client.settings(); st.settings = r && typeof r === 'object' ? r : {}; } catch (e) { noteErr(e); }
}
async function setUpload(value) {
  if (!st.up || st.settingsBusy) return;
  st.settingsBusy = value; st.settingsMsg = ''; redraw();
  try { const r = await st.client.setUpload(value); st.settings = r && typeof r === 'object' && r.upload ? r : { ...(st.settings || {}), upload: value }; st.settingsMsg = 'saved'; }
  catch (e) { noteErr(e); st.settingsMsg = e.message || HUB_WORDS.down; }
  st.settingsBusy = '';
  redraw();
}
/** The card under the Office server lights: three big chips, a tap sets the mode at once and shows the hub's answer. */
export function uploadCard(bigFiles) {
  return live(() => {
    const big = typeof bigFiles === 'function' ? bigFiles() : bigFiles;
    const U = C.uploadChoices(big, st.settings, st.up);
    const busy = st.settingsBusy;
    const said = st.settingsMsg === 'saved' && st.settings
      ? h('p', { class: 'drv-scan s-done' }, `Set${st.settings.at ? ` ${C.agoWords(C.toMs(st.settings.at))}` : ''}${st.settings.by ? ` from ${String(st.settings.by).split(':')[0]}` : ''}.`)
      : st.settingsMsg ? h('p', { class: 'rwhy err', role: 'alert' }, st.settingsMsg) : null;
    return h('div', { class: `drv upcard${U.greyed ? ' greyed' : ''}` },
      h('div', { class: 'drv-h' }, icon('server'), h('span', { class: 'rtx' }, h('span', { class: 'rn' }, 'Big files to the cloud'),
        h('span', { class: 'rm' }, U.greyed ? U.note : 'How much the office iMac sends'))),
      h('div', { class: 'tagchips', role: 'radiogroup', 'aria-label': 'Big files to the cloud' }, U.choices.map((c) => h('button', {
        class: `tagchip${busy === c.value ? ' busy' : ''}`, type: 'button', role: 'radio', 'aria-checked': c.on ? 'true' : 'false', disabled: U.greyed || !!busy,
        onclick: () => { if (!c.on) setUpload(c.value); },
      }, h('b', null, c.title), h('small', null, c.line)))),
      busy ? h('p', { class: 'drv-scan' }, h('span', { class: 'spinner sm' }), 'Telling the hub…') : said);
  });
}
