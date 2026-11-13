// What this phone keeps between visits, in IndexedDB (never in the service worker's HTTP cache):
//  - "snap":  the last good snapshot files, keyed by their path in the data repo, with their ETag.
//  - "files": photos, papers and small thumbnails, keyed by path, capped at FILE_CACHE_CAP (least recently used goes first).
// When IndexedDB is not available (a private window) everything still works, held in memory for this visit only.
import { DB_NAME, FILE_CACHE_CAP } from './config.mjs';
import { lruPlan } from './core.mjs';

let dbp = null;
const mem = { snap: new Map(), files: new Map() };

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('snap')) db.createObjectStore('snap');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbp;
}
const done = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function get(store, key) {
  const db = await open();
  if (!db) return mem[store].get(key);
  try { return await done(db.transaction(store).objectStore(store).get(key)); } catch { return mem[store].get(key); }
}
async function put(store, key, value) {
  const db = await open();
  mem[store].set(key, value); // also in memory, so a failed write (storage full) still serves this visit
  if (!db) return;
  try { await done(db.transaction(store, 'readwrite').objectStore(store).put(value, key)); } catch { /* full or blocked */ }
}
async function del(store, keys) {
  for (const k of keys) mem[store].delete(k);
  const db = await open();
  if (!db || !keys.length) return;
  try { const os = db.transaction(store, 'readwrite').objectStore(store); await Promise.all(keys.map((k) => done(os.delete(k)))); } catch { /* gone */ }
}

// ---------- snapshot ----------
export const getSnap = (path) => get('snap', path);
export const putSnap = (path, rec) => put('snap', path, rec);

// ---------- files (LRU) ----------
let index = null; // key -> { size, used }
async function loadIndex() {
  if (index) return index;
  index = new Map();
  const db = await open();
  if (!db) return index;
  await new Promise((resolve) => {
    try {
      const cur = db.transaction('files').objectStore('files').openCursor();
      cur.onsuccess = () => { const c = cur.result; if (!c) return resolve(); index.set(c.key, { size: c.value.size || 0, used: c.value.used || 0 }); c.continue(); };
      cur.onerror = () => resolve();
    } catch { resolve(); }
  });
  return index;
}
export async function getFileBlob(key) {
  const rec = await get('files', key);
  if (!rec || !rec.blob) return null;
  const idx = await loadIndex();
  const used = Date.now();
  if (idx.has(key)) idx.get(key).used = used;
  if (used - (rec.used || 0) > 60000) put('files', key, { ...rec, used }); // touch at most once a minute
  return rec.blob;
}
export async function putFileBlob(key, blob, cap = FILE_CACHE_CAP) {
  const idx = await loadIndex();
  idx.delete(key);
  const plan = lruPlan([...idx].map(([k, v]) => ({ key: k, ...v })), cap, blob.size);
  if (!plan.fits) return false;
  await del('files', plan.evict);
  for (const k of plan.evict) idx.delete(k);
  const used = Date.now();
  await put('files', key, { blob, size: blob.size, used, type: blob.type });
  idx.set(key, { size: blob.size, used });
  return true;
}
export async function cacheBytes() {
  const idx = await loadIndex();
  let n = 0; for (const v of idx.values()) n += v.size; return n;
}

/** Forget this phone: drop the whole database and the in-memory copies. */
export async function wipe() {
  mem.snap.clear(); mem.files.clear(); index = null;
  const db = await dbp;
  try { if (db) db.close(); } catch { /* closed */ }
  dbp = null;
  await new Promise((resolve) => {
    try { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => resolve(); } catch { resolve(); }
  });
}
