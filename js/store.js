/* IndexedDB 存储：检测历史 + 误判修正 */
(function (global) {
  'use strict';

  var DB_NAME = 'feature-detect-db';
  var DB_VERSION = 1;
  var STORE_HISTORY = 'history';
  var STORE_CORRECTIONS = 'corrections';

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('IndexedDB 不可用，历史与修正功能无法使用'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          db.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_CORRECTIONS)) {
          db.createObjectStore(STORE_CORRECTIONS, { keyPath: 'featureId' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(db, store, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, mode);
      var out = fn(t.objectStore(store));
      t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
      t.onerror = function () { reject(t.error); };
    });
  }

  function requestToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  var Store = {
    /* 保存一次检测记录，返回记录 id */
    saveRun: function (run) {
      return openDB().then(function (db) {
        return requestToPromise(
          db.transaction(STORE_HISTORY, 'readwrite').objectStore(STORE_HISTORY).add(run)
        );
      });
    },

    /* 读取全部历史，按时间倒序 */
    listRuns: function () {
      return openDB().then(function (db) {
        return requestToPromise(
          db.transaction(STORE_HISTORY, 'readonly').objectStore(STORE_HISTORY).getAll()
        );
      }).then(function (rows) {
        return (rows || []).sort(function (a, b) { return b.timestamp - a.timestamp; });
      });
    },

    deleteRun: function (id) {
      return openDB().then(function (db) {
        return requestToPromise(
          db.transaction(STORE_HISTORY, 'readwrite').objectStore(STORE_HISTORY).delete(id)
        );
      });
    },

    /* 误判修正：按 featureId 存取 */
    saveCorrection: function (featureId, correction) {
      return openDB().then(function (db) {
        return requestToPromise(
          db.transaction(STORE_CORRECTIONS, 'readwrite').objectStore(STORE_CORRECTIONS)
            .put({ featureId: featureId, status: correction.status, note: correction.note || '', timestamp: Date.now() })
        );
      });
    },

    removeCorrection: function (featureId) {
      return openDB().then(function (db) {
        return requestToPromise(
          db.transaction(STORE_CORRECTIONS, 'readwrite').objectStore(STORE_CORRECTIONS).delete(featureId)
        );
      });
    },

    getCorrections: function () {
      return openDB().then(function (db) {
        return requestToPromise(
          db.transaction(STORE_CORRECTIONS, 'readonly').objectStore(STORE_CORRECTIONS).getAll()
        );
      }).then(function (rows) {
        var map = {};
        (rows || []).forEach(function (r) { map[r.featureId] = r; });
        return map;
      });
    }
  };

  global.FeatureStore = Store;
})(window);
