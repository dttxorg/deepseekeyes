import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowUrl = new URL('../.github/workflows/npm-publish.yml', import.meta.url)

test('npm release workflow treats an identical published package as idempotent success', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')

  assert.match(workflow, /name: Check for an existing identical package/)
  assert.match(workflow, /npm view "\$SPEC" dist\.tarball/)
  assert.match(workflow, /npm pack --ignore-scripts --json/)
  assert.match(workflow, /diff -qr "\$LOCAL_TREE\/package" "\$REMOTE_TREE\/package"/)
  assert.match(workflow, /already_published=true/)
  assert.match(workflow, /if: steps\.registry\.outputs\.already_published != 'true'/)
})

test('npm release workflow keeps OIDC publishing for a new version', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')

  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /environment: npm/)
  assert.match(workflow, /name: Publish package through OIDC/)
  assert.match(workflow, /npm publish --access public --provenance/)
})
