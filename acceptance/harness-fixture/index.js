export const name = 'deepseekeyes-dsh-acceptance'
export const inject = ['llm']

function output(text) {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

function toolCall(name, arguments_) {
  const id = 'acceptance-look-call'
  const json = JSON.stringify(arguments_)
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: json }
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name, arguments: json },
    }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  })()
}

function baseEvidence() {
  return {
    schemaVersion: 'deepseekeyes.evidence.v1',
    summary: 'A one-pixel acceptance image whose pixel is blue.',
    ocr: [],
    regions: [{ id: 'pixel', bbox: [0, 0, 1, 1], description: 'one blue pixel' }],
    objects: [{ name: 'pixel', bbox: [0, 0, 1, 1], attributes: ['blue'] }],
    relations: [],
    quantitativeFacts: ['exactly one pixel'],
    uncertainties: [],
  }
}

function targetEvidence() {
  return {
    schemaVersion: 'deepseekeyes.target.v1',
    answer: 'The original pixel is blue.',
    observations: [{ fact: 'The pixel is blue.', bbox: [0, 0, 1, 1], confidence: 1 }],
    ocr: [],
    uncertainties: [],
  }
}

function collectStrings(value, output) {
  if (typeof value === 'string') {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, output)
  }
}

function textCorpus(options) {
  const output = []
  collectStrings({ system: options.system, messages: options.messages }, output)
  return output.join('\n')
}

export function apply(ctx) {
  const adapter = {
    providerInfo(provider) {
      return {
        id: provider,
        name: provider === 'mock-vision' ? 'Mock Vision' : 'Mock DeepSeek',
      }
    },
    providerRetryPolicy() {
      return undefined
    },
    listModels(provider) {
      return Promise.resolve(provider === 'mock-vision'
        ? [{
            provider,
            id: 'mock-vision-model',
            name: 'Mock Vision Model',
            inputModalities: ['text', 'image'],
          }]
        : [{
            provider,
            id: 'mock-deepseek-model',
            name: 'Mock DeepSeek V4 Flash',
            inputModalities: ['text'],
          }])
    },
    resolveModel(provider, model) {
      return Promise.resolve({
        provider,
        id: model,
        name: provider === 'mock-vision' ? 'Mock Vision Model' : 'Mock DeepSeek V4 Flash',
        inputModalities: provider === 'mock-vision' ? ['text', 'image'] : ['text'],
        context: { contextWindow: 1_048_576 },
        defaultMaxTokens: provider === 'mock-vision' ? 16_384 : 384_000,
      })
    },
    stream(options) {
      const corpus = textCorpus(options)
      if (options.provider === 'mock-vision') {
        return output(JSON.stringify(
          corpus.includes('deepseekeyes.target.v1') ? targetEvidence() : baseEvidence(),
        ))
      }

      const hasLookTool = options.tools?.some(tool => tool.name === 'deepseekeyes_look') === true
      const hasLookPrompt = options.system?.includes('DeepSeekEyes preserved images') === true
      const hasComputerTool = options.tools?.some(tool => tool.name === 'computer') === true
      const hasMcpEchoTool = options.tools?.some(tool => tool.name === 'mcp__acceptance__echo') === true
      const hasMcpResourceTool = options.tools?.some(tool => tool.name === 'mcp__deepseekeyes__resource') === true
      const hasMcpPromptTool = options.tools?.some(tool => tool.name === 'mcp__deepseekeyes__prompt') === true
      if (corpus.includes('MCP_STDIO_ACCEPTANCE')) {
        if (!hasMcpEchoTool) return output('MCP_STDIO_ACCEPTANCE_TOOL_MISSING')
        if (corpus.includes('[DeepSeekEyes MCP result]') && corpus.includes('echo:verified')) {
          return output('MCP_STDIO_ACCEPTANCE_OK: official stdio result reached the final model.')
        }
        return toolCall('mcp__acceptance__echo', { text: 'verified' })
      }
      if (corpus.includes('MCP_CONTENT_ACCEPTANCE')) {
        if (!hasMcpResourceTool || !hasMcpPromptTool) return output('MCP_CONTENT_ACCEPTANCE_TOOL_MISSING')
        if (!corpus.includes('stdio-resource:notes://welcome')) {
          return toolCall('mcp__deepseekeyes__resource', {
            serverId: 'content_acceptance',
            uri: 'notes://welcome',
          })
        }
        if (!corpus.includes('detail:full')) {
          return toolCall('mcp__deepseekeyes__prompt', {
            serverId: 'content_acceptance',
            name: 'describe-pixel',
            arguments: { detail: 'full' },
          })
        }
        return output('MCP_CONTENT_ACCEPTANCE_OK: Resources and Prompts reached the final model.')
      }
      if (corpus.includes('DESKTOP_COMPUTER_USE_ACCEPTANCE')) {
        if (!hasComputerTool) return output('DESKTOP_COMPUTER_TOOL_MISSING')
        if (corpus.includes('[DeepSeekEyes desktop state]')) {
          return output('DESKTOP_COMPUTER_USE_OK: native screenshot reached the vision bridge and final model.')
        }
        return toolCall('computer', { action: 'observe' })
      }
      if (corpus.includes('DESKTOP_DISABLED_ACCEPTANCE')) {
        return output(hasComputerTool ? 'DESKTOP_DISABLED_TOOL_LEAK' : 'DESKTOP_DISABLED_OK')
      }
      if (hasLookTool && hasLookPrompt) {
        if (corpus.includes('[DeepSeekEyes on-demand visual evidence]')) {
          return output('DIRECT_SWITCH_LOOK_OK: The original pixel is blue.')
        }
        const hash = /"imageSha256":"([0-9a-f]{64})"/.exec(corpus)?.[1]
        if (hash === undefined) return output('DIRECT_SWITCH_MISSING_IMAGE_POINTER')
        return toolCall('deepseekeyes_look', {
          imageSha256: hash,
          question: 'What is the exact color of the original pixel?',
        })
      }

      if (options.system?.includes('DeepSeekEyes private visual protocol')) {
        return output('BRIDGE_IMAGE_OK: visual evidence reached the final model.')
      }
      return output('PLAIN_NO_LOOK_OK')
    },
  }

  ctx.llm.registerAdapter(['mock-deepseek', 'mock-vision'], adapter)
}
