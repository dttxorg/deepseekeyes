# Changelog

## 0.2.0 - 2026-08-15

- Merge Browser Computer Use into `main` with Playwright-based open, observe, semantic action, wait, assertion, reporting and close operations.
- Return a fresh content-addressed screenshot, DOM-derived refs, diagnostics and stale-state-bound `stateId` after every browser step.
- Add native Harness settings for browser enablement, installed Edge/Chrome selection, executable path, locale, timing, viewport and observation limits.
- Raise the default base/clarification budgets to 16,384/8,192 tokens.
- Add 8K, 16K, 32K, 64K and 128K suggestions, unrestricted provider-managed output, and unbounded safe-integer custom token values.
- Omit `maxTokens` entirely in unrestricted mode so the selected model/Provider owns its effective output ceiling.
- Make Browser Computer Use opt-in by default so ordinary text/vision sessions receive no Browser tool or prompt overhead.
- Process only images introduced in the current request segment; historical images make zero automatic vision calls and are represented by a bounded number of compact hash-bound references.
- Compact historical Browser DOM/OCR states to a bounded recent window instead of repeatedly forwarding every full state and screenshot.
- Preserve original image events and attachment bytes while replacing processed image blocks on the model-facing session Surface, allowing direct selection of native text-only models such as DeepSeek V4 Flash.
- Add the session-scoped `deepseekeyes_look` tool so a native text model can request one precise reread from the preserved original attachment without enabling visual overhead in unrelated sessions.
- Fit final-model output to the resolved context window and retry one provider-reported context overflow with the exact safe capacity.
- Apply browser settings live, close stale sessions after launch-setting changes, and keep the existing final-model/vision-model GUI routing.
- Preserve screenshots and JSON reports under the configured DSH evidence directory and reject stale actions before page mutation.

## 0.1.1-alpha.3 - 2026-08-15

- Match the visible native Harness plugin-card surface by using the same `--dsw-alias-bg-layer-3` background token.

## 0.1.1-alpha.2 - 2026-08-15

- Add an explicit `upstreamModel` setting and `DEEPSEEKEYES_UPSTREAM_MODEL` fallback.
- Put final-answer Provider/Model and background-vision Provider/Model side by side in the native settings card.
- Clear the final model when its Provider changes and persist the selected model through Harness settings.
- Lock text-only and image turns to the configured final model; reject stale sessions that request another wrapper model.
- List only the selected final model and identify both roles in the model name and description.
- Show a live `image → vision → final answer` route summary before saving.

## 0.1.1-alpha.1 - 2026-08-14

- Register a live `deepseekeyes` Harness settings namespace.
- Expose the namespace through the configurable-provider directory and Settings API.
- Add a native bilingual Settings → Plugins card with dynamic Provider/Model choices.
- Apply upstream, vision, probing, clarification, evidence and token settings without restarting.
- Add a GUI switch that writes `llm-pi-ai` `defaultInput: [text, image]` through an exact path mutation while preserving sibling fields.
- Ship a prebuilt `dsh.client` browser bundle with the npm package.
- Match the Harness light/dark theme tokens and top-align side-by-side settings controls.
- Keep `cordis.patch.yml` and environment variables as headless fallbacks.

## 0.1.0 - 2026-08-14

- Register the image-capable `deepseekeyes` virtual Provider.
- Reuse visual Provider/Model routes configured in DeepSeek Harness.
- Require explicit image metadata and pass a randomized active pixel probe.
- Preserve original attachments while replacing images only at DeepSeek wire dispatch.
- Persist SHA-256-bound base and targeted evidence records.
- Add an internal DeepSeek-to-vision clarification loop with a strict round limit.
- Stop the turn on visual, persistence or protocol failure.
