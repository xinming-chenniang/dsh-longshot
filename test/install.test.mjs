import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, normalizeConfig, name as pluginName, inject } from '../lib/index.js'
import { sampleLongJpegBase64 } from '../test-fixtures/longshot.mjs'

const sampleB64 = sampleLongJpegBase64()

/** 忠实模拟 Cordis Service：方法在原型上，实例状态在实例上。 */
class FakeAttachmentStore {
  constructor() {
    this.accepted = []
  }
  async saveImages(inputs) {
    this.accepted.push(...inputs)
    return inputs.map((input, index) => ({ attachmentId: `sha256:${index}`, mediaType: input.mediaType }))
  }
  async admitPromptContent(content) {
    const refs = await this.saveImages(content.filter((part) => part.type === 'image'))
    let next = 0
    return content.map((part) => (part.type === 'image' ? { type: 'image', attachment: refs[next++] } : part))
  }
}

/**
 * 复刻 Cordis 的两条关键语义：
 *  1. `get` 方法时把 this 换成 shadow ctx（`createShadowMethod` 的行为）；
 *  2. `set` 落到 shadow ctx，**不落到 Service 实例**。
 * 我们的补丁必须在这两条约束下仍然生效。
 */
function traceable(store) {
  const shadow = Object.create(store)
  return new Proxy(store, {
    get(target, prop) {
      const value = target[prop]
      if (typeof value === 'function') return (...args) => value.apply(shadow, args)
      return value
    },
    set(_target, prop, value) {
      shadow[prop] = value
      return true
    },
  })
}

function fakeCtx(store) {
  const disposers = []
  return {
    attachments: traceable(store),
    logger: () => ({ info() {}, warn() {} }),
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    disposeAll() {
      while (disposers.length > 0) disposers.pop()()
    },
  }
}

test('插件元信息与 patch 入口约定一致', () => {
  assert.equal(pluginName, 'dsh-longshot')
  assert.deepEqual(inject, ['attachments'])
})

test('打在原型上而不是 proxy 上：赋值不走 Cordis 的 set trap', () => {
  const store = new FakeAttachmentStore()
  const ctx = fakeCtx(store)
  const before = Object.getPrototypeOf(ctx.attachments).admitPromptContent
  apply(ctx, {})
  const after = Object.getPrototypeOf(ctx.attachments).admitPromptContent
  assert.notEqual(after, before, '原型方法必须被替换')
  assert.equal(Object.hasOwn(store, 'admitPromptContent'), false, '不该在实例上留 own property')
  ctx.disposeAll()
})

test('超长图经 proxy 调用后被切成 4 张进入准入', async () => {
  const store = new FakeAttachmentStore()
  const ctx = fakeCtx(store)
  apply(ctx, {})
  const content = [{ type: 'image', mediaType: 'image/jpeg', data: sampleB64, name: 'bill.jpg' }]
  const admitted = await ctx.attachments.admitPromptContent(content)
  assert.equal(store.accepted.length, 4, `准入应当收到 4 张，实际 ${store.accepted.length}`)
  assert.equal(admitted.length, 4)
  for (const input of store.accepted) {
    assert.equal(input.mediaType, 'image/jpeg')
    assert.ok(Buffer.from(input.data, 'base64').length > 0)
  }
  ctx.disposeAll()
})

test('合规图在不切的情况下照常通过（不改变个数）', async () => {
  const store = new FakeAttachmentStore()
  const ctx = fakeCtx(store)
  apply(ctx, {})
  const content = [{ type: 'text', text: 'hi' }, { type: 'file', attachment: { attachmentId: 'sha256:x' } }]
  const admitted = await ctx.attachments.admitPromptContent(content)
  assert.equal(admitted.length, 2)
  assert.equal(store.accepted.length, 0)
  ctx.disposeAll()
})

test('dispose 后原方法恢复，行为回到未安装', async () => {
  const store = new FakeAttachmentStore()
  const ctx = fakeCtx(store)
  apply(ctx, {})
  ctx.disposeAll()
  const content = [{ type: 'image', mediaType: 'image/jpeg', data: sampleB64 }]
  const admitted = await ctx.attachments.admitPromptContent(content)
  assert.equal(admitted.length, 1, '卸载后应恢复成 1 张')
  assert.equal(store.accepted.length, 1)
})

test('enabled:false 时不打补丁', () => {
  const store = new FakeAttachmentStore()
  const ctx = fakeCtx(store)
  const before = Object.getPrototypeOf(ctx.attachments).admitPromptContent
  apply(ctx, { enabled: false })
  assert.equal(Object.getPrototypeOf(ctx.attachments).admitPromptContent, before)
})

test('服务缺失时不抛错，只是不激活', () => {
  const ctx = { logger: () => ({ info() {}, warn() {} }), effect() {} }
  assert.doesNotThrow(() => apply(ctx, {}))
})

test('normalizeConfig 把非法值回落成默认值', () => {
  const config = normalizeConfig({ maxDimension: -1, maxPixels: 'big', overlap: -5, maxSlices: 0, enabled: 0 })
  assert.equal(config.maxDimension, 8192)
  assert.equal(config.maxPixels, 4194304)
  assert.equal(config.overlap, 48)
  assert.equal(config.maxSlices, 18)
  assert.equal(config.enabled, true)
  assert.equal(normalizeConfig({ enabled: false }).enabled, false)
  assert.equal(normalizeConfig(undefined).enabled, true)
})
