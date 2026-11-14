// Small DOM helpers and the shared pieces every screen uses (rows, facts, phones, chips, icons).
import { phoneInfo, phonesOf, hasArabic, division } from './core.mjs';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(5)) if (c != null && c !== false && c !== '') el.append(c.nodeType ? c : String(c));
  return el;
}
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

// Line icons, drawn for this page (1.6 px strokes on a 24 grid). Constant strings only.
const P = {
  projects: '<path d="M4 20.5h16M6 20.5V8.5l6-4 6 4v12M9.5 20.5v-5h5v5M9.5 11h.01M14.5 11h.01"/>',
  customers: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.6 14.8c1.6.7 2.6 2.2 2.9 4.7"/>',
  dues: '<rect x="4.5" y="3.5" width="15" height="17" rx="1"/><path d="M8 8h8M8 11.5h8M8 15h4.5"/>',
  equipment: '<path d="M4 20.5h16M7 20.5V6.5l5-3 5 3"/><path d="M7 6.5h13M17 6.5v5"/><path d="M15.5 11.5h3v3h-3z"/><path d="M7 10.5l4-4M7 14.5l4-4M7 18.5l4-4"/>',
  more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  suppliers: '<path d="M3.5 7.5h11v9h-11zM14.5 10.5h3.5l2.5 3v3h-6"/><circle cx="7.5" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>',
  workforce: '<path d="M5 13.5a7 7 0 0 1 14 0"/><path d="M3.5 13.5h17v2h-17zM10 6.5h4v3"/>',
  quotations: '<path d="M6.5 3.5h8l3 3v14h-11z"/><path d="M14.5 3.5v3h3M9 11h6M9 14h6M9 17h3.5"/>',
  drawings: '<path d="M3.5 5.5h17v13h-17z"/><path d="M6.5 15.5l4-6 3 4 2-2.5 2.5 4.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  phone: '<path d="M7.5 3.5h-2a1.5 1.5 0 0 0-1.5 1.6C4.6 13 11 19.4 18.9 20a1.5 1.5 0 0 0 1.6-1.5v-2.3l-4-1.6-2 2a12 12 0 0 1-6.1-6.1l2-2-1.6-4z"/>',
  wa: '<path d="M4.5 19.5l1.2-3.6A7.8 7.8 0 1 1 8.4 18.5z"/><path d="M9.3 8.8c.3 2.9 2.6 5.3 5.6 5.7l1.1-1.2-1.6-.9-.8.8a4.6 4.6 0 0 1-2.4-2.4l.8-.8-.9-1.6z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="1"/><path d="M4 6.5l8 6 8-6"/>',
  file: '<path d="M6.5 3.5h8l3 3v14h-11z"/><path d="M14.5 3.5v3h3"/>',
  pc: '<rect x="3.5" y="4.5" width="17" height="11" rx="1"/><path d="M9 19.5h6M12 15.5v4"/>',
  offline: '<path d="M3 3l18 18M8.5 16.2a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 4.2-2.4M19 12.6a10 10 0 0 0-3.3-2.1M2 9a14 14 0 0 1 4-2.6M22 9a14 14 0 0 0-9.4-3.5"/><circle cx="12" cy="19.5" r=".6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  save: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  open: '<path d="M13.5 4.5h6v6M19.5 4.5l-8 8M17.5 13.5v6h-13v-13h6"/>',
  server: '<rect x="4.5" y="3.5" width="15" height="7" rx="1"/><rect x="4.5" y="13.5" width="15" height="7" rx="1"/><path d="M8 7h.01M8 17h.01M12 7h4M12 17h4"/>',
  photo: '<rect x="3.5" y="5.5" width="17" height="13" rx="1"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>',
};
export function icon(name, cls = 'ic') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
  s.innerHTML = P[name] || '';
  return s;
}

/** A value that may be Arabic: shaped right-to-left with the Arabic face. */
export const txt = (v, cls = '') => h('span', { class: cls, dir: 'auto', lang: hasArabic(v) && !/[A-Za-z]/.test(v) ? 'ar' : null }, String(v));
export const ar = (v, cls = 'ar') => (v ? h('span', { class: cls, dir: 'rtl', lang: 'ar' }, String(v)) : null);

export function kicker(text, n) {
  return h('p', { class: 'kick' }, h('i'), text, n != null ? h('span', { class: 'kick-n' }, String(n)) : null);
}
export function pageHead(kick, title, count, extra) {
  return h('header', { class: 'phead' }, kicker(kick), h('div', { class: 'phead-row' }, h('h1', null, title), count != null ? h('span', { class: 'count' }, String(count)) : null), extra || null);
}

/** Facts as a reading list: label over value; empty values are left out. Values may be nodes. */
export function facts(pairs) {
  const rows = pairs.filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length));
  if (!rows.length) return null;
  return h('dl', { class: 'facts' }, rows.map(([k, v]) => h('div', { class: 'fact' }, h('dt', null, k), h('dd', null, v && v.nodeType ? v : txt(String(v))))));
}
export function section(title, ...kids) {
  const body = kids.flat(3).filter((k) => k != null && k !== false);
  if (!body.length) return null;
  return h('section', { class: 'dsec' }, h('h2', null, title), body);
}
export const chip = (text, kind = '') => h('span', { class: `chip ${kind}`.trim() }, text);
export const divChips = (ids) => (ids && ids.length ? h('div', { class: 'chips' }, ids.map((id) => chip(division(id).en, 'div'))) : null);
export const note = (text) => (text ? h('p', { class: 'note', dir: 'auto' }, String(text)) : null);

/** Phone numbers as big tap targets: Call, and WhatsApp for mobiles. */
export function phoneRow(phones) {
  const list = phonesOf(phones).map(phoneInfo).filter(Boolean);
  if (!list.length) return null;
  return h('div', { class: 'phones' }, list.map((p) => h('div', { class: 'phone' },
    h('a', { class: 'pcall', href: p.tel, 'aria-label': `Call ${p.display}` }, icon('phone'), h('span', { class: 'pnum' }, p.display)),
    p.wa ? h('a', { class: 'pwa', href: p.wa, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `WhatsApp ${p.display}` }, icon('wa'), h('span', null, 'WhatsApp')) : null)));
}
export function contactCard(c, extra) {
  if (!c) return null;
  const role = c.roleText || c.role || '';
  return h('div', { class: 'contact' },
    h('div', { class: 'ct-who' }, txt(c.name || 'No name', 'ct-name'), role ? h('span', { class: 'ct-role' }, role) : null, extra || null),
    phoneRow(c.phones || c.phone),
    c.email ? h('a', { class: 'pmail', href: `mailto:${c.email}` }, icon('mail'), h('span', null, c.email)) : null,
    c.notes ? note(c.notes) : null);
}

/** One list row: link, optional thumb, title (+ Arabic), up to three meta lines, and an end column. */
export function row({ href, thumb, title, titleAr, meta, meta2, meta3, end, cls = '' }) {
  return h('a', { class: `row ${cls}`.trim(), href },
    thumb || null,
    h('span', { class: 'rtx' },
      txt(title || '—', 'rn'),
      titleAr ? ar(titleAr, 'rar') : null,
      meta ? (meta.nodeType ? meta : h('span', { class: 'rm', dir: 'auto' }, meta)) : null,
      meta2 ? (meta2.nodeType ? meta2 : h('span', { class: 'rm', dir: 'auto' }, meta2)) : null,
      meta3 ? (meta3.nodeType ? meta3 : h('span', { class: 'rm', dir: 'auto' }, meta3)) : null),
    end ? h('span', { class: 'rend' }, end) : null,
    icon('chev', 'ic chev'));
}
export const dot = ' · ';
export const join = (...parts) => parts.flat().filter((x) => x != null && x !== '').join(dot);
/** append() that skips null/false (DOM append would write the word "null"). */
export function add(el, ...kids) { for (const c of kids.flat(5)) if (c != null && c !== false && c !== '') el.append(c); return el; }
