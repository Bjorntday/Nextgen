const DB_NAME = 'nextgenImageEditor';
const DB_VERSION = 1;
const STORE_NAME = 'refImageStores';

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

function withStore(mode, callback) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('IndexedDB transaction failed'));
    };
    result = callback(store);
  }));
}

function normalizeList(items, maxItems) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && item.dataUrl)
    .slice(0, maxItems)
    .map((item) => ({
      name: item.name || 'image',
      dataUrl: item.dataUrl,
      mime: item.mime || '',
      isSwatch: !!item.isSwatch,
    }));
}

export async function loadRefImageList(key, maxItems) {
  try {
    const req = await withStore('readonly', (store) => store.get(key));
    return normalizeList(req && req.result, maxItems);
  } catch (_e) {
    return [];
  }
}

export async function saveRefImageList(key, items, maxItems) {
  const normalized = normalizeList(items, maxItems);
  try {
    await withStore('readwrite', (store) => {
      if (normalized.length) return store.put(normalized, key);
      return store.delete(key);
    });
    return true;
  } catch (_e) {
    return false;
  }
}
