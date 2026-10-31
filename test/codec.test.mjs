import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { probe, sliceImage } from '../lib/codec.js'
import { planSlices } from '../lib/slice.js'
import { sampleLongJpeg } from '../test-fixtures/longshot.mjs'

test('probe 读完头部就能拿到 1280x12719', () => {
  const head = probe(sampleLongJpeg())
  assert.deepEqual(head, { format: 'jpeg', width: 1280, height: 12719 })
})

test('真实长截图切成 4 片，尺寸与字节都合规', () => {
  const bytes = sampleLongJpeg()
  const slices = sliceImage(bytes, planSlices(1280, 12719))
  assert.equal(slices.length, 4)
  for (const s of slices) {
    assert.equal(s.width, 1280)
    assert.ok(s.height <= 3276, `片高 ${s.height} 超预算`)
    assert.ok(s.data.length <= 4 * 1024 * 1024, `片字节 ${s.data.length} 超 4 MiB`)
    const head = probe(s.data)
    assert.equal(head.format, 'jpeg')
    assert.equal(head.width, 1280)
    assert.equal(head.height, s.height)
  }
  assert.equal(slices[0].height, 3276)
  const total = slices.reduce((n, s) => n + s.height, 0)
  assert.ok(total >= 12719, '切片必须覆盖整图')
})

test('非图片字节返回 null', () => {
  assert.equal(probe(Buffer.from('not an image at all, just text')), null)
  assert.equal(probe(Buffer.alloc(8)), null)
})

test('PNG 往返：手工造一张窄长 PNG 并切两片', () => {
  const width = 64
  const height = 9000
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = y % 256
      data[i + 1] = x % 256
      data[i + 2] = 128
      data[i + 3] = 255
    }
  }
  const png = PNG.sync.write({ width, height, data }, { colorType: 6, deflateLevel: 1 })
  assert.deepEqual(probe(png), { format: 'png', width, height })
  const spans = planSlices(width, height)
  assert.equal(spans.length, 2)
  const slices = sliceImage(png, spans)
  assert.equal(slices.length, 2)
  for (const s of slices) {
    assert.equal(s.mediaType, 'image/png')
    const head = probe(s.data)
    assert.equal(head.format, 'png')
    assert.equal(head.width, width)
    assert.equal(head.height, s.height)
  }
})
