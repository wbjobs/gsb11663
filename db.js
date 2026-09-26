/*
 * IndexedDB 封装：保存检测历史与人工修正记录。
 * - runs:      每次检测的完整快照（keyPath: id 自增）
 * - overrides: 误判修正（keyPath: featureId）
 */
const DetectDB = (() => {
  const DB_NAME = 'feature-detect-history';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('runs')) {
          db.createObjectStore('runs', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('overrides')) {
          db.createObjectStore('overrides', { keyPath: 'featureId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(db, store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  }

  return {
    async saveRun(run) {
      const db = await open();
      return tx(db, 'runs', 'readwrite', (s) => s.add(run));
    },
    async listRuns() {
      const db = await open();
      const all = await tx(db, 'runs', 'readonly', (s) => s.getAll());
      return (all || []).sort((a, b) => b.id - a.id);
    },
    async getRun(id) {
      const db = await open();
      return tx(db, 'runs', 'readonly', (s) => s.get(id));
    },
    async deleteRun(id) {
      const db = await open();
      return tx(db, 'runs', 'readwrite', (s) => s.delete(id));
    },
    async saveOverride(override) {
      const db = await open();
      return tx(db, 'overrides', 'readwrite', (s) => s.put(override));
    },
    async deleteOverride(featureId) {
      const db = await open();
      return tx(db, 'overrides', 'readwrite', (s) => s.delete(featureId));
    },
    async listOverrides() {
      const db = await open();
      return (await tx(db, 'overrides', 'readonly', (s) => s.getAll())) || [];
    }
  };
})();
