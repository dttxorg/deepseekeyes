# Changelog

## 0.5.0 - 2026-08-16

- Add window-scoped native observation on Windows and macOS, with screenshot-relative coordinate mapping back to the desktop and explicit failure instead of silently returning the wrong scope.
- Add Windows UI Automation and macOS Accessibility element discovery with stable `elementRef` identities, semantic role/name/value/bounds/state metadata and configurable observation limits.
- Re-resolve macOS Accessibility actions by a stable semantic fingerprint and duplicate ordinal, using the prior flat index only after identity/bounds verification so a shifted tree fails closed instead of acting on another control.
- Prefer semantic `elementRef` actions while retaining pixel-coordinate fallback: click/type/scroll now accept elements, and new `invoke`, `set_value` and `perform_action` operations call native accessibility patterns.
- Derive stable `windowRef` values from native window identity while keeping all refs bound to the latest `stateId`.
- Bind macOS windows to stable CoreGraphics window numbers and re-resolve the matching Accessibility window after z-order changes, preventing a focus/raise action from capturing another window of the same application.
- Return `stateDelta` after every observation, including pixel-identity screenshot changes and added/removed/changed windows and elements.
- Add native runtime assertions for window existence/title, element existence/visibility/enabled/focus/value/name and screen changed/unchanged, while retaining explicit model-backed visual assertions.
- Upgrade desktop reports to `deepseekeyes.desktop-report.v2`; typed text, assigned values and launch arguments remain plaintext-free in persisted events.
- Add GUI settings for semantic desktop observation and element limits, increase the default desktop timeout to 30 seconds, and document the 0.5 screenshot/action/feedback loop.
- Extend unit and native acceptance coverage for window capture, semantic refs/actions, state differences, runtime assertions and macOS Accessibility; Windows helper parsing/native observation remain covered by cross-platform CI.

## 0.4.2 - 2026-08-15

- Restore the tolerant single-object extraction used by 0.2 for base evidence and the active pixel probe, while keeping clarification control messages whole-response strict and rejecting multiple JSON objects.
- Replace the full in-prompt JSON Schema dump with a compact example generated from that same canonical Schema, reducing the dense-screen base prompt from 3,756 to 2,091 characters without weakening Ajv validation.
- Normalize common Qwen 0–1000 `xyxy`, normalized `xyxy`, pixel `xyxy` and pixel `xywh` boxes into strict normalized `xywh` before validation, with original and converted coordinates retained in the evidence audit.
- Keep coordinate repair deterministic and local: it makes no additional model call, changes no source image bytes and sends only canonical normalized evidence to DeepSeek.
- Match Harness home resolution when `DSH_HOME` is absent by storing evidence, attempts, usage and Computer Use artifacts under `~/.dsh/deepseekeyes/` instead of a split `~/.deepseekeyes/deepseekeyes/` tree.

## 0.4.1 - 2026-08-15

- Register the web client bundle under its scoped npm identity, `@dttxorg/deepseekeyes`, so the Harness client-module loader resolves the package after a normal scoped install.
- Derive the registration ID from `package.json` instead of maintaining a second hard-coded identity.
- Make package verification, the native settings acceptance check and `deepseekeyes doctor` reject a client bundle whose registered module ID differs from the installed package name.
- Refresh the project logo and README hero with the DeepSeek text-model-to-vision bridge and cross-platform Computer Use visual identity.
- Bound the first-pass evidence generated for dense desktop screenshots while preserving exact original attachments for targeted rereads, retry only explicit Provider max-token rejections with Provider-managed output, classify generated-output truncation explicitly, and surface the full route/error-code chain on failover exhaustion.

## 0.4.0 - 2026-08-15

- Publish the runtime as the scoped `@dttxorg/deepseekeyes` package with cross-platform one-line `install`, `upgrade` and `doctor` commands plus an OIDC/provenance release workflow.
- Migrate an existing unscoped `deepseekeyes` profile dependency after a successful scoped install, while keeping install commands argument-safe and shell-free.
- Make `schemas/visual-evidence.schema.json` the single public contract for both initial and targeted visual evidence; generate model prompts from it and validate every nested field with strict Ajv rules.
- Reject leading/trailing prose, unknown nested fields, out-of-bounds normalized boxes and malformed confidence/OCR/object/region/observation values before evidence reaches DeepSeek.
- Add ordered visual routing across the current evidence route, configured primary route, explicit fallback priority and auto-detected image-capable models.
- Add cached capability health checks, failed-route cooldowns, bounded failover and `VISION_FAILOVER_EXHAUSTED` diagnostics without changing the single-route error contract.
- Persist privacy-bounded vision attempts with Provider/model, stage, status, latency, error code, image SHA-256 and hashed session ID; never persist prompts, image bytes or evidence text in this log.
- Add native GUI controls for route priority, health TTL, failure cooldown, failover bounds and attempt retention.
- Add a deterministic public visual eval covering screenshots, dense text, charts, route-settings UI and prompt injection, with schema validity, accuracy, latency and Token reporting.
- Add `SECURITY.md`, `TROUBLESHOOTING.md`, architecture, data-retention and eval documentation, positioning DeepSeekEyes as the auditable vision and cross-platform Computer Use runtime for DSH.

## 0.3.1 - 2026-08-15

- Add a native token-usage statistics panel with refresh, reset and live enable/disable controls.
- Separate exact Provider-reported vision/probe/clarification usage from estimated plugin-injected bridge input.
- Track final-model visual-turn usage separately and exclude it from plugin overhead so normal DeepSeek answer tokens are not attributed to DeepSeekEyes.
- Keep ordinary pure-text turns on the unchanged direct path with no statistics entry, model call or tool-schema overhead.
- Persist totals and the 50 most recent sessions atomically under `$DSH_HOME/deepseekeyes/usage-stats.json` with mode `0600`, while supporting a memory-only mode.
- Serve statistics through a loopback-only `/deepseekeyes` RPC, so reading and resetting the panel never creates a model request.
- Treat statistics persistence failures as non-fatal: continue accounting in memory and recover on a later successful write without interrupting the user turn.

## 0.3.0 - 2026-08-15

- Add opt-in native Desktop Computer Use for Windows and macOS without replacing the existing Browser Computer Use flow.
- Register a separate `computer` tool only while desktop control is enabled; ordinary sessions receive no desktop tool, prompt, screenshot or visual-call overhead.
- Support observe, mouse movement/click/drag, Unicode text, shortcut keys, scrolling, application launch/focus, window movement/resizing/closing, waits, visual pass/fail assertions, evidence reports and session close.
- Use PowerShell plus user32/System.Drawing on Windows and JXA plus CoreGraphics/System Events/screencapture on macOS, with no new desktop automation runtime dependency.
- Bind every stateful action to the latest screenshot `stateId`, reject stale actions before mutation, bound coordinates to the newest screenshot and scope window refs to one observation.
- Return a fresh full-screen PNG and window catalog after every action and route those pixels through the same DeepSeekEyes evidence/clarification loop before DeepSeek continues.
- Recompress system screenshots without pixel changes and losslessly tile only when the Host's 5 MB single-image limit requires it; record source, full-pixel, tile-pixel and attachment SHA-256 values.
- Hash typed text and launch arguments in persisted reports instead of storing their original values.
- Add independent Desktop history retention so old screenshots and full window lists do not repeat across turns or inflate normal model context.
- Add live GUI settings for desktop enablement, history, action timeout, settle delay, window count, macOS display, Windows PowerShell path and evidence directory.
- Add macOS native observe acceptance, Windows/macOS driver simulation, native-helper validation, lossless tile reconstruction tests and cross-platform CI coverage.

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
