import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Materialize a one-tool or explicitly empty MCP SDK server outside the repository.
 *
 * The generated module imports the exact SDK installation used by this
 * checkout, so both the node:test integration and a live Harness acceptance
 * exercise a real stdio transport instead of a protocol stub.
 */
export async function createTemporaryMcpServer({ empty = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'deepseekeyes-harness-mcp-'))
  const script = join(directory, 'server.mjs')
  const sdkServer = import.meta.resolve('@modelcontextprotocol/sdk/server/index.js')
  const sdkStdio = import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js')
  const sdkTypes = import.meta.resolve('@modelcontextprotocol/sdk/types.js')

  await writeFile(script, `
import { Server } from ${JSON.stringify(sdkServer)}
import { StdioServerTransport } from ${JSON.stringify(sdkStdio)}
import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(sdkTypes)}

const server = new Server(
  { name: 'deepseekeyes-harness-acceptance', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ${empty ? '[]' : `[{
    name: 'echo',
    description: 'Echo one acceptance value',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  }]`},
}))

server.setRequestHandler(CallToolRequestSchema, async request => ({
  content: [{ type: 'text', text: 'echo:' + request.params.arguments.text }],
}))

await server.connect(new StdioServerTransport())
`, { mode: 0o600 })

  let cleaned = false
  return Object.freeze({
    directory,
    script,
    async cleanup() {
      if (cleaned) return
      cleaned = true
      await rm(directory, { recursive: true, force: true })
    },
  })
}
