/**
 * 测试夹具：自包含的「真实长截图」。
 *
 * 早期版本直接读作者桌面上的真实截图，别的机器（以及 CI）上会静默 skip，
 * 导致端到端路径在发布后从未被别人跑过。这里改为生成一张同尺寸的长图，
 * 任何人都能复跑；生成一次后缓存在 test-fixtures/.cache/，不随仓库发布。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'

/** 与桌面那张真实长截图同尺寸，保住既有回归基线。 */
export const SAMPLE_WIDTH = 1280
export const SAMPLE_HEIGHT = 12719

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '.cache', 'longshot-1280x12719.jpg')

/**
 * 返回一张 1280×12719 的 JPEG 字节。
 *
 * 内容按 96 行一条色带铺开，模拟文字行：切缝落在带中间时肉眼可见，
 * 用来验证「片间重叠 48px 不会把一行劈成两半」。
 * @returns {Buffer} JPEG 字节。
 */
export function sampleLongJpeg() {
  if (existsSync(CACHE)) return readFileSync(CACHE)
  const data = Buffer.alloc(SAMPLE_WIDTH * SAMPLE_HEIGHT * 4)
  for (let y = 0; y < SAMPLE_HEIGHT; y++) {
    const band = Math.floor(y / 96)
    const r = (band * 37) % 256
    const g = (band * 91) % 256
    const b = (band * 53) % 256
    const row = y * SAMPLE_WIDTH * 4
    for (let x = 0; x < SAMPLE_WIDTH; x++) {
      const i = row + x * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  const encoded = jpeg.encode({ data, width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT }, 85).data
  mkdirSync(dirname(CACHE), { recursive: true })
  // 多个测试文件并行时可能同时生成：先写本进程临时文件，再原子改名，
  // 避免另一个进程读到写了一半的缓存。
  const staging = `${CACHE}.${process.pid}.tmp`
  writeFileSync(staging, encoded)
  renameSync(staging, CACHE)
  return encoded
}

/** 与 {@link sampleLongJpeg} 等价的 base64 字符串。 */
export function sampleLongJpegBase64() {
  return sampleLongJpeg().toString('base64')
}
