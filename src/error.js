/** Stable error used by the bridge and surfaced by the Harness LLM runtime. */
export class DeepSeekEyesError extends Error {
  constructor(message, code, options) {
    super(message, options)
    this.name = 'DeepSeekEyesError'
    this.code = code
  }
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
