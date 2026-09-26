(function () {
  'use strict';

  var LABELS = FeatureDetectors.STATUS_LABELS;
  var currentResults = [];
  var corrections = {};
  var lastRunAt = null;

  var els = {
    banner: null,
    body: document.getElementById('result-body'),
    summary: document.getElementById('summary'),
    envBanner: document.getElementById('env-banner'),
    envInfo: document.getElementById('env-info'),
    historyPanel: document.getElementById('history-panel'),
    historyList: document.getElementById('history-list'),
    dialog: document.getElementById('correct-dialog'),
    correctName: document.getElementById('correct-feature-name'),
    correctStatus: document.getElementById('correct-status'),
    correctNote: document.getElementById('correct-note')
  };
  var correctingId = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderEnv() {
    if (window.isSecureContext === false) {
      els.envBanner.hidden = false;
      els.envBanner.textContent =
        '当前为非安全上下文（非 HTTPS 且非 localhost）：部分 API（Service Worker、Web Crypto、Clipboard、Notifications、Geolocation 等）会被浏览器隐藏。';
    } else {
      els.envBanner.hidden = true;
    }
    els.envInfo.textContent =
      'User-Agent: ' + navigator.userAgent +
      ' ｜ 安全上下文: ' + (window.isSecureContext ? '是' : '否') +
      ' ｜ 协议: ' + location.protocol;
  }

  function applyCorrections(results) {
    results.forEach(function (r) {
      var c = corrections[r.id];
      if (c) {
        r.originalStatus = r.status;
        r.status = c.status;
        r.corrected = true;
        r.note = (c.note ? c.note + ' ' : '') + '（人工修正，原检测结果：' + (LABELS[r.originalStatus] || r.originalStatus) + '）';
      }
    });
    return results;
  }

  function renderSummary(results) {
    els.summary.textContent = '';
    var counts = {};
    results.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
    Object.keys(LABELS).forEach(function (status) {
      if (!counts[status]) return;
      var chip = el('span', 'chip');
      var badge = el('span', 'badge ' + status, LABELS[status]);
      chip.appendChild(badge);
      chip.appendChild(document.createTextNode(' × ' + counts[status]));
      els.summary.appendChild(chip);
    });
    if (lastRunAt) {
      els.summary.appendChild(el('span', 'chip', '检测时间：' + new Date(lastRunAt).toLocaleString()));
    }
  }

  function renderTable(results) {
    els.body.textContent = '';
    results.forEach(function (r) {
      var tr = document.createElement('tr');

      tr.appendChild(el('td', null, r.name));

      var tdStatus = document.createElement('td');
      tdStatus.appendChild(el('span', 'badge ' + r.status, LABELS[r.status] || r.status));
      if (r.corrected) tdStatus.appendChild(el('span', 'badge corrected', '已修正'));
      tr.appendChild(tdStatus);

      var tdNote = document.createElement('td');
      var cond = [];
      if (r.permissionState) cond.push('权限状态：' + r.permissionState);
      tdNote.textContent = cond.join('；') || '—';
      if (r.note) tdNote.appendChild(el('div', 'detail-note', r.note));
      tr.appendChild(tdNote);

      tr.appendChild(el('td', 'fallback', r.fallback || '—'));

      var tdOps = document.createElement('td');
      var btn = el('button', null, '标记误判');
      btn.type = 'button';
      btn.addEventListener('click', function () { openCorrectDialog(r); });
      tdOps.appendChild(btn);
      tr.appendChild(tdOps);

      els.body.appendChild(tr);
    });
  }

  function run() {
    renderEnv();
    return FeatureDetectors.detectAll().then(function (results) {
      lastRunAt = Date.now();
      currentResults = applyCorrections(results);
      renderSummary(currentResults);
      renderTable(currentResults);
      return FeatureStore.saveRun({
        timestamp: lastRunAt,
        userAgent: navigator.userAgent,
        secureContext: window.isSecureContext !== false,
        results: currentResults.map(function (r) {
          return { id: r.id, name: r.name, status: r.status, note: r.note, permissionState: r.permissionState, corrected: !!r.corrected };
        })
      }).catch(function () { /* IndexedDB 不可用时静默跳过历史保存 */ });
    }).then(loadHistory);
  }

  /* ---------- 导出 ---------- */
  function exportJSON() {
    var payload = {
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext !== false,
      url: location.href,
      results: currentResults
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'feature-detect-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- 历史 ---------- */
  function loadHistory() {
    return FeatureStore.listRuns().then(function (runs) {
      els.historyList.textContent = '';
      if (!runs.length) {
        els.historyList.appendChild(el('li', null, '暂无历史记录'));
        return;
      }
      runs.forEach(function (runRec) {
        var li = document.createElement('li');
        li.appendChild(el('span', 'time', new Date(runRec.timestamp).toLocaleString()));
        li.appendChild(el('span', null, runRec.results.length + ' 项特性'));

        var btnView = el('button', null, '恢复查看');
        btnView.type = 'button';
        btnView.addEventListener('click', function () {
          currentResults = runRec.results.map(function (r) {
            var def = FeatureDetectors.FEATURES.find(function (f) { return f.id === r.id; });
            return Object.assign({ fallback: def ? def.fallback : '' }, r);
          });
          lastRunAt = runRec.timestamp;
          renderSummary(currentResults);
          renderTable(currentResults);
        });
        li.appendChild(btnView);

        var btnDel = el('button', null, '删除');
        btnDel.type = 'button';
        btnDel.addEventListener('click', function () {
          FeatureStore.deleteRun(runRec.id).then(loadHistory);
        });
        li.appendChild(btnDel);

        els.historyList.appendChild(li);
      });
    }).catch(function () {
      els.historyList.textContent = '';
      els.historyList.appendChild(el('li', null, 'IndexedDB 不可用，无法读取历史'));
    });
  }

  /* ---------- 误判修正 ---------- */
  function openCorrectDialog(result) {
    correctingId = result.id;
    els.correctName.textContent = result.name;
    els.correctStatus.value = result.status in LABELS ? result.status : 'supported';
    els.correctNote.value = '';
    els.dialog.showModal();
  }

  document.getElementById('correct-form').addEventListener('submit', function (e) {
    e.preventDefault();
    FeatureStore.saveCorrection(correctingId, {
      status: els.correctStatus.value,
      note: els.correctNote.value.trim()
    }).then(function () {
      return FeatureStore.getCorrections();
    }).then(function (map) {
      corrections = map;
      els.dialog.close();
      run();
    });
  });

  document.getElementById('correct-clear').addEventListener('click', function () {
    FeatureStore.removeCorrection(correctingId).then(function () {
      return FeatureStore.getCorrections();
    }).then(function (map) {
      corrections = map;
      els.dialog.close();
      run();
    });
  });

  document.getElementById('correct-cancel').addEventListener('click', function () {
    els.dialog.close();
  });

  /* ---------- 入口 ---------- */
  document.getElementById('btn-run').addEventListener('click', run);
  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('btn-toggle-history').addEventListener('click', function () {
    els.historyPanel.hidden = !els.historyPanel.hidden;
    if (!els.historyPanel.hidden) loadHistory();
  });

  FeatureStore.getCorrections().then(function (map) {
    corrections = map;
  }).catch(function () {
    corrections = {};
  }).then(run);
})();
