# dsh-longshot —— 开发指针

> DSH 宿主插件：拖入超长截图时，在 prompt 准入前把图切成多张，让 DSH 不再拒收。
> 任何一步做不了都降级为原图透传，不阻断发消息。

## 当前状态

- 版本 **0.1.0**，发布在 npm：`dsh-longshot`
- 测试：`node --test` → 28/28（`test-fixtures/longshot.mjs` 首次运行生成 1280×12719 长图，
  不依赖本机文件）
- 定位：只解决「被拒收」（单边 > 8192 / 像素超预算）。「被压糊」不是本插件目标，
  那件事交给 [`dsh-image-tiler`](https://github.com/Ssrs-Pro-Max/dsh-image-tiler)。

## 硬规则

- 准入路径只做「展开」：解码与切图在 `lib/codec.js`，`lib/index.js` 只挂一层包装。
- 任何异常都必须降级为原图透传，不能阻断用户发消息。
- 依赖 DSH 的 `ctx.attachments.admitPromptContent()`（Cordis 原型补丁）。API 改名或移走后
  插件记一条错误日志并自动停用，不崩、不污染准入流程。
- 发版：`node --test` 全绿 + 更新 `CHANGELOG.md`，再 `npm publish`。
- 测试不引用本机绝对路径；大夹具放 `test-fixtures/`，生成缓存已在 `.gitignore`。
- 不使用原生依赖（`sharp` 等）：插件模块从 profile 解析，解析链走不到 DSH 自带二进制。
