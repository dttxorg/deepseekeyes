import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'

test('configuration resolves Harness defaults and a private evidence path', () => {
  const config = resolveConfig({}, {}, '/test-home')
  assert.equal(config.providerId, 'deepseekeyes')
  assert.equal(config.upstreamProvider, 'deepseek-official')
  assert.equal(config.visionProvider, undefined)
  assert.equal(config.activeProbe, true)
  assert.equal(config.cacheDir, '/test-home/.deepseekeyes/deepseekeyes/evidence')
})

test('configuration accepts environment-selected Harness vision route', () => {
  const config = resolveConfig({}, {
    DSH_HOME: '/dsh-home',
    DEEPSEEKEYES_VISION_PROVIDER: 'configured-provider',
    DEEPSEEKEYES_VISION_MODEL: 'vision-1',
  }, '/unused')
  assert.equal(config.visionProvider, 'configured-provider')
  assert.equal(config.visionModel, 'vision-1')
  assert.equal(config.cacheDir, '/dsh-home/deepseekeyes/evidence')
})

test('configuration rejects a model without a provider and recursive upstream id', () => {
  assert.throws(() => resolveConfig({ visionModel: 'x' }, {}, '/tmp'), /requires visionProvider/)
  assert.throws(
    () => resolveConfig({ providerId: 'same', upstreamProvider: 'same' }, {}, '/tmp'),
    /must differ/,
  )
})

test('configuration bounds visual clarification rounds', () => {
  assert.throws(() => resolveConfig({ maxClarifications: 9 }, {}, '/tmp'), /0 through 8/)
  assert.equal(resolveConfig({ maxClarifications: 0 }, {}, '/tmp').maxClarifications, 0)
})
