// The phone page's rules with no DOM and no network: reading the snapshot (whole or split), search, URL building,
// labels, dates, money, phone numbers and the picture cache's eviction plan. Tested with node --test (test/phone-page-*.test.js).

// ---------- the snapshot ----------
export const AREAS = ['projects', 'customers', 'dues', 'suppliers', 'equipment', 'workforce', 'quotations', 'drawings'];
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
export const arr = (v) => (Array.isArray(v) ? v : []);

export class SnapshotError extends Error {
  constructor(message) { super(message); this.name = 'SnapshotError'; this.code = 'invalid'; }
}

/**
 * Turns the parsed `_phone/snapshot.json` into { version, madeAt, appVersion, split, areas }.
 * Split form: `loadPart(file)` returns the parsed `<area>.json` ({ version, madeAt, area, data }); a part that fails
 * becomes { error } for that area only. Every area is either its data object or { error: "..." }.
 */
export async function readSnapshot(entry, loadPart) {
  const e = obj(entry);
  if (!e || !obj(e.areas) || typeof e.madeAt !== 'string') throw new SnapshotError('The snapshot is not in the expected shape.');
  if (Number(e.version) > 1) { /* a newer writer: read what we know, the rest is ignored */ }
  const areas = {};
  for (const name of AREAS) {
    const raw = e.areas[name];
    if (e.split) {
      const ref = obj(raw);
      if (!ref || typeof ref.file !== 'string' || !/^[a-z]+\.json$/.test(ref.file)) { areas[name] = { error: ref && ref.error ? String(ref.error) : 'Not in this copy.' }; continue; }
      try {
        const part = obj(await loadPart(ref.file));
        if (!part || part.area !== name) throw new Error('the part file is for another area');
        areas[name] = shapeArea(part.data);
      } catch (err) { areas[name] = { error: `This part could not be read (${String((err && err.message) || err).slice(0, 120)}).` }; }
    } else {
      areas[name] = shapeArea(raw);
    }
  }
  return { version: Number(e.version) || 1, madeAt: e.madeAt, appVersion: String(e.appVersion || ''), split: !!e.split, areas };
}
function shapeArea(raw) {
  const a = obj(raw);
  if (!a) return { error: 'Not in this copy.' };
  if ('error' in a) return { error: String(a.error || 'The PC could not read this part.') };
  return a;
}
/** The data of one area, or null when it failed ({ error }). */
export const areaData = (snap, name) => { const a = snap && snap.areas && snap.areas[name]; return a && !a.error ? a : null; };
export const areaError = (snap, name) => { const a = snap && snap.areas && snap.areas[name]; return a && a.error ? a.error : ''; };

// ---------- paths -> API URLs ----------
/** 'Projects library/a b/photos/صورة.jpg' -> 'Projects%20library/a%20b/photos/%D8%B5...' ; '' for anything that climbs or is empty. */
export function encodeRel(rel) {
  if (typeof rel !== 'string') return '';
  const parts = rel.replace(/\\/g, '/').split('/').filter((p) => p !== '');
  if (!parts.length || parts.some((p) => p === '.' || p === '..')) return '';
  return parts.map((p) => encodeURIComponent(p.normalize('NFC'))).join('/');
}
export function contentsUrl(api, repo, rel) {
  const p = encodeRel(rel);
  return p ? `${api}/repos/${repo}/contents/${p}` : '';
}

// ---------- GitHub answers ----------
export const ERRORS = {
  key: 'That key is wrong or has expired.',
  access: 'This key can’t see the company data repo.',
  rate: 'GitHub’s hourly limit is used up. It resets within the hour.',
  offline: 'You’re offline.',
  down: 'GitHub can’t be reached right now.',
  missing: 'Only on the PC.',
  invalid: 'The copy from the PC can’t be read.',
  big: 'Too big to open on the phone (over 100 MB). Only on the PC.',
};
/** status (+ x-ratelimit-remaining) -> one of the ERRORS codes. For the snapshot itself a 404 means "access". */
export function classify(status, remaining) {
  if (status === 403 && String(remaining) === '0') return 'rate';
  if (status === 429) return 'rate';
  if (status === 401 || status === 403) return 'key';
  if (status === 404) return 'missing';
  return 'down';
}
export function cleanKey(t) {
  t = typeof t === 'string' ? t.trim() : '';
  return t && !/\s/.test(t) && t.length >= 20 && t.length < 400 ? t : '';
}

// ---------- search ----------
/** Lower case, no accents, Arabic letters folded (alef forms, ta marbuta, alef maqsura, tashkeel, tatweel), digits as Latin. */
export function fold(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
/** Every word of the query is somewhere in the fields. */
export function matches(query, fields) {
  const q = fold(query);
  if (!q) return true;
  const hay = fold(arr(fields).flat(3).filter((x) => x != null && x !== '').join(' \u0001 '));
  return q.split(' ').every((w) => hay.includes(w));
}
export function search(list, query, fieldsOf) {
  if (!fold(query)) return arr(list);
  return arr(list).filter((x) => matches(query, fieldsOf(x)));
}
// What each list searches: name, Arabic name, client and place, plus what is natural for the area.
export const SEARCH_FIELDS = {
  projects: (p) => [p.name, p.nameAr, p.client, p.location, p.year, p.consultant, p.contractor],
  customers: (c) => [c.name, c.nameAr, c.area, arr(c.contacts).map((x) => x.name)],
  dues: (g) => [g.customer && g.customer.name, g.customer && g.customer.nameAr, arr(g.dues).map((d) => [d.projectName, d.quotation, d.notes])],
  suppliers: (s) => [s.name, s.nameAr, s.families, s.makers, arr(s.contacts).map((x) => x.name)],
  equipment: (e) => [e.name, e.nameAr, e.type, e.model, e.plate, e.serial, e.maker, e.category, e.location, e.now && [e.now.customerName, e.now.customerText, e.now.site]],
  workforce: (w) => [w.name, w.nameAr, w.employeeNo, w.jobTitle, w.nationality],
  quotations: (q) => [q.number, q.ref, q.to, q.subject, q.customerName, q.projectName],
  drawings: (d) => [d.name, d.category, arr(d.copies).map((c) => [c.sourceName, c.folder])],
};

// ---------- labels (the app's own words) ----------
export const DIVISIONS = [
  ['bmu', 'Building maintenance units', 'مكائن نظافة الواجهات', 'BMU'],
  ['cradles', 'Electric cradles', 'سقالات كهربائية', 'Cradles'],
  ['platforms', 'Aerial work platforms', 'منصات العمل المرتفعة', 'AWP'],
  ['facade-cleaning', 'Façade cleaning', 'تنظيف الواجهات', 'Façade'],
  ['hoists-cranes', 'Construction hoists & tower cranes', 'مصعد إنشائي ورافعة برجية', 'Hoists'],
  ['factory', 'Factory', 'المصنع', 'Factory'],
  ['space-frames', 'Space frames & skylights', 'الهياكل الفراغية والمناور', 'Frames'],
  ['scaffolding', 'Steel scaffolding', 'السقالات المعدنية', 'Scaff.'],
  ['misting', 'Misting systems', 'تلطيف الجو', 'Misting'],
  ['steel-works', 'Steel works', 'الأعمال المعدنية', 'Steel'],
  ['workshop', 'Workshop & technical support', 'الورشة والدعم الفني', 'Shop'],
  ['aluminium', 'Aluminium, glass & cladding', 'الألمنيوم والزجاج والتكسيات', 'Alu'],
];
const DIV = Object.fromEntries(DIVISIONS.map(([id, en, ar, short]) => [id, { id, en, ar, short }]));
export const division = (id) => DIV[id] || { id, en: String(id || ''), ar: '', short: String(id || '') };
const lab = (pairs) => { const m = Object.fromEntries(pairs); return (v) => m[v] || (v ? String(v) : ''); };
export const equipStatus = lab([['rented', 'Rented'], ['free', 'Free'], ['unavailable', 'Not working'], ['internal', 'Workshop']]);
export const equipCondition = lab([['working', 'Working'], ['needs-repair', 'Needs repair'], ['out-of-service', 'Out of service']]);
export const workerStatus = lab([['active', 'Active'], ['on-leave', 'On leave'], ['left', 'Left']]);
export const workerLevel = lab([['weak', 'Weak'], ['average', 'Acceptable'], ['good', 'Good'], ['strong', 'Strong']]);
export const docKind = lab([['residency', 'Residency'], ['civil-id', 'Civil ID'], ['passport', 'Passport'], ['work-permit', 'Work permit'], ['other', 'Paper']]);
export const dueStatus = lab([['unpaid', 'Unpaid'], ['court', 'In court'], ['paid', 'Paid'], ['written-off', 'Written off']]);
export const paperKind = (k) => (k ? String(k).replace(/[-_]/g, ' ') : '');

// ---------- dates, money, sizes ----------
const DAY_MS = 864e5;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' (or an ISO time) -> '15 Mar 2021' with no time-zone shift for plain days. */
export function fmtDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const ms = toMs(v);
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function toMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 2e10 ? v * 1000 : v;
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : 0;
}
export function agoWords(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  const n = (v, w) => `${v} ${w}${v === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return n(Math.floor(s / 60), 'minute');
  if (s < 86400) return n(Math.floor(s / 3600), 'hour');
  return n(Math.floor(s / 86400), 'day');
}
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** "Changed 14:53 (2 hours ago)", "Changed yesterday 14:53 (19 hours ago)", "Changed Tue 11 Nov, 14:53 (3 days ago)". */
export function asOf(madeAt, now = Date.now()) {
  const ms = toMs(madeAt);
  if (!ms) return '';
  const d = new Date(ms), today = new Date(now), yest = new Date(now - DAY_MS);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = sameDay(d, today) ? '' : sameDay(d, yest) ? 'yesterday '
    : `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, `;
  return `Changed ${day}${clock} (${agoWords(ms, now)})`;
}
/** How old the copy is: 'fresh' (< 1 h), 'old' (< 1 day), 'stale'. */
export function ageLevel(madeAt, now = Date.now()) {
  const h = (now - toMs(madeAt)) / 3600000;
  return h < 1 ? 'fresh' : h < 24 ? 'old' : 'stale';
}
/** Whole days from today to 'YYYY-MM-DD' (negative = past). */
export function daysUntil(ymd, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return null;
  const t = new Date(now);
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / DAY_MS);
}
export function daysWords(days) {
  if (days == null || !Number.isFinite(days)) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
/** "1250.5" -> "1,250.500" (KWD, three decimals; strings only, no float maths). */
export function fmtKwd(v) {
  const s = String(v == null ? '' : v).replace(/,/g, '').trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || s === '') return String(v || '');
  const int = (m[2] || '0').replace(/^0+(?=\d)/, '');
  return `${m[1]}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${((m[3] || '') + '000').slice(0, 3)}`;
}
export const kwd = (v) => (v === '' || v == null ? '' : `KWD ${fmtKwd(v)}`);
export function fmtAge(age) {
  const y = (age && age.years) || 0, m = (age && age.months) || 0;
  if (!y && !m) return 'this month';
  return [y ? `${y} y` : '', m ? `${m} m` : ''].filter(Boolean).join(' ');
}
const MB = 1024 * 1024;
export function fmtSize(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b < 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < MB) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * MB) return `${(b / MB).toFixed(b < 10 * MB ? 1 : 0)} MB`;
  return `${(b / MB / 1024).toFixed(1)} GB`;
}

// ---------- phone numbers ----------
/** Like the app's normalisePhone, without throwing: digits with country code, or ''. */
export function phoneDigits(input) {
  let d = String(input == null ? '' : input).replace(/\D+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = `965${d}`;
  else if (d.length === 11 && d.startsWith('01')) d = `20${d.slice(1)}`;
  if (!d || d.startsWith('0') || d.length < 9 || d.length > 15) return '';
  return d;
}
/** Is it a mobile (so WhatsApp makes sense)? Kuwait 4/5/6/9, Egypt 1x, Saudi 5, UAE 5, Qatar 3/5/6/7, Bahrain 3, Oman 7/9. */
export function isMobile(d) {
  return /^965[4569]\d{7}$/.test(d) || /^201[0125]\d{8}$/.test(d) || /^9665\d{8}$/.test(d) || /^9715\d{8}$/.test(d)
    || /^974[3567]\d{7}$/.test(d) || /^9733\d{7}$/.test(d) || /^968[79]\d{7}$/.test(d);
}
/** -> { digits, display, tel, wa } or null. */
export function phoneInfo(raw) {
  const d = phoneDigits(raw);
  if (!d) return null;
  let display = `+${d}`;
  if (/^965\d{8}$/.test(d)) display = `+965 ${d.slice(3, 7)} ${d.slice(7)}`;
  else if (/^20\d{10}$/.test(d)) display = `+20 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  else if (/^9[67]\d{9,10}$/.test(d)) display = `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return { digits: d, display, tel: `tel:+${d}`, wa: isMobile(d) ? `https://wa.me/${d}` : '' };
}
export const phonesOf = (v) => arr(Array.isArray(v) ? v : v ? [v] : []).map((p) => (typeof p === 'object' && p ? p.number || p.phone || '' : p)).filter(Boolean);

// ---------- files ----------
const EXT = (rel) => { const m = /\.([a-z0-9]{1,6})$/i.exec(String(rel || '')); return m ? m[1].toLowerCase() : ''; };
const PC_ONLY = new Set(['mp4', 'mov', 'm4v', 'avi', 'mkv', 'wmv', 'webm', 'exe', 'msi', 'dmg', 'pkg', 'iso', 'apk', 'appx', 'msix']);
/** 'image' | 'pdf' | 'doc' | 'pc-only' | 'file' */
export function fileKind(rel) {
  const e = EXT(rel);
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif'].includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'txt', 'csv'].includes(e)) return 'doc';
  if (PC_ONLY.has(e) || e === '') return 'pc-only';
  return 'file';
}
export const fileExt = EXT;
export const baseName = (rel) => String(rel || '').split('/').pop();
export const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', txt: 'text/plain', csv: 'text/csv' };
/** A paper's file name without its date prefix and extension: '2010-01-20 GL test certificate.pdf' -> 'GL test certificate'. */
export function paperTitle(rel) {
  const n = baseName(rel).replace(/\.[a-z0-9]{1,6}$/i, '');
  return n.replace(/^\d{4}-\d{2}-\d{2}\s+/, '').trim() || n;
}
export const paperDate = (rel) => { const m = /^(\d{4}-\d{2}-\d{2})\s/.exec(baseName(rel)); return m ? m[1] : ''; };

// ---------- the picture cache: least recently used goes first ----------
/**
 * entries: [{ key, size, used }]. Returns { fits, evict: [keys] } so that total + incoming <= cap.
 * Something bigger than the whole cap is not kept (fits: false, nothing evicted).
 */
export function lruPlan(entries, cap, incoming) {
  const list = arr(entries).filter((e) => e && Number.isFinite(e.size));
  if (!(incoming >= 0) || incoming > cap) return { fits: false, evict: [] };
  let total = list.reduce((s, e) => s + e.size, 0);
  const evict = [];
  for (const e of list.slice().sort((a, b) => (a.used || 0) - (b.used || 0))) {
    if (total + incoming <= cap) break;
    evict.push(e.key); total -= e.size;
  }
  return { fits: true, evict };
}

// ---------- ordering ----------
/** Fleet: out on rent now first (overdue first, most overdue on top), then free, not working, workshop; by name inside. */
export function sortFleet(list) {
  const rank = (e) => (e.now ? (e.now.overdue ? 0 : 1) : ({ free: 2, unavailable: 3, internal: 4 }[e.status] ?? 5));
  const due = (e) => (e.now && e.now.expectedReturn ? e.now.expectedReturn : '9999');
  return arr(list).slice().sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 0 ? (b.now.days || 0) - (a.now.days || 0) : 0)
    || due(a).localeCompare(due(b)) || String(a.name || '').localeCompare(String(b.name || '')));
}
/** Workers: the paper that runs out first on top (expired first), people with no date at the end. */
export function sortWorkers(list) {
  const d = (w) => (w.nextExpiry && Number.isFinite(w.nextExpiry.days) ? w.nextExpiry.days : Infinity);
  return arr(list).slice().sort((a, b) => d(a) - d(b) || String(a.name || '').localeCompare(String(b.name || '')));
}
export function sortQuotes(list) {
  return arr(list).slice().sort((a, b) => String(b.date || b.created || '').localeCompare(String(a.date || a.created || '')) || String(b.number || '').localeCompare(String(a.number || '')));
}
// ---------- the office-server piece: `_phone/server.json` (contract: docs/SERVER-SYNC.md) ----------
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' ? String(v) : '');
const num = (v) => (Number.isFinite(Number(v)) && v !== '' && v !== null && typeof v !== 'boolean' ? Number(v) : 0);
const pickOf = (keys, kind) => (src) => Object.fromEntries(keys.map((k) => [k, kind[k] === 'n' ? num(src[k]) : str(src[k])]));
const FILE_KEYS = { p: 's', s: 'n', m: 'n', c: 's', g: 'n', d: 's', x: 's' };
function fileOf(r, keys = FILE_KEYS) {
  const o2 = obj(r);
  if (!o2 || typeof o2.p !== 'string' || !o2.p) return null;
  const out = pickOf(Object.keys(keys), keys)(o2);
  if ('g' in out) out.g = out.g === 1 ? 1 : 0;
  return out;
}
const RECENT_KEYS = { p: 's', s: 'n', m: 'n', g: 'n', d: 's', x: 's' };
const CUSTOMER_KEYS = { id: 's', name: 's', nameAr: 's', quotations: 'n', projects: 'n', last: 's' };
const QUOTE_KEYS = { id: 's', p: 's', year: 'n', number: 's', by: 's', ref: 's', date: 's', to: 's', subject: 's', project: 's', total: 's', customerId: 's', s: 'n', g: 'n', d: 's', x: 's' };
const PROJECT_KEYS = { id: 's', name: 's', path: 's', owner: 's', status: 's', records: 'n', onGitHub: 'n', onDrive: 'n', bytes: 'n', newest: 'n', customerId: 's', libraryId: 's' };
const KIND_KEYS = ['drawings', 'pdfs', 'docs', 'sheets', 'photos', 'other'];
const COUNT_KEYS = ['records', 'onGitHub', 'onDrive', 'serverOnly', 'gone', 'quotations', 'customers', 'projects'];
const BYTE_KEYS = ['server', 'onGitHub', 'budget', 'onDrive'];
const numsOf = (v, keys) => { const o2 = obj(v); return o2 ? Object.fromEntries(keys.filter((k) => k in o2).map((k) => [k, num(o2[k])])) : {}; };
const withId = (keys) => (r) => { const o2 = obj(r); if (!o2 || typeof o2.id !== 'string' || !o2.id) return null; return pickOf(Object.keys(keys), keys)(o2); };

/**
 * Validates the parsed `_phone/server.json` and keeps ONLY the fields of the contract (anything else is dropped).
 * Missing parts become empty lists / {} / null. Returns null when it is not the shape at all.
 */
export function readServer(json) {
  const e = obj(json);
  if (!e) return null;
  const big = obj(e.bigFiles);
  return {
    version: num(e.version) || 1, copiedAt: str(e.copiedAt), changedAt: str(e.changedAt), machine: str(e.machine),
    counts: numsOf(e.counts, COUNT_KEYS), bytes: numsOf(e.bytes, BYTE_KEYS),
    bigFiles: big ? { kind: str(big.kind), folder: str(big.folder), uploadedAt: str(big.uploadedAt), pending: num(big.pending), pendingBytes: num(big.pendingBytes) } : null,
    warnings: arr(e.warnings).map(obj).filter((w) => w && str(w.text)).map((w) => ({ at: str(w.at), text: str(w.text) })),
    latest: arr(e.latest).map((r) => fileOf(r)).filter(Boolean),
    customers: arr(e.customers).map(withId(CUSTOMER_KEYS)).filter(Boolean),
    quotations: arr(e.quotations).map((r) => { const q = withId(QUOTE_KEYS)(r); if (q) q.g = q.g === 1 ? 1 : 0; return q && q.p ? q : null; }).filter(Boolean),
    projects: arr(e.projects).map((r) => {
      const p = withId(PROJECT_KEYS)(r);
      if (!p) return null;
      const lq = obj(r.latestQuotation);
      p.kinds = numsOf(r.kinds, KIND_KEYS);
      p.latestDrawing = fileOf(r.latestDrawing, { p: 's', s: 'n', m: 'n', g: 'n', d: 's' });
      p.latestQuotation = lq && (str(lq.id) || str(lq.p)) ? { id: str(lq.id), p: str(lq.p), ref: str(lq.ref), date: str(lq.date), total: str(lq.total) } : null;
      p.recent = arr(r.recent).map((x) => fileOf(x, RECENT_KEYS)).filter(Boolean);
      return p;
    }).filter(Boolean),
  };
}
/** Reads the optional piece: anything that fails (404, bad JSON, wrong shape) is "no server copy" (null), never an error. */
export async function optionalServer(load) {
  try { return readServer(await load()); } catch { return null; }
}
/** How old the server copy is: 'fresh' (< 5 h), 'old' (< 26 h), 'stale', or 'never' (no copy). */
export function serverAge(copiedAt, now = Date.now()) {
  const ms = toMs(copiedAt);
  if (!ms) return 'never';
  const h = (now - ms) / 3600000;
  return h < 5 ? 'fresh' : h < 26 ? 'old' : 'stale';
}
/** "Server copy: 12:30 (2 hours ago)" or "Server copy: never". */
export function serverLine(copiedAt, now = Date.now()) {
  const t = asOf(copiedAt, now);
  return `Server copy: ${t ? t.replace(/^Changed /, '') : 'never'}`;
}
/** Where a file of the index lives: 'set' (in the Reference Set), 'drive' (cloud storage: "gd:<Drive id>" or "r2:<path>"), 'gone' (vanished, no copy), 'server' (only there). */
export function whereOf(row) {
  const r = obj(row) || {};
  if (Number(r.g) === 1) return 'set';
  if (r.d) return 'drive';
  if (r.x) return 'gone';
  return 'server';
}
export const WHERE = { set: 'In the set', drive: 'In cloud storage', server: 'Office server only', gone: 'Gone from the server' };
/** 'gd:<id>' -> the Drive viewer link; anything else (an 'r2:' path has no link yet, a bad id) -> ''. */
export function driveUrl(d) {
  const m = /^gd:([A-Za-z0-9_-]+)$/.exec(typeof d === 'string' ? d : '');
  return m ? `https://drive.google.com/file/d/${m[1]}/view` : '';
}
/** A server path's place in the data repo. */
export const setPath = (p) => `Office server/${p}`;
/**
 * The snapshot's customers joined with the server piece's by id: snapshot fields win; `server` = { quotations, projects, last }
 * or null; a customer only the server piece knows comes last (by name) with `serverOnly: true`.
 */
export function joinCustomers(snapList, serverList) {
  const side = new Map(arr(serverList).filter((c) => c && c.id).map((c) => [c.id, c]));
  const seen = new Set();
  const out = arr(snapList).map((c) => {
    seen.add(c.id);
    const s = side.get(c.id);
    return { ...c, server: s ? { quotations: s.quotations || 0, projects: s.projects || 0, last: s.last || '' } : null };
  });
  const extra = [...side.values()].filter((s) => !seen.has(s.id))
    .map((s) => ({ id: s.id, name: s.name || s.nameAr || s.id, nameAr: s.name ? s.nameAr : '', serverOnly: true, server: { quotations: s.quotations || 0, projects: s.projects || 0, last: s.last || '' } }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out.concat(extra);
}
const quoteKey = (q) => String(q.date || q.created || (q.year ? String(q.year) : ''));
/** The app's own quotations and the archive in one list, newest first; each row gets `archive: true|false`. */
export function mergeQuotes(appList, archiveList) {
  const all = arr(appList).map((q) => ({ ...q, archive: false })).concat(arr(archiveList).map((q) => ({ ...q, archive: true })));
  return all.sort((a, b) => quoteKey(b).localeCompare(quoteKey(a)) || (a.archive - b.archive) || String(b.number || '').localeCompare(String(a.number || '')) || String(b.p || '').localeCompare(String(a.p || '')));
}
/** One customer's side of the server piece: archive quotations (newest first) and projects. */
export function serverSide(server, customerId) {
  if (!server || !customerId) return { quotations: [], projects: [] };
  return {
    quotations: mergeQuotes([], server.quotations.filter((q) => q.customerId === customerId)),
    projects: server.projects.filter((p) => p.customerId === customerId),
  };
}
export const SERVER_SEARCH = {
  quotes: (q) => [q.number, q.ref, q.to, q.subject, q.project, q.year, q.customerName, q.projectName, q.archive ? baseName(q.p) : ''],
  projects: (p) => [p.name, p.owner, p.status, p.path],
};

/** Distinct years, newest first. */
export const yearsOf = (list) => [...new Set(arr(list).map((p) => p.year).filter((y) => y))].sort((a, b) => b - a);
export const divisionsOf = (list) => { const s = new Set(arr(list).flatMap((p) => arr(p.divisions).concat(p.division ? [p.division] : []))); return DIVISIONS.map((d) => d[0]).filter((id) => s.has(id)); };
export const hasArabic = (s) => /[؀-ۿ]/.test(String(s || ''));
