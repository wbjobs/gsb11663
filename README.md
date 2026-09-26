# 浏览器特性检测工具

纯静态页面，只做检测与展示，不含业务功能。

## 运行

```bash
# 任选其一，然后访问 http://localhost:8000
python3 -m http.server 8000
npx serve .
```

> 注意：直接 `file://` 打开时部分浏览器会限制 IndexedDB / Service Worker，建议用本地 HTTP 服务。
> 用 `http://` 非 localhost 访问可验证“非安全上下文”分支。

## 功能

- 检测 14 项特性：ResizeObserver、IntersectionObserver、BroadcastChannel、IndexedDB、Web Worker、Service Worker、Web Crypto、Clipboard、Notifications、Geolocation、WebSocket、localStorage、WebGL、Fetch、Permissions API
- 状态区分：支持 / 部分支持（附说明）/ 不支持 / 需要权限（Permissions API 查询）/ 需要安全上下文 / 检测失败
- 每项给出降级建议
- 检测历史保存到 IndexedDB，可恢复查看、删除
- 误判修正：人工覆盖检测结果并持久化，后续检测自动应用
- 结果可导出为 JSON

## 浏览器差异处理

- IndexedDB / Notifications / WebSocket 检查厂商前缀实现，命中记为“部分支持”
- localStorage 实际写入验证，避免隐私模式下误判
- Permissions API 不认识的权限名静默降级，不报错
