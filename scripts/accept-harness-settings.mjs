import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const [baseURL, settingsPath, localClientPath, cordisPatchPath, expectedCordisSha256] = process.argv.slice(2)
if (!baseURL || !settingsPath || !localClientPath || !cordisPatchPath || !expectedCordisSha256) {
  throw new Error('usage: node scripts/accept-harness-settings.mjs BASE_URL SETTINGS_YAML LOCAL_CLIENT_JS CORDIS_PATCH_YAML EXPECTED_CORDIS_SHA256')
}
let sequence = 0
async function rpc(method, payload) {
  sequence += 1
  const request = {
    type: 'client-request',
    rpcId: `deepseekeyes-acceptance-${sequence}`,
    method,
    payload,
  }
  const response = await fetch(`${baseURL}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.rpcId, request.rpcId)
  assert.equal(body.result.ok, true, body.result.error?.message)
  return body.result.value
}

const homepage = await (await fetch(`${baseURL}/`)).text()
assert.match(homepage, /"id":"deepseekeyes"/)
const servedClientResponse = await fetch(`${baseURL}/plugins/deepseekeyes/client.js`)
assert.equal(servedClientResponse.status, 200)
const servedClient = Buffer.from(await servedClientResponse.arrayBuffer())
const localClient = await readFile(localClientPath)
assert.deepEqual(servedClient, localClient)
assert.match(servedClient.toString('utf8'), /^window\.__ModuleLoader__\.load\(\{ id: "deepseekeyes"/)

const initialSettings = await rpc('settings.describe', {})
const eyesNamespace = initialSettings.namespaces.find(entry => entry.ns === 'deepseekeyes')
assert.ok(eyesNamespace)
assert.equal(eyesNamespace.applies, 'live')
assert.equal(eyesNamespace.revision, 0)
assert.equal(eyesNamespace.value.maxClarifications, 3)
assert.equal(eyesNamespace.value.baseMaxTokens, 16_384)
assert.equal(eyesNamespace.value.targetMaxTokens, 8_192)
assert.equal(eyesNamespace.value.historyImageLimit, 8)
assert.equal(eyesNamespace.value.historySummaryChars, 320)
assert.equal(eyesNamespace.value.browserHistoryLimit, 8)
assert.equal(eyesNamespace.value.browserComputerUse, false)

const providers = await rpc('llm.providers', {})
const eyesDirectory = providers.providers.find(entry => entry.provider === 'deepseekeyes')
assert.deepEqual(eyesDirectory, {
  provider: 'deepseekeyes',
  displayName: 'DeepSeekEyes',
  settingsNs: 'deepseekeyes',
  settingsPath: [],
  active: true,
})

await rpc('settings.mutate', {
  ns: 'llm-pi-ai',
  expectedRevision: 0,
  ops: [{
    op: 'set',
    path: ['providers', 'fixture-vision-gateway'],
    value: {
      displayName: 'Fixture Vision Gateway',
      api: 'openai-completions',
      baseURL: 'https://fixture.invalid/v1',
      models: [{ id: 'fixture-vision-model', name: 'Fixture Vision Model', contextWindow: 65536, maxTokens: 8192 }],
      defaultInput: ['text'],
    },
  }],
})
await rpc('settings.mutate', {
  ns: 'deepseekeyes',
  expectedRevision: 0,
  ops: [
    { op: 'set', path: ['upstreamProvider'], value: 'deepseek-official' },
    { op: 'set', path: ['upstreamModel'], value: 'deepseek-v4-pro' },
    { op: 'set', path: ['visionProvider'], value: 'fixture-vision-gateway' },
    { op: 'set', path: ['visionModel'], value: 'fixture-vision-model' },
    { op: 'set', path: ['activeProbe'], value: false },
    { op: 'set', path: ['maxClarifications'], value: 5 },
    { op: 'set', path: ['baseMaxTokens'], value: 0 },
    { op: 'set', path: ['targetMaxTokens'], value: 131_072 },
    { op: 'set', path: ['historyImageLimit'], value: 6 },
    { op: 'set', path: ['historySummaryChars'], value: 240 },
    { op: 'set', path: ['browserHistoryLimit'], value: 4 },
    { op: 'set', path: ['browserComputerUse'], value: true },
    { op: 'set', path: ['browserHeadless'], value: true },
    { op: 'set', path: ['browserChannel'], value: 'msedge' },
  ],
})
await new Promise(resolve => setTimeout(resolve, 200))
const before = await rpc('llm.models', {})
assert.equal(before.groups.some(group => group.id === 'deepseekeyes'), false)

await rpc('settings.mutate', {
  ns: 'llm-pi-ai',
  expectedRevision: 1,
  ops: [{
    op: 'set',
    path: ['providers', 'fixture-vision-gateway', 'defaultInput'],
    value: ['text', 'image'],
  }],
})
await new Promise(resolve => setTimeout(resolve, 200))
const after = await rpc('llm.models', {})
const eyesModels = after.groups.find(group => group.id === 'deepseekeyes')?.models ?? []
assert.deepEqual(eyesModels.map(model => model.id), ['deepseek-v4-pro'])
assert.equal(eyesModels[0].name, 'DeepSeek-V4-Pro · Fixture Vision Model Eyes')
assert.equal(
  eyesModels[0].description,
  'Vision: fixture-vision-gateway/fixture-vision-model · Final: deepseek-official/deepseek-v4-pro',
)

const finalSettings = await rpc('settings.describe', {})
const finalEyes = finalSettings.namespaces.find(entry => entry.ns === 'deepseekeyes')
const finalGateway = finalSettings.namespaces.find(entry => entry.ns === 'llm-pi-ai')
  ?.user?.providers?.['fixture-vision-gateway']
assert.equal(finalEyes.revision, 1)
assert.equal(finalEyes.value.upstreamProvider, 'deepseek-official')
assert.equal(finalEyes.value.upstreamModel, 'deepseek-v4-pro')
assert.equal(finalEyes.value.visionProvider, 'fixture-vision-gateway')
assert.equal(finalEyes.value.visionModel, 'fixture-vision-model')
assert.equal(finalEyes.value.activeProbe, false)
assert.equal(finalEyes.value.maxClarifications, 5)
assert.equal(finalEyes.value.baseMaxTokens, 0)
assert.equal(finalEyes.value.targetMaxTokens, 131_072)
assert.equal(finalEyes.value.historyImageLimit, 6)
assert.equal(finalEyes.value.historySummaryChars, 240)
assert.equal(finalEyes.value.browserHistoryLimit, 4)
assert.equal(finalEyes.value.browserComputerUse, true)
assert.equal(finalEyes.value.browserHeadless, true)
assert.equal(finalEyes.value.browserChannel, 'msedge')
assert.equal(finalGateway.baseURL, 'https://fixture.invalid/v1')
assert.equal(finalGateway.models[0].id, 'fixture-vision-model')
assert.deepEqual(finalGateway.defaultInput, ['text', 'image'])

const yaml = await readFile(settingsPath, 'utf8')
for (const literal of [
  'deepseekeyes:',
  'upstreamModel: deepseek-v4-pro',
  'visionProvider: fixture-vision-gateway',
  'visionModel: fixture-vision-model',
  'maxClarifications: 5',
  'baseMaxTokens: 0',
  'targetMaxTokens: 131072',
  'historyImageLimit: 6',
  'historySummaryChars: 240',
  'browserHistoryLimit: 4',
  'browserHeadless: true',
  'browserChannel: msedge',
  'baseURL: https://fixture.invalid/v1',
  '- id: fixture-vision-model',
  '- image',
]) assert.ok(yaml.includes(literal), `settings.yaml missing ${literal}`)

const cordisPatch = await readFile(cordisPatchPath)
const cordisPatchSha256 = createHash('sha256').update(cordisPatch).digest('hex')
assert.equal(cordisPatchSha256, expectedCordisSha256)

console.log(JSON.stringify({
  result: 'PASS',
  harnessSettingsNamespace: 'deepseekeyes',
  applies: finalEyes.applies,
  settingsRevision: finalEyes.revision,
  providerDirectory: eyesDirectory,
  beforeVisionDeclaration: 'deepseekeyes catalog absent',
  afterVisionDeclaration: eyesModels.map(model => model.id),
  explicitRoute: {
    final: `${finalEyes.value.upstreamProvider}/${finalEyes.value.upstreamModel}`,
    vision: `${finalEyes.value.visionProvider}/${finalEyes.value.visionModel}`,
    wrapperName: eyesModels[0].name,
    wrapperDescription: eyesModels[0].description,
  },
  tokenBudgets: {
    baseMaxTokens: finalEyes.value.baseMaxTokens,
    targetMaxTokens: finalEyes.value.targetMaxTokens,
    unrestrictedOmitsMaxTokens: finalEyes.value.baseMaxTokens === 0,
  },
  boundedHistory: {
    imageReferences: finalEyes.value.historyImageLimit,
    summaryCharacters: finalEyes.value.historySummaryChars,
    browserStates: finalEyes.value.browserHistoryLimit,
  },
  browserSettings: {
    enabled: finalEyes.value.browserComputerUse,
    headless: finalEyes.value.browserHeadless,
    channel: finalEyes.value.browserChannel,
  },
  persistedSiblingFields: {
    baseURL: finalGateway.baseURL,
    model: finalGateway.models[0].id,
    defaultInput: finalGateway.defaultInput,
  },
  servedClientSha256: createHash('sha256').update(servedClient).digest('hex'),
  browserBundleInBootGraph: true,
  cordisPatchEdited: false,
  cordisPatchSha256,
}, null, 2))
