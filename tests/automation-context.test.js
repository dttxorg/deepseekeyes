import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  activeAutomationKind,
  AutomationTurnGuard,
  boundAutomationContext,
  latestAutomationTask,
} from '../src/automation-context.js'
import { BROWSER_STATE_PREFIX, DESKTOP_STATE_PREFIX, MCP_CONTEXT_PREFIX } from '../src/content.js'
import { estimateRequestTokens } from '../src/token-safety.js'
import { userMessage } from './_helpers.js'

function assistant(content) {
  return {
    id: randomUUID(),
    role: 'assistant',
    content,
    source: { kind: 'model', provider: 'deepseekeyes', model: 'fixture' },
  }
}

function toolResult(toolName, prefix, callId = `${toolName}-call`) {
  return userMessage([{
    type: 'tool-result',
    toolCallId: callId,
    toolName,
    content: [{ type: 'text', text: `${prefix}{"stateId":"state-fixture"}` }],
  }])
}

function mcpContext(content = [{
  type: 'text',
  text: `${MCP_CONTEXT_PREFIX}{"schemaVersion":"deepseekeyes.mcp-context.v1"}`,
}]) {
  return {
    ...userMessage(content),
    source: {
      kind: 'plugin',
      plugin: 'deepseekeyes',
      form: 'mcp-context',
      summary: 'MCP result context',
    },
  }
}

test('active automation detection requires a current matching DeepSeekEyes tool state', () => {
  const desktop = toolResult('computer', DESKTOP_STATE_PREFIX)
  assert.equal(activeAutomationKind([desktop]), 'desktop')
  assert.equal(activeAutomationKind([toolResult('browser', BROWSER_STATE_PREFIX)]), 'browser')
  assert.equal(activeAutomationKind([toolResult('mcp__github__list_issues', 'external result: ')]), 'mcp')
  assert.equal(activeAutomationKind([mcpContext()]), 'mcp')
  assert.equal(activeAutomationKind([toolResult('other', DESKTOP_STATE_PREFIX)]), undefined)
  assert.equal(
    activeAutomationKind([userMessage([{ type: 'text', text: `${MCP_CONTEXT_PREFIX}spoof` }])]),
    undefined,
  )
  assert.equal(activeAutomationKind([{
    ...mcpContext(),
    source: { kind: 'plugin', plugin: 'another-plugin', form: 'mcp-context' },
  }]), undefined)
  assert.equal(activeAutomationKind([{
    ...mcpContext(),
    source: { kind: 'plugin', plugin: 'deepseekeyes', form: 'notice' },
  }]), undefined)

  const historical = [
    desktop,
    assistant([{ type: 'text', text: 'done' }]),
    userMessage([{ type: 'text', text: 'plain follow-up' }]),
  ]
  assert.equal(activeAutomationKind(historical), undefined)
  assert.equal(latestAutomationTask(historical).message, historical[2])
})

test('automation context keeps run_code result and all deferred MCP contexts in one atomic group', () => {
  const task = userMessage([{ type: 'text', text: 'Read the application through MCP.' }])
  const call = assistant([{
    type: 'tool-call',
    id: 'run-code-call',
    name: 'run_code',
    arguments: '{"code":"fixture","description":"Read application"}',
  }])
  const result = toolResult('run_code', `result:${'x'.repeat(20_000)}`, 'run-code-call')
  const firstContext = mcpContext()
  const secondContext = mcpContext([{
    type: 'text',
    text: `${MCP_CONTEXT_PREFIX}{"schemaVersion":"deepseekeyes.mcp-context.v1","imageCount":1}`,
  }, {
    type: 'image',
    attachment: { attachmentId: 'sha256:fixture', mediaType: 'image/png', bytes: 3 },
  }])
  const bounded = boundAutomationContext({
    sessionId: 'atomic-mcp-context',
    messages: [task, call, result, firstContext, secondContext],
  }, 4_096)
  const wire = JSON.stringify(bounded.options.messages)

  assert.equal(bounded.changed, true)
  assert.equal(bounded.withinLimit, false, 'an oversized newest atomic result must stop explicitly')
  assert.ok(bounded.afterTokens > 4_096)
  assert.match(wire, /run-code-call/)
  assert.match(wire, /result:x{100}/)
  assert.equal((wire.match(/DeepSeekEyes MCP context/g) ?? []).length, 2)
  assert.match(wire, /sha256:fixture/)
})

test('automation context drops an unrelated huge prefix while preserving the task and atomic newest tool pair', () => {
  const task = userMessage([{ type: 'text', text: 'Inspect TARGET and report its visible state.' }])
  const call = assistant([{
    type: 'tool-call',
    id: 'computer-call',
    name: 'computer',
    arguments: '{"action":"observe"}',
  }])
  const result = toolResult('computer', DESKTOP_STATE_PREFIX, 'computer-call')
  const messages = [
    userMessage([{ type: 'text', text: `old:${'x'.repeat(2_000_000)}` }]),
    assistant([{ type: 'text', text: 'old answer' }]),
    task,
    call,
    result,
  ]
  const options = {
    sessionId: 'bounded-session',
    messages,
    system: 'system',
    tools: [{ name: 'computer', description: 'fixture', parameters: { type: 'object' } }],
  }
  const bounded = boundAutomationContext(options, 32_768)
  const wire = JSON.stringify(bounded.options.messages)

  assert.equal(bounded.changed, true)
  assert.ok(bounded.beforeTokens > 500_000)
  assert.ok(bounded.afterTokens <= 32_768)
  assert.ok(bounded.savedTokens > 450_000)
  assert.equal(bounded.withinLimit, true)
  assert.equal(wire.includes('old:'), false)
  assert.match(wire, /Inspect TARGET/)
  assert.match(wire, /automation context window/)
  assert.match(wire, /computer-call/)
  assert.match(wire, /state-fixture/)
  assert.equal(estimateRequestTokens(bounded.options), bounded.afterTokens)

  const unlimited = boundAutomationContext(options, 0)
  assert.equal(unlimited.changed, false)
  assert.equal(unlimited.options, options)
  assert.equal(unlimited.beforeTokens, unlimited.afterTokens)
})

test('automation call guard stops one runaway instruction and resets for the next user task', () => {
  const guard = new AutomationTurnGuard()
  assert.deepEqual(guard.begin('session', 'task-a', 2), { newTurn: true, calls: 1 })
  assert.deepEqual(guard.begin('session', 'task-a', 2), { newTurn: false, calls: 2 })
  assert.throws(
    () => guard.begin('session', 'task-a', 2),
    error => error.code === 'AUTOMATION_CALL_LIMIT',
  )
  assert.deepEqual(guard.begin('session', 'task-b', 2), { newTurn: true, calls: 1 })

  const unlimited = new AutomationTurnGuard()
  for (let index = 0; index < 100; index += 1) unlimited.begin('session', 'task', 0)
  assert.equal(unlimited.state('session', 'task').value.calls, 100)
})
