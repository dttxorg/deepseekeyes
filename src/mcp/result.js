import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalJson, boundedUnicode, sha256Text } from './canonical.js'

/**
 * Hard admission limits for an untrusted MCP CallToolResult. These limits are
 * intentionally independent from mcpMaxResultChars: that setting controls how
 * much already-admitted text is shown to the model, while this boundary keeps
 * canonicalization, JSON serialization and base64 decoding finite.
 */
export const DEFAULT_MCP_RESULT_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 50_000,
  maxBlocks: 4_096,
  // Above the public 10,000,000-character projection ceiling so a legitimate
  // large text result can still use mcpMaxResultChars or spill to an artifact.
  maxStringChars: 16 * 1024 * 1024,
  maxImages: 8,
  maxEncodedImageBytes: 28 * 1024 * 1024,
  maxDecodedImageBytes: 20 * 1024 * 1024,
  maxBinaryBytes: 20 * 1024 * 1024,
})

const ADMITTED_VALUE = Symbol('deepseekeyes.mcp.admitted-value')

function resultAdmissionError(message, code) {
  const error = new Error(message)
  error.name = 'McpResultAdmissionError'
  error.code = code
  return error
}

function admissionLimit(value, fallback, field, { zero = false } = {}) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) {
    throw new RangeError(`${field} must be ${zero ? 'a non-negative' : 'a positive'} safe integer`)
  }
  return value
}

function resultLimits(input) {
  const source = input ?? {}
  return Object.freeze({
    maxDepth: admissionLimit(source.maxDepth, DEFAULT_MCP_RESULT_LIMITS.maxDepth, 'maxDepth', { zero: true }),
    maxNodes: admissionLimit(source.maxNodes, DEFAULT_MCP_RESULT_LIMITS.maxNodes, 'maxNodes'),
    maxBlocks: admissionLimit(source.maxBlocks, DEFAULT_MCP_RESULT_LIMITS.maxBlocks, 'maxBlocks'),
    maxStringChars: admissionLimit(source.maxStringChars, DEFAULT_MCP_RESULT_LIMITS.maxStringChars, 'maxStringChars'),
    maxImages: admissionLimit(source.maxImages, DEFAULT_MCP_RESULT_LIMITS.maxImages, 'maxImages'),
    maxEncodedImageBytes: admissionLimit(
      source.maxEncodedImageBytes,
      DEFAULT_MCP_RESULT_LIMITS.maxEncodedImageBytes,
      'maxEncodedImageBytes',
    ),
    maxDecodedImageBytes: admissionLimit(
      source.maxDecodedImageBytes,
      DEFAULT_MCP_RESULT_LIMITS.maxDecodedImageBytes,
      'maxDecodedImageBytes',
    ),
    maxBinaryBytes: admissionLimit(source.maxBinaryBytes, DEFAULT_MCP_RESULT_LIMITS.maxBinaryBytes, 'maxBinaryBytes'),
  })
}

function base64DecodedBytes(value) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw resultAdmissionError('MCP image data is not canonical base64.', 'INVALID_IMAGE_BASE64')
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function exceed(stats, field, amount, limit, code, message) {
  stats[field] += amount
  if (stats[field] > limit) throw resultAdmissionError(message, code)
}

/**
 * Iteratively admit a raw MCP result before any recursive canonicalization,
 * serialization, base64 decoding or persistence. The ancestor enter/exit
 * markers mirror canonicalValue's path-local circular handling without using
 * the JavaScript call stack.
 */
export function admitMcpResult(value, options = {}) {
  const limits = resultLimits(options.resultLimits)
  const stats = {
    nodes: 0,
    blocks: 0,
    stringChars: 0,
    images: 0,
    encodedImageBytes: 0,
    decodedImageBytes: 0,
    binaryBytes: 0,
  }
  const ancestors = new WeakSet()
  const stack = [{ kind: 'value', value, depth: 0, propertyKey: undefined, contentBlock: false, imageData: false }]

  while (stack.length > 0) {
    const entry = stack.pop()
    if (entry.kind === 'exit') {
      ancestors.delete(entry.value)
      continue
    }
    if (entry.depth > limits.maxDepth) {
      throw resultAdmissionError('MCP result exceeds the nesting-depth limit.', 'MCP_RESULT_DEPTH_LIMIT')
    }
    exceed(
      stats,
      'nodes',
      1,
      limits.maxNodes,
      'MCP_RESULT_NODE_LIMIT',
      'MCP result exceeds the node-count limit.',
    )
    if (entry.contentBlock) {
      exceed(
        stats,
        'blocks',
        1,
        limits.maxBlocks,
        'MCP_RESULT_BLOCK_LIMIT',
        'MCP result exceeds the content-block limit.',
      )
    }

    const current = entry.value
    if (typeof current === 'string') {
      if (entry.imageData) {
        // Canonical base64 is ASCII, so code-unit length is its encoded byte
        // length. Check the encoded aggregate before the linear validation.
        exceed(
          stats,
          'encodedImageBytes',
          current.length,
          limits.maxEncodedImageBytes,
          'MCP_RESULT_IMAGE_ENCODED_LIMIT',
          'MCP image data exceeds the encoded-byte limit.',
        )
        exceed(
          stats,
          'decodedImageBytes',
          base64DecodedBytes(current),
          limits.maxDecodedImageBytes,
          'MCP_RESULT_IMAGE_DECODED_LIMIT',
          'MCP image data exceeds the decoded-byte limit.',
        )
      } else {
        exceed(
          stats,
          'stringChars',
          current.length,
          limits.maxStringChars,
          'MCP_RESULT_STRING_LIMIT',
          'MCP result exceeds the aggregate string limit.',
        )
      }
      continue
    }
    if (typeof current === 'bigint') {
      exceed(
        stats,
        'stringChars',
        current.toString().length,
        limits.maxStringChars,
        'MCP_RESULT_STRING_LIMIT',
        'MCP result exceeds the aggregate string limit.',
      )
      continue
    }
    if (current === null || (typeof current !== 'object' && typeof current !== 'symbol')) continue
    if (typeof current === 'symbol') {
      exceed(
        stats,
        'stringChars',
        String(current).length,
        limits.maxStringChars,
        'MCP_RESULT_STRING_LIMIT',
        'MCP result exceeds the aggregate string limit.',
      )
      continue
    }
    if (Buffer.isBuffer(current) || current instanceof Uint8Array) {
      exceed(
        stats,
        'binaryBytes',
        current.byteLength,
        limits.maxBinaryBytes,
        'MCP_RESULT_BINARY_LIMIT',
        'MCP result exceeds the binary-byte limit.',
      )
      continue
    }
    if (current instanceof Date) continue
    if (ancestors.has(current)) {
      exceed(
        stats,
        'stringChars',
        '[circular]'.length,
        limits.maxStringChars,
        'MCP_RESULT_STRING_LIMIT',
        'MCP result exceeds the aggregate string limit.',
      )
      continue
    }
    ancestors.add(current)
    stack.push({ kind: 'exit', value: current })

    if (entry.contentBlock && current.type === 'image') {
      exceed(
        stats,
        'images',
        1,
        limits.maxImages,
        'MCP_RESULT_IMAGE_COUNT_LIMIT',
        'MCP result exceeds the image-count limit.',
      )
    }

    if (Array.isArray(current)) {
      // canonicalValue maps every array slot, including the cost of a sparse
      // array. Reject pathological lengths before iterating or allocating a
      // canonical array of that size.
      if (current.length > limits.maxNodes - stats.nodes) {
        throw resultAdmissionError('MCP result exceeds the node-count limit.', 'MCP_RESULT_NODE_LIMIT')
      }
      const childIsBlock = entry.propertyKey === 'content'
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({
          kind: 'value',
          value: current[index],
          depth: entry.depth + 1,
          propertyKey: undefined,
          contentBlock: childIsBlock,
          imageData: false,
        })
      }
      continue
    }

    const keys = Object.keys(current)
    if (keys.length > limits.maxNodes - stats.nodes) {
      throw resultAdmissionError('MCP result exceeds the node-count limit.', 'MCP_RESULT_NODE_LIMIT')
    }
    const imageBlock = entry.contentBlock && current.type === 'image'
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]
      exceed(
        stats,
        'stringChars',
        key.length,
        limits.maxStringChars,
        'MCP_RESULT_STRING_LIMIT',
        'MCP result exceeds the aggregate string limit.',
      )
      stack.push({
        kind: 'value',
        value: current[key],
        depth: entry.depth + 1,
        propertyKey: key,
        contentBlock: false,
        imageData: imageBlock && key === 'data',
      })
    }
  }

  const admitted = { limits, stats: Object.freeze({ ...stats }) }
  Object.defineProperty(admitted, ADMITTED_VALUE, { value })
  return Object.freeze(admitted)
}

function admittedMcpResult(value, options) {
  const candidate = options?.admission
  return candidate?.[ADMITTED_VALUE] === value ? candidate : admitMcpResult(value, options)
}

function safeSegment(value) {
  return String(value ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'unknown'
}

function contentProjection(value, { artifactEnabled = false, images = [] } = {}) {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.content)) return canonicalJson(value)
  const parts = []
  let imageIndex = 0
  for (const item of value.content) {
    if (item?.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text)
    } else if (item?.type === 'image') {
      const delivered = images[imageIndex] !== undefined
      imageIndex += 1
      parts.push(artifactEnabled
        ? `[image: ${item.mimeType ?? 'unknown'}; full block preserved in artifact]`
        : delivered
          ? `[image: ${item.mimeType ?? 'unknown'}; delivered as a model attachment; raw block not retained]`
          : `[image: ${item.mimeType ?? 'unknown'}; raw block omitted because MCP artifact storage is disabled]`)
    } else if (item?.type === 'audio') {
      parts.push(artifactEnabled
        ? `[audio: ${item.mimeType ?? 'unknown'}; full block preserved in artifact]`
        : `[audio: ${item.mimeType ?? 'unknown'}; raw block omitted because MCP artifact storage is disabled]`)
    } else if (item?.type === 'resource' || item?.type === 'resource_link') {
      parts.push(artifactEnabled
        ? '[resource: full block preserved in artifact]'
        : '[resource: raw block omitted because MCP artifact storage is disabled]')
    } else {
      parts.push(`[unsupported MCP content: ${item?.type ?? 'unknown'}]`)
    }
  }
  if (value.structuredContent !== undefined) {
    parts.push(`structuredContent: ${canonicalJson(value.structuredContent)}`)
  }
  return parts.join('\n') || canonicalJson(value)
}

async function persistArtifact(serialized, { artifactDir, serverId, toolName, sha256 }) {
  if (artifactDir === undefined || artifactDir === false) return undefined
  const directory = join(artifactDir, safeSegment(serverId))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, `${safeSegment(toolName)}-${sha256}.json`)
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    await writeFile(temporary, `${serialized}\n`, { mode: 0o600 })
    try {
      await rename(temporary, path)
    } catch (error) {
      // Cross-platform antivirus/indexer races can make replacement fail. The
      // hash-addressed name is immutable, so writing it directly remains safe.
      await writeFile(path, `${serialized}\n`, { mode: 0o600 })
    }
  } finally {
    // Cleanup is best-effort and must not replace the original write/rename
    // failure. It also covers partial temporary writes and successful renames.
    await rm(temporary, { force: true }).catch(() => {})
  }
  return Object.freeze({
    path,
    sha256,
    bytes: Buffer.byteLength(serialized),
    mediaType: 'application/json',
  })
}

function hasNonTextMcpContent(value) {
  return Array.isArray(value?.content)
    && value.content.some(block => block?.type !== 'text')
}

/** Return only a bounded model-visible projection and spill the exact result when truncated. */
export async function boundMcpResult(value, options = {}) {
  const maximum = options.maxChars ?? 20_000
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new RangeError('maxChars must be a positive safe integer')
  admittedMcpResult(value, options)
  const serialized = canonicalJson(value)
  const sha256 = sha256Text(serialized)
  const projection = contentProjection(value, {
    artifactEnabled: typeof options.artifactDir === 'string' && options.artifactDir.length > 0,
    images: options.images,
  })
  const bounded = boundedUnicode(projection, maximum)
  const needsArtifact = bounded.truncated || hasNonTextMcpContent(value)
  const artifact = needsArtifact
    ? await persistArtifact(serialized, { ...options, sha256 })
    : undefined
  return Object.freeze({
    schemaVersion: 'deepseekeyes.mcp-result.v1',
    preview: bounded.text,
    truncated: bounded.truncated,
    sha256,
    bytes: Buffer.byteLength(serialized),
    ...(artifact === undefined ? {} : { artifact }),
    ...(options.images?.length ? { images: Object.freeze(options.images.map(image => Object.freeze({ ...image }))) } : {}),
  })
}

const FALLBACK_IMAGE_LIMITS = Object.freeze({
  // Old/test Harness hosts expose only saveImage(), so there is no host-owned
  // batch admission policy to consult. Keep that compatibility path finite.
  maxImageBytes: 5 * 1024 * 1024,
  maxImagesPerMessage: 8,
  maxMessageImageBytes: 20 * 1024 * 1024,
  mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
})

function imageAdmissionError(message, code) {
  const error = new Error(message)
  error.name = 'AttachmentError'
  error.code = code
  return error
}

function decodeBase64Image(value) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw imageAdmissionError('MCP image data is not canonical base64.', 'INVALID_IMAGE_BASE64')
  }
  const decoded = Buffer.from(value, 'base64')
  // Buffer.from() deliberately accepts several malformed encodings. A
  // round-trip check rejects non-canonical padding and pad bits before any
  // attachment method is allowed to persist a member of the batch.
  if (decoded.length === 0 || decoded.toString('base64') !== value) {
    throw imageAdmissionError('MCP image data is not canonical base64.', 'INVALID_IMAGE_BASE64')
  }
  return new Uint8Array(decoded)
}

function prepareMcpImages(value, { serverId, toolName } = {}) {
  const inputs = []
  for (const block of value.content) {
    if (block?.type !== 'image') continue
    const index = inputs.length + 1
    inputs.push(Object.freeze({
      data: decodeBase64Image(block.data),
      mediaType: typeof block.mimeType === 'string' ? block.mimeType : 'image/png',
      name: `${safeSegment(serverId)}-${safeSegment(toolName)}-${index}`,
    }))
  }
  return inputs
}

function positiveLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function fallbackLimits(attachments) {
  const configured = attachments?.imageLimits
  return {
    maxImageBytes: positiveLimit(configured?.maxImageBytes, FALLBACK_IMAGE_LIMITS.maxImageBytes),
    maxImagesPerMessage: positiveLimit(configured?.maxImagesPerMessage, FALLBACK_IMAGE_LIMITS.maxImagesPerMessage),
    maxMessageImageBytes: positiveLimit(configured?.maxMessageImageBytes, FALLBACK_IMAGE_LIMITS.maxMessageImageBytes),
    mediaTypes: Array.isArray(configured?.mediaTypes)
      ? configured.mediaTypes
      : FALLBACK_IMAGE_LIMITS.mediaTypes,
  }
}

async function saveImagesWithLegacyHost(attachments, inputs) {
  const limits = fallbackLimits(attachments)
  if (inputs.length > limits.maxImagesPerMessage) {
    throw imageAdmissionError('MCP image batch exceeds the image-count limit.', 'TOO_MANY_IMAGES')
  }
  const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
  if (totalBytes > limits.maxMessageImageBytes) {
    throw imageAdmissionError('MCP image batch exceeds the aggregate byte limit.', 'IMAGES_TOO_LARGE')
  }
  for (const input of inputs) {
    if (!limits.mediaTypes.includes(input.mediaType)) {
      throw imageAdmissionError(`MCP image type ${input.mediaType} is not accepted.`, 'UNSUPPORTED_IMAGE_TYPE')
    }
    if (input.data.byteLength > limits.maxImageBytes) {
      throw imageAdmissionError('MCP image exceeds the per-image byte limit.', 'IMAGE_TOO_LARGE')
    }
  }

  // Decode and admit every member before the first legacy write. Newer legacy
  // stores may also expose validateImage(), which performs the authoritative
  // raster decode without committing. A later saveImage() storage fault can
  // leave only unreachable immutable objects (never partial returned refs),
  // bounded by the count/byte limits above; that is the same storage boundary
  // documented by Harness saveImages().
  if (typeof attachments.validateImage === 'function') {
    for (const input of inputs) await attachments.validateImage(input)
  }
  const refs = []
  for (const input of inputs) refs.push(await attachments.saveImage(input))
  return refs
}

/** Save MCP image blocks through the Harness attachment store before history projection. */
export async function saveMcpResultImages(ctx, value, options = {}) {
  const { serverId, toolName } = options
  admittedMcpResult(value, options)
  const attachments = ctx?.attachments
  if (!Array.isArray(value?.content)
    || (typeof attachments?.saveImages !== 'function' && typeof attachments?.saveImage !== 'function')) return []
  const inputs = prepareMcpImages(value, { serverId, toolName })
  if (inputs.length === 0) return []
  // The Harness batch API owns count, aggregate-byte, media and raster
  // admission. Calling it exactly once ensures no validation failure can
  // publish a prefix of attachment references.
  if (typeof attachments.saveImages === 'function') return [...await attachments.saveImages(inputs)]
  return saveImagesWithLegacyHost(attachments, inputs)
}

export function renderMcpResult(_args, value) {
  const reference = value.artifact === undefined ? '' : `\nartifact: ${value.artifact.path}`
  return [{
    type: 'text',
    text: `[DeepSeekEyes MCP result]\nsha256: ${value.sha256}\nbytes: ${value.bytes}\ntruncated: ${value.truncated}${reference}\npreview:\n${value.preview}`,
  }, ...(value.images ?? []).map(attachment => ({ type: 'image', attachment }))]
}

/** Mirror the request-pressure estimator over the exact blocks render() emits. */
export function estimateMcpResultTokens(value) {
  const rendered = renderMcpResult({}, value)
  // One tool-result wrapper plus its containing message role. Each child block
  // carries the same four-token structural overhead used by token-safety.js.
  let tokens = 8
  for (const block of rendered) {
    if (block.type === 'text' || block.type === 'reasoning') {
      tokens += Math.ceil(block.text.length / 4) + 4
    } else {
      tokens += Math.ceil(JSON.stringify(block ?? null).length / 4) + 4
    }
  }
  return tokens
}

export const MCP_RESULT_OUTPUT = Object.freeze({
  schema: {
    type: 'object',
    properties: {
      schemaVersion: { type: 'string', const: 'deepseekeyes.mcp-result.v1' },
      preview: { type: 'string' },
      truncated: { type: 'boolean' },
      sha256: { type: 'string' },
      bytes: { type: 'integer' },
      artifact: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          sha256: { type: 'string' },
          bytes: { type: 'integer' },
          mediaType: { type: 'string' },
        },
        required: ['path', 'sha256', 'bytes', 'mediaType'],
        additionalProperties: false,
      },
      images: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
    },
    required: ['schemaVersion', 'preview', 'truncated', 'sha256', 'bytes'],
    additionalProperties: false,
  },
  render: renderMcpResult,
})
