import { canonicalJson } from './canonical.js'

export function estimateJsonTokens(value) {
  const text = canonicalJson(value)
  return text.length === 0 ? 0 : Math.ceil(text.length / 4)
}

/**
 * Project the exact schema-bearing surface owned by a registered ToolRuntime
 * definition. Runtime callbacks and presentation metadata never reach the
 * model, while `output.schema` is part of the Code Mode SDK contract.
 */
export function toolDefinitionTokenSurface(definition) {
  return {
    name: definition.name,
    description: definition.description ?? '',
    parameters: definition.parameters ?? {},
    output: definition.output?.schema ?? {},
  }
}

export function estimateToolSchemaTokens(definition) {
  return estimateJsonTokens(toolDefinitionTokenSurface(definition)) + 8
}
