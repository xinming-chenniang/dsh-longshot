import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { expandContent } from '../lib/expand.js'
import { probe } from '../lib/codec.js'
import { sampleLongJpegBase64 } from '../test-fixtures/longshot.mjs'

const sampleB64 = sampleLongJpegBase64()

/** 收集日志，方便断言"为什么没切"。 */
function collector() {
  const events = []
  return { events, log: (event) => events.push(event) }
}

/** 造一张小 PNG（合规尺寸）。 */
function tinyPng(width = 200, height = 120) {
  const data = Buffer.alloc(width * height * 4, 200)
  return PNG.sync.write({ width, height, data }, { colorType: 6, deflateLevel: 1 })
}

test('真实长截图：1 张变 4 张，命名与顺序正确', async () => {
  const { events, log } = collector()
  const content = [{ type: 'text', text: '看这张账单' }, { type: 'image', mediaType: 'image/jpeg', data: sampleB64, name: '账单.jpg' }]
  const out = await expandContent(content, {}, log)

  assert.equal(out.length, 5)
  assert.deepEqual(out[0], { type: 'text', text: '看这张账单' })
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'split')
  assert.equal(events[0].to, 4)

  const images = out.slice(1)
  assert.deepEqual(
    images.map((p) => p.name),
    ['账单-01.jpg', '账单-02.jpg', '账单-03.jpg', '账单-04.jpg'],
  )
  for (const image of images) {
    assert.equal(image.type, 'image')
    assert.equal(image.mediaType, 'image/jpeg')
    const head = probe(Buffer.from(image.data, 'base64'))
    assert.equal(head.width, 1280)
    assert.ok(head.height <= 3276)
  }
})

test('合规小图原样透传（对象引用都不变，零解码）', async () => {
  const { events, log } = collector()
  const part = { type: 'image', mediaType: 'image/png', data: tinyPng().toString('base64'), name: 'small.png' }
  const out = await expandContent([part], {}, log)
  assert.equal(out.length, 1)
  assert.equal(out[0], part)
  assert.equal(events.length, 0)
})

test('图文混排时切片插在原位，文本顺序不变', async () => {
  const content = [
    { type: 'text', text: '前' },
    { type: 'image', mediaType: 'image/jpeg', data: sampleB64, name: 'a.jpg' },
    { type: 'text', text: '后' },
  ]
  const out = await expandContent(content)
  assert.equal(out[0].text, '前')
  assert.equal(out.at(-1).text, '后')
  assert.equal(out.length, 6)
})

test('无法识别的字节原样透传，不抛错', async () => {
  const { events, log } = collector()
  const part = { type: 'image', mediaType: 'image/png', data: Buffer.from('garbage').toString('base64') }
  const out = await expandContent([part], {}, log)
  assert.equal(out.length, 1)
  assert.equal(out[0], part)
  assert.equal(events[0].reason, 'unrecognized-format')
})

test('缺 data 的 part 原样透传', async () => {
  const part = { type: 'image', mediaType: 'image/png' }
  const out = await expandContent([part])
  assert.equal(out[0], part)
})

test('张数护栏：消息里已有 18 张时不切，避免超过 20 张上限', async () => {
  const { events, log } = collector()
  const filler = Array.from({ length: 18 }, () => ({
    type: 'image',
    mediaType: 'image/png',
    data: tinyPng(80, 60).toString('base64'),
  }))
  const long = { type: 'image', mediaType: 'image/jpeg', data: sampleB64, name: 'x.jpg' }
  const out = await expandContent([...filler, long], {}, log)
  assert.equal(out.length, 19)
  assert.equal(out.at(-1), long, '超限时应原样透传原图')
  assert.equal(events[0].reason, 'batch-would-exceed')
})

test('maxSlices 护栏：超过配置上限时透传', async () => {
  const { events, log } = collector()
  const part = { type: 'image', mediaType: 'image/jpeg', data: sampleB64 }
  const out = await expandContent([part], { maxSlices: 2 }, log)
  assert.equal(out.length, 1)
  assert.equal(out[0], part)
  assert.equal(events[0].reason, 'too-many-slices')
})

test('非 image part 一概不碰', async () => {
  const content = [
    { type: 'text', text: 'hello' },
    { type: 'file', attachment: { attachmentId: 'sha256:abc' } },
  ]
  const out = await expandContent(content)
  assert.deepEqual(out, content)
})
