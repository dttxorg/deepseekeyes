# Troubleshooting

## `MCP_TOOL_RISK_BLOCKED`

The selected MCP Server uses `riskPolicy: read-only`, and the requested tool is annotated as `write`, `destructive`, or `unknown-write`. The tool is removed from the model-facing schema and the runtime stops before transport dispatch. Select **工具风险策略 → 允许已选工具（兼容模式）** only for a Server whose allowlist and credentials are intentionally scoped, or choose a read-only tool with `readOnlyHint: true`.

Start with the scoped package doctor:

```bash
npx -y @dttxorg/deepseekeyes@latest doctor
```

Use `--json` for a machine-readable report and `--profile NAME` when the DSH profile is not `web`.

## Installation and upgrade

```bash
npx -y @dttxorg/deepseekeyes@latest install
npx -y @dttxorg/deepseekeyes@latest upgrade
```

Restart `dsh web` once after installation or upgrade. The installer migrates the old unscoped `deepseekeyes` profile dependency after the scoped package is added successfully.

DeepSeekEyes 0.8.2 is verified with DeepSeek Harness `0.1.0-rc.8` and the DSH `0.1.1-rc.2` LLM call/attachment contracts, accepts the compatible Host range `>=0.1.0-rc.6 <0.2.0`, and resolves the official MCP runtime pair plus its protocol SDK only from DSH's managed `$DSH_HOME/profiles/node_modules` Host fallback. Doctor verifies the optional Host-peer declarations, managed Host entries, Tools renderer and all three Content SDK exports; runtime resolution canonicalizes them so a profile-local copy cannot split Cordis or scheduler identity. If the MCP section or RPC controls are missing, run doctor, confirm those versions, upgrade the plugin and restart the same DSH profile named by `--profile`.

## An MCP server connects but exposes no tools

This is the expected safe state for a new server: its `allowedTools` list is empty.

1. Enable **MCP applications**, save, and verify that the server status is **connected**.
2. Use **Test connection** for an independent live transport/tools-list probe, or **Refresh tools** to replace the active transport generation and repopulate discovery. Neither operation treats a captured tool list as proof of health.
3. Select only the tools required for the task, then save again. A deny selector always overrides an allow selector.
4. Check the global **Maximum exposed tools** and **Maximum Schema Tokens** counters. A discovered tool can be shown as blocked when either budget is exhausted.
5. Select the `DeepSeekEyes` virtual Provider in the conversation. Managed MCP tools deliberately reject calls from a native Provider with `MCP_REQUIRES_DEEPSEEKEYES`.

If a selected tool shows **风险策略已拦截**, inspect the Server's **工具风险策略**. `read-only` exposes only tools with `readOnlyHint: true`; switch to the compatibility mode only when the allowlist and credentials are intentionally scoped.

Disabling MCP, disabling the server or clearing its allowlist unregisters the managed definitions and MCP prompt section. When MCP is enabled for DeepSeekEyes, prompt assembly still strips those schemas and guidance from every non-DeepSeekEyes Provider, and execution rejects wrong-Provider or agentless calls. Ordinary text, image, Browser and Desktop routes are unaffected.

## Resources or Prompts connect but do not appear

1. Enable **Resources** and/or **Prompts** on the Server and save. These switches are off by default and use an independent Content connection.
2. Click **Refresh content**. Confirm `contentStatus=connected` and inspect the discovered Resources, templates and Prompts.
3. Select exact entries in the discovery list and save again. `allowedResources` and `allowedPrompts` start empty; discovery alone exposes no schema.
4. Use the `DeepSeekEyes` virtual Provider. The generic schemas are `mcp__deepseekeyes__resource` and `mcp__deepseekeyes__prompt`, and only the corresponding schema appears when at least one item is allowed.

`MCP_RESOURCES_UNSUPPORTED` or `MCP_PROMPTS_UNSUPPORTED` means the Server did not advertise that capability. `MCP_CONTENT_CATALOG_*`, `MCP_CONTENT_PAGE_LIMIT` or `MCP_CONTENT_CURSOR_LOOP` means discovery was rejected by the fixed 256-entry / 256-page / 1,000,000-character / 4,000,000-byte Content budget. Narrow the Server catalog or disable that capability; increasing model Token settings does not change these protocol limits.

## `MCP_CATALOG_*` rejection or a server suddenly shows zero tools

DeepSeekEyes atomically rejects a captured catalog generation above any fixed post-client boundary:

| Limit code | Fixed captured-catalog boundary |
| :-- | :-- |
| `MCP_CATALOG_TOOL_LIMIT` | 256 tools |
| `MCP_CATALOG_SCHEMA_CHARS_LIMIT` | 1,000,000 measured schema characters |
| `MCP_CATALOG_SCHEMA_BYTES_LIMIT` | 4,000,000 UTF-8 schema bytes |
| `MCP_CATALOG_SCHEMA_DEPTH_LIMIT` | schema depth 64 |
| `MCP_CATALOG_SCHEMA_NODES_LIMIT` | 100,000 schema nodes |

The measured surface includes each captured tool's name, description, input parameters and output schema. A rejection publishes no partial catalog and removes that server's exposure; other servers remain independent. `mcpMaxTools` is a later cross-server exposure budget, so increasing it does not change these fixed capture limits. Reduce the server's advertised tool/schema surface.

When a previously non-empty generation becomes empty, DeepSeekEyes withdraws its tools and marks health unknown instead of treating the unregister event as a healthy empty server. **Test connection** performs a fresh uncached probe: a matching zero-tool response confirms a legitimate healthy empty catalog; a mismatch remains disconnected.

These limits begin at CaptureRegistry. Official rc.6 has already drained and validated every paginated `tools/list` response and built an in-memory definition map before registration, so this layer does not pre-limit bytes in one network page, the number of cursor pages or that temporary upstream map. Diagnose a server with pathological pagination at the server/official-client boundary rather than treating the post-capture limits as a network-response cap.

## `MCP_CREDENTIAL_MISSING` or an MCP connection fails

Credential fields contain environment-variable **names**, not secret values. For example, an HTTP `Authorization` header may point to `{ "env": "APP_MCP_AUTHORIZATION" }`. Export that variable in the environment that starts `dsh web`, then restart or reconnect the server. The settings card, runtime snapshot and audit do not return the resolved value.

For stdio, verify the executable path, argument array and optional working directory from the same user account that runs DSH. Put secrets in the server's `env` reference map rather than command arguments; common inline forms such as `--token VALUE`, `--auth=VALUE` and Basic/Bearer authorization arguments are rejected. For Streamable HTTP, a remote endpoint must use `https://`. Plain `http://` is accepted only when the URL hostname/address is explicitly loopback, for example `localhost`, `service.localhost`, `127.0.0.1` or `[::1]`; a private-LAN name or address is not loopback. Keep credentials out of URL user information/query parameters and put them in header environment references. **Test connection** returns the stage, error code, latency and discovered-tool count without exposing the credential. OAuth client credentials are available in 0.8 as an opt-in Streamable HTTP section; interactive OAuth is not part of this release. Settings status uses a fresh successful check for 30 seconds and single-flights an expired live probe; a failed probe marks the server degraded and withdraws its managed tools.

## `MCP_OAUTH_*` or a Streamable HTTP OAuth server keeps returning 401

Enable **OAuth 2.0 Client Credentials** only for a Streamable HTTP server. Enter the names of two variables that are exported to the process which starts `dsh web`, for example:

```text
MCP_OAUTH_CLIENT_ID=...
MCP_OAUTH_CLIENT_SECRET=...
```

The settings card stores `{ "env": "MCP_OAUTH_CLIENT_ID" }` and `{ "env": "MCP_OAUTH_CLIENT_SECRET" }`, never their values. Restart `dsh web` after changing the process environment, then run **Test connection**. `MCP_OAUTH_CREDENTIAL_MISSING` means the variable is absent or empty; `MCP_OAUTH_TOKEN_INVALID` means the token endpoint did not return a non-empty `access_token`; discovery failures identify the protected-resource or authorization-server stage without returning a secret.

The default token authentication is `client_secret_basic`; choose `client_secret_post` only when the authorization server advertises that method. Do not configure a static `Authorization` header at the same time—the OAuth transport owns the Bearer header. The Host SDK retries a 401 with a new client-credentials token and treats an expired in-memory token as absent, so repeated 401s usually indicate an issuer/resource mismatch, wrong scope, invalid client credentials or a server-side audience policy. Check the MCP health card for `oauth.status`, `tokenExpiresAt`, `discoveryCached` and the redacted `lastError`; token values and Client Secret values are never shown there or in the audit ring.

If Tools work but Resources/Prompts do not, confirm both capability switches are enabled and that the server advertises the corresponding MCP capabilities. Tools and Content share one process-local OAuth provider for the same server configuration; changing the environment requires a DSH restart or a reconnect after the old process-local session is gone.

## An MCP result is truncated or has only an artifact reference

`mcpMaxResultChars` defaults to `20000`, but it is not the raw-result memory guard. A successful adapter value first passes the fixed admission described below. DeepSeekEyes then canonicalizes and hashes that admitted value, sends a bounded preview to the model, and writes the complete canonical JSON under:

```text
$DSH_HOME/deepseekeyes/mcp-artifacts/<server-id>/
```

The returned SHA-256, byte count and path identify the canonical admitted adapter result, not the transport's original wire bytes. Non-text MCP content also creates an artifact by default; image blocks are additionally saved as Harness attachments for the visual bridge. Set a different private `mcpArtifactDir` when needed. Setting it to `false` means no complete artifact or reference is created: delivered images are labelled as model attachments, while raw image/audio/resource blocks that were not retained are labelled accordingly in the preview. Raising `mcpMaxResultChars` raises future model input but does not change the hard admission limits, so prefer a narrower MCP query or a follow-up tool call over placing a very large record in context.

If artifact persistence fails, the MCP result is rejected instead of presenting a complete-result reference that was not written. DeepSeekEyes attempts to remove the per-write `.tmp` file on success and failure, while preserving the original write/rename error for diagnosis; inspect the artifact directory's permissions and whether the destination path was replaced by a directory.

## `MCP_RESULT_*_LIMIT` before a preview is produced

Every successful adapter result must pass fixed limits before DeepSeekEyes canonicalization, base64 decoding, attachment writes or artifact persistence:

| Limit code | Fixed boundary |
| :-- | :-- |
| `MCP_RESULT_DEPTH_LIMIT` | nesting depth 64 |
| `MCP_RESULT_NODE_LIMIT` | 50,000 visited values |
| `MCP_RESULT_BLOCK_LIMIT` | 4,096 content blocks |
| `MCP_RESULT_STRING_LIMIT` | 16 Mi aggregate non-image string characters, including object keys |
| `MCP_RESULT_IMAGE_COUNT_LIMIT` | 8 image blocks |
| `MCP_RESULT_IMAGE_ENCODED_LIMIT` | 28 MiB aggregate base64/encoded image data |
| `MCP_RESULT_IMAGE_DECODED_LIMIT` | 20 MiB aggregate decoded image data |
| `MCP_RESULT_BINARY_LIMIT` | 20 MiB aggregate Buffer/Uint8Array data |

These fixed guards are intentionally separate from `mcpMaxResultChars`. A rejected result writes no DeepSeekEyes artifact or attachment and contributes zero MCP result-input estimate; narrow the server query or result shape rather than increasing the preview setting.

The official rc.6 client and MCP SDK already parsed/decoded the transport response before this admission runs. For any array-valued `content`, rc.6 walks the blocks and joins extracted text before checking `isError`; it discards that temporary string on success and throws it on failure. The plugin bounds and redacts an already-created exception before showing it, and the audit retains only a stable/redacted code plus message SHA-256. These controls do not bound the dependency's earlier decode or pre-admission extract/join allocation.

## Code Mode reports `MCP_RESULT_CONTEXT_UNAVAILABLE`

An MCP tool invoked inside `run_code` needs the current Harness Host's `deferContext()` channel. DeepSeekEyes uses it to append one trusted plugin `mcp-context` marker for every successful or failed nested call, so the following model request remains inside MCP context/call guards and `upstreamMcp` usage accounting. Image results carry Harness attachment references through this message and never embed base64; the visual bridge reads the original attachment and installs targeted reread state. Native MCP execution already returns its result directly and intentionally does not append a duplicate context.

This error is fail-closed and occurs before contacting the MCP server. Upgrade the Harness Host/runtime pair and restart the selected profile; retry after doctor confirms the pinned 0.7 dependencies.

Do not use `automationMaxCallsPerTurn` as a quota for calls made inside one `run_code`; it counts final-model continuation requests. `mcpMaxExternalCallsPerRun` separately defaults to 64 and rejects the next Tool/Resource/Prompt sub-call before transport dispatch; `0` is explicit unlimited. ToolRuntime concurrency, each operation's timeout and server-side rate/operation limits remain separate controls.

## An MCP image result is rejected

After the fixed raw-result admission succeeds, DeepSeekEyes submits every image block from one tool result through exactly one `ctx.attachments.saveImages()` call on a current Harness Host. The Host owns the batch count, aggregate-byte, media-type and raster-decode admission, so a validation rejection returns no prefix of attachment references. A later storage failure also returns no partial reference list, although already written content-addressed objects may remain unreachable until Host retention collects them. Reduce the server response or image sizes when the surfaced code is a fixed `MCP_RESULT_IMAGE_*_LIMIT` or Host admission code such as `TOO_MANY_IMAGES`, `IMAGES_TOO_LARGE`, `IMAGE_TOO_LARGE`, `UNSUPPORTED_IMAGE_TYPE` or `INVALID_IMAGE_BASE64`.

An older Host that exposes only `saveImage()` uses the Host's advertised limits when available, otherwise a compatibility ceiling of 8 images, 5 MiB per image and 20 MiB total. DeepSeekEyes decodes and validates the complete bounded batch before the first compatibility write. A later storage fault can leave unreachable content-addressed blobs, but the failed call returns no partial image-reference list. Upgrade Harness to use the batch boundary.

## MCP causes unexpected Token growth

An exposed tool definition consumes input context on every model request even when the tool is not called. Keep per-server allowlists narrow, leave MCP off outside structured-application tasks, and use `mcpMaxTools` plus `mcpMaxSchemaTokens` as hard exposure budgets. MCP continuations share `automationContextMaxTokens` and `automationMaxCallsPerTurn`; nested Code Mode calls are separately bounded by `mcpMaxExternalCallsPerRun` (default 64). All three accept explicit `0` unlimited mode.

## A 5K or ultra-wide desktop screenshot reports a per-side pixel limit

Upgrade to 0.6.1 or later. Older builds split only when compressed PNG bytes crossed the attachment limit, so a highly compressible 5120px screenshot could remain one file and then fail DSH rc.8's per-side admission. Current builds read the active attachment service's byte, dimension, decoded-pixel, image-count and aggregate-byte limits, split losslessly before `saveImage()`, and preserve coordinate metadata plus full/tile pixel hashes. A remaining `DESKTOP_SCREENSHOT_TILE_COUNT_LIMIT` or `DESKTOP_SCREENSHOT_TOTAL_BYTES_LIMIT` means the exact lossless screenshot cannot fit the Host's advertised message limits; observe a target window instead of the full desktop.

The Schema estimate follows the request actually sent. Native mode counts the native function definition, Code Mode counts the generated `tools:sdk` declaration, and `both` mode counts both surfaces; the larger `both` value is expected and is not an accidental duplicate of one surface.

During stop or live reconfiguration, all MCP tools can temporarily disappear even when only one transport is slow to close. This is intentional fail-closed behavior: exposure is revoked before asynchronous cleanup and restored only from the validated replacement generation. Tools and Content cleanup failures appear with their plane in health state; another probe/reconnect is blocked until the retained close handle succeeds. Wait for the operation to finish, retry reconnect, then refresh status.

The Token panel separates final-model MCP usage, external call count, Schema input estimate, result input estimate, MCP compactions and MCP limit stops. Schema/result values are attribution subsets of Provider input and are not added twice to exact usage. Non-DeepSeekEyes Provider requests receive neither the MCP schemas nor MCP guidance, so they do not pay this plugin's MCP Schema estimate. Clearing or refreshing statistics uses only the loopback RPC and does not call a model.

## The selected DeepSeek model still rejects images

Select the virtual model under **DeepSeekEyes** in the conversation model picker. Choosing the native DeepSeek entry bypasses the image bridge by design. In **Settings → Plugins → DeepSeekEyes**, verify both the final-answer route and the visual route, save, then refresh the model catalog.

For a custom OpenAI-compatible gateway, enable **Declare image input** so DSH stores `defaultInput: [text, image]` for that Provider.

## The settings card shows a different model from the conversation picker

The two model roles are independent:

- **Final answer model** is the DeepSeek model shown in the virtual model name.
- **Background visual model** reads pixels and appears after `Eyes` in the same name.

Changing one does not change the other. Save the settings card before reopening the picker.

## `base visual evidence was not one valid JSON object`

The Provider returned prose, truncated JSON or a wrapper outside the JSON object. Version 0.5.5 accepts a reasoning preamble and multiple balanced JSON candidates for visual evidence, preferring the final object that declares the expected evidence contract. Missing empty lists and common confidence/bbox scalar forms are repaired locally with an audit before strict Schema validation. Malformed JSON and unrepairable/extra fields remain rejected. Clarification control messages remain whole-response strict.

1. Set **Fallback vision route priority** to one `provider/model` per line.
2. Keep health checks and route-attempt logging enabled.
3. Inspect `$DSH_HOME/deepseekeyes/vision-attempts.json` for status, error code and latency.
4. Raise the visual output budget or select provider-managed output (`0`) when the model truncates a dense screenshot.

Current releases keep the initial evidence pass bounded and leave the original attachment available for precise targeted rereads. If an explicit `maxTokens` value is rejected before generation, DeepSeekEyes retries that route once with Provider-managed output. A recognizable incomplete Anthropic SSE stream may also retry once on the same route; its attempt and both Provider-reported usages are recorded. Neither retry applies to content or Schema failures. A `max-tokens` finish after generation is reported as `VISION_OUTPUT_TRUNCATED` instead of being mislabelled as malformed JSON.

## `bbox/N must be <= 1` or `normalizedBox` validation failures

This was a 0.4 compatibility regression when a working visual route returned pixel or `xyxy` coordinates instead of canonical normalized `xywh`. Version 0.4.2 converts the common normalized/pixel `xywh`, normalized/pixel `xyxy`, and Qwen 0–1000 `xyxy` conventions locally before running the unchanged strict Schema validator. The evidence record stores `vision.coordinateNormalization`, including every original and normalized box. No repair-model request is made and the original attachment is unchanged.

Upgrade and restart DSH:

```bash
npx -y @dttxorg/deepseekeyes@latest upgrade
```

## `visual route failover exhausted after N failed attempt(s)`

If the `computer` result already contains `"ok": true`, a `stateId`, screenshot hashes and image attachments, desktop capture succeeded. This later error belongs to the visual evidence route, not the native mouse/screenshot driver.

The surfaced error includes the ordered `provider/model [ERROR_CODE]` chain and a redacted final cause. Use that chain together with `$DSH_HOME/deepseekeyes/vision-attempts.json` to distinguish Provider budget rejection, output truncation, active-probe failure, transient transport retry and strict Schema rejection. The attempt log remains privacy-bounded and stores error codes rather than Provider message bodies.

From 0.5.5, exhaustion while processing a `computer` screenshot does not discard an otherwise valid native state. The model receives the adjacent `actionResult`, windows, accessibility elements, `stateDelta`, screenshot hash and a `desktop visual fallback` marker that explicitly says pixels were not decoded. A pasted user image still fails strictly because it has no independent native state to reason from.

When `DSH_HOME` is not exported into the web process, 0.4.2 follows Harness and resolves it to `~/.dsh`; logs and evidence therefore remain under `~/.dsh/deepseekeyes/` on Windows, macOS and Linux.

## Image or screenshot exceeds 5 MB

Pasted user images remain original DSH attachments. Desktop Computer Use screenshots are losslessly recompressed and, when required, split into coordinate-labelled PNG tiles without scaling or JPEG conversion.

## Context-length or unexpected Token growth

- Upgrade to 0.5.7 or later. Earlier releases could replay an unrelated 500k-token task prefix on every semantic Computer Use step even when no visual-model request was made.
- Keep **Context limit per automation call** at the recommended `32768` and **Maximum model calls per user instruction** at `32`. Both settings accept custom values; `0` explicitly restores unlimited behavior.
- The guard changes only the model-facing Browser/Desktop request. It never deletes the DSH task, event log, screenshots, original attachments or reports.
- Keep `historyImageLimit`, `browserHistoryLimit` and `desktopHistoryLimit` bounded.
- Historical images are compact hash pointers and do not trigger automatic rereads.
- Disable Browser/Desktop Computer Use when not needed; both are off by default.
- Review **Token usage statistics** in the settings card. Computer Use DeepSeek usage is counted as plugin overhead; the panel also shows estimated replay input avoided and budget stops.

For Desktop 0.5, keep **Desktop screenshot delivery** on **Auto · semantic fast path** and start with `observe` using `scope: "window"` plus the target application/title once it is known. Complete semantic states and successful mutations then bypass the visual Provider while the full PNG remains preserved. Use `includeScreenshot: true` only for a step whose current pixels are required. **Full audit** intentionally reads every step; **Manual** reads only explicit requests.

Reduce **Maximum semantic controls per step** when a large accessibility tree adds unnecessary tool text. Disabling semantic controls returns to screenshot-only coordinate control and therefore increases the likelihood that visual reads are needed.

## Every Computer Use step stays on `Deep diving` for minutes

Check the returned `visualDelivery` and `timings` objects:

- `visualDelivery.delivered: false` means the step used the semantic/action fast path and created no visual-model request;
- `delivered: true` means current pixels were required, explicitly requested, or forced by `desktopVisualMode: always`;
- `timings.toolTotalMs` measures native action, capture and local screenshot processing, while Provider/model generation happens after the tool returns.

Upgrade from 0.5.2 or earlier, select **Auto · semantic fast path**, and avoid `includeScreenshot: true` on deterministic `click → type` sequences. The complete screenshot remains under its SHA-256/artifact path even when the model image block is omitted.

## DSH restart fails while parsing `package.json`

Run doctor and check for `profile-manifest ... contains UTF-8 BOM`. On PowerShell, rewrite the profile manifest as UTF-8 without BOM:

```powershell
$p = Join-Path $env:USERPROFILE '.dsh\profiles\web\package.json'
$text = [System.IO.File]::ReadAllText($p)
[System.IO.File]::WriteAllText($p, $text, [System.Text.UTF8Encoding]::new($false))
```

Then rerun doctor before restarting DSH.

## Browser Computer Use does not start

Check the configured Edge/Chrome channel or executable path. Browser mode requires a compatible local Chromium runtime. Use `npm run test:browser` from a source checkout for an explicit live acceptance run.

## Desktop text goes to the wrong control, or `type` is rejected

Upgrade to 0.5.8 or later. `type` now requires one concrete target:

- semantic UI: `{"action":"type","stateId":"...","elementRef":"el_...","text":"..."}`;
- pixel-only UI: observe the target window with pixels, then use `{"action":"type","stateId":"...","windowRef":"win_...","x":123,"y":456,"text":"..."}`. A `windowRef` may be omitted only when the newest state is already scoped to that exact window.

Do not split pixel input into an unrelated click followed by targetless text. The coordinate form is one native transaction: focus window, click point, verify the foreground/modal state, then enter text. `TARGET_FOCUS_MISMATCH`, `DESKTOP_MODAL_TARGET_BLOCKED`, `DESKTOP_COORDINATE_SPACE_MISMATCH`, `DESKTOP_TYPE_COORDINATE_OUTSIDE_WINDOW` and `DESKTOP_TYPE_WINDOW_REQUIRED` all stop before text is sent. Observe again, handle any dialog, reground the input control in the new screenshot and retry with the returned `stateId`.

`allowFocusedTarget: true` exists for a caller that independently verified the current focus. It restores the pre-0.5.8 behavior explicitly and should not be the normal visual-control path.

## macOS desktop actions fail

Grant **Screen Recording** and **Accessibility** to the terminal that starts `dsh web`, then restart that terminal and DSH. Screen Recording provides PNG capture; Accessibility provides element discovery and actions. The doctor verifies packaged native helpers; `npm run test:desktop` exercises desktop discovery, window capture and semantic metadata from a source checkout.

`launch` accepts an application display name, bundle ID or full `.app` path and does not require a prior `stateId`. Version 0.5.1 resolves the app PID before Accessibility discovery, ignores tiny auxiliary dialogs when a focused/main usable window exists, and bounds semantic traversal. A timeout now names both the action and target; run `DEEPSEEKEYES_ACCEPTANCE_APPLICATION=ChatGPT npm run test:desktop` to verify this exact path locally.

## Windows desktop actions fail

Confirm `powershell.exe` exists or configure its absolute path in the plugin card. DeepSeekEyes uses Windows UI Automation, `user32`, `SendInput` and `System.Drawing`; no separate desktop automation runtime is installed. If screenshots work but `elements` is empty, confirm the target app exposes UI Automation and that the DSH process runs at a compatible integrity level.

If 0.5.4 or earlier reports mojibake together with `[System.Object[]]` and `op_Addition` on `click`, upgrade to 0.5.5. The Windows helper now forces UTF-8 JSON, scalarizes coordinate operands and uses the latest screenshot/window origin (including negative multi-monitor coordinates) before calling `user32`. Windows CI executes both `move_cursor` and a real `click` through this path.

## A window-scoped observation returns an error

Desktop 0.5 intentionally fails an explicit `scope: "window"` request when the named/ref window disappeared. Run one fresh `observe` with `scope: "desktop"`, choose a current `windowRef`, then retry the window observation with the new `stateId`. The runtime does not silently substitute the active window or widen the screenshot because that would make screenshot coordinates and visual evidence refer to a different target.
