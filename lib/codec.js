/**
 * PNG / JPEG 的解码、纵向裁剪、再编码。纯本地，不依赖 sharp。
 *
 * 为什么不用 sharp：host 插件模块从 profile 目录解析，解析链走不到 DSH 自带的 asar，
 * 所以解码器必须自带。jpeg-js 与 pngjs 都是纯 JS、无原生编译，装上就能跑。
 */
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

/** JPEG SOFn 标记（含基线/渐进/无损，但不含 C4/C8/CC 的算术编码变体）。 */
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/**
 * 只读文件头拿尺寸，不解码像素。
 * @param {Buffer} bytes - 完整编码字节。
 * @returns {{format: 'png'|'jpeg', width: number, height: number}|null} 无法识别时返回 null。
 */
export function probe(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24) return null
  // PNG：8 字节签名 + IHDR，宽高在 16/20（大端）。
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    return width > 0 && height > 0 ? { format: 'png', width, height } : null
  }
  // JPEG：FFD8 开头，扫到第一个 SOFn。
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++
        continue
      }
      const marker = bytes[offset + 1]
      // 填充字节
      if (marker === 0xff) {
        offset++
        continue
      }
      // 无长度字段的标记
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2
        continue
      }
      const length = bytes.readUInt16BE(offset + 2)
      if (length < 2) return null
      if (SOF_MARKERS.has(marker)) {
        const height = bytes.readUInt16BE(offset + 5)
        const width = bytes.readUInt16BE(offset + 7)
        return width > 0 && height > 0 ? { format: 'jpeg', width, height } : null
      }
      offset += 2 + length
    }
    return null
  }
  return null
}

/**
 * 解码成 RGBA。
 * @param {Buffer} bytes - 编码字节。
 * @param {'png'|'jpeg'} format - 已由 {@link probe} 判定的格式。
 * @returns {{width: number, height: number, data: Buffer}} RGBA 像素。
 */
export function decode(bytes, format) {
  if (format === 'png') {
    const png = PNG.sync.read(bytes)
    return { width: png.width, height: png.height, data: Buffer.from(png.data) }
  }
  const decoded = jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: true,
    maxResolutionInMP: 200,
    maxMemoryUsageInMB: 1024,
  })
  return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength) }
}

/**
 * 按行区间裁出一片。
 * @param {Buffer} rgba - 整图 RGBA。
 * @param {number} width - 整图宽度。
 * @param {number} top - 起始行（含）。
 * @param {number} bottom - 结束行（不含）。
 * @returns {Buffer} 该片的 RGBA。
 */
export function crop(rgba, width, top, bottom) {
  const rowBytes = width * 4
  return Buffer.from(rgba.subarray(top * rowBytes, bottom * rowBytes))
}

/**
 * 编码一片；PNG 超出字节目标时改 JPEG，与 DSH 自己的降级策略一致。
 * @param {Buffer} rgba - 该片 RGBA。
 * @param {number} width - 片宽。
 * @param {number} height - 片高。
 * @param {'png'|'jpeg'} prefer - 源格式。
 * @param {number} maxBytes - 单张字节目标。
 * @returns {{data: Buffer, mediaType: string, ext: string}} 编码结果。
 */
export function encode(rgba, width, height, prefer, maxBytes) {
  if (prefer === 'png') {
    const png = PNG.sync.write({ width, height, data: rgba }, { colorType: 6, deflateLevel: 9, filterType: -1 })
    if (png.length <= maxBytes) return { data: png, mediaType: 'image/png', ext: 'png' }
  }
  let quality = 92
  let out = jpeg.encode({ data: rgba, width, height }, quality).data
  while (out.length > maxBytes && quality > 60) {
    quality -= 8
    out = jpeg.encode({ data: rgba, width, height }, quality).data
  }
  return { data: out, mediaType: 'image/jpeg', ext: 'jpg' }
}

/**
 * 把一张整图按规划好的区间切开。
 * 逐片裁剪-编码-释放，避免同时持有 N 份 RGBA。
 * @param {Buffer} bytes - 原图字节。
 * @param {Array<{top: number, bottom: number}>} spans - {@link planSlices} 的结果。
 * @param {object} [opts] - `maxBytes` 单张字节目标。
 * @returns {Array<{data: Buffer, width: number, height: number, mediaType: string, ext: string}>} 切片。
 */
export function sliceImage(bytes, spans, opts = {}) {
  const maxBytes = opts.maxBytes ?? 4 * 1024 * 1024
  const head = probe(bytes)
  if (head === null) throw new Error('dsh-longshot: 无法识别图片格式')
  const image = decode(bytes, head.format)
  const out = []
  for (const { top, bottom } of spans) {
    const height = bottom - top
    const piece = crop(image.data, image.width, top, bottom)
    const encoded = encode(piece, image.width, height, head.format, maxBytes)
    out.push({ ...encoded, width: image.width, height })
  }
  return out
}
