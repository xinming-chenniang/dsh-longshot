# 变更史 —— dsh-longshot

> 按版本记录"改了什么、为什么、怎么验证的"。

## 0.1.1 — 2026-10-31

- 仓库转公开：GitHub Release（含 tarball 资产）可用；npm 暂未发布。
- 测试夹具自包含：`test-fixtures/longshot.mjs` 首次运行时生成 1280×12719 长图，不再依赖作者本机截图路径；
  此前在别人的机器与 CI 上会 skip 的 8 条端到端用例现在全跑（`node --test` 28/28）。
- 源码注释与测试中的本机绝对路径已移除；`AGENTS.md` 改写为公开版开发指引。
- 兼容性核实：DSH `0.2.1-rc.5` 上 `ctx.attachments.admitPromptContent()` 仍在 `AttachmentStore` 原型上、
  签名未变（解 `app.asar` 只读核实）；未在本版真机拖图。

## 0.1.0 — 2026-10-22

- 超长截图在 prompt 准入前自动切成 DSH 可接受的切片；切片带重叠，避免把一行字劈成两半。
- 纯 JS 依赖（`jpeg-js` + `pngjs`），无原生编译；不依赖 sharp。
- 展开失败降级为原图透传，不阻断发送；配置非法值回落到默认。
- 验证：`node --test` 28 / 28，含真实长图端到端与 Cordis traceable proxy 语义模拟。
- 已知限制：仅 JPEG/PNG；宽超过 8192 的图不切；单条消息最多 18 片。
