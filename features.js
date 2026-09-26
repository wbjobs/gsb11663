/*
 * 特性检测定义。
 * 每个检测器为异步函数，返回 { status, note, fallback }。
 * status 取值：supported | partial | unsupported | needs-permission | insecure-context | error
 *
 * 浏览器差异处理约定：
 * - Permissions API 的 query() 对不认识的权限名会 reject（Safari/Firefox 表现不同），统一 try/catch。
 * - 前缀 API（webkit*）作为降级检测。
 * - 检测一律包在 try/catch 中，异常归为 error，避免单个特性拖垮整体。
 */

const STATUS_LABELS = {
  'supported': '支持',
  'partial': '部分支持',
  'unsupported': '不支持',
  'needs-permission': '需要权限',
  'insecure-context': '非安全上下文受限',
  'error': '检测异常'
};

function isSecure() {
  return window.isSecureContext === true;
}

/* 查询权限状态；浏览器不支持该权限名或 Permissions API 时返回 null */
async function queryPermission(name) {
  if (!('permissions' in navigator) || !navigator.permissions.query) return null;
  try {
    const result = await navigator.permissions.query({ name });
    return result.state; // 'granted' | 'denied' | 'prompt'
  } catch (e) {
    return null; // Safari 等对部分权限名直接抛错，视为无法查询
  }
}

/* 根据权限状态推导特性状态 */
function statusByPermission(state, notePrefix) {
  if (state === 'granted') {
    return { status: 'supported', note: notePrefix + '，权限已授予' };
  }
  if (state === 'denied') {
    return { status: 'needs-permission', note: notePrefix + '，权限已被用户拒绝（需在浏览器设置中重新开启）' };
  }
  if (state === 'prompt') {
    return { status: 'needs-permission', note: notePrefix + '，首次使用时会请求用户授权' };
  }
  // 无法查询权限（浏览器差异）：API 存在即认为可用，但标注权限情况未知
  return { status: 'needs-permission', note: notePrefix + '（当前浏览器无法查询权限状态，实际使用时可能弹出授权）' };
}

const FEATURES = [
  {
    id: 'resize-observer',
    name: 'ResizeObserver',
    fallback: '降级：监听 window resize 事件 + 手动读取元素尺寸（getBoundingClientRect）。',
    async detect() {
      if (typeof ResizeObserver === 'function') {
        return { status: 'supported', note: '可观察元素尺寸变化。' };
      }
      return { status: 'unsupported', note: '构造函数不存在。' };
    }
  },
  {
    id: 'intersection-observer',
    name: 'IntersectionObserver',
    fallback: '降级：scroll 事件 + getBoundingClientRect 手动计算可见性（注意节流）。',
    async detect() {
      if (typeof IntersectionObserver === 'function') {
        return { status: 'supported', note: '可高效检测元素可见性 / 懒加载。' };
      }
      return { status: 'unsupported', note: '构造函数不存在。' };
    }
  },
  {
    id: 'broadcast-channel',
    name: 'BroadcastChannel',
    fallback: '降级：localStorage 的 storage 事件做跨标签页通信。',
    async detect() {
      if (typeof BroadcastChannel === 'function') {
        return { status: 'supported', note: '支持同源标签页 / Worker 间广播消息。' };
      }
      return { status: 'unsupported', note: '构造函数不存在（旧版 Safari 不支持）。' };
    }
  },
  {
    id: 'indexeddb',
    name: 'IndexedDB',
    fallback: '降级：localStorage（容量小、同步阻塞）或后端存储。',
    async detect() {
      const idb = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB;
      if (!idb) return { status: 'unsupported', note: 'indexedDB 对象不存在。' };
      // 真实打开一次数据库，排除隐私模式等"对象存在但不可用"的误判场景
      return await new Promise((resolve) => {
        let req;
        try {
          req = idb.open('__feature_detect__', 1);
        } catch (e) {
          resolve({ status: 'unsupported', note: 'open() 调用抛异常：' + e.message });
          return;
        }
        const timer = setTimeout(() => {
          resolve({ status: 'partial', note: 'open() 长时间未返回，可能被浏览器策略限制。' });
        }, 3000);
        req.onsuccess = () => {
          clearTimeout(timer);
          req.result.close();
          try { idb.deleteDatabase('__feature_detect__'); } catch (e) { /* 忽略清理失败 */ }
          resolve({ status: 'supported', note: '实际打开数据库成功，可正常读写。' });
        };
        req.onerror = () => {
          clearTimeout(timer);
          resolve({
            status: 'partial',
            note: 'API 存在但打开数据库失败（常见于隐私/无痕模式）：' + (req.error && req.error.message || '未知错误')
          });
        };
        req.onblocked = () => {
          clearTimeout(timer);
          resolve({ status: 'partial', note: '打开数据库被阻塞（可能有其他连接占用）。' });
        };
      });
    }
  },
  {
    id: 'web-worker',
    name: 'Web Worker',
    fallback: '降级：重计算任务切片 + requestIdleCallback / setTimeout 分时执行。',
    async detect() {
      if (typeof Worker !== 'function') {
        return { status: 'unsupported', note: 'Worker 构造函数不存在。' };
      }
      let note = '支持 Dedicated Worker。';
      try {
        const blob = new Blob([''], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url);
        w.terminate();
        URL.revokeObjectURL(url);
        note += ' Blob URL 创建 Worker 验证通过。';
      } catch (e) {
        return { status: 'partial', note: '构造函数存在但创建实例失败：' + e.message };
      }
      return { status: 'supported', note };
    }
  },
  {
    id: 'service-worker',
    name: 'Service Worker',
    fallback: '降级：无离线缓存能力，可用 Cache-Control + localStorage 做弱缓存。',
    async detect() {
      if (!('serviceWorker' in navigator)) {
        return { status: 'unsupported', note: 'navigator.serviceWorker 不存在。' };
      }
      if (!isSecure()) {
        return {
          status: 'insecure-context',
          note: 'API 存在，但 Service Worker 仅在安全上下文（HTTPS 或 localhost）中可注册。'
        };
      }
      return { status: 'supported', note: '安全上下文，可注册 Service Worker 实现离线缓存 / 推送。' };
    }
  },
  {
    id: 'web-crypto',
    name: 'Web Crypto',
    fallback: '降级：纯 JS 加密库（如 crypto-js），性能较差且无法使用硬件加速。',
    async detect() {
      if (!window.crypto) {
        return { status: 'unsupported', note: 'window.crypto 不存在。' };
      }
      if (!window.crypto.subtle) {
        // 典型场景：非安全上下文中 crypto 存在但 subtle 被移除
        return {
          status: isSecure() ? 'partial' : 'insecure-context',
          note: 'crypto 存在但 crypto.subtle 不可用' + (isSecure() ? '（异常，可能是浏览器限制）' : '（安全上下文中才提供 SubtleCrypto）') + '，仅 getRandomValues 可用。'
        };
      }
      return { status: 'supported', note: 'SubtleCrypto 可用，支持摘要 / 加解密 / 签名。' };
    }
  },
  {
    id: 'clipboard',
    name: 'Clipboard API',
    fallback: '降级：document.execCommand("copy")（已废弃但兼容性好）或提示用户手动复制。',
    async detect() {
      if (!navigator.clipboard) {
        if (!isSecure()) {
          return { status: 'insecure-context', note: '异步剪贴板 API 仅在安全上下文暴露。' };
        }
        return { status: 'unsupported', note: 'navigator.clipboard 不存在。' };
      }
      const canWrite = typeof navigator.clipboard.writeText === 'function';
      const canRead = typeof navigator.clipboard.readText === 'function';
      if (!canWrite) {
        return { status: 'partial', note: 'clipboard 对象存在但 writeText 缺失。' };
      }
      if (!canRead) {
        return { status: 'partial', note: '支持写入（writeText），不支持读取（readText，浏览器差异）。' };
      }
      const perm = await queryPermission('clipboard-read');
      const base = statusByPermission(perm, '读写均可用，读取需授权');
      return { status: base.status === 'supported' ? 'supported' : base.status, note: base.note };
    }
  },
  {
    id: 'notifications',
    name: 'Notifications',
    fallback: '降级：页面内 Toast / 角标提示。',
    async detect() {
      if (typeof Notification === 'undefined') {
        return { status: 'unsupported', note: 'Notification 构造函数不存在。' };
      }
      if (!isSecure()) {
        return { status: 'insecure-context', note: 'API 存在，但通知仅在安全上下文中可用。' };
      }
      // Notification.permission 是同步属性，各浏览器表现一致，比 Permissions API 更可靠
      const perm = Notification.permission;
      if (perm === 'granted') return { status: 'supported', note: '权限已授予，可直接弹出系统通知。' };
      if (perm === 'denied') return { status: 'needs-permission', note: '权限已被拒绝，需用户在浏览器设置中手动开启。' };
      return { status: 'needs-permission', note: '需调用 Notification.requestPermission() 请求授权。' };
    }
  },
  {
    id: 'geolocation',
    name: 'Geolocation',
    fallback: '降级：IP 定位（精度低）或让用户手动选择位置。',
    async detect() {
      if (!('geolocation' in navigator)) {
        return { status: 'unsupported', note: 'navigator.geolocation 不存在。' };
      }
      if (!isSecure()) {
        return { status: 'insecure-context', note: 'API 存在，但定位仅在安全上下文中可用。' };
      }
      const perm = await queryPermission('geolocation');
      return statusByPermission(perm, '安全上下文，API 可用');
    }
  }
];

/* 运行全部检测，单个检测器异常不影响其他 */
async function detectAll() {
  const results = [];
  for (const feature of FEATURES) {
    let result;
    try {
      result = await feature.detect();
    } catch (e) {
      result = { status: 'error', note: '检测过程抛异常：' + (e && e.message || e) };
    }
    results.push({
      id: feature.id,
      name: feature.name,
      status: result.status,
      note: result.note || '',
      fallback: feature.fallback
    });
  }
  return results;
}
