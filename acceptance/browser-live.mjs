import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { BrowserSession, parseBrowserArgs } from '../src/browser/index.js'
import { resolveConfig } from '../src/config.js'

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>DeepSeekEyes Browser Acceptance</title></head>
<body>
  <main>
    <h1>Browser Computer Use Acceptance</h1>
    <label for="name">用户名</label><input id="name" autocomplete="off">
    <label for="plan">套餐</label>
    <select id="plan"><option value="basic">基础版</option><option value="pro">专业版</option></select>
    <label><input id="terms" type="checkbox">接受条款</label>
    <button id="submit">提交测试</button>
    <p id="status" aria-live="polite">尚未提交</p>
  </main>
  <script>
    document.querySelector('#submit').addEventListener('click', () => {
      const name = document.querySelector('#name').value
      const plan = document.querySelector('#plan').value
      const terms = document.querySelector('#terms').checked
      document.querySelector('#status').textContent = terms
        ? '提交成功：' + name + ' / ' + plan
        : '请接受条款'
    })
  </script>
</body>
</html>`

class AcceptanceAttachments {
  constructor() {
    this.images = new Map()
  }

  async saveImage(input) {
    const data = Buffer.from(input.data)
    const digest = createHash('sha256').update(data).digest('hex')
    const ref = {
      attachmentId: `sha256:${digest}`,
      mediaType: input.mediaType,
      bytes: data.length,
      width: 1280,
      height: 800,
      name: input.name,
    }
    this.images.set(ref.attachmentId, { data, ref })
    return ref
  }
}

function findRef(result, predicate, label) {
  const found = result.elements.find(predicate)
  if (found === undefined) throw new Error(`acceptance element not found: ${label}`)
  return found.ref
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(PAGE)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
const url = `http://127.0.0.1:${address.port}/`
const artifacts = process.env.DEEPSEEKEYES_ACCEPTANCE_DIR
  ?? await mkdtemp(join(tmpdir(), 'deepseekeyes-browser-acceptance-'))
await mkdir(artifacts, { recursive: true })

const config = resolveConfig({
  browserHeadless: true,
  browserChannel: process.env.DEEPSEEKEYES_ACCEPTANCE_CHANNEL ?? 'chrome',
  browserArtifactsDir: artifacts,
  browserViewportWidth: 1280,
  browserViewportHeight: 800,
  browserSettleMs: 50,
}, {}, artifacts)
const session = new BrowserSession({ attachments: new AcceptanceAttachments() }, config, {
  sessionId: 'browser-live-acceptance',
  runId: 'browser-live-acceptance',
})
const signal = new AbortController().signal
const run = input => session.execute(parseBrowserArgs(input), signal)

try {
  const opened = await run({ action: 'open', url })
  const originalState = opened.stateId
  const inputRef = findRef(opened, element => element.role === 'textbox' && element.name.includes('用户名'), 'username')
  const typed = await run({ action: 'type', stateId: opened.stateId, ref: inputRef, value: 'DeepSeek' })
  const selectRef = findRef(typed, element => element.role === 'combobox', 'plan')
  const selected = await run({ action: 'select', stateId: typed.stateId, ref: selectRef, value: 'pro' })
  const termsRef = findRef(selected, element => element.role === 'checkbox', 'terms')
  const checked = await run({ action: 'check', stateId: selected.stateId, ref: termsRef })
  const buttonRef = findRef(checked, element => element.role === 'button' && element.name.includes('提交测试'), 'submit')
  const clicked = await run({ action: 'click', stateId: checked.stateId, ref: buttonRef })
  const asserted = await run({
    action: 'assert',
    stateId: clicked.stateId,
    selector: '#status',
    assertion: 'text_equals',
    expected: '提交成功：DeepSeek / pro',
  })
  if (asserted.actionResult.passed !== true) throw new Error('browser assertion did not pass')
  const report = await run({ action: 'report', reportName: 'acceptance-report' })
  const stored = JSON.parse(await readFile(report.report.path, 'utf8'))
  if (stored.assertionCount !== 1 || stored.assertionFailures !== 0 || stored.actionFailureCount !== 0) {
    throw new Error('report summary mismatch')
  }
  const stale = await run({ action: 'click', stateId: originalState, selector: '#submit' })
  if (stale.actionResult.code !== 'STALE_BROWSER_STATE') throw new Error('stale state was not rejected')
  console.log(`DEEPSEEKEYES_BROWSER_ACCEPTANCE:${JSON.stringify({
    url,
    finalStateId: stale.stateId,
    screenshots: session.observations.length,
    assertionPassed: asserted.actionResult.passed,
    staleRejected: stale.actionResult.code === 'STALE_BROWSER_STATE',
    reportPath: report.report.path,
    reportPassed: report.report.passed,
  })}`)
} finally {
  await session.close()
  server.close()
  await once(server, 'close')
}
