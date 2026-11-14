// The one place that names the private data repo this page reads (owner/repo). Nothing else in the shell names it.
export const DATA_REPO = 'Mohamed3042/medmac-reference-set';

export const API = 'https://api.github.com';
export const SNAPSHOT_PATH = '_phone/snapshot.json';
export const SERVER_PATH = '_phone/server.json'; // the office server's copy (optional; written by the sync machine, docs/SERVER-SYNC.md)

// What this page keeps on the phone (localStorage). The MK Launcher Backup lives on the same github.io origin;
// its key is tried silently first (read only, never changed or removed by this page).
export const SLOT = { key: 'mmis.key', keyFrom: 'mmis.keyFrom', noBorrow: 'mmis.noBorrow', ui: 'mmis.ui' };
export const BORROW = { launcher: 'mkl.token', launcherFrom: 'mkl.tokenFrom', cinema: 'mkc.token' };

export const DB_NAME = 'medmac-phone';
export const FILE_CACHE_CAP = 150 * 1024 * 1024; // photos and papers kept on the phone (least recently used goes first)
export const MAX_FILE_BYTES = 100 * 1024 * 1024;  // the contents API stops at 100 MB
export const PARALLEL_FILES = 3;                  // pictures fetched at the same time, only those on screen
export const LOW_RATE = 60;                       // under this many API calls left this hour, pictures wait
