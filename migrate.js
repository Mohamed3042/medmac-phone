// The old address (https://mohamed3042.github.io/medmac-phone/) shares one browser origin with every other github.io page
// of this account, so anything stored here could be read by any of them. This page removes what the old phone page kept
// and sends the visitor to its own origin. It never touches other apps' keys (mkl.*, mkc.*, ...).
(function (root) {
  'use strict';
  var NEW_ORIGIN = 'https://medmac-phone.job-orbit-cloud.workers.dev';
  var PREFIX = 'mmis.';              // every key the old phone page wrote: mmis.key, mmis.keyFrom, mmis.noBorrow, mmis.ui, ...
  var DB_NAME = 'medmac-phone';      // its IndexedDB (cached snapshot, photos, papers)
  var CACHE_PREFIX = 'mmis-shell-';  // its service-worker caches; other pages' caches are left alone

  function clearStorage(ls) {
    var gone = [];
    try {
      var keys = [];
      for (var i = 0; i < ls.length; i++) keys.push(ls.key(i));
      keys.forEach(function (k) { if (k && k.indexOf(PREFIX) === 0) { ls.removeItem(k); gone.push(k); } });
    } catch (e) { /* storage blocked: nothing to clear */ }
    return gone;
  }
  // "#/projects" style routes only; anything else (a stray fragment) is dropped, so nothing odd is forwarded
  function target(hash) {
    return NEW_ORIGIN + '/' + (/^#\/[A-Za-z0-9_\/-]{0,80}$/.test(hash || '') ? hash : '');
  }
  // The old phone page was served from this path; every other page on the origin (Launcher Backup, Cinema, ...) has its own
  // scope and keeps its service worker.
  var OLD_SCOPE_PATH = '/medmac-phone/';
  function isOldPhoneScope(scope) {
    try { var p = new URL(scope).pathname; return p === OLD_SCOPE_PATH || p.indexOf(OLD_SCOPE_PATH) === 0; } catch (e) { return false; }
  }
  function cleanup(env) {
    var gone = clearStorage(env.localStorage);
    var jobs = [];
    try { if (env.indexedDB) jobs.push(new Promise(function (r) { var q = env.indexedDB.deleteDatabase(DB_NAME); q.onsuccess = q.onerror = q.onblocked = function () { r(); }; })); } catch (e) { /* ignore */ }
    try {
      if (env.caches) jobs.push(env.caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf(CACHE_PREFIX) === 0; }).map(function (k) { return env.caches.delete(k); })); }));
    } catch (e) { /* ignore */ }
    try {
      if (env.serviceWorker) jobs.push(env.serviceWorker.getRegistrations().then(function (rs) {
        return Promise.all(rs.filter(function (x) { return isOldPhoneScope(x.scope); }).map(function (x) { return x.unregister(); }));
      }));
    } catch (e) { /* ignore */ }
    return Promise.all(jobs.map(function (j) { return j.catch(function () {}); })).then(function () { return gone; });
  }
  // storage / service-worker getters throw a SecurityError when the browser blocks them: each read is guarded
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function run(win, timeoutMs) {
    var go = NEW_ORIGIN + '/';
    var done = false;
    var leave = function () { if (!done) { done = true; win.location.replace(go); } };
    setTimeout(leave, timeoutMs || 2500); // armed first: never trap the visitor, whatever below throws or hangs
    go = safe(function () { return target(win.location.hash); }) || go;
    safe(function () { var link = win.document && win.document.getElementById('go'); if (link) link.setAttribute('href', go); });
    var env = {
      localStorage: safe(function () { return win.localStorage; }),
      indexedDB: safe(function () { return win.indexedDB; }),
      caches: safe(function () { return win.caches; }),
      serviceWorker: safe(function () { return win.navigator && win.navigator.serviceWorker; }),
    };
    try { cleanup(env).then(leave, leave); } catch (e) { leave(); }
  }
  var api = { isOldPhoneScope: isOldPhoneScope, NEW_ORIGIN: NEW_ORIGIN, clearStorage: clearStorage, target: target, cleanup: cleanup, run: run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else run(root);
})(typeof window !== 'undefined' ? window : this);
