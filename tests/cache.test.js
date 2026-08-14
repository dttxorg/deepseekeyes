import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EvidenceCache } from '../src/cache.js'

test('evidence cache persists and reopens an immutable keyed record', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseekeyes-cache-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const first = new EvidenceCache({ directory, persistent: true, logger: { warn() {} } })
  await first.write('abc', { kind: 'base', source: { sha256: '123' } })
  const raw = JSON.parse(await readFile(join(directory, 'abc.json'), 'utf8'))
  assert.equal(raw.cacheKey, 'abc')

  const reopened = new EvidenceCache({ directory, persistent: true, logger: { warn() {} } })
  const record = await reopened.read('abc')
  assert.equal(record.source.sha256, '123')
  record.source.sha256 = 'changed outside'
  assert.equal((await reopened.read('abc')).source.sha256, '123')
})
