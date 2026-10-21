/**
 * 切片几何：纯函数，不碰 IO。
 *
 * 阈值来自 DSH 的 `@deepseek-ai/dsh-attachment-local`：
 *   - 准入：单边 ≤ 8192、像素 ≤ 64,000,000、字节 ≤ 20 MiB
 *   - 归一化直通：像素 ≤ 4,194,304、长边 ≤ 8192、字节 ≤ 4 MiB
 * 按"直通预算"切，切片就不会被 DSH 再压一遍。
 */

/** 默认限制；与 DSH 归一化预算对齐。 */
export const DEFAULT_LIMITS = Object.freeze({
  /** 单边上限（DSH maxImageDimension）。 */
  maxDimension: 8192,
  /** 每片像素预算（DSH normalizedImageMaxPixels）。 */
  maxPixels: 4194304,
  /** 相邻片重叠像素，防止把一行字劈成两半。 */
  overlap: 48,
  /** 一张图最多切多少片；留出余量给同一条消息里的其它图。 */
  maxSlices: 18,
})

/**
 * 按「宽不变、纵向切片、片间重叠」规划切片。
 * @param {number} width - 源图宽度（像素）。
 * @param {number} height - 源图高度（像素）。
 * @param {object} [options] - 覆盖 {@link DEFAULT_LIMITS} 的字段。
 * @returns {Array<{top: number, bottom: number}>|null} 切片区间；无法切片时返回 null。
 */
export function planSlices(width, height, options = {}) {
  const maxDimension = options.maxDimension ?? DEFAULT_LIMITS.maxDimension
  const maxPixels = options.maxPixels ?? DEFAULT_LIMITS.maxPixels
  const overlap = options.overlap ?? DEFAULT_LIMITS.overlap

  if (!Number.isInteger(width) || width <= 0) return null
  if (!Number.isInteger(height) || height <= 0) return null
  // 宽本身就超单边：纵向切片救不了它，交给 DSH 报原生错误。
  if (width > maxDimension) return null

  const sliceHeight = Math.min(maxDimension, Math.floor(maxPixels / width))
  if (sliceHeight < 1) return null
  if (height <= sliceHeight) return [{ top: 0, bottom: height }]

  const gap = Math.max(0, Math.min(overlap, Math.floor(sliceHeight / 4)))
  const spans = []
  let top = 0
  while (top < height) {
    let bottom = Math.min(top + sliceHeight, height)
    // 末尾只剩一条窄边时并进上一片，避免产出几乎全空的碎片。
    if (spans.length > 0 && bottom < height && height - bottom <= gap) bottom = height
    spans.push({ top, bottom })
    if (bottom >= height) break
    top = bottom - gap
  }
  return spans
}

/**
 * 这张图是否需要处理。
 * @param {number} width - 源宽。
 * @param {number} height - 源高。
 * @param {number} bytes - 编码字节数。
 * @param {object} [options] - 覆盖 {@link DEFAULT_LIMITS} 的字段。
 * @returns {boolean} 超限返回 true。
 */
export function needsSplit(width, height, bytes, options = {}) {
  const maxDimension = options.maxDimension ?? DEFAULT_LIMITS.maxDimension
  const maxPixels = options.maxPixels ?? DEFAULT_LIMITS.maxPixels
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024
  if (maxDimension >= Math.max(width, height) && width * height <= maxPixels && bytes <= maxBytes) return false
  return true
}
