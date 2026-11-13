// The screens: the eight areas of the snapshot, each a searchable list and a detail page laid out for reading.
import * as C from './core.mjs';
import { add, h, clear, icon, txt, ar, kicker, pageHead, facts, section, chip, divChips, note, phoneRow, contactCard, row, join } from './dom.mjs';
import { thumb, openFile } from './media.mjs';

const { arr } = C;
const CHUNK = 60;

// ---------- shared list screen ----------
/**
 * A list with instant search, optional filters (native selects) and a segmented switch, rendered in chunks.
 * opts: { area, kick, title, items, fieldsOf, filters: [{ id, label, options: [[value, text]], test(item, value) }],
 *         seg, top, group(item) -> heading, rowOf(item), empty, placeholder }
 */
export function listScreen(ui, opts) {
  const st = ui.state(opts.stateKey || opts.area);
  const page = h('section', { class: 'page list' });
  add(page, pageHead(opts.kick, opts.title, opts.items.length, opts.seg || null));
  if (opts.top) add(page, opts.top);
  const input = h('input', { type: 'search', class: 'search', placeholder: opts.placeholder || 'Search', 'aria-label': opts.placeholder || 'Search',
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'search', value: st.q || '' });
  const clearBtn = h('button', { class: 'sclear', type: 'button', 'aria-label': 'Clear search', hidden: !st.q }, icon('close'));
  const selects = (opts.filters || []).map((f) => {
    const s = h('select', { class: 'select', 'aria-label': f.label },
      h('option', { value: '' }, f.all), f.options.map(([v, t]) => h('option', { value: String(v), selected: String(st[f.id] || '') === String(v) }, t)));
    s.addEventListener('change', () => { st[f.id] = s.value; s.classList.toggle('on', !!s.value); st.shown = 0; draw(); scrollTo(0, 0); });
    s.classList.toggle('on', !!st[f.id]);
    return s;
  });
  add(page, h('div', { class: 'tools' },
    h('label', { class: 'sbox' }, icon('search', 'ic sic'), input, clearBtn),
    selects.length ? h('div', { class: `filters n${selects.length}` }, selects) : null));
  const showing = h('p', { class: 'showing', 'aria-live': 'polite' });
  const body = h('div', { class: 'rows' });
  add(page, showing, body);

  let list = [], drawn = 0, sentinel = null;
  const more = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) drawMore(); }, { rootMargin: '600px 0px' });
  function filtered() {
    let items = opts.items;
    for (const f of opts.filters || []) if (st[f.id]) items = items.filter((x) => f.test(x, st[f.id]));
    return C.search(items, st.q, opts.fieldsOf);
  }
  function draw() {
    list = filtered();
    clear(body); drawn = 0;
    const n = list.length, all = opts.items.length;
    showing.textContent = n === all ? `${all} ${all === 1 ? opts.one || 'item' : opts.many || 'items'}` : `Showing ${n} of ${all}`;
    if (!n) { body.append(h('div', { class: 'empty' }, h('p', null, all ? 'Nothing matches. Try fewer words.' : opts.empty || 'Nothing here yet.'))); return; }
    drawMore(Math.max(CHUNK, st.shown || 0));
  }
  let lastGroup = null;
  function drawMore(count = CHUNK) {
    if (sentinel) { more.unobserve(sentinel); sentinel.remove(); sentinel = null; }
    if (drawn === 0) lastGroup = null;
    const end = Math.min(list.length, drawn + count);
    const frag = document.createDocumentFragment();
    for (let i = drawn; i < end; i++) {
      const it = list[i];
      if (opts.group) { const g = opts.group(it); if (g !== lastGroup) { frag.append(h('h3', { class: 'ghead' }, g)); lastGroup = g; } }
      frag.append(opts.rowOf(it));
    }
    body.append(frag);
    drawn = end; st.shown = drawn;
    if (drawn < list.length) { sentinel = h('div', { class: 'sentinel' }); body.append(sentinel); more.observe(sentinel); }
  }
  let t = 0;
  input.addEventListener('input', () => { clearTimeout(t); clearBtn.hidden = !input.value; t = setTimeout(() => { st.q = input.value; st.shown = 0; draw(); }, 80); });
  clearBtn.addEventListener('click', () => { input.value = ''; st.q = ''; clearBtn.hidden = true; st.shown = 0; draw(); input.focus(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  draw();
  return page;
}

/** A Fleet | Stock style switch made of links (hash routes, so Back works). */
export function segLinks(items, current) {
  return h('nav', { class: 'seg', 'aria-label': 'Show' }, items.map(([href, text, id]) => h('a', { href, 'aria-current': id === current ? 'page' : null }, text)));
}
function backBar(ui, fallback, label) {
  return h('div', { class: 'backbar' }, h('button', { class: 'back', type: 'button', onclick: () => ui.back(fallback) }, icon('back'), h('span', null, label)));
}
function detailPage(ui, { fallback, backLabel, kick, title, titleAr, chips, hero }) {
  const page = h('article', { class: 'page detail' });
  add(page, backBar(ui, fallback, backLabel));
  if (hero) add(page, hero);
  add(page, h('header', { class: 'dhead' }, kicker(kick), h('h1', { dir: 'auto' }, title || '—'), titleAr ? ar(titleAr, 'title-ar') : null, chips || null));
  return page;
}
export function notFound(ui, fallback, what) {
  const page = h('section', { class: 'page detail' }, backBar(ui, fallback, 'Back'));
  add(page, h('div', { class: 'empty' }, h('p', null, `This ${what} is not in the copy from the PC. It may be new since then, or removed.`)));
  return page;
}
export function areaFailed(kick, title, error) {
  return h('section', { class: 'page' }, pageHead(kick, title), h('div', { class: 'callout warn' },
    h('p', null, h('b', null, 'This part did not come through.'), ' The PC could not read it when it made this copy. The other parts are fine.'),
    h('p', { class: 'small' }, error)));
}
const linkTo = (href, text) => h('a', { class: 'inlink', href, dir: 'auto' }, text);
const fileRows = (files) => h('div', { class: 'files' }, files.map((f) => h('button', { class: 'frow', type: 'button', onclick: () => openFile(f.rel, { title: f.title, sub: f.sub }) },
  h('span', { class: `fext ${C.fileKind(f.rel)}` }, (C.fileExt(f.rel) || '?').toUpperCase().slice(0, 4)),
  h('span', { class: 'rtx' }, txt(f.title, 'rn'), f.sub ? h('span', { class: 'rm', dir: 'auto' }, f.sub) : null),
  icon('chev', 'ic chev'))));

// ---------- Projects ----------
export function projectsList(ui, snap) {
  const d = C.areaData(snap, 'projects');
  if (!d) return areaFailed('Projects', 'Projects', C.areaError(snap, 'projects'));
  const items = arr(d.list);
  return listScreen(ui, {
    area: 'projects', kick: 'Projects library', title: 'Projects', items, one: 'project', many: 'projects',
    placeholder: 'Search name, client, place', fieldsOf: C.SEARCH_FIELDS.projects,
    filters: [
      { id: 'div', label: 'Division', all: 'All divisions', options: C.divisionsOf(items).map((id) => [id, C.division(id).en]), test: (p, v) => arr(p.divisions).includes(v) },
      { id: 'year', label: 'Year', all: 'All years', options: C.yearsOf(items).map((y) => [y, String(y)]), test: (p, v) => String(p.year) === v },
    ],
    rowOf: (p) => row({
      href: `#/projects/${encodeURIComponent(p.id)}`,
      thumb: thumb(p.cover, { label: arr(p.divisions).length ? C.division(p.divisions[0]).short : '' }),
      title: p.name, titleAr: p.nameAr,
      meta: join(p.client, p.year),
      meta2: p.location || '',
      end: p.paperCount ? h('span', { class: 'rcount', title: 'Papers' }, icon('file', 'ic tiny'), String(p.paperCount)) : null,
    }),
  });
}
export function projectPage(ui, snap, id, sub) {
  const d = C.areaData(snap, 'projects');
  if (!d) return areaFailed('Projects', 'Projects', C.areaError(snap, 'projects'));
  const p = (d.records || {})[id] || arr(d.list).find((x) => x.id === id);
  if (!p) return notFound(ui, '#/projects', 'project');
  const photos = arr(p.photos).filter((x) => x.rel);
  if (sub && sub[0] === 'photo') ui.viewer(photos.map((x) => ({ rel: x.rel, caption: x.caption })), Number(sub[1]) || 0, `#/projects/${encodeURIComponent(id)}`);
  const hero = photos.length ? heroBlock(photos, `#/projects/${encodeURIComponent(id)}`) : null;
  const page = detailPage(ui, { fallback: '#/projects', backLabel: 'Projects', kick: join('Project', p.year), title: p.name, titleAr: p.nameAr, chips: divChips(p.divisions), hero });
  const cust = p.customerId ? arr((C.areaData(snap, 'customers') || {}).list).find((c) => c.id === p.customerId) : null;
  const owner = p.owner === 'medmac' ? 'Medmac' : p.owner === 'other' ? (p.ownerFor || 'Someone else') : p.owner ? 'The customer' : '';
  add(page, 
    facts([
      ['Client', cust ? linkTo(`#/customers/${encodeURIComponent(cust.id)}`, p.client || cust.name) : p.client],
      ['Year', p.year], ['Place', p.location], ['Scope', p.scope], ['Consultant', p.consultant], ['Contractor', p.contractor],
      ['Equipment belongs to', owner],
      ['Documented', p.documented ? 'Yes, checked' : ''],
    ]),
    arr(p.missing).length ? h('div', { class: 'callout amber' }, h('p', null, h('b', null, 'Missing: '), arr(p.missing).join(', '))) : null,
    p.openQuestions ? h('div', { class: 'callout amber' }, h('p', null, `${p.openQuestions} open question${p.openQuestions === 1 ? '' : 's'} about this project's papers. Answer them on the PC.`)) : null,
    section('Notes', note(p.notes)),
    section('People', arr(p.people).map((x) => contactCard(x))),
    section(`Papers${arr(p.papers).length ? ` · ${arr(p.papers).length}` : ''}`, arr(p.papers).length ? fileRows(arr(p.papers).filter((x) => x.rel).map((x) => ({
      rel: x.rel, title: C.paperTitle(x.rel), sub: join(C.paperKind(x.kind), C.fmtDay(C.paperDate(x.rel)))
    }))) : null),
    section('Drawing versions', arr(p.drawings).map((v) => h('div', { class: 'line' + (p.finalVersion && v.id === p.finalVersion ? ' final' : '') },
      h('span', { class: 'rtx' }, txt(v.label || v.fileName || 'Version', 'rn'), h('span', { class: 'rm', dir: 'auto' }, join(v.fileName !== v.label ? v.fileName : '', v.note))),
      p.finalVersion && v.id === p.finalVersion ? chip('Final', 'ok') : null))),
    componentsBlock(p),
  );
  return page;
}
function componentsBlock(p) {
  const rows = arr(p.components);
  if (!rows.length) return null;
  const t = p.componentTotals || {};
  return section(`Components · ${rows.length}`,
    t.all ? h('div', { class: 'totals' },
      h('div', null, h('small', null, 'All'), h('b', null, C.kwd(t.all))),
      h('div', null, h('small', null, 'Bought'), h('b', null, C.kwd(t.bought))),
      h('div', null, h('small', null, 'To buy'), h('b', null, C.kwd(t.toBuy)))) : null,
    rows.map((c) => h('div', { class: 'line' },
      h('span', { class: 'rtx' }, txt(c.item || 'Item', 'rn'), h('span', { class: 'rm', dir: 'auto' }, join(c.spec, c.quantity ? `${c.quantity} ${c.unit || ''}`.trim() : '', c.supplier))),
      h('span', { class: 'lend' }, c.total ? h('b', null, C.fmtKwd(c.total)) : null, chip(c.bought ? 'Bought' : 'To buy', c.bought ? 'ok' : '')))));
}
function heroBlock(photos, base) {
  const first = photos[0];
  const big = h('a', { class: 'hero', href: `${base}/photo/0`, 'aria-label': `Open photo 1 of ${photos.length}` }, thumb(first.rel, { cls: 'thumb hero-img', full: true }),
    photos.length > 1 ? h('span', { class: 'hero-n' }, icon('photo', 'ic tiny'), `${photos.length}`) : null);
  const strip = photos.length > 1 ? h('div', { class: 'strip' }, photos.slice(1, 12).map((x, i) => h('a', { href: `${base}/photo/${i + 1}`, 'aria-label': `Open photo ${i + 2}` }, thumb(x.rel)))) : null;
  return h('div', { class: 'heroes' }, big, strip);
}

// ---------- Customers ----------
export function customersList(ui, snap, mode) {
  const d = C.areaData(snap, 'customers');
  if (!d) return areaFailed('Customers', 'Customers', C.areaError(snap, 'customers'));
  const seg = segLinks([['#/customers', 'Companies', 'co'], ['#/customers/people', 'People', 'people']], mode === 'people' ? 'people' : 'co');
  if (mode === 'people') {
    const items = arr(d.people);
    return listScreen(ui, {
      area: 'people', kick: 'Customers', title: 'People', items, seg, one: 'person', many: 'people', placeholder: 'Search name, company, phone',
      empty: 'No contacts in the copy from the PC.',
      fieldsOf: (x) => [x.contact && x.contact.name, x.customerName, x.customerNameAr, x.contact && (x.contact.roleText || x.contact.role), C.phonesOf(x.contact && x.contact.phones)],
      rowOf: (x) => h('div', { class: 'prow' }, contactCard(x.contact, h('a', { class: 'inlink small', href: `#/customers/${encodeURIComponent(x.customerId)}`, dir: 'auto' }, x.customerName || ''))),
    });
  }
  const items = arr(d.list);
  return listScreen(ui, {
    area: 'customers', kick: 'Customers', title: 'Customers', items, seg, one: 'company', many: 'companies', placeholder: 'Search name, area, contact',
    empty: 'No customers in the copy from the PC yet.',
    fieldsOf: C.SEARCH_FIELDS.customers,
    filters: [{ id: 'div', label: 'Division', all: 'All divisions', options: C.divisionsOf(items).map((id) => [id, C.division(id).en]), test: (c, v) => arr(c.divisions).includes(v) }],
    rowOf: (c) => row({
      href: `#/customers/${encodeURIComponent(c.id)}`, title: c.name, titleAr: c.nameAr,
      meta: join(c.kindText || '', c.area, arr(c.contacts).length ? `${arr(c.contacts).length} contact${arr(c.contacts).length === 1 ? '' : 's'}` : ''),
      meta2: Number(String(c.unpaidTotal || '0').replace(/,/g, '')) > 0 ? h('span', { class: 'rm amber' }, `${C.kwd(c.unpaidTotal)} unpaid`) : null,
    }),
  });
}
export function customerPage(ui, snap, id) {
  const d = C.areaData(snap, 'customers');
  if (!d) return areaFailed('Customers', 'Customers', C.areaError(snap, 'customers'));
  const c = arr(d.list).find((x) => x.id === id);
  if (!c) return notFound(ui, '#/customers', 'customer');
  const page = detailPage(ui, { fallback: '#/customers', backLabel: 'Customers', kick: 'Customer', title: c.name, titleAr: c.nameAr, chips: divChips(c.divisions) });
  const projects = arr((C.areaData(snap, 'projects') || {}).list).filter((p) => p.customerId === c.id);
  const quotes = arr((C.areaData(snap, 'quotations') || {}).list).filter((q) => q.customerId === c.id);
  const open = arr(c.dues).filter((x) => x.status === 'unpaid' || x.status === 'court');
  add(page, 
    Number(String(c.unpaidTotal || '0').replace(/,/g, '')) > 0 ? h('div', { class: 'owed' }, h('small', null, 'Unpaid'), h('b', null, C.kwd(c.unpaidTotal)), c.oldestUnpaid ? h('span', null, `oldest due ${C.fmtDay(c.oldestUnpaid)}`) : null) : null,
    facts([['Kind', c.kindText || c.kind], ['Size', cap(c.size)], ['Area', c.area], ['Status', cap(c.status)]]),
    section('Notes', note(c.notes)),
    section(`Contacts${arr(c.contacts).length ? ` · ${arr(c.contacts).length}` : ''}`, arr(c.contacts).map((x) => contactCard(x))),
    section('Dues', arr(c.dues).length ? h('div', { class: 'dues' }, arr(c.dues).map((x) => dueRow(x, snap))) : null),
    section('Projects', projects.map((p) => row({ href: `#/projects/${encodeURIComponent(p.id)}`, thumb: thumb(p.cover, { label: arr(p.divisions).length ? C.division(p.divisions[0]).short : '' }), title: p.name, titleAr: p.nameAr, meta: join(p.year, p.location) }))),
    section('Quotations', quotes.map((q) => quoteRow(q))),
    section('Files', arr(c.files).filter((f) => f.rel).length ? fileRows(arr(c.files).filter((f) => f.rel).map((f) => ({ rel: f.rel, title: f.name || C.baseName(f.rel), sub: join(f.kind, C.fmtDay(f.added), f.note) }))) : null),
  );
  if (!open.length && !arr(c.dues).length) { /* nothing owed: no dues section */ }
  return page;
}

// ---------- Dues ----------
function dueRow(x, snap) {
  const proj = x.projectName || (x.projectId ? ((C.areaData(snap, 'projects') || {}).records || {})[x.projectId]?.name : '') || '';
  const age = x.age ? C.fmtAge(x.age) : '';
  return h('div', { class: `due s-${x.status || 'unpaid'}` },
    h('div', { class: 'due-top' }, h('b', { class: 'amt' }, C.kwd(x.amount)), chip(C.dueStatus(x.status), `st-${x.status || 'unpaid'}`)),
    h('p', { class: 'due-for', dir: 'auto' }, proj ? (x.projectId ? linkTo(`#/projects/${encodeURIComponent(x.projectId)}`, proj) : proj) : 'No project named'),
    h('p', { class: 'due-when' }, join(x.dueDate ? `Due ${C.fmtDay(x.dueDate)}` : '', age && (x.status === 'unpaid' || x.status === 'court') ? `${age} old` : '')),
    x.quotation && x.quotation.rel ? h('button', { class: 'qlink', type: 'button', onclick: () => openFile(x.quotation.rel, { title: x.quotation.name || C.baseName(x.quotation.rel), sub: 'Quotation' }) }, icon('file', 'ic tiny'), x.quotation.name || C.baseName(x.quotation.rel)) : null,
    note(x.notes));
}
export function duesScreen(ui, snap, which) {
  const d = C.areaData(snap, 'dues');
  if (!d) return areaFailed('Dues', 'Dues', C.areaError(snap, 'dues'));
  const status = which === 'court' ? 'court' : 'unpaid';
  const groups = arr(d[status]);
  const seg = segLinks([['#/dues', `Unpaid · ${arr(d.unpaid).length}`, 'unpaid'], ['#/dues/court', `In court · ${arr(d.court).length}`, 'court']], status);
  const sumFils = groups.reduce((s, g) => s + Math.round(Number(String(g.total || '0').replace(/,/g, '')) * 1000), 0);
  const top = groups.length ? h('div', { class: 'owed big' }, h('small', null, status === 'court' ? 'In court' : 'Owed to Medmac'), h('b', null, C.kwd((sumFils / 1000).toFixed(3))),
    h('span', null, `${groups.length} compan${groups.length === 1 ? 'y' : 'ies'} · oldest first`)) : null;
  return listScreen(ui, {
    area: 'dues', stateKey: `dues-${status}`, kick: 'Customers', title: 'Dues', items: groups, seg, top, one: 'company', many: 'companies',
    placeholder: 'Search company or project', fieldsOf: C.SEARCH_FIELDS.dues,
    empty: status === 'court' ? 'Nothing in court. Good.' : 'Nobody owes anything in this copy.',
    rowOf: (g) => {
      const cu = g.customer && typeof g.customer === 'object' ? g.customer : { name: String(g.customer || '') };
      return h('div', { class: 'dgroup' },
        h('a', { class: 'dg-head', href: cu.id ? `#/customers/${encodeURIComponent(cu.id)}` : null },
          h('span', { class: 'rtx' }, txt(cu.name || 'Customer', 'rn'), cu.nameAr ? ar(cu.nameAr, 'rar') : null, h('span', { class: 'rm' }, `oldest due ${C.fmtDay(g.oldest)}`)),
          h('span', { class: 'dg-total' }, h('small', null, 'Total'), h('b', null, C.kwd(g.total)))),
        h('div', { class: 'dues' }, arr(g.dues).map((x) => dueRow({ status, ...x }, snap))));
    },
  });
}

// ---------- Suppliers ----------
export function suppliersList(ui, snap) {
  const d = C.areaData(snap, 'suppliers');
  if (!d) return areaFailed('Suppliers', 'Suppliers', C.areaError(snap, 'suppliers'));
  return listScreen(ui, {
    area: 'suppliers', kick: 'Suppliers', title: 'Suppliers', items: arr(d.list), one: 'supplier', many: 'suppliers', placeholder: 'Search name, maker, family',
    fieldsOf: C.SEARCH_FIELDS.suppliers,
    rowOf: (s) => row({ href: `#/suppliers/${encodeURIComponent(s.id)}`, title: s.name, titleAr: s.nameAr,
      meta: join(arr(s.families).map(cap), s.specCount ? `${s.specCount} spec sheet${s.specCount === 1 ? '' : 's'}` : ''),
      meta2: arr(s.makers).length && arr(s.makers).join(', ') !== s.name ? `Makers: ${arr(s.makers).join(', ')}` : '' }),
  });
}
const cap = (s) => (/^(bmu|awp|dxf|dwg)$/i.test(String(s)) ? String(s).toUpperCase() : String(s || '').replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()));
export function supplierPage(ui, snap, id) {
  const d = C.areaData(snap, 'suppliers');
  const s = d && arr(d.list).find((x) => x.id === id);
  if (!s) return notFound(ui, '#/suppliers', 'supplier');
  const page = detailPage(ui, { fallback: '#/suppliers', backLabel: 'Suppliers', kick: 'Supplier', title: s.name, titleAr: s.nameAr,
    chips: arr(s.families).length ? h('div', { class: 'chips' }, arr(s.families).map((f) => chip(cap(f), 'div'))) : null });
  add(page, 
    facts([['Makers', arr(s.makers).join(', ')], ['Spec sheets', s.specCount ? `${s.specCount} on the PC's spec shelf` : '']]),
    section('Notes', note(s.notes)),
    section('Contacts', arr(s.contacts).map((x) => contactCard(x))),
  );
  return page;
}

// ---------- Equipment ----------
export function equipmentScreen(ui, snap, mode) {
  const d = C.areaData(snap, 'equipment');
  if (!d) return areaFailed('Equipment', 'Equipment', C.areaError(snap, 'equipment'));
  const fleet = arr(d.fleet), stock = arr(d.stock), ov = d.overview || {};
  const seg = segLinks([['#/equipment', `Fleet · ${fleet.length}`, 'fleet'], ['#/equipment/stock', `Stock · ${stock.length}`, 'stock']], mode === 'stock' ? 'stock' : 'fleet');
  if (mode === 'stock') {
    return listScreen(ui, {
      area: 'stock', kick: 'Fleet and stock', title: 'Equipment', items: stock, seg, one: 'item', many: 'items', placeholder: 'Search name, category, place',
      empty: 'No stock items in the copy from the PC.', fieldsOf: C.SEARCH_FIELDS.equipment,
      top: ov.stock ? statLine([[ov.stock.items, 'items'], [ov.stock.units, 'units'], [ov.stock.slow, 'slow to sell']]) : null,
      rowOf: (e) => row({ href: `#/equipment/${encodeURIComponent(e.id)}`, thumb: e.photo && e.folderRel ? thumb(`${e.folderRel}/${e.photo}`) : null,
        title: e.name, titleAr: e.nameAr, meta: join(cap(e.category), e.location), end: e.quantity != null && e.quantity !== '' ? h('span', { class: 'qty' }, h('b', null, String(e.quantity)), h('small', null, 'qty')) : null }),
    });
  }
  const f = ov.fleet || {};
  const sorted = C.sortFleet(fleet);
  const groupOf = (e) => (e.now ? (e.now.overdue ? 'Overdue, still out' : 'Out on rent now') : ({ free: 'Free', unavailable: 'Not working', internal: 'In the workshop' }[e.status] || 'Other'));
  return listScreen(ui, {
    area: 'fleet', kick: 'Fleet and stock', title: 'Equipment', items: sorted, seg, one: 'machine', many: 'machines', placeholder: 'Search name, model, plate',
    fieldsOf: C.SEARCH_FIELDS.equipment, group: groupOf,
    top: statLine([[f.rented ?? sorted.filter((e) => e.now).length, 'out on rent'], [f.free, 'free'], [f.unavailable, 'not working'], [f.internal, 'workshop']], ov.stale ? ov.staleLine : ''),
    filters: [{ id: 'st', label: 'Status', all: 'Every status', options: [['out', 'Out on rent'], ['free', 'Free'], ['unavailable', 'Not working'], ['internal', 'Workshop']],
      test: (e, v) => (v === 'out' ? !!e.now : !e.now && e.status === v) }],
    rowOf: (e) => row({
      href: `#/equipment/${encodeURIComponent(e.id)}`, cls: e.now && e.now.overdue ? 'overdue' : '',
      thumb: e.photo && e.folderRel ? thumb(`${e.folderRel}/${e.photo}`) : null,
      title: e.name, titleAr: e.nameAr,
      meta: e.now ? h('span', { class: 'rm', dir: 'auto' }, `With ${e.now.customerName || e.now.customerText || 'a customer'}${e.now.site ? ` at ${e.now.site}` : ''}`) : join(e.model, e.plate),
      meta2: e.now ? h('span', { class: `rm ${e.now.overdue ? 'red' : ''}` }, e.now.expectedReturn ? `${e.now.overdue ? 'Was due back' : 'Back'} ${C.fmtDay(e.now.expectedReturn)}` : `Out since ${C.fmtDay(e.now.start)}`) : '',
      end: e.now ? chip(e.now.overdue ? "Overdue" : `${e.now.days || 0} days`, e.now.overdue ? 'red' : 'amber') : null,
    }),
  });
}
function statLine(pairs, warn) {
  const items = pairs.filter(([n]) => n != null);
  return h('div', { class: 'stats' }, items.map(([n, w]) => h('div', { class: 'stat' }, h('b', null, String(n)), h('small', null, w))),
    warn ? h('p', { class: 'stats-warn' }, warn) : null);
}
export function equipmentPage(ui, snap, id, sub) {
  const d = C.areaData(snap, 'equipment');
  const e = d && (arr(d.fleet).find((x) => x.id === id) || arr(d.stock).find((x) => x.id === id));
  if (!e) return notFound(ui, '#/equipment', 'machine');
  const base = `#/equipment/${encodeURIComponent(id)}`;
  const photo = e.photo && e.folderRel ? `${e.folderRel}/${e.photo}` : '';
  if (sub && sub[0] === 'photo' && photo) ui.viewer([{ rel: photo, caption: e.name }], 0, base);
  const page = detailPage(ui, { fallback: e.kind === 'stock' ? '#/equipment/stock' : '#/equipment', backLabel: e.kind === 'stock' ? 'Stock' : 'Fleet',
    kick: e.kind === 'stock' ? 'Stock item' : join('Fleet', cap(e.type)), title: e.name, titleAr: e.nameAr,
    hero: photo ? heroBlock([{ rel: photo }], base) : null,
    chips: h('div', { class: 'chips' }, e.kind === 'stock' ? null : chip(e.now ? (e.now.overdue ? 'Overdue' : 'Out on rent') : C.equipStatus(e.status), e.now ? (e.now.overdue ? 'red' : 'amber') : e.status === 'free' ? 'ok' : ''),
      e.division ? chip(C.division(e.division).en, 'div') : null, e.forRent ? chip('For rent', 'div') : null) });
  if (e.now) {
    add(page, h('div', { class: `callout ${e.now.overdue ? 'red' : 'amber'}` },
      h('p', { class: 'big', dir: 'auto' }, `With ${e.now.customerName || e.now.customerText || 'a customer'}`),
      h('p', { dir: 'auto' }, join(e.now.site, `since ${C.fmtDay(e.now.start)}`, `${e.now.days || 0} days`)),
      e.now.expectedReturn ? h('p', null, h('b', null, `${e.now.overdue ? 'Was due back' : 'Due back'} ${C.fmtDay(e.now.expectedReturn)}`)) : null,
      e.now.customerId ? linkTo(`#/customers/${encodeURIComponent(e.now.customerId)}`, 'Open the customer') : null));
  }
  add(page, 
    facts(e.kind === 'stock'
      ? [['Category', cap(e.category)], ['Quantity', e.quantity], ['Where', e.location], ['In stock since', C.fmtDay(e.since)], ['Asking price', e.askingPrice ? C.kwd(e.askingPrice) : '']]
      : [['Model', e.model], ['Maker', join(e.maker, e.country)], ['Made', e.madeYear], ['Serial', e.serial], ['Plate', e.plate], ['Condition', C.equipCondition(e.condition)], ['Last returned', C.fmtDay(e.lastReturned)]]),
    section('Notes', note(e.notes)),
    section('Rentals', arr(e.rentals).slice().reverse().map((r) => h('div', { class: 'line' },
      h('span', { class: 'rtx' }, txt(r.customerText || 'Customer', 'rn'), h('span', { class: 'rm', dir: 'auto' }, join(r.site, `${C.fmtDay(r.start)} – ${r.returned ? C.fmtDay(r.returned) : 'still out'}`))),
      r.returned ? chip('Back', 'ok') : chip('Out', 'amber')))),
  );
  return page;
}

// ---------- Workforce ----------
function expiryChip(w) {
  const x = w.nextExpiry;
  if (!x || x.days == null) return null;
  const k = x.days < 0 ? 'red' : x.days <= 30 ? 'amber' : '';
  return h('span', { class: `exp ${k}` }, h('small', null, C.docKind(x.kind)), h('b', null, x.days < 0 ? `${-x.days} d late` : x.days === 0 ? 'today' : `${x.days} d`));
}
export function workforceList(ui, snap) {
  const d = C.areaData(snap, 'workforce');
  if (!d) return areaFailed('Workforce', 'Workforce', C.areaError(snap, 'workforce'));
  const items = C.sortWorkers(arr(d.list));
  return listScreen(ui, {
    area: 'workforce', kick: 'Workforce', title: 'Workers', items, one: 'worker', many: 'workers', placeholder: 'Search name, number, trade',
    empty: 'No workers in the copy from the PC yet.', fieldsOf: C.SEARCH_FIELDS.workforce,
    top: items.length ? h('p', { class: 'lede' }, 'The paper that runs out first is on top.') : null,
    filters: [{ id: 'st', label: 'Status', all: 'Every status', options: [['active', 'Active'], ['on-leave', 'On leave'], ['left', 'Left']], test: (w, v) => w.status === v }],
    rowOf: (w) => row({ href: `#/workforce/${encodeURIComponent(w.id)}`, title: w.name, titleAr: w.nameAr,
      meta: join(w.jobTitle, w.nationality), meta2: w.status && w.status !== 'active' ? C.workerStatus(w.status) : '', end: expiryChip(w) }),
  });
}
export function workerPage(ui, snap, id) {
  const d = C.areaData(snap, 'workforce');
  const w = d && arr(d.list).find((x) => x.id === id);
  if (!w) return notFound(ui, '#/workforce', 'worker');
  const page = detailPage(ui, { fallback: '#/workforce', backLabel: 'Workers', kick: join('Worker', w.employeeNo ? `No. ${w.employeeNo}` : ''), title: w.name, titleAr: w.nameAr,
    chips: h('div', { class: 'chips' }, chip(C.workerStatus(w.status) || 'Active', w.status === 'active' || !w.status ? 'ok' : ''), w.teamLeader ? chip('Team leader', 'div') : null) });
  const x = w.nextExpiry;
  if (x && x.expiry) {
    const k = x.days < 0 ? 'red' : x.days <= 30 ? 'amber' : '';
    add(page, h('div', { class: `callout ${k}` }, h('p', { class: 'big' }, `${C.docKind(x.kind)} ${x.days < 0 ? 'ran out' : 'runs out'} ${C.daysWords(x.days)}`), h('p', null, C.fmtDay(x.expiry))));
  }
  add(page, 
    facts([['Trade', w.jobTitle], ['Level', C.workerLevel(w.level)], ['Nationality', w.nationality], ['Joined', C.fmtDay(w.joinDate)], ['Employee number', w.employeeNo],
      ['Papers already expired', w.expired ? String(w.expired) : '']]),
    section('Phone', phoneRow(w.phones)),
    h('p', { class: 'small quiet' }, 'Pay, advances, attendance and document numbers stay on the PC.'),
  );
  return page;
}

// ---------- Quotations ----------
function quoteRow(q) {
  return row({ href: `#/quotations/${encodeURIComponent(q.id)}`, title: q.subject || q.number || 'Quotation', meta: join(q.number, q.to), meta2: C.fmtDay(q.date || q.created),
    end: q.total ? h('span', { class: 'amtcol' }, C.fmtKwd(q.total)) : null });
}
export function quotationsList(ui, snap) {
  const d = C.areaData(snap, 'quotations');
  if (!d) return areaFailed('Quotations', 'Quotations', C.areaError(snap, 'quotations'));
  const items = C.sortQuotes(arr(d.list));
  return listScreen(ui, { area: 'quotations', kick: 'Quotations', title: 'Quotations', items, one: 'quotation', many: 'quotations', placeholder: 'Search number, customer, subject',
    empty: 'No quotations made in the app yet.', fieldsOf: C.SEARCH_FIELDS.quotations, rowOf: quoteRow });
}
export function quotationPage(ui, snap, id) {
  const d = C.areaData(snap, 'quotations');
  const q = d && arr(d.list).find((x) => x.id === id);
  if (!q) return notFound(ui, '#/quotations', 'quotation');
  const page = detailPage(ui, { fallback: '#/quotations', backLabel: 'Quotations', kick: join('Quotation', q.number), title: q.subject || q.number });
  const proj = q.projectId ? ((C.areaData(snap, 'projects') || {}).records || {})[q.projectId] : null;
  const cust = q.customerId ? arr((C.areaData(snap, 'customers') || {}).list).find((c) => c.id === q.customerId) : null;
  const files = Object.entries(q.files && typeof q.files === 'object' ? q.files : {}).filter(([, rel]) => typeof rel === 'string' && rel);
  add(page, 
    q.total ? h('div', { class: 'owed' }, h('small', null, 'Total'), h('b', null, C.kwd(q.total))) : null,
    facts([['To', q.to], ['Customer', cust ? linkTo(`#/customers/${encodeURIComponent(cust.id)}`, cust.name) : ''], ['Project', proj ? linkTo(`#/projects/${encodeURIComponent(proj.id)}`, proj.name) : ''],
      ['Number', q.number], ['Reference', q.ref], ['Date', C.fmtDay(q.date || q.created)]]),
    section('Files', files.length ? fileRows(files.map(([kind, rel]) => ({ rel, title: C.baseName(rel), sub: kind.toUpperCase() }))) : null),
    h('p', { class: 'small quiet' }, 'Line items and prices stay on the PC.'),
  );
  return page;
}

// ---------- Drawings ----------
export function drawingsList(ui, snap) {
  const d = C.areaData(snap, 'drawings');
  if (!d) return areaFailed('Drawings', 'Drawings', C.areaError(snap, 'drawings'));
  const s = d.summary || {};
  const cats = Object.entries(s.byCategory || {}).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] : 1;
  const top = h('div', { class: 'dsum' },
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', null, (s.total || 0).toLocaleString('en-GB')), h('small', null, 'drawings')),
      Object.entries(s.byExt || {}).map(([k, n]) => h('div', { class: 'stat' }, h('b', null, n.toLocaleString('en-GB')), h('small', null, k.toUpperCase())))),
    cats.length ? h('div', { class: 'bars' }, cats.slice(0, 8).map(([k, n]) => h('div', { class: 'bar' },
      h('span', { class: 'bl' }, cap(k)), h('span', { class: 'bt' }, h('i', { style: { width: `${Math.max(2, Math.round((n / max) * 100))}%` } })), h('span', { class: 'bn' }, n.toLocaleString('en-GB'))))) : null,
    h('p', { class: 'small quiet' }, `Below: the first ${s.shown || arr(d.list).length} of ${(s.total || 0).toLocaleString('en-GB')}. The drawing files themselves are on the PC.${s.indexedAt ? ` Indexed ${C.fmtDay(s.indexedAt)}.` : ''}`));
  return listScreen(ui, { area: 'drawings', kick: 'Drawing index', title: 'Drawings', items: arr(d.list), top, one: 'drawing', many: 'drawings', placeholder: 'Search name, folder',
    fieldsOf: C.SEARCH_FIELDS.drawings,
    filters: [{ id: 'cat', label: 'Kind', all: 'Every kind', options: cats.map(([k]) => [k, cap(k)]), test: (x, v) => x.category === v }],
    rowOf: (x) => row({ href: `#/drawings/${encodeURIComponent(x.id)}`, thumb: h('span', { class: `fext ${x.ext}` }, String(x.ext || '').toUpperCase()), title: x.name,
      meta: join(cap(x.category), C.fmtSize(x.size), x.mtime ? C.fmtDay(x.mtime) : ''), meta2: x.copyCount > 1 ? `${x.copyCount} copies` : '' }) });
}
export function drawingPage(ui, snap, id) {
  const d = C.areaData(snap, 'drawings');
  const x = d && arr(d.list).find((r) => r.id === id);
  if (!x) return notFound(ui, '#/drawings', 'drawing');
  const page = detailPage(ui, { fallback: '#/drawings', backLabel: 'Drawings', kick: join('Drawing', String(x.ext || '').toUpperCase()), title: x.name,
    chips: h('div', { class: 'chips' }, chip(cap(x.category), 'div'), x.corrected ? chip('Corrected', 'ok') : null, x.hasPreview ? chip('Preview on the PC', '') : null) });
  add(page, 
    facts([['Size', C.fmtSize(x.size)], ['Last changed', x.mtime ? C.fmtDay(x.mtime) : ''], ['Copies', x.copyCount ? `${x.copyCount} place${x.copyCount === 1 ? '' : 's'} on the PC` : '']]),
    section('Where it is kept', arr(x.copies).map((c) => h('div', { class: 'line' }, h('span', { class: 'rtx' }, txt(c.sourceName || 'Source', 'rn'), h('span', { class: 'rm path', dir: 'auto' }, c.folder || ''))))),
    h('div', { class: 'callout' }, h('p', null, icon('pc', 'ic tiny'), ' The drawing file is only on the PC. Open it there, or through the live link.')),
  );
  return page;
}

// ---------- More ----------
export function moreScreen(ui, snap, info) {
  const n = (area, f) => { const d = C.areaData(snap, area); return d ? f(d) : null; };
  const areas = [
    ['suppliers', 'Suppliers', n('suppliers', (d) => arr(d.list).length)],
    ['workforce', 'Workforce', n('workforce', (d) => arr(d.list).length)],
    ['quotations', 'Quotations', n('quotations', (d) => arr(d.list).length)],
    ['drawings', 'Drawings', n('drawings', (d) => (d.summary && d.summary.total) || arr(d.list).length)],
  ];
  const page = h('section', { class: 'page more' }, pageHead('Medmac Internal System', 'More'));
  add(page, h('nav', { class: 'tiles', 'aria-label': 'More areas' }, areas.map(([id, label, count]) => h('a', { class: 'tile', href: `#/${id}` },
    icon(id, 'ic tile-ic'), h('span', { class: 'tile-l' }, label), h('span', { class: 'tile-n' }, count == null ? 'not in this copy' : count.toLocaleString('en-GB'))))));
  add(page, h('section', { class: 'about' },
    h('h2', null, 'This copy'),
    h('p', { class: 'ro' }, icon('lock', 'ic tiny'), 'Read-only copy. Changes are made on the PC or through the live link.'),
    facts([['Last change on the PC', snap ? C.asOf(snap.madeAt, Date.now()).replace(/^Changed /, '') : ''], ['Last checked', info.checkedAt ? C.agoWords(info.checkedAt) : 'not yet'],
      ['App version', snap && snap.appVersion], ['Kept on this phone', info.cache], ['Key', info.keyFrom === 'launcher' ? 'the MK Launcher key on this phone' : 'pasted on this phone']]),
    h('div', { class: 'about-btns' },
      h('button', { class: 'btn wide', type: 'button', onclick: info.refresh }, icon('refresh'), 'Check for a newer copy'),
      h('button', { class: 'btn danger wide', type: 'button', onclick: info.forget }, 'Forget this phone')),
    h('p', { class: 'small quiet' }, 'Forget removes the key and everything this page kept on the phone.')));
  return page;
}
