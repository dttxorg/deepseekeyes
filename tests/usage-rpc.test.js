import assert from 'node:assert/strict'
import test from 'node:test'
import { UsageTracker } from '../src/usage.js'
import {
  createUsageRpcHandler,
  installUsageRpc,
  USAGE_RPC_CHANNEL,
} from '../src/usage-rpc.js'

test('usage RPC snapshots and resets only with explicit confirmation', async () => {
  const tracker = new UsageTracker({ file: undefined })
  await tracker.recordCall('s', 'visionBase', { inputTokens: 10, outputTokens: 2 })
  const handle = createUsageRpcHandler(tracker)
  let result = await handle('usage.snapshot', {})
  assert.equal(result.ok, true)
  assert.equal(result.value.totals.derived.exactAdditionalTokens, 12)

  result = await handle('usage.reset', {})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'bad-request')

  result = await handle('usage.reset', { confirm: true })
  assert.equal(result.ok, true)
  assert.equal(result.value.totals.derived.exactAdditionalTokens, 0)
  assert.equal((await handle('missing', {})).error.code, 'not-found')
})

test('usage RPC registers a loopback-only model-free channel', async () => {
  let registration
  const tracker = new UsageTracker({ file: undefined })
  const connectionCtx = {
    connection: {
      rpc: {
        handle(channel, handler, options) {
          registration = { channel, handler, options }
          return () => Promise.resolve()
        },
      },
    },
  }
  const ctx = {
    inject(services, install) {
      assert.deepEqual(services, ['connection'])
      install(connectionCtx)
    },
  }
  installUsageRpc(ctx, tracker)
  assert.equal(registration.channel, USAGE_RPC_CHANNEL)
  assert.deepEqual(registration.options, { authority: 'loopback' })
  assert.equal((await registration.handler('usage.snapshot', {})).ok, true)
})
