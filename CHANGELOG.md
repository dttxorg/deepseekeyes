# Changelog

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
