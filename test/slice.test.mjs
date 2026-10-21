import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planSlices, needsSplit } from '../lib/slice.js'

/** 这片是否覆盖了 [top, bottom) 区间的每一行。 */
function covers(spans, height) {
  let cursor = 0
  for (const { top, bottom } of spans) {
    assert.ok(top <= cursor, `骨架断裂：片起点 ${top} 晚于已覆盖终点 ${cursor}`)
    cursor = Math.max(cursor, bottom)
  }
  return cursor >= height
}

test('1080x20000 切成 6 片，每片 1080x3883（Python 版实测基线）', () => {
  const spans = planSlices(1080, 20000)
  assert.ok(spans)
  assert.equal(spans.length, 6)
  for (const span of spans.slice(0, 5)) assert.equal(span.bottom - span.top, 3883)
  assert.equal(spans[0].top, 0)
  assert.equal(spans.at(-1).bottom, 20000)
  assert.ok(covers(spans, 20000))
})

test('1280x12719 切成 4 片（桌面那张真实长截图）', () => {
  const spans = planSlices(1280, 12719)
  assert.ok(spans)
  assert.equal(spans.length, 4)
  for (const span of spans.slice(0, 3)) assert.equal(span.bottom - span.top, 3276)
  assert.equal(spans.at(-1).bottom, 12719)
  assert.ok(covers(spans, 12719))
})

test('每片都不超过直通预算', () => {
  for (const [w, h] of [[1080, 20000], [1280, 12719], [750, 30000], [2560, 9000]]) {
    const spans = planSlices(w, h)
    assert.ok(spans, `${w}x${h} 应该可切`)
    for (const { top, bottom } of spans) {
      const ph = bottom - top
      assert.ok(w * ph <= 4194304, `${w}x${ph} 像素 ${w * ph} 超预算`)
      assert.ok(ph <= 8192, `片高 ${ph} 超长边`)
      assert.ok(ph > 48 || spans.length === 1, `片高 ${ph} 太窄，疑似碎片`)
    }
  }
})

test('已有重叠，相邻片共享 overlap 行', () => {
  const spans = planSlices(1280, 12719)
  for (let i = 1; i < spans.length; i++) {
    const shared = spans[i - 1].bottom - spans[i].top
    assert.ok(shared >= 40, `第 ${i} 片重叠只有 ${shared} 行`)
  }
})

test('合规尺寸原样返回单片', () => {
  const spans = planSlices(1440, 900)
  assert.deepEqual(spans, [{ top: 0, bottom: 900 }])
})

test('宽超单边返回 null（切片救不了）', () => {
  assert.equal(planSlices(9000, 200), null)
  assert.equal(planSlices(20000, 100), null)
})

test('非法输入返回 null', () => {
  assert.equal(planSlices(0, 100), null)
  assert.equal(planSlices(100, 0), null)
  assert.equal(planSlices(1.5, 100), null)
  assert.equal(planSlices(-1, -1), null)
})

test('needsSplit 只对超限图为真', () => {
  assert.equal(needsSplit(1440, 900, 200_000), false)
  assert.equal(needsSplit(1280, 12719, 1_800_000), true) // 单边超 8192
  assert.equal(needsSplit(8000, 8000, 1_000_000), true) // 6400 万像素 = 上限，不超；但 8000x8000=64,000,000 恰好等于
  assert.equal(needsSplit(8192, 8192, 1_000_000), true) // 67M 像素
  assert.equal(needsSplit(1000, 1000, 21 * 1024 * 1024), true) // 字节超 20 MiB
  assert.equal(needsSplit(1000, 1000, 1000), false)
})
