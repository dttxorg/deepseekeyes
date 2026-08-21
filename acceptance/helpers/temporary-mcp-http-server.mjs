import { createServer } from 'node:http'
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const LOOPBACK_HOST = '127.0.0.1'
const MAX_REQUEST_BYTES = 1024 * 1024
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function writeJsonError(response, status, message) {
  if (response.headersSent) return
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32603, message },
    id: null,
  }))
}

async function readJsonBody(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > MAX_REQUEST_BYTES) throw new Error('temporary MCP request exceeded 1 MiB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function requestMethods(body) {
  const messages = Array.isArray(body) ? body : [body]
  return messages
    .map(message => message?.method)
    .filter(method => typeof method === 'string')
}

function createProtocol(state) {
  const protocol = new McpServer(
    { name: 'deepseekeyes-http-acceptance', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  )

  protocol.setRequestHandler(ListToolsRequestSchema, async () => {
    state.listCalls += 1
    return {
      tools: [{
        name: 'echo',
        description: 'Echo one Streamable HTTP acceptance value',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
      }],
    }
  })

  protocol.setRequestHandler(CallToolRequestSchema, async request => {
    const text = request.params.arguments?.text
    state.toolCalls.push(text)
    return { content: [{ type: 'text', text: `http-echo:${text}` }] }
  })

  protocol.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: 'http://resource/note', name: 'HTTP note', mimeType: 'text/plain' },
      { uri: 'http://resource/pixel', name: 'HTTP pixel', mimeType: 'image/png' },
    ],
  }))
  protocol.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [{ uriTemplate: 'http://resource/{id}', name: 'HTTP resource template' }],
  }))
  protocol.setRequestHandler(ReadResourceRequestSchema, async request => request.params.uri.endsWith('/pixel')
    ? { contents: [{ uri: request.params.uri, mimeType: 'image/png', blob: ONE_PIXEL_PNG }] }
    : { contents: [{ uri: request.params.uri, mimeType: 'text/plain', text: `http-resource:${request.params.uri}` }] })
  protocol.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: 'http-summary', arguments: [{ name: 'style', required: true }] }],
  }))
  protocol.setRequestHandler(GetPromptRequestSchema, async request => ({
    messages: [{ role: 'user', content: { type: 'text', text: `http-prompt:${request.params.arguments.style}` } }],
  }))

  return protocol
}

/**
 * Start an official-SDK, loopback-only Streamable HTTP MCP server.
 *
 * Each POST is handled by a fresh stateless SDK transport. This follows the
 * SDK's stateless Streamable HTTP pattern, supports concurrent probe sessions,
 * and avoids retaining a test session after an adapter refresh or close.
 */
export async function createTemporaryMcpHttpServer(options = {}) {
  const requiredHeaders = Object.fromEntries(Object.entries(options.requiredHeaders ?? {}).map(
    ([name, value]) => [name.toLowerCase(), String(value)],
  ))
  const state = {
    httpRequests: 0,
    rejectedRequests: 0,
    activeRequests: 0,
    transportsCreated: 0,
    transportsClosed: 0,
    listCalls: 0,
    toolCalls: [],
    methods: new Map(),
    errors: [],
  }
  const sockets = new Set()
  const pending = new Set()

  const handle = async (request, response) => {
    state.httpRequests += 1
    const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`)
    if (url.pathname !== '/mcp') {
      response.writeHead(404).end()
      return
    }
    for (const [name, expected] of Object.entries(requiredHeaders)) {
      if (request.headers[name] !== expected) {
        state.rejectedRequests += 1
        writeJsonError(response, 401, `missing acceptance header ${name}`)
        return
      }
    }
    if (request.method === 'GET' || request.method === 'DELETE') {
      // Standalone SSE and explicit session termination are optional for a
      // stateless Streamable HTTP endpoint.
      response.writeHead(405, { allow: 'POST' }).end()
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end()
      return
    }

    state.activeRequests += 1
    let protocol
    let transport
    try {
      const body = await readJsonBody(request)
      for (const method of requestMethods(body)) {
        state.methods.set(method, (state.methods.get(method) ?? 0) + 1)
      }
      protocol = createProtocol(state)
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      state.transportsCreated += 1
      await protocol.connect(transport)
      await transport.handleRequest(request, response, body)
    } catch (error) {
      state.errors.push(error instanceof Error ? error.message : String(error))
      writeJsonError(response, 500, 'temporary MCP server request failed')
    } finally {
      try {
        await protocol?.close()
      } catch (error) {
        state.errors.push(error instanceof Error ? error.message : String(error))
      }
      if (transport !== undefined) state.transportsClosed += 1
      state.activeRequests -= 1
    }
  }

  const httpServer = createServer((request, response) => {
    const task = handle(request, response)
    pending.add(task)
    task.finally(() => pending.delete(task))
  })
  httpServer.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  await new Promise((resolve, reject) => {
    const onError = error => {
      httpServer.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      httpServer.off('error', onError)
      resolve()
    }
    httpServer.once('error', onError)
    httpServer.once('listening', onListening)
    httpServer.listen({ host: LOOPBACK_HOST, port: 0 })
  })

  const address = httpServer.address()
  if (address === null || typeof address === 'string') {
    await new Promise(resolve => httpServer.close(resolve))
    throw new Error('temporary MCP HTTP server did not bind an IP socket')
  }

  let cleaned = false
  return Object.freeze({
    url: `http://${LOOPBACK_HOST}:${address.port}/mcp`,
    snapshot() {
      return Object.freeze({
        httpRequests: state.httpRequests,
        rejectedRequests: state.rejectedRequests,
        activeRequests: state.activeRequests,
        transportsCreated: state.transportsCreated,
        transportsClosed: state.transportsClosed,
        listCalls: state.listCalls,
        toolCalls: Object.freeze([...state.toolCalls]),
        methods: Object.freeze(Object.fromEntries(state.methods)),
        errors: Object.freeze([...state.errors]),
      })
    },
    async cleanup() {
      if (cleaned) return
      cleaned = true
      await Promise.allSettled([...pending])
      await new Promise((resolve, reject) => {
        httpServer.close(error => error === undefined ? resolve() : reject(error))
        httpServer.closeAllConnections?.()
        for (const socket of sockets) socket.destroy()
      })
    },
  })
}
