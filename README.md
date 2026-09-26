# 浏览器特性检测工具

纯静态页面，无构建步骤。功能保持简单：只做**检测与展示**，不含业务功能。

## 使用

```bash
# 任选其一
python3 -m http.server 8080   # 然后访问 http://localhost:8080
npx serve .
```

> 建议用 HTTPS 或 localhost 访问，否则可直观看到"非安全上下文受限"状态。

## 检测的特性

ResizeObserver、IntersectionObserver、BroadcastChannel、IndexedDB、Web Worker、
Service Worker、Web Crypto、Clipboard API、Notifications、Geolocation。

## 状态说明

| 状态 | 含义 |
|---|---|
| 支持 | API 存在且可用（IndexedDB / Worker 做了真实实例化验证） |
| 部分支持 | API 存在但能力不完整（如 Clipboard 只支持写不支持读、隐私模式下 IndexedDB 打开失败） |
| 不支持 | API 不存在 |
| 需要权限 | API 存在，但需用户授权（Notifications / Geolocation / Clipboard 读取） |
| 非安全上下文受限 | API 存在，但仅在 HTTPS/localhost 下可用（Service Worker / Web Crypto subtle 等） |
| 检测异常 | 检测器自身抛异常，不影响其他特性 |

## 验收标准对应

- **区分不支持与需要权限**：通过 Permissions API（`navigator.permissions.query`）+ `Notification.permission` 判断授权状态。
- **非安全上下文识别**：`window.isSecureContext` + 各 API 的安全上下文要求。
- **部分支持说明**：每项给出具体缺失能力与原因。
- **检测结果可导出**：导出 JSON 文件 / 复制到剪贴板（含 execCommand 降级）。
- **历史可恢复**：每次检测快照存入 IndexedDB，可恢复查看、可删除。
- **误判修正机制**：每条结果可人工修正状态与备注，修正持久化并在后续检测中自动应用，可清除。
- **浏览器差异处理**：Permissions API 不认识的权限名会抛错（Safari/Firefox 行为不同），统一捕获降级；检测带前缀 API（webkitIndexedDB 等）；每个检测器独立 try/catch。

## 文件结构

- `index.html` — 页面结构
- `styles.css` — 样式
- `features.js` — 特性检测器定义（核心）
- `db.js` — IndexedDB 封装（历史 + 修正记录）
- `app.js` — UI 渲染、导出、历史管理、修正交互
