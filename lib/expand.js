/**
 * 把一条 prompt 里的超限图片就地展开成多张切片。
 *
 * 契约：**永远返回可被 DSH 准入的 content**。
 * 任何一步做不了（格式不认识、切完张数超限、内部异常），都把原 part 原样放回去，
 * 让 DSH 报它自己的错误 —— 绝不让插件坏了导致用户发不出消息。
 */
import { probe, sliceImage } from './codec.js'
import { DEFAULT_LIMITS, needsSplit, planSlices } from './slice.js'

/** DSH 的 maxImagesPerMessage 默认值。 */
export const MAX_IMAGES_PER_MESSAGE = 20

/** 单张切片字节目标（DSH normalizedImageMaxBytes）。 */
const SLICE_MAX_BYTES = 4 * 1024 * 1024

/**
 * 展开一条 prompt 的 content。
 * @param {Array<object>} content - DSH prompt parts（text / image / file）。
 * @param {object} [options] - 切片限制，见 {@link DEFAULT_LIMITS}。
 * @param {(event: object) => void} [log] - 结构化日志回调。
 * @returns {Promise<Array<object>>} 展开后的 content；顺序保持不变。
 */
export async function expandContent(content, options = {}, log = () => {}) {
  const limits = { ...DEFAULT_LIMITS, ...options }
  let imageCount = content.reduce((n, part) => n + (part?.type === 'image' ? 1 : 0), 0)
  const out = []

  for (const part of content) {
    if (part?.type !== 'image') {
      out.push(part)
      continue
    }
    const expanded = expandPart(part, limits, imageCount, log)
    out.push(...expanded)
    imageCount += expanded.length - 1
  }
  return out
}

/**
 * 展开单张图片。
 * @param {object} part - 一个 image part（`{type:'image', mediaType, data, name?}`）。
 * @param {object} limits - 已合并默认值的限制。
 * @param {number} currentCount - 当前消息里的图片总数（含这一张）。
 * @param {(event: object) => void} log - 日志回调。
 * @returns {Array<object>} 一个或多个 image part。
 */
function expandPart(part, limits, currentCount, log) {
  let bytes
  try {
    if (typeof part.data !== 'string' || part.data === '') return [part]
    bytes = Buffer.from(part.data, 'base64')
  } catch {
    return [part]
  }
  if (bytes.length === 0) return [part]

  const head = probe(bytes)
  if (head === null) {
    log({ kind: 'skip', reason: 'unrecognized-format', bytes: bytes.length })
    return [part]
  }
  if (!needsSplit(head.width, head.height, bytes.length, limits)) return [part]

  const spans = planSlices(head.width, head.height, limits)
  if (spans === null || spans.length <= 1) {
    log({ kind: 'skip', reason: 'unsplittable', width: head.width, height: head.height })
    return [part]
  }
  if (spans.length > limits.maxSlices) {
    log({ kind: 'skip', reason: 'too-many-slices', slices: spans.length, limit: limits.maxSlices })
    return [part]
  }
  if (currentCount - 1 + spans.length > MAX_IMAGES_PER_MESSAGE) {
    log({ kind: 'skip', reason: 'batch-would-exceed', slices: spans.length, currentCount })
    return [part]
  }

  try {
    const slices = sliceImage(bytes, spans, { maxBytes: SLICE_MAX_BYTES })
    const base = stripExtension(part.name ?? '')
    const parts = slices.map((slice, index) => ({
      type: 'image',
      mediaType: slice.mediaType,
      data: slice.data.toString('base64'),
      name: `${base}-${String(index + 1).padStart(2, '0')}.${slice.ext}`,
    }))
    log({
      kind: 'split',
      from: `${head.width}x${head.height}`,
      to: slices.length,
      sizes: slices.map((s) => `${s.width}x${s.height}/${Math.round(s.data.length / 1024)}KB`),
    })
    return parts
  } catch (error) {
    log({ kind: 'error', reason: 'slice-failed', message: String(error?.message ?? error) })
    return [part]
  }
}

/**
 * 去掉文件扩展名，用于生成 `原名-01.png` 之类的名字。
 * @param {string} name - 原始文件名，可能为空。
 * @returns {string} 不含扩展名的基名。
 */
function stripExtension(name) {
  const trimmed = name.trim()
  if (trimmed === '') return 'longshot'
  const dot = trimmed.lastIndexOf('.')
  return dot > 0 ? trimmed.slice(0, dot) : trimmed
}
