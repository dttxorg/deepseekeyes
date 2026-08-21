import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

/** Create a real stdio MCP server exposing Resources, a template and Prompts. */
export async function createTemporaryMcpContentServer() {
  const directory = await mkdtemp(join(tmpdir(), 'deepseekeyes-mcp-content-'))
  const script = join(directory, 'server.mjs')
  const sdkServer = import.meta.resolve('@modelcontextprotocol/sdk/server/index.js')
  const sdkStdio = import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js')
  const sdkTypes = import.meta.resolve('@modelcontextprotocol/sdk/types.js')
  await writeFile(script, `
import { Server } from ${JSON.stringify(sdkServer)}
import { StdioServerTransport } from ${JSON.stringify(sdkStdio)}
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from ${JSON.stringify(sdkTypes)}

const png = ${JSON.stringify(ONE_PIXEL_PNG)}
const server = new Server(
  { name: 'deepseekeyes-content-acceptance', version: '1.0.0' },
  { capabilities: { resources: {}, prompts: {} } },
)

server.setRequestHandler(ListResourcesRequestSchema, async request => request.params?.cursor === undefined
  ? {
      resources: [{ uri: 'notes://welcome', name: 'Welcome', mimeType: 'text/plain' }],
      nextCursor: 'page-2',
    }
  : { resources: [{ uri: 'image://pixel', name: 'Pixel', mimeType: 'image/png' }] })
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [{ uriTemplate: 'notes://{slug}', name: 'Note by slug', mimeType: 'text/plain' }],
}))
server.setRequestHandler(ReadResourceRequestSchema, async request => request.params.uri.startsWith('image://')
  ? { contents: [{ uri: request.params.uri, mimeType: 'image/png', blob: png }] }
  : { contents: [{ uri: request.params.uri, mimeType: 'text/plain', text: 'stdio-resource:' + request.params.uri }] })
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [{
    name: 'describe-pixel',
    description: 'Describe the fixture pixel',
    arguments: [{ name: 'detail', description: 'Detail level', required: true }],
  }],
}))
server.setRequestHandler(GetPromptRequestSchema, async request => ({
  description: 'Fixture prompt ' + request.params.arguments.detail,
  messages: [
    { role: 'user', content: { type: 'text', text: 'detail:' + request.params.arguments.detail } },
    { role: 'user', content: { type: 'image', data: png, mimeType: 'image/png' } },
  ],
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
