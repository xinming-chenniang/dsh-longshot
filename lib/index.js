/**
 * dsh-longshot —— 宿主半部。
 *
 * 问题：DSH 的图片准入把「单边 > 8192」「像素 > 6400 万」「字节 > 20 MiB」直接拒掉，
 * 手机长截图（1080x20000 之类）第一步就撞墙，用户拖进去只会看到
 * `IMAGE_DIMENSION_TOO_LARGE`。
 *
 * 做法：在**唯一**的 prompt 准入入口 `ctx.attachments.admitPromptContent()` 上挂一层，
 * 把超限的 image part 就地换成 N 张按直通预算切好的图。该方法的调用方
 * （`dsh-api-session-controller`）直接把返回值交给 `createUserMessage({content})`，
 * 数组长度从 1 变 4 不需要改任何下游。
 *
 * 为什么打在**原型**上而不是 `ctx.attachments.admitPromptContent = ...`：
 * `ctx.attachments` 是 Cordis 的 traceable proxy，它的 set trap 把赋值落到 shadow ctx，
 * 而不是 Service 实例；而 `Object.getPrototypeOf(proxy)` 会转发到真实实例的原型，
 * 在那里定义 own property 才能被后续所有 `get` 命中。
 *
 * 刻意不做：不改前端（拖入后的预览仍是原图，发送后才变多张）、不解 WebP/GIF、
 * 不因为插件自身故障阻断发送。
 */
import { DEFAULT_LIMITS } from './slice.js'
import { expandContent } from './expand.js'

/** 稳定插件名，必须与 `cordis.patch.yml` 的 insert id 一致。 */
export const name = 'dsh-longshot'

/** 需要附件存储服务才谈得上"准入"。 */
export const inject = ['attachments']

/** 面向用户的默认值；`enabled: false` 等价于没装。 */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  maxDimension: DEFAULT_LIMITS.maxDimension,
  maxPixels: DEFAULT_LIMITS.maxPixels,
  overlap: DEFAULT_LIMITS.overlap,
  maxSlices: DEFAULT_LIMITS.maxSlices,
})

/**
 * 合并并校验配置：非法值一律回落到默认值，不抛错。
 * @param {object|undefined} config - cordis.patch.yml 里的 config。
 * @returns {typeof DEFAULT_CONFIG} 完整配置。
 */
export function normalizeConfig(config) {
  const raw = config ?? {}
  const positive = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
  const nonNegative = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
  return {
    enabled: raw.enabled !== false,
    maxDimension: positive(raw.maxDimension, DEFAULT_CONFIG.maxDimension),
    maxPixels: positive(raw.maxPixels, DEFAULT_CONFIG.maxPixels),
    overlap: nonNegative(raw.overlap, DEFAULT_CONFIG.overlap),
    maxSlices: positive(raw.maxSlices, DEFAULT_CONFIG.maxSlices),
  }
}

/**
 * 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主插件上下文。
 * @param {object} [config] - 见 {@link DEFAULT_CONFIG}。
 */
export function apply(ctx, config) {
  const options = normalizeConfig(config)
  const logger = pickLogger(ctx)
  const log = (event) => {
    if (event.kind === 'error') logger.warn('[dsh-longshot]', event)
    else logger.info('[dsh-longshot]', event)
  }

  if (!options.enabled) {
    logger.info('[dsh-longshot] disabled by config')
    return
  }

  const store = ctx.attachments
  if (store === undefined || store === null) {
    logger.warn('[dsh-longshot] attachments service unavailable; plugin inactive')
    return
  }

  let proto
  let original
  try {
    proto = Object.getPrototypeOf(store)
    original = proto?.admitPromptContent
  } catch (error) {
    logger.warn('[dsh-longshot] cannot inspect attachments service:', String(error))
    return
  }
  if (typeof original !== 'function') {
    logger.warn('[dsh-longshot] admitPromptContent not found on the attachments service; plugin inactive')
    return
  }

  /** 包装后的准入：先展开，再交给原实现。 */
  const patched = async function admitPromptContentWithLongshot(content) {
    if (!Array.isArray(content)) return original.call(this, content)
    let expanded = content
    try {
      expanded = await expandContent(content, options, log)
    } catch (error) {
      // 展开失败只降级，不阻断发送。
      logger.warn('[dsh-longshot] expand failed; passing content through:', String(error))
    }
    return original.call(this, expanded)
  }

  ctx.effect(() => {
    proto.admitPromptContent = patched
    return () => {
      // 只还原自己写的那一层，避免踩到别人后来打的补丁。
      if (proto.admitPromptContent === patched) proto.admitPromptContent = original
    }
  }, 'dsh-longshot: admitPromptContent')

  logger.info(
    `[dsh-longshot] installed (maxDimension=${options.maxDimension}, maxPixels=${options.maxPixels}, overlap=${options.overlap})`,
  )
}

/**
 * 优先用 cordis 的 logger，拿不到就退回 console —— 日志失败绝不能影响主流程。
 * @param {object} ctx - 宿主上下文。
 * @returns {{info: Function, warn: Function}} 日志器。
 */
function pickLogger(ctx) {
  try {
    const logger = ctx.logger?.('dsh-longshot')
    if (logger && typeof logger.info === 'function') {
      return {
        info: (...args) => logger.info(...args),
        warn: (...args) => logger.warn(...args),
      }
    }
  } catch {
    // 落到 console
  }
  return {
    info: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
  }
}

export { expandContent }
