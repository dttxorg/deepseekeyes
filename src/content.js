import { randomUUID } from 'node:crypto'

export function contentHasImage(content) {
  return Array.isArray(content) && content.some((block) =>
    block?.type === 'image'
      || (block?.type === 'tool-result' && contentHasImage(block.content)),
  )
}

export function messagesHaveImages(messages) {
  return Array.isArray(messages) && messages.some((message) => contentHasImage(message.content))
}

export function attachmentKey(ref) {
  const id = ref?.attachmentId
  if (typeof id === 'string' && id.length > 0) return id
  return JSON.stringify(ref ?? null)
}

function collectBlocks(blocks, found) {
  if (!Array.isArray(blocks)) return
  for (const block of blocks) {
    if (block?.type === 'image') {
      const key = attachmentKey(block.attachment)
      if (!found.has(key)) found.set(key, block)
    } else if (block?.type === 'tool-result') {
      collectBlocks(block.content, found)
    }
  }
}

export function uniqueImageBlocks(messages) {
  const found = new Map()
  for (const message of messages ?? []) collectBlocks(message.content, found)
  return [...found.values()]
}

function replaceBlocks(blocks, evidenceByAttachment) {
  return blocks.map((block) => {
    if (block?.type === 'image') {
      const evidence = evidenceByAttachment.get(attachmentKey(block.attachment))
      if (evidence === undefined) {
        throw new Error(`deepseekeyes: no evidence for attachment ${attachmentKey(block.attachment)}`)
      }
      return { type: 'text', text: evidence }
    }
    if (block?.type === 'tool-result' && contentHasImage(block.content)) {
      return { ...block, content: replaceBlocks(block.content, evidenceByAttachment) }
    }
    return block
  })
}

/** Copy wire messages while replacing every nested image with evidence text. */
export function replaceImagesWithEvidence(messages, evidenceByAttachment) {
  return messages.map((message) => {
    if (!contentHasImage(message.content)) return message
    return { ...message, content: replaceBlocks(message.content, evidenceByAttachment) }
  })
}

/** Create one ephemeral plugin-produced user message for an internal model call. */
export function pluginUserMessage(content, summary) {
  return {
    id: randomUUID(),
    role: 'user',
    content,
    source: {
      kind: 'plugin',
      plugin: 'deepseekeyes',
      form: 'notice',
      summary: summary.slice(0, 120),
    },
  }
}
