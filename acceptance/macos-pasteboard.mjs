import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

if (process.platform !== 'darwin') {
  console.log(`macOS pasteboard acceptance: SKIP (${process.platform})`)
  process.exit(0)
}

const execFileAsync = promisify(execFile)
const helperUrl = new URL('../src/desktop/helpers/macos.jxa', import.meta.url)
const source = await readFile(helperUrl, 'utf8')
const marker = '\nfunction run() {'
const markerIndex = source.lastIndexOf(marker)
assert.ok(markerIndex >= 0, 'macOS helper run handler was not found')
const instrumented = `${source.slice(0, markerIndex)}\nfunction desktopHelperRun() {${source.slice(markerIndex + marker.length)}

function pasteboardRecordsDigest(records) {
  return JSON.stringify(records.map(entries => entries.map(entry => [
    objcText(entry.type),
    objcText(entry.data.base64EncodedStringWithOptions(0)),
  ])))
}

function run() {
  const board = $.NSPasteboard.generalPasteboard
  const original = snapshotPasteboard(board)
  const before = pasteboardRecordsDigest(original)
  try {
    board.clearContents
    if (!board.setStringForType($('DeepSeekEyes pasteboard acceptance 目标'), pasteboardStringType())) {
      throw new Error('acceptance could not stage pasteboard text')
    }
  } finally {
    restorePasteboard(board, original)
  }
  const after = pasteboardRecordsDigest(snapshotPasteboard(board))
  return JSON.stringify({ ok: before === after, itemCount: original.length })
}
`

const directory = await mkdtemp(join(tmpdir(), 'deepseekeyes-pasteboard-'))
const path = join(directory, 'acceptance.jxa')
try {
  await writeFile(path, instrumented)
  const { stdout, stderr } = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', path], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  })
  assert.equal(stderr.trim(), '')
  const result = JSON.parse(stdout.trim())
  assert.equal(result.ok, true)
  console.log(JSON.stringify({ result: 'MACOS_PASTEBOARD_TRANSACTION_OK', itemCount: result.itemCount }))
} finally {
  await rm(directory, { recursive: true, force: true })
}
