/*
 * 特性检测定义。
 * 状态取值：
 *   supported         支持
 *   partial           部分支持（附说明）
 *   unsupported       不支持
 *   needs-permission  支持但需要用户授权
 *   insecure-context  仅在安全上下文（HTTPS/localhost）可用
 *   error             检测过程出错（可能误判，可人工修正）
 */
(function (global) {
  'use strict';

  var STATUS_LABELS = {
    'supported': '支持',
    'partial': '部分支持',
    'unsupported': '不支持',
    'needs-permission': '需要权限',
    'insecure-context': '需要安全上下文',
    'error': '检测失败'
  };

  function has(obj, prop) {
    return typeof obj !== 'undefined' && obj !== null && prop in obj;
  }

  /* 各特性的检测函数：返回 { status, note }，抛错则由外层标记为 error */
  var FEATURES = [
    {
      id: 'resize-observer',
      name: 'ResizeObserver',
      requiresSecureContext: false,
      detect: function () {
        if (typeof ResizeObserver === 'function') return { status: 'supported' };
        return { status: 'unsupported' };
      },
      fallback: '监听 window resize 事件并手动比对元素尺寸，或使用 getBoundingClientRect 轮询。'
    },
    {
      id: 'intersection-observer',
      name: 'IntersectionObserver',
      requiresSecureContext: false,
      detect: function () {
        if (typeof IntersectionObserver === 'function') return { status: 'supported' };
        return { status: 'unsupported' };
      },
      fallback: '使用 scroll 事件 + getBoundingClientRect 计算可见性，或引入 IntersectionObserver polyfill。'
    },
    {
      id: 'broadcast-channel',
      name: 'BroadcastChannel',
      requiresSecureContext: false,
      detect: function () {
        if (typeof BroadcastChannel === 'function') return { status: 'supported' };
        return { status: 'unsupported' };
      },
      fallback: '使用 localStorage 的 storage 事件或 SharedWorker 做跨标签页通信。'
    },
    {
      id: 'indexeddb',
      name: 'IndexedDB',
      requiresSecureContext: false,
      detect: function () {
        if (typeof indexedDB !== 'undefined' && indexedDB !== null) return { status: 'supported' };
        /* 浏览器差异：旧版带厂商前缀 */
        var prefixed = global.mozIndexedDB || global.webkitIndexedDB || global.msIndexedDB;
        if (prefixed) {
          return { status: 'partial', note: '仅存在带厂商前缀的实现（moz/webkit/msIndexedDB），需做前缀兼容。' };
        }
        return { status: 'unsupported' };
      },
      fallback: '降级到 localStorage / sessionStorage（容量小、同步阻塞），或服务端存储。'
    },
    {
      id: 'web-worker',
      name: 'Web Worker',
      requiresSecureContext: false,
      detect: function () {
        if (typeof Worker === 'function') return { status: 'supported' };
        return { status: 'unsupported' };
      },
      fallback: '重计算任务分片到 setTimeout/requestIdleCallback 中执行，避免阻塞主线程。'
    },
    {
      id: 'service-worker',
      name: 'Service Worker',
      requiresSecureContext: true,
      detect: function () {
        if (has(navigator, 'serviceWorker')) return { status: 'supported' };
        return { status: 'unsupported' };
      },
      fallback: '无法离线缓存时，使用 HTTP 缓存（Cache-Control）+ AppCache 已废弃不建议。'
    },
    {
      id: 'web-crypto',
      name: 'Web Crypto',
      requiresSecureContext: true,
      detect: function () {
        if (global.crypto && typeof global.crypto.subtle === 'object' && global.crypto.subtle !== null) {
          return { status: 'supported' };
        }
        if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
          /* 部分支持：非安全上下文下通常只有 getRandomValues，没有 subtle */
          return { status: 'partial', note: '仅有 getRandomValues 可用，crypto.subtle（加解密/签名）不可用。' };
        }
        return { status: 'unsupported' };
      },
      fallback: '使用纯 JS 加密库（如 js-crypto 库），但性能与安全性弱于原生实现。'
    },
    {
      id: 'clipboard',
      name: 'Clipboard API',
      requiresSecureContext: true,
      permissionName: 'clipboard-read',
      detect: function () {
        var hasWrite = navigator.clipboard && typeof navigator.clipboard.writeText === 'function';
        var hasRead = navigator.clipboard && typeof navigator.clipboard.readText === 'function';
        if (hasWrite && hasRead) return { status: 'supported' };
        if (hasWrite) {
          return { status: 'partial', note: '仅支持写入（writeText），读取剪贴板不可用。' };
        }
        if (document.queryCommandSupported && document.queryCommandSupported('copy')) {
          return { status: 'partial', note: '无异步 Clipboard API，仅可用已废弃的 document.execCommand("copy")。' };
        }
        return { status: 'unsupported' };
      },
      fallback: '使用 document.execCommand("copy") 或提示用户手动复制。'
    },
    {
      id: 'notifications',
      name: 'Notifications',
      requiresSecureContext: true,
      permissionName: 'notifications',
      detect: function () {
        if (typeof Notification === 'function') return { status: 'supported' };
        /* 浏览器差异：旧版带前缀 */
        if (global.webkitNotifications) {
          return { status: 'partial', note: '仅存在旧版 webkitNotifications 接口。' };
        }
        return { status: 'unsupported' };
      },
      fallback: '降级为页面内 toast/横幅提示。'
    },
    {
      id: 'geolocation',
      name: 'Geolocation',
      requiresSecureContext: true,
      permissionName: 'geolocation',
      detect: function () {
        if (has(navigator, 'geolocation')) return { status: 'supported' };
        return { status: 'unsupported' };
      },
      fallback: '让用户手动选择位置，或通过 IP 粗略定位（需服务端）。'
    },
    {
      id: 'websocket',
      name: 'WebSocket',
      requiresSecureContext: false,
      detect: function () {
        if (typeof WebSocket === 'function') return { status: 'supported' };
        if (global.MozWebSocket) {
          return { status: 'partial', note: '仅存在带前缀的 MozWebSocket。' };
        }
        return { status: 'unsupported' };
      },
      fallback: '降级为 SSE（EventSource）或长轮询。'
    },
    {
      id: 'local-storage',
      name: 'localStorage',
      requiresSecureContext: false,
      detect: function () {
        /* 隐私模式下存在但写入会抛错，需实际写入验证，避免误判 */
        try {
          var key = '__fd_test__';
          global.localStorage.setItem(key, '1');
          global.localStorage.removeItem(key);
          return { status: 'supported' };
        } catch (e) {
          return { status: 'partial', note: 'localStorage 对象存在但写入失败（隐私模式或配额限制）。' };
        }
      },
      fallback: '降级为内存对象或 Cookie（容量更小）。'
    },
    {
      id: 'webgl',
      name: 'WebGL',
      requiresSecureContext: false,
      detect: function () {
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        if (gl) return { status: 'supported', note: 'WebGL2 可用。' };
        gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
          return { status: 'partial', note: '仅 WebGL1 可用，WebGL2 不可用。' };
        }
        return { status: 'unsupported' };
      },
      fallback: '降级为 2D Canvas 渲染或静态图片。'
    },
    {
      id: 'fetch',
      name: 'Fetch API',
      requiresSecureContext: false,
      detect: function () {
        if (typeof fetch === 'function') {
          if (typeof AbortController === 'function') return { status: 'supported' };
          return { status: 'partial', note: 'fetch 可用，但 AbortController 缺失，无法中止请求。' };
        }
        return { status: 'unsupported' };
      },
      fallback: '使用 XMLHttpRequest 或 fetch polyfill。'
    },
    {
      id: 'permissions-api',
      name: 'Permissions API',
      requiresSecureContext: true,
      detect: function () {
        if (navigator.permissions && typeof navigator.permissions.query === 'function') {
          return { status: 'supported' };
        }
        return { status: 'unsupported' };
      },
      fallback: '无法预查询权限状态，只能直接调用 API 并捕获拒绝错误。'
    }
  ];

  /* 查询权限状态；Permissions API 不可用或不认识该权限名时返回 null */
  function queryPermission(name) {
    if (!name) return Promise.resolve(null);
    if (!(navigator.permissions && navigator.permissions.query)) return Promise.resolve(null);
    return navigator.permissions.query({ name: name }).then(function (result) {
      return result.state; // 'granted' | 'prompt' | 'denied'
    }).catch(function () {
      return null; // 部分浏览器（如 Safari）不支持某些权限名，避免误判
    });
  }

  /* 执行单个特性的完整检测流程 */
  function detectFeature(feature) {
    var result = {
      id: feature.id,
      name: feature.name,
      status: 'error',
      note: '',
      fallback: feature.fallback || '',
      permissionState: null
    };

    /* 1. 安全上下文检查优先：非安全上下文下这些 API 直接不可见 */
    if (feature.requiresSecureContext && global.isSecureContext === false) {
      result.status = 'insecure-context';
      result.note = '当前为非安全上下文（非 HTTPS 且非 localhost），该 API 被浏览器隐藏。';
      return Promise.resolve(result);
    }

    /* 2. 运行检测函数，异常标记为 error（防止误判为不支持） */
    var detected;
    try {
      detected = feature.detect();
    } catch (e) {
      result.status = 'error';
      result.note = '检测过程抛出异常：' + (e && e.message ? e.message : String(e));
      return Promise.resolve(result);
    }
    result.status = detected.status;
    result.note = detected.note || '';

    /* 3. 支持且声明了权限：查询 Permissions API 区分“可用”与“需要授权” */
    if ((result.status === 'supported' || result.status === 'partial') && feature.permissionName) {
      return queryPermission(feature.permissionName).then(function (state) {
        result.permissionState = state;
        if (state === 'prompt') {
          result.status = 'needs-permission';
          result.note = (result.note ? result.note + ' ' : '') + 'API 可用，但首次使用需用户授权。';
        } else if (state === 'denied') {
          result.status = 'needs-permission';
          result.note = (result.note ? result.note + ' ' : '') + '权限已被用户拒绝，需在浏览器设置中重新开启。';
        }
        return result;
      });
    }
    return Promise.resolve(result);
  }

  function detectAll() {
    return Promise.all(FEATURES.map(detectFeature));
  }

  global.FeatureDetectors = {
    FEATURES: FEATURES,
    STATUS_LABELS: STATUS_LABELS,
    detectAll: detectAll
  };
})(window);
