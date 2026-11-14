// The hub client (contract: docs/HUB.md). Plain logic with an injected fetch, so it is tested in Node.
// The phone logs in with the GitHub key it already holds (Authorization header only, never in a URL) and names itself
// with X-Hub-Device: <random id>|<label>. With no key there is no call at all.
import { HUB_URL } from './config.mjs';

export const MB = 1024 * 1024;
export const SINGLE_MAX = 32 * MB;          // up to this one PUT, else multipart
export const PART_SIZE = 16 * MB;           // the hub's part size unless it says otherwise
export const MAX_DROP = 5 * 1024 * MB;      // the hub refuses more
export const SECTIONS = [['project', 'Project'], ['customer', 'Customer'], ['quotation', 'Quotation'], ['drawing', 'Drawing'], ['profile', 'Profile'], ['other', 'Other']];
export const UPLOAD_MODES = ['recent', 'all', 'off'];
const SECTION_IDS = new Set(['', 'project', 'customer', 'quotation', 'drawing', 'profile', 'equipment', 'worker', 'farm', 'other']);

// ---------- errors in plain words ----------
export const HUB_WORDS = {
  nokey: 'No key on this phone.',
  offline: 'You’re offline.',
  down: 'The hub can’t be reached right now.',
  key: 'The hub did not accept this phone’s key.',
  denied: 'This phone may not do that.',
  missing: 'The hub does not have that.',
  conflict: 'The size did not match. Try again.',
  big: 'Too big for the drop box (over 5 GB).',
  busy: 'Too many tries. Wait a minute.',
  bad: 'The hub did not take that.',
  behind: 'Something behind the hub did not answer. Try again soon.',
  'drive-not-set-up': 'Drive is not set up yet.',
  parts: 'A piece did not arrive. Try again.',
  empty: 'The file is empty.',
};
export class HubError extends Error {
  constructor(code, message = '', status = 0) { super(message || HUB_WORDS[code] || HUB_WORDS.down); this.name = 'HubError'; this.code = code; this.status = status; }
}
const STATUS_CODE = { 400: 'bad', 401: 'key', 403: 'denied', 404: 'missing', 409: 'conflict', 413: 'big', 429: 'busy', 502: 'behind' };
/** An HTTP answer (status, parsed body or null) -> HubError with a short plain sentence. */
export function hubError(status, body) {
  const b = body && typeof body === 'object' ? body : {};
  const named = typeof b.error === 'string' && HUB_WORDS[b.error] ? b.error : '';
  const code = named || STATUS_CODE[status] || (status >= 500 ? 'down' : 'bad');
  // the hub's own message is plain words by contract; ours win for the codes we know, theirs for the rest of a 400 / 409
  const theirs = typeof b.message === 'string' && b.message.length <= 160 && !/[<>]/.test(b.message) ? b.message.trim() : '';
  const msg = named ? HUB_WORDS[named] : (code === 'bad' || code === 'missing') && theirs ? theirs : HUB_WORDS[code];
  return new HubError(code, msg, status);
}

// ---------- the device ----------
/** A short name for this device from its user agent. */
export function deviceLabel(ua = '') {
  const s = String(ua);
  if (/iPhone/.test(s)) return 'iPhone';
  if (/iPad/.test(s) || (/Macintosh/.test(s) && /Mobile/.test(s))) return 'iPad';
  if (/Android/.test(s)) return /Mobile/.test(s) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Mac OS X/.test(s)) return 'Mac';
  if (/Windows/.test(s)) return 'Windows';
  return 'Phone';
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
/** The X-Hub-Device value: a random id kept in storage (made once) and a label. */
export function deviceHeader(storage, slot, ua, random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  let id = '';
  try { id = storage.getItem(slot) || ''; } catch { /* blocked storage */ }
  if (!/^ph-[0-9a-f]{12}$/.test(id)) {
    id = `ph-${hex(random(6))}`;
    try { storage.setItem(slot, id); } catch { /* the id lives for this visit only */ }
  }
  return `${id}|${deviceLabel(ua)}`;
}

// ---------- the upload plan ----------
/** What the hub will answer for this size: 'single' up to 32 MB, else 'multipart'. */
export const expectMode = (size) => (size <= SINGLE_MAX ? 'single' : 'multipart');
/** -> [{ n, start, end }]: n 0 = the one PUT of a single upload; multipart parts count from 1. */
export function uploadPlan(size, mode = expectMode(size), partSize = PART_SIZE) {
  const total = Math.max(0, Number(size) || 0);
  if (mode !== 'multipart') return [{ n: 0, start: 0, end: total }];
  const ps = Math.max(5 * MB, Number(partSize) || PART_SIZE);
  const parts = [];
  for (let start = 0, n = 1; start < total; start += ps, n++) parts.push({ n, start, end: Math.min(total, start + ps) });
  return parts;
}
export const cleanSection = (s) => (SECTION_IDS.has(String(s || '')) ? String(s || '') : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryable = (e) => e && (e.code === 'down' || e.code === 'offline' || e.code === 'behind' || e.code === 'busy');

// ---------- the client ----------
/**
 * createHub({ key: () => string, fetchImpl, storage, ua, onLine, putImpl?, base?, wait? })
 * putImpl(url, { headers, body, onProgress }) -> { status, json } lets the browser use XHR for upload progress;
 * without it bytes go through fetchImpl.
 */
export function createHub(opts = {}) {
  const base = String(opts.base || HUB_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl || ((...a) => globalThis.fetch(...a));
  const onLine = opts.onLine || (() => globalThis.navigator?.onLine !== false);
  const wait = opts.wait || sleep;
  const keyOf = () => { const k = typeof opts.key === 'function' ? opts.key() : opts.key; return typeof k === 'string' ? k.trim() : ''; };
  const device = () => deviceHeader(opts.storage || { getItem: () => '', setItem() {} }, opts.slot || 'mmis.hubDevice', opts.ua || '');

  function headersFor(extra = {}) {
    const k = keyOf();
    if (!k) throw new HubError('nokey');
    return { Authorization: `Bearer ${k}`, 'X-Hub-Device': device(), ...extra };
  }
  async function call(method, path, { json, body, type = '' } = {}) {
    const headers = headersFor(json !== undefined ? { 'Content-Type': 'application/json' } : type ? { 'Content-Type': type } : {});
    if (!onLine()) throw new HubError('offline');
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, { method, headers, body: json !== undefined ? JSON.stringify(json) : body, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new HubError(onLine() ? 'down' : 'offline');
    }
    let data = null;
    try { const t = await res.text(); data = t ? JSON.parse(t) : null; } catch { data = null; }
    if (!res.ok) throw hubError(res.status, data);
    return data || {};
  }
  async function putBytes(path, blob, onProgress) {
    if (!opts.putImpl) return call('PUT', path, { body: blob, type: 'application/octet-stream' });
    const headers = headersFor({ 'Content-Type': 'application/octet-stream' });
    if (!onLine()) throw new HubError('offline');
    let r;
    try { r = await opts.putImpl(`${base}${path}`, { headers, body: blob, onProgress }); }
    catch { throw new HubError(onLine() ? 'down' : 'offline'); }
    if (!(r.status >= 200 && r.status < 300)) throw hubError(r.status, r.json);
    return r.json || {};
  }
  const enc = encodeURIComponent;

  const hub = {
    base,
    hasKey: () => !!keyOf(),
    // lights
    beat: (body = { app: 'phone-page', every: 60 }) => call('POST', '/beat', { json: body }),
    lights: () => call('GET', '/lights'),
    // the bulk upload of big files: 'off' | 'recent' | 'all' (the office wifi is weak, so it is paced from the phone)
    settings: () => call('GET', '/settings'),
    setUpload: (value) => {
      if (!UPLOAD_MODES.includes(value)) return Promise.reject(new HubError('bad'));
      return call('POST', '/settings', { json: { upload: value } });
    },
    // drop box
    inbox: () => call('GET', '/inbox'),
    dropLink: (id) => call('GET', `/inbox/${enc(id)}/link`),
    // files in the bucket and asks
    fileLink: (key, name = '') => call('POST', '/files/link', { json: { key, name } }),
    ask: (rec) => call('POST', '/asks', { json: { p: rec.p, s: Number(rec.s) || 0, m: Number(rec.m) || 0 } }),
    asks: () => call('GET', '/asks'),
    // Drive
    driveAccounts: () => call('GET', '/drive/accounts'),
    driveConnect: () => call('POST', '/drive/connect', { json: {} }),
    driveTag: (id, tag) => call('POST', `/drive/accounts/${enc(id)}/tag`, { json: { tag } }),
    driveForget: (id) => call('DELETE', `/drive/accounts/${enc(id)}`),
    driveFiles: (id, { folder = 'root', q = '', page = '' } = {}) => {
      const qs = new URLSearchParams({ folder: folder || 'root' });
      if (q) qs.set('q', q);
      if (page) qs.set('page', page);
      return call('GET', `/drive/accounts/${enc(id)}/files?${qs}`);
    },
    driveAdd: (id, fileId, section = '', note = '') => call('POST', `/drive/accounts/${enc(id)}/add`, { json: { fileId, section: cleanSection(section), note } }),
    driveFind: (items) => call('POST', '/drive/find', { json: { items: items.slice(0, 200).map((x) => ({ name: String(x.name || ''), size: Number(x.size) || 0 })) } }),

    /**
     * Sends one file to the drop box. file: a Blob with name/type. onProgress(sent, total) after each piece (and inside
     * a piece when putImpl reports it). Each multipart piece is tried up to `tries` times. -> the final answer { id, state }.
     */
    async upload(file, { section = '', note = '', onProgress = () => {}, tries = 3 } = {}) {
      const size = Number(file.size) || 0;
      if (!size) throw new HubError('empty');
      if (size > MAX_DROP) throw new HubError('big');
      const start = await call('POST', '/inbox', { json: { name: String(file.name || 'file'), size, type: String(file.type || ''), section: cleanSection(section), note: String(note || '') } });
      const id = String(start.id || '');
      if (!id) throw new HubError('bad');
      const plan = uploadPlan(size, start.mode === 'multipart' || start.mode === 'single' ? start.mode : expectMode(size), start.partSize);
      onProgress(0, size);
      if (plan[0].n === 0) {
        const r = await putBytes(`/inbox/${enc(id)}/data`, file, (sent) => onProgress(Math.min(size, sent), size));
        onProgress(size, size);
        return { id, state: r.state || 'ready' };
      }
      const done = [];
      let sent = 0;
      for (const part of plan) {
        const piece = file.slice(part.start, part.end);
        let lastErr = null;
        for (let t = 1; t <= tries; t++) {
          try {
            const r = await putBytes(`/inbox/${enc(id)}/part/${part.n}`, piece, (inPart) => onProgress(Math.min(size, sent + inPart), size));
            if (!r || !r.etag) throw new HubError('parts');
            done.push({ n: part.n, etag: String(r.etag) });
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (!(retryable(e) || e.code === 'parts') || t === tries) break;
            await wait(t * 1500);
          }
        }
        if (lastErr) throw lastErr;
        sent += part.end - part.start;
        onProgress(sent, size);
      }
      const fin = await call('POST', `/inbox/${enc(id)}/finish`, { json: { parts: done } });
      return { id, state: fin.state || 'ready' };
    },
  };
  return hub;
}

/** Upload with progress through XMLHttpRequest (browser only). Same answer shape as the fetch path. */
export function xhrPut(XHR) {
  return (url, { headers, body, onProgress }) => new Promise((resolve, reject) => {
    const x = new XHR();
    x.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.withCredentials = false;
    if (x.upload && onProgress) x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    x.onload = () => { let json = null; try { json = x.responseText ? JSON.parse(x.responseText) : null; } catch { json = null; } resolve({ status: x.status, json }); };
    x.onerror = () => reject(new Error('network'));
    x.onabort = () => reject(new Error('aborted'));
    x.send(body);
  });
}

// ---------- the drop list ----------
export const DROP_STATE = { uploading: 'Uploading', ready: 'At the hub', imported: 'In the app' };
export function dropFrom(from) {
  const s = String(from || '');
  if (s.startsWith('phone:')) return `from ${s.slice(6) || 'a phone'}`;
  if (s.startsWith('pc:')) return 'from the PC';
  if (s.startsWith('drive:')) return 'from Drive';
  return '';
}
