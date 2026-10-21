# dsh-longshot

拖入超长截图时自动切成多张，让 DSH 不再拒收。

## 它解决什么

DSH 的图片准入（`@deepseek-ai/dsh-attachment-local`）有三条硬限制：

| 限制 | 默认值 | 超出后的错误码 |
|---|---|---|
| 单边（宽或高） | 8192 px | `IMAGE_DIMENSION_TOO_LARGE` |
| 总像素 | 64,000,000 | `IMAGE_TOO_MANY_PIXELS` |
| 单张字节 | 20 MiB | `IMAGE_TOO_LARGE` |

手机长截图常见 `1080×20000`，第一步就撞上 8192。**即使侥幸放进去**，入库时还会被压到
4,194,304 像素（≈2048×2048），`20000` 高会被压成 `465×8616`，字全糊。

本插件在 prompt 准入前把长图**按直通预算纵向切片**，每片都落在
「4,194,304 像素 / 长边 8192 / 4 MiB」以内 —— 也就是 DSH 归一化的直通区间，
**一次重压缩都不会触发**，画质就是原图。

## 行为

- 拖入/粘贴一张 `1280×12719` 的图 → 发送后历史里出现 4 张 `1280×3276`。
- 合规尺寸的图（如 `1440×900`）**完全不走解码路径**，字节原样透传，零开销。
- 切片按原位置插入，同一条消息里的文字顺序不变。
- 片间有 48 px 重叠，避免把一行字劈成两半。
- 命名沿用原名：`账单.jpg` → `账单-01.jpg` … `账单-04.jpg`。

## 配置

写在 profile 的 `cordis.patch.yml`：

```yaml
- id: dsh-longshot
  name: dsh-longshot
  config:
    enabled: true
    maxDimension: 8192        # 每片长边上限
    maxPixels: 4194304        # 每片像素预算（DSH 归一化直通值）
    overlap: 48               # 相邻片重叠像素
    maxSlices: 18             # 单张图最多切几片（留余量给同消息的其它图）
```

非法值一律回落到默认值，不会因为写错一个数字就装不上。

## 安装

```sh
cd dsh-longshot
pnpm install          # 只装 jpeg-js + pngjs，纯 JS，无编译
```

然后在这个 DSH 的 profile 里挂上（`~/.dsh/profiles/<profile>/package.json`）：

```json
{
  "dependencies": { "dsh-longshot": "link:D:/path/to/dsh-longshot" },
  "dsh": { "profile": { "bundles": ["...", "dsh-longshot"] } }
}
```

`bundles` 那一行是**真正决定装不装**的开关 —— 只加依赖不加它，插件静默不装载。

最后重启 DSH 应用（host 插件不热更）。启动日志里应出现：

```
[dsh-longshot] installed (maxDimension=8192, maxPixels=4194304, overlap=48)
```

## 卸载 / 回滚

- 临时关闭：`config.enabled: false`，重启。
- 彻底移除：从 `bundles` 删掉 `dsh-longshot`，`pnpm remove dsh-longshot`，重启。
- 插件自身故障**不会**阻断发消息：任何异常都降级为「原样透传原图」，DSH 原生错误照旧出现。

## 为什么不改前端

`ctx.attachments.admitPromptContent()` 是 Web prompt 的唯一准入入口
（`dsh-api-session-controller`），粘贴、拖拽、命令面板、远程客户端都经过它；
而且它的返回值直接喂给 `createUserMessage({content})`，数组长度 1→4 不需要动任何下游。

前端反而做不到：`addFiles` 是 conversation 内部的闭包，插件拿不到；而且 canvas 单边上限
16384，`20000` 高的图在浏览器里会静默失败。

## 与同类插件的关系

动手写之前先查过：这个赛道已经有人，而且不止一个。其中最完整的是
[**`dsh-image-tiler`**](https://github.com/Ssrs-Pro-Max/dsh-image-tiler)，走的正是同一条路 ——
同样重写 `ctx.attachments.admitPromptContent()`，同样在准入前把原图换成多张。
**如果你只是想要一个现成的、能看懂大图的插件，优先装它。**

两者解决的不是同一个问题：它主要对付「**被压糊**」（一张图最多 1024 视觉 token，大图会被缩），
本插件主要对付「**被拒收**」（单边 > 8192 直接 `IMAGE_DIMENSION_TOO_LARGE`）。

|  | dsh-image-tiler | dsh-longshot |
|---|---|---|
| 切法 | 2D 网格，**不重叠** | 纵向条，**48 px 重叠** |
| `8000×8000` 方图 | 切 20 块，清晰 | 不处理（不超限，直接过 → 被压糊） |
| `1280×12719` 长图 | 花满 20 块预算 | 4 片 × `1280×3276`，吃满 token 预算 |
| 切片断字 | **会**（其自述的已知限制） | 不会 |
| 运行时依赖 | `sharp`（原生二进制） | `jpeg-js` + `pngjs`（纯 JS，无编译） |
| 装载方式 | `disabled: true` 官方 `attachment-local`，**顶替整个服务** | 只包一个方法，官方服务照常 |
| WebP / GIF | 支持 | 不支持 |

坦率讲：**功能上它是超集**。本插件存在的理由只是三条更窄的需求 —— 不想装原生依赖、
切缝不许断字、以及不能顶替附件服务（例如已经给 `attachment-local` 配过非默认上限，
或同时用了别的依赖官方 store 的插件）。

两者**互斥**：都接管 `attachments` 的准入，不能同时启用。

> 对比基于 `dsh-image-tiler` 0.1.6（2026-10-10 发布）的 npm 包源码与 README，2026-10-22 核对。
> 未在本机实际安装运行过它，对方的行为描述来自其代码与自述，不是我的实测。

## 已知限制

- **WebP / GIF 不切**：这两个格式没有纯 JS 解码器，命中时原样透传（报 DSH 原生错误）。
- **发送前预览仍是 1 张**：切片发生在准入时，所以拖入后到发送前看到的还是原图。
- **多图 = 多 token**：切成 4 张，视觉 token 大约 4 倍。这是"能看清"的必要代价。
- **宽幅全景图也会被切**：判断依据只有尺寸，没有内容识别。
- **依赖 Cordis 原型上的 `admitPromptContent`**：DSH 升级若把它改名或挪走，
  插件会记一条错误日志并自动停用，不会崩、也不会污染准入流程。

## 测试

```sh
node --test test/*.test.mjs
```

28 条，覆盖：切片几何（含 `1080×20000` / `1280×12719` 回归基线）、真实 JPEG 端到端、
PNG 往返、透传、张数护栏、故障降级。

其中 `test/install.test.mjs` 按 Cordis 的 `createTraceable` 语义复刻了 proxy 行为
—— `get` 会把 `this` 换成 shadow ctx，`set` 落到 shadow 而不落实例 —— 补丁必须在这两条约束下
仍然生效、且 `dispose` 后能还原。这是本插件最容易错的地方，所以单独锁住。

`test/codec.test.mjs` 里依赖本机真实截图的用例在文件缺失时会自动 skip，不会在别的机器上假红。

> **另做过一次真 Cordis 验证**（一次性探针，不随包发布）：从 DSH 的 `app.asar` 取出
> `@deepseek-ai/cordis`，建真 `Context` + 一个假 `attachments` Service，装插件后调用
> `ctx.attachments.admitPromptContent()`，断言 `1280×12719` 变成 4 张、每张 < 4 MiB、
> `dispose` 后恢复为 1 张 —— 9/9 通过。
> 做这一步是为了排除「模拟的 proxy 语义和真实实现不一致」这个风险，模拟测试本身证明不了它。
