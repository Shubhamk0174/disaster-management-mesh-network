/**
 * offlineMapCache.ts
 *
 * Thin IndexedDB wrapper that caches OlaMaps / MapLibre assets
 * (tiles, style JSON, sprites, glyphs) by URL so the map works
 * offline.  All access is async; errors are swallowed gracefully so
 * a full storage quota never crashes the app.
 */

const DB_NAME    = 'ecs-map-cache';
const DB_VERSION = 1;
const STORE_NAME = 'tiles';

export interface CacheEntry {
  url:         string;
  data:        ArrayBuffer;
  contentType: string;
  cachedAt:    number;       // unix ms
}

export interface CacheStats {
  count:     number;
  sizeBytes: number;
}

// ─────────────────────────────────────────────
// Singleton DB connection
// ─────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }
    };

    req.onsuccess = () => {
      _db = req.result;
      resolve(req.result);
    };

    req.onerror = () => reject(req.error);
  });
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/** Return the cached entry for `url`, or null if not found. */
export async function cacheGet(url: string): Promise<CacheEntry | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(url);
      req.onsuccess = () => resolve((req.result as CacheEntry) ?? null);
      req.onerror   = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Store (or overwrite) an entry in the cache. */
export async function cachePut(
  url:         string,
  data:        ArrayBuffer,
  contentType: string,
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, 'readwrite');
      const entry: CacheEntry = { url, data, contentType, cachedAt: Date.now() };
      const req   = tx.objectStore(STORE_NAME).put(entry);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch (e) {
    // Storage quota exceeded or similar — silently ignore
    console.warn('[MapCache] cachePut failed:', e);
  }
}

/** Count cached entries and sum their byte size. */
export async function cacheStats(): Promise<CacheStats> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx    = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      let count = 0;
      let sizeBytes = 0;

      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          count++;
          sizeBytes += (cursor.value as CacheEntry).data.byteLength;
          cursor.continue();
        } else {
          resolve({ count, sizeBytes });
        }
      };
      req.onerror = () => resolve({ count: 0, sizeBytes: 0 });
    });
  } catch {
    return { count: 0, sizeBytes: 0 };
  }
}

/** Delete every cached entry. */
export async function cacheClear(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[MapCache] cacheClear failed:', e);
  }
}
