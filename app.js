/* 主逻辑：运行检测、渲染结果、历史管理、导出、误判修正 */

let currentResults = [];   // 当前展示的检测结果（已应用修正）
let currentOverrides = {}; // featureId -> override
let currentRunId = null;   // 当前展示的历史记录 id（null 表示实时检测）

function envDescription() {
  const parts = [];
  parts.push('安全上下文: ' + (window.isSecureContext ? '是' : '否'));
  parts.push('UA: ' + navigator.userAgent);
  return parts.join('　|　');
}

function statusBadge(status) {
  const label = STATUS_LABELS[status] || status;
  return '<span class="badge ' + status + '">' + label + '</span>';
}

function applyOverrides(results, overrides) {
  return results.map((r) => {
    const ov = overrides[r.id];
    if (!ov) return r;
    return {
      ...r,
      status: ov.status,
      note: (ov.note ? ov.note + '；' : '') + '（人工修正，原结果：' + (STATUS_LABELS[r.status] || r.status) + '）',
      overridden: true
    };
  });
}

function renderSummary(results) {
  const counts = {};
  results.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const order = ['supported', 'partial', 'needs-permission', 'insecure-context', 'unsupported', 'error'];
  document.getElementById('summary').innerHTML = order
    .filter((s) => counts[s])
    .map((s) => '<div class="chip">' + statusBadge(s) + ' × ' + counts[s] + '</div>')
    .join('');
}

function renderResults() {
  const filter = document.getElementById('statusFilter').value;
  const tbody = document.getElementById('resultBody');
  tbody.innerHTML = '';
  const rows = currentResults.filter((r) => !filter || r.status === filter);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">没有匹配的记录</td></tr>';
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><strong></strong></td>' +
      '<td>' + statusBadge(r.status) + (r.overridden ? '<span class="override-mark" title="此结果经过人工修正">已修正</span>' : '') + '</td>' +
      '<td class="note"></td>' +
      '<td class="fallback"></td>' +
      '<td><button class="btn small" data-override="' + r.id + '">修正</button></td>';
    tr.children[0].querySelector('strong').textContent = r.name;
    tr.children[2].textContent = r.note || '—';
    tr.children[3].textContent = r.fallback || '—';
    tbody.appendChild(tr);
  });
}

async function runDetection() {
  currentRunId = null;
  document.getElementById('envLine').textContent = envDescription();
  const results = await detectAll();
  try {
    const overrides = await DetectDB.listOverrides();
    currentOverrides = {};
    overrides.forEach((o) => { currentOverrides[o.featureId] = o; });
  } catch (e) {
    currentOverrides = {};
  }
  currentResults = applyOverrides(results, currentOverrides);
  renderSummary(currentResults);
  renderResults();
  // 保存历史（IndexedDB 不可用时静默降级，不影响检测展示）
  try {
    await DetectDB.saveRun({
      time: new Date().toISOString(),
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext === true,
      results: currentResults
    });
  } catch (e) { /* 忽略 */ }
  renderHistory();
}

async function renderHistory() {
  const box = document.getElementById('historyList');
  let runs = [];
  try {
    runs = await DetectDB.listRuns();
  } catch (e) {
    box.innerHTML = '<div class="empty">历史不可用（IndexedDB 受限）：' + e.message + '</div>';
    return;
  }
  if (!runs.length) {
    box.innerHTML = '<div class="empty">暂无历史记录</div>';
    return;
  }
  box.innerHTML = '';
  runs.slice(0, 20).forEach((run) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const okCount = run.results.filter((r) => r.status === 'supported').length;
    div.innerHTML =
      '<span class="time">' + new Date(run.time).toLocaleString() + '</span>' +
      '<span class="meta">' + okCount + '/' + run.results.length + ' 项支持 · ' +
      (run.secureContext ? '安全上下文' : '非安全上下文') + '</span>' +
      '<button class="btn small" data-restore="' + run.id + '">恢复查看</button>' +
      '<button class="btn small" data-delete="' + run.id + '">删除</button>';
    box.appendChild(div);
  });
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext === true,
    results: currentResults
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'feature-detect-' + Date.now() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function copyJson() {
  const text = JSON.stringify({ exportedAt: new Date().toISOString(), results: currentResults }, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    alert('已复制到剪贴板');
  } catch (e) {
    // 降级：execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); alert('已复制到剪贴板（降级方式）'); }
    catch (e2) { alert('复制失败，请使用导出功能'); }
    ta.remove();
  }
}

/* ---- 误判修正 ---- */
let overrideTarget = null;

function openOverrideDialog(featureId) {
  const r = currentResults.find((x) => x.id === featureId);
  if (!r) return;
  overrideTarget = featureId;
  document.getElementById('overrideTitle').textContent = '修正：' + r.name;
  const ov = currentOverrides[featureId];
  document.getElementById('overrideStatus').value = ov ? ov.status : r.status;
  document.getElementById('overrideNote').value = ov ? (ov.note || '') : '';
  document.getElementById('overrideDialog').showModal();
}

async function saveOverride() {
  if (!overrideTarget) return;
  const ov = {
    featureId: overrideTarget,
    status: document.getElementById('overrideStatus').value,
    note: document.getElementById('overrideNote').value.trim(),
    updatedAt: new Date().toISOString()
  };
  try {
    await DetectDB.saveOverride(ov);
    currentOverrides[overrideTarget] = ov;
  } catch (e) {
    alert('修正保存失败（IndexedDB 不可用），本次仅在页面生效');
    currentOverrides[overrideTarget] = ov;
  }
  const base = currentResults.map((r) => {
    if (r.id !== overrideTarget) return r;
    // 去掉旧修正痕迹，重新应用
    const raw = { ...r };
    delete raw.overridden;
    return raw;
  });
  currentResults = applyOverrides(base, currentOverrides);
  renderSummary(currentResults);
  renderResults();
}

async function clearOverride() {
  if (!overrideTarget) return;
  try { await DetectDB.deleteOverride(overrideTarget); } catch (e) { /* 忽略 */ }
  delete currentOverrides[overrideTarget];
  document.getElementById('overrideDialog').close();
  await runDetection(); // 重新检测以恢复原始结果
}

/* ---- 事件绑定 ---- */
document.getElementById('btnRun').addEventListener('click', runDetection);
document.getElementById('btnExport').addEventListener('click', exportJson);
document.getElementById('btnCopy').addEventListener('click', copyJson);
document.getElementById('statusFilter').addEventListener('change', renderResults);

document.getElementById('resultBody').addEventListener('click', (e) => {
  const id = e.target.getAttribute('data-override');
  if (id) openOverrideDialog(id);
});

document.getElementById('historyList').addEventListener('click', async (e) => {
  const restoreId = e.target.getAttribute('data-restore');
  const deleteId = e.target.getAttribute('data-delete');
  if (restoreId) {
    const run = await DetectDB.getRun(Number(restoreId));
    if (run) {
      currentRunId = run.id;
      currentResults = run.results;
      document.getElementById('envLine').textContent =
        '历史记录 @ ' + new Date(run.time).toLocaleString() + '　|　UA: ' + run.userAgent;
      renderSummary(currentResults);
      renderResults();
    }
  } else if (deleteId) {
    await DetectDB.deleteRun(Number(deleteId));
    renderHistory();
  }
});

document.getElementById('overrideForm').addEventListener('submit', (e) => {
  if (e.submitter && e.submitter.value === 'save') {
    e.preventDefault();
    saveOverride().then(() => document.getElementById('overrideDialog').close());
  }
});
document.getElementById('btnClearOverride').addEventListener('click', clearOverride);

/* 启动 */
runDetection();
