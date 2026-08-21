# Changelog

## 0.7.0 - 2026-08-21

- Add an opt-in MCP Content plane for Resources, Resource Templates and Prompts while keeping Tools entirely on DSH's official `@deepseek-ai/dsh-mcp-client`.
- Resolve `Client`, `StdioClientTransport` and `StreamableHTTPClientTransport` from the exact protocol SDK dependency owned by the canonical Host client; no second MCP SDK enters the plugin runtime.
- Add per-server `toolsEnabled`, `resourcesEnabled` and `promptsEnabled` switches plus independent allow/deny lists. Resources and Prompts default off and produce zero Content connections, generic schemas or model calls while disabled.
- Add fixed Content discovery limits of 256 total entries, 256 pages, 1,000,000 serialized characters and 4,000,000 UTF-8 bytes, including cursor-loop and invalid-entry rejection.
- Expose only two static bounded schemas—`mcp__deepseekeyes__resource` and `mcp__deepseekeyes__prompt`—when corresponding discovered entries are explicitly allowed; catalogs never enter the system prompt.
- Validate Resource URIs/templates and Prompt names/declared arguments before dispatch, then reuse existing hard result admission, bounded preview/artifact handling, image attachment bridge, deferred Code Mode context, external-call quota, Token accounting and privacy-reduced audit.
- Extend the native settings card with capability switches, Content health/counts, manual allow/deny editors, exact discovered Resource/Prompt checkboxes and a model-free `mcp.content` refresh RPC.
- Extend doctor/package verification to require the Content adapter and Host SDK exports.
- Probe Tools and Content independently on mixed-capability servers, expose per-plane status/latency/error timestamps, and serialize Content transport notifications through the manager lifecycle queue.
- Persist failed Content transport cleanup separately from Tools cleanup, withdraw affected schemas immediately, block duplicate probes/reconnects, and retry the retained close handle before creating a replacement generation.
- Add unit and real-protocol acceptance for text/image Resources, Resource Templates and parameterized/image Prompts over both stdio and loopback Streamable HTTP, plus full DSH model-call acceptance.

## 0.6.1 - 2026-08-20

- Split desktop screenshots against the active Harness attachment service's byte, per-side dimension, decoded-pixel, image-count and aggregate-byte limits instead of using compressed byte size alone. Compressible 5K/ultra-wide screens now remain exact lossless PNG tiles rather than failing DSH rc.8's 2,000px side admission.
- Keep failed Browser/Desktop tool results inside the automation call guard by correlating DSH tool-result IDs with the immediately preceding tool call even when an error block omits `toolName`; repeated native failures therefore stop at the configured model-call limit instead of bypassing Token protection.
- Add `mcpMaxExternalCallsPerRun` with default `64` and explicit `0` unlimited, enforced atomically before each nested Code Mode MCP transport dispatch and attributed to MCP limit-stop statistics.
- Prefer the already installed `dsh` executable for one-line install/upgrade/migration commands and fall back to one non-nested `npx --package=@deepseek-ai/dsh` invocation only when `dsh` is absent, removing the npm-exec-inside-npm-exec hang.
- Add rc.8 acceptance for native multimodal passthrough, future-turn pixel shadowing, stdio MCP, Token accounting and macOS Desktop Computer Use on high-resolution displays.

## 0.6.0 - 2026-08-19

- Make MCP artifact permission verification cross-platform: assert the real `0700`/`0600` contract on POSIX and rely on the per-user DSH Home or explicitly configured directory ACL on Windows instead of interpreting Node's synthesized POSIX mode bits as NTFS permissions.
- Detect DSH rc.8 upstream models that explicitly declare image input and expose them as `Native Vision` routes without requiring a separate visual Provider.
- Forward the current original `ImageBlock` unchanged to a native multimodal upstream, skip all secondary vision/evidence calls, and shadow only the future model-facing session surface after success so later text turns do not replay pixels.
- Add a `nativeVisualTurns` usage counter; native image calls remain final-model usage while vision-model tokens, bridge estimates and exact plugin overhead remain zero.
- Verify the source tree against DSH rc.8 while accepting managed MCP Host peers across `>=0.1.0-rc.6 <0.2.0`.
- Load the official MCP client and Tool SDK renderers from DSH's managed `$DSH_HOME/profiles/node_modules` Host fallback, canonicalizing the resolved entry so a profile-local shadow cannot split Cordis or tool-scheduler identity; compatible optional Host peers and rc.8 source-test pins remain enforced.
- Add a lifecycle-managed MCP application layer around the official `@deepseek-ai/dsh-mcp-client` and matching `@deepseek-ai/dsh-tools`, including local stdio and remote Streamable HTTP transports, health checks, tool refresh and reconnect controls. Remote Streamable HTTP requires HTTPS; plaintext HTTP is accepted only for explicit loopback hosts/addresses.
- Back health with live transport/tools-list probes: test connection is independent, refresh replaces the transport generation, 30-second status freshness is single-flight, and a cleared/failed generation withdraws exposure instead of reporting stale tools as healthy.
- Add atomic post-client catalog admission at 256 tools, 1,000,000 measured schema characters, 4,000,000 UTF-8 schema bytes, depth 64 and 100,000 schema nodes; over-limit/invalid generations publish no prefix, and non-empty-to-zero transitions require a matching live probe before becoming healthy.
- Add a Harness-native, default-collapsed MCP settings control center for creating, enabling and testing servers, inspecting discovered tools and health, and selecting an explicit per-server tool allowlist without editing `cordis.patch.yml`.
- Keep MCP off with no configured servers by default, expose zero tools from every new server, apply deny rules before allow rules, and enforce global tool-count and Schema Token budgets.
- Isolate model-facing MCP schemas/guidance to the DeepSeekEyes virtual Provider during prompt assembly, then reject wrong-Provider and agentless execution again before an external call.
- Ferry every successful or failed nested Code Mode MCP sub-call through the Host `deferContext()` channel as a trusted plugin `mcp-context`; carry image attachment references without base64, keep native results non-duplicated, and fail before server invocation with `MCP_RESULT_CONTEXT_UNAVAILABLE` when the Host channel is absent.
- Treat deferred Code Mode markers as MCP automation so the following continuation enters the context/call guards and `upstreamMcp` accounting; estimate `both` presentation mode from its two real request surfaces, native definitions plus generated `tools:sdk` declarations.
- Document that 0.6 `automationMaxCallsPerTurn` limits final-model continuations rather than MCP sub-calls inside one `run_code`; current concurrency/timeouts and default-closed exposure are mitigations, while a P1 `mcpMaxExternalCallsPerRun` setting (recommended `64`, `0` unlimited) remains future work.
- Suspend all MCP exposure before asynchronous stop/reconfigure cleanup and publish only the validated final generation, preventing slow or failed transport close from leaving stale schemas or guidance callable.
- Store only stdio `env` and Streamable HTTP header environment-variable references in settings; resolve them from the `dsh web` process environment at connection time, and reject credential-bearing command arguments, URLs and transport-incompatible fields during the same strict validation used by both the GUI and runtime.
- Add a fixed iterative post-client admission before DeepSeekEyes canonicalization, base64 decode or persistence: depth 64, 50,000 nodes, 4,096 blocks, 16 Mi string characters, 8 images, 28 MiB encoded image data, 20 MiB decoded image data and 20 MiB other binary data.
- Apply `mcpMaxResultChars` only to an already-admitted model preview, compute a canonical SHA-256 for the admitted adapter value, and spill truncated/non-text results to private content-addressed artifacts by default. Artifact writes clean their temporary path best-effort on success and failure without masking the authoritative error; artifact-disabled projections explicitly distinguish delivered attachments from raw blocks/tails that were not retained.
- Submit each MCP image result through one Harness `saveImages()` batch for Host-owned atomic admission; retain a count/byte/media-bounded, full-batch-validated `saveImage()` compatibility path for older Hosts, then route successful attachments into original-pixel evidence and targeted rereads.
- Add privacy-reduced in-memory MCP call auditing with server/tool identity, risk class, status, latency and argument/result hashes; failures retain only a stable/redacted code and message SHA-256 while excluding error text, credentials and complete arguments/results.
- Extend the automation context and per-instruction call guards to MCP continuations, and attribute MCP final-model usage, external calls, Schema/result input estimates, compactions and limit stops without double-counting estimates in Provider totals.
- Add MCP architecture, retention, security and troubleshooting documentation plus real official-client integration coverage for Cordis lifecycle and tool discovery/call/probe/refresh/disposal over both temporary stdio and loopback Streamable HTTP SDK servers.
- Document the dependency boundary: official Host Client/MCP SDK transport decode and unconditional extract/join for array-valued `content` happen before the `isError` branch and before DeepSeekEyes can apply its subsequent successful-value admission or error redaction.
- Document the discovery dependency boundary: the official Host Client drains/validates every `tools/list` page and builds its definition map before CaptureRegistry, so the fixed catalog limits bound persistent post-client state but not one page's wire bytes, cursor count or the temporary upstream map.
- Document the 0.6 capability boundary: MCP Tools only, with Resources/Prompts and interactive OAuth deferred; external write verification and server privileges remain application concerns.

## 0.5.9 - 2026-08-19

- Fix Windows PowerShell 5.1 UI Automation observations returning an empty semantic tree by materializing `Generic.List[object]` with `ToArray()` before returning it through the PowerShell pipeline.
- Preserve UIA elements whose virtual/offscreen bounds are non-finite while omitting only those unusable bounds, preventing PowerShell's bare `Infinity` token from corrupting native JSON.
- Add source-level regression coverage and a Windows PowerShell CI smoke test for the exact list-materialization failure reported in Issue #1.
- Require the Windows native window-observation acceptance test to return a real non-empty UI Automation tree.
- Prevent a helper's late asynchronous stdin `EPIPE` from escaping after its authoritative close/result event, removing the cross-platform native-runner CI race exposed while validating this patch.

## 0.5.8 - 2026-08-17

- Make desktop `type` target-bound: require an `elementRef` or complete screenshot coordinates, while retaining an explicit `allowFocusedTarget` compatibility escape hatch.
- Bind coordinate text entry to a current `windowRef` or window-scoped observation, validate screenshot coordinate space and target bounds, and reject ambient-focus input before native mutation.
- Execute coordinate text atomically on Windows and macOS by focusing the intended window, clicking the target, verifying the foreground window, and sending text only after the check passes.
- Detect active modal windows and stop text intended for another window with `DESKTOP_MODAL_TARGET_BLOCKED`; native focus races return `TARGET_FOCUS_MISMATCH` with no text sent.
- Add native window modal metadata, cross-platform target-verification results and action input-method diagnostics without retaining plaintext input.
- Fix macOS Unicode entry: semantic elements use Accessibility selected-text insertion, while coordinate-only input snapshots every pasteboard item/type, pastes through CoreGraphics and restores the original pasteboard.
- Teach the Computer Use prompt that the visual model owns pixel grounding, DeepSeek owns planning/text, and the runtime owns target validation and execution.
- Add protocol/session/helper regressions for targetless input, explicit compatibility mode, semantic and coordinate targets, window bounds, modal interception, helper focus checks and clipboard-preserving Unicode input.

## 0.5.7 - 2026-08-17

- Stop Browser/Desktop Computer Use from replaying an unrelated full long-task prefix on every model step: the model-facing automation copy now defaults to a 32,768-token context budget while the complete DSH task, screenshots, event log and reports remain preserved.
- Retain the newest direct user instruction plus an atomic tail of assistant tool calls and matching tool results; fail before Provider dispatch when even that required state exceeds the configured budget.
- Add a per-user-instruction runaway guard with a default of 32 final-model calls. Both safeguards are configurable in the native settings card, accept custom values, and support explicit `0` unlimited mode without changing ordinary text or non-automation image turns.
- Count every Provider-reported DeepSeek call caused by Browser/Desktop Computer Use as plugin overhead, including the semantic no-image fast path, and expose automation calls, protected turns, compactions, limit stops and estimated avoided replay input.

## 0.5.6 - 2026-08-17

- Make the one-line install/upgrade/migration commands work from inside `npm exec` on npm 11 by selecting the scoped DSH package and its `dsh` binary explicitly; update the documented uninstall command to use the same argument-safe form.

## 0.5.5 - 2026-08-16

- Recover visual evidence from MiniMax-style reasoning preambles and multiple balanced JSON candidates by selecting the final contract object, while keeping private DeepSeek control messages whole-response strict.
- Canonicalize missing empty-list structure plus common confidence/bbox scalar formats locally, retain a field-level repair audit, and keep strict Ajv validation as the final evidence gate without another model call or any source-image change.
- Retry one same-route visual request after a recognizable incomplete Anthropic SSE stream, record the retry in route attempts, and include Provider-reported usage from both calls in DeepSeekEyes Token statistics.
- Let Desktop Computer Use continue from its preserved semantic state when every bounded visual route fails; direct user-image turns remain strict and still stop rather than letting DeepSeek guess about unseen pixels.
- Fix Windows PowerShell 5.1 coordinate actions by scalarizing the window/screen origin before addition, honoring the latest window-scoped origin, and forcing UTF-8 stdin/stdout so localized native errors remain readable.
- Exercise the real Windows `move_cursor` and `click` coordinate path in cross-platform native CI in addition to PowerShell parsing, macOS helper compilation and existing desktop observation coverage.

## 0.5.4 - 2026-08-16

- Show the installed DeepSeekEyes version beside the plugin name even while the settings card is collapsed.
- Inject the badge value from `package.json` during the client build so the displayed version and published package cannot drift independently.
- Include the version in the settings-card accessible name and cover both the bundled value and rendered badge in tests.

## 0.5.3 - 2026-08-16

- Add a default `desktopVisualMode: auto` semantic/action fast path so complete Accessibility/UIA states and successful mutations continue without a visual-model call.
- Keep capturing, hashing, attaching and optionally persisting the full lossless PNG on every native step; conditional model delivery changes no source pixels or audit artifacts.
- Add per-call `includeScreenshot` overrides plus `always` full-audit and `manual` explicit-read modes in the native bilingual settings card.
- Return `visualDelivery` reasons and native/semantic/screenshot/tool timing fields, and compact non-visual desktop state text without tile attachment metadata.
- Update the Computer Use prompt to continue deterministic action sequences immediately and request pixels only when the current screen is needed.
- Add policy, override, compact-render, settings and cross-platform acceptance coverage for the new fast path.

## 0.5.2 - 2026-08-16

- Match the native Harness plugin-card disclosure pattern with a full-width accessible header button and rotating chevron.
- Keep the DeepSeekEyes settings card collapsed by default so the Plugins page remains compact alongside the built-in cards.
- Preserve staged edits when collapsing, show an unsaved badge in the header, and keep all existing live-save behavior after reopening.

## 0.5.1 - 2026-08-16

- Make desktop `launch` stateless and resolve macOS applications by display name, renamed alias, bundle ID or full `.app` path through `NSWorkspace` plus `/usr/bin/open`.
- Replace the JXA Standard Additions delay that failed after application activation with an in-process `NSThread` sleep, eliminating the opaque localized “message not understood” launch failure at the default settle delay.
- Prefer exact application/display-name matches before substring matches, so `ChatGPT` selects the windowed app instead of the earlier `ChatGPTHelper` background process.
- Resolve exact macOS targets by PID before enumerating Accessibility processes, rank focused/main usable windows ahead of tiny auxiliary dialogs, and traverse semantic children incrementally under both element and time budgets instead of calling unbounded `entireContents()`; ChatGPT launch now returns its real window without consuming the whole native timeout.
- Make explicit `application` and `title` selectors override a previously captured window, preventing a new ChatGPT request from silently returning another application's old capture.
- Allow name-based `focus` without state and read-only `observe` with the current `windowRef` without restating `stateId`; state-changing and ref-based mutations remain bound to the newest state.
- Return actionable macOS routing errors with the failed stage and available applications/windows instead of a generic target-not-found result.
- Include the action and target in native helper timeout errors so a slow launch/observe can be diagnosed directly.
- Capture exactly the selected macOS window with `screencapture -a -l`, excluding attached dialogs or parent windows so screenshot dimensions and coordinate origin always match window metadata.
- Add `semanticStatus` to every desktop state so sparse Electron Accessibility trees immediately direct the model to screenshot coordinates rather than repeated element probing.
- Add real macOS application routing acceptance for launch, direct window observation and ref observation, while keeping Windows and ordinary non-desktop paths unchanged.

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
- Keep Windows desktop discovery valid when no window-scoped semantic target exists by normalizing the UI Automation result to an explicit empty array before counting controls.

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
