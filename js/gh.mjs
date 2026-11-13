// Reading the private data repo through GitHub's contents API with the key kept on this phone.
// Read-only by construction: this module only ever sends GET. The key travels only in the Authorization header,
// never in a URL, a cache key or a log.
import { API, DATA_REPO, MAX_FILE_BYTES } from './config.mjs';
import { contentsUrl, classify, cleanKey, ERRORS } from './core.mjs';

export class GhError extends Error {
  constructor(code, detail = '') { super(ERRORS[code] || ERRORS.down); this.name = 'GhError'; this.code = code; this.detail = detail; }
}

export const rate = { remaining: null, reset: 0 };

/**
 * GET one file of the data repo. -> { status: 200, body (text|Blob), etag } or { status: 304 } when `etag` still matches.
 * `as`: 'text' | 'blob'. `fetchImpl` is for tests.
 */
export async function getFile(rel, { key, etag = '', as = 'text', signal, fetchImpl = globalThis.fetch, onLine = () => globalThis.navigator?.onLine !== false } = {}) {
  const k = cleanKey(key);
  if (!k) throw new GhError('key');
  const url = contentsUrl(API, DATA_REPO, rel);
  if (!url) throw new GhError('missing', 'bad path');
  if (!onLine()) throw new GhError('offline');
  const headers = { Authorization: `Bearer ${k}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' };
  if (etag) headers['If-None-Match'] = etag;
  let res;
  try {
    res = await fetchImpl(url, { method: 'GET', headers, cache: 'no-store', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new GhError(onLine() ? 'down' : 'offline');
  }
  const rem = res.headers.get('x-ratelimit-remaining');
  if (rem != null) { rate.remaining = Number(rem); rate.reset = Number(res.headers.get('x-ratelimit-reset')) || 0; }
  if (res.status === 304) return { status: 304 };
  if (!res.ok) throw new GhError(classify(res.status, rem), String(res.status));
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > MAX_FILE_BYTES) throw new GhError('big');
  const body = as === 'blob' ? await res.blob() : await res.text();
  return { status: 200, body, etag: res.headers.get('etag') || '' };
}

/** Does this key open the snapshot? -> { ok, code?, message? } */
export async function tryKey(key, rel, opts = {}) {
  try { await getFile(rel, { ...opts, key }); return { ok: true }; }
  catch (e) { return { ok: false, code: e.code || 'down', message: e.message }; }
}
