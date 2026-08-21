# Data retention

DeepSeekEyes separates original DSH attachments, derived visual evidence, MCP results, automation artifacts, usage accounting and route diagnostics.

| Data | Default location | Default bound | Contents |
| :-- | :-- | :-- | :-- |
| Original user image | DSH attachment store | Controlled by DSH/session retention | Original bytes and content-addressed attachment metadata. |
| Evidence cache | `$DSH_HOME/deepseekeyes/evidence/` | One immutable file per source/route/prompt key | Source hash/metadata, selected route and schema-valid evidence. |
| Token statistics | `$DSH_HOME/deepseekeyes/usage-stats.json` | 50 recent sessions plus totals | Provider usage, bridge estimates, native-vision bypass turns, Computer Use/MCP DeepSeek usage, MCP Schema/result attribution, avoided-replay estimates and operational counters. Nested Code Mode success/failure continuations are attributed to `upstreamMcp`; `both`-mode Schema estimates include the native and generated `tools:sdk` input surfaces. |
| Vision attempts | `$DSH_HOME/deepseekeyes/vision-attempts.json` | 1,000 attempts | Provider/model, status, phase, latency, error code, image hash and SHA-256 of session ID. |
| Browser runs | `$DSH_HOME/deepseekeyes/browser-runs/` | Operator-managed files; model history defaults to 8 summaries | Screenshots, action metadata, assertions and reports. Typed text is represented by length/hash. |
| Desktop runs | `$DSH_HOME/deepseekeyes/desktop-runs/` | Operator-managed files; model history defaults to 8 summaries | Original/lossless PNG evidence, window/element metadata, state deltas, actions, assertions and v2 reports. Typed text, assigned values and launch arguments are hashed. |
| Transient official-client tool catalog | Official Host Client process memory before CaptureRegistry | Controlled by the dependency while it drains/validates paginated `tools/list` and builds its definition map | Complete upstream pages/map exist before DeepSeekEyes can apply its catalog limits; this plugin does not bound page bytes or cursor count at that earlier stage. |
| Captured MCP tool catalog | Process memory after official-client registration | Fixed per-generation limits: 256 tools; 1,000,000 schema chars; 4,000,000 UTF-8 bytes; depth 64; 100,000 nodes | Name, description, input parameters and output schema. Invalid/duplicate/over-limit generations are atomically cleared; a non-empty-to-zero transition is unverified until a matching live probe. |
| MCP Content catalog | Process memory only while its per-server Resources/Prompts switch is enabled | Shared fixed limits: 256 Resources/templates/Prompts, 256 pages, 1,000,000 serialized characters and 4,000,000 UTF-8 bytes | Public discovery metadata only: URI/template, name/title/description, MIME/size/annotations, Prompt argument names/descriptions/required flags. Catalog entries are not injected into the system prompt. |
| Transient MCP adapter result | Official Host Client and plugin process memory before projection | The dependency decodes first and, for array-valued `content`, extracts/joins text before checking `isError`; fixed DeepSeekEyes post-client admission then limits depth 64, 50,000 nodes, 4,096 blocks, 16 Mi string chars, 8 images, 28 MiB encoded image, 20 MiB decoded image and 20 MiB other binary data | The temporary join occurs on both successful and failed array-content paths and is discarded on success or thrown on failure. Only the subsequently returned successful value enters DeepSeekEyes admission, canonicalization and persistence controls. |
| MCP model-visible result | DSH session/event storage | Controlled by DSH/session retention; each admitted result defaults to 20,000 visible characters | Bounded text preview, canonical-admitted-result SHA-256, byte count, truncation flag and optional local artifact reference. |
| Code Mode MCP context | DSH session/event storage through Host `deferContext()` | One trusted plugin message per successful or failed nested MCP sub-call | Tool/status/result-or-error digest/image count plus content-addressed Harness attachment references. It contains no inline base64, full result, error text or credential; native calls do not duplicate it. |
| Complete MCP result artifact | `$DSH_HOME/deepseekeyes/mcp-artifacts/<server>/` | Content-addressed, operator-managed files; created by default for truncated or non-text admitted results | Exact canonical JSON of the admitted adapter value, not the original transport bytes. The filename contains the tool name and result SHA-256; POSIX directories/files use `0700`/`0600`, while Windows inherits the ACL of DSH Home or the configured artifact directory because POSIX mode bits do not represent NTFS permissions. A private temporary file is best-effort removed in `finally` after success or failure; persistence failure rejects the result. |
| MCP image output | DSH attachment store | Controlled by DSH/session retention and Host batch limits; saveImage-only fallback uses Host limits or 8 images / 5 MiB each / 20 MiB total | Decoded MCP image content submitted once through `saveImages()` and passed into the visual evidence path. Legacy Hosts validate a bounded full batch before sequential compatibility writes. |
| MCP OAuth session | Process memory only | One current access token and one discovery snapshot per normalized OAuth server; removed with the process/session registry | Client ID/Secret are resolved from the DSH process environment only at connection time. The token, client secret and raw discovery response are never written to settings, artifacts, usage statistics or audit records; health exposes only authentication status, expiry timestamp, discovery presence and redacted error code. Tools and Content reuse the same session and refresh it after expiry/401. |
| MCP audit ring | Process memory | 200 most recent calls | Server/tool identity, risk class, status, duration and argument/result hashes; failures add only a stable/redacted error code and message SHA-256. No error text, complete arguments/results or credentials. |
| In-memory route health | Process memory | Current process | Success/failure counts, last timestamps and circuit cooldown. |

On Windows, `$DSH_HOME` normally resolves to `%USERPROFILE%\.dsh`; on macOS/Linux it normally resolves to `~/.dsh`. When the environment variable is absent, DeepSeekEyes uses the same `~/.dsh` fallback as Harness. Explicit DSH configuration takes precedence.

The 200-entry MCP audit ring is retention, not enforcement. `automationMaxCallsPerTurn` limits final-model continuations, while `mcpMaxExternalCallsPerRun` enforces the separate default 64-call quota inside one `run_code` before transport dispatch. Its per-run counter is in memory only and is removed when the Host run signal aborts; explicit `0` is unlimited. ToolRuntime concurrency/timeouts remain independent.

## What is excluded from the route-attempt log

The attempt log does not store API keys, prompt text, model output, OCR, image bytes or raw session IDs. Persistence failures keep the current operation running and are surfaced in diagnostics.

## Configuration

- Set `persistentEvidence: false` to keep evidence memory-only.
- Set `usageStats: false` to stop new Token statistics.
- Set `automationContextMaxTokens: 32768` and `automationMaxCallsPerTurn: 32` to keep the default model-facing Computer Use bounds. Either value may be set to `0` for explicit unlimited mode; neither setting deletes retained task or evidence data.
- Set `visionAttemptLog: false` to stop new route-attempt records.
- Keep `mcpEnabled: false` (the default) to avoid connecting MCP servers or registering tool definitions.
- Keep each server `allowedTools` list empty until a tool is needed. `denyTools` always overrides matching allow entries; unrelated Providers receive neither these MCP schemas nor the MCP prompt section.
- Keep `resourcesEnabled` and `promptsEnabled` false (their defaults) to avoid the independent Content connection. Enabling discovery alone still exposes no generic schema while `allowedResources` / `allowedPrompts` remain empty; deny rules override allow rules.
- Keep `oauth.enabled` false (the default) unless the Streamable HTTP server requires OAuth. Supply only `{ "env": "VARIABLE_NAME" }` references for `clientId` and `clientSecret`; never place a token or secret in settings, a URL, a command argument or a static `Authorization` header.
- Treat OAuth health and audit as metadata only. `tokenExpiresAt` and `discoveryCached` do not retain token material; restarting `dsh web` clears the process-local token and discovery state. Rotate the environment values and restart DSH when a Client Secret changes.
- Treat `mcpMaxTools` as a post-capture model-exposure budget. `0` removes only that later budget; it does not disable the fixed 256-tool/catalog-complexity limits or the official client's earlier paginated-discovery allocation.
- Set `mcpMaxResultChars` to bound the preview of an already-admitted result stored in the model-visible session. It does not change the fixed raw-result admission. Keep `mcpMaxTools` / `mcpMaxSchemaTokens` bounded to reduce persistent conversation growth from exposed tools.
- Set `mcpAudit: false` to stop new in-memory MCP audit summaries. This audit is not written to disk by default.
- Set `mcpArtifactDir: false` to stop complete MCP result artifacts. The model still receives a bounded preview, but no artifact/reference is claimed: delivered images are labelled as attachments and omitted raw image/audio/resource blocks are explicitly labelled as not retained. A truncated tail has no DeepSeekEyes complete-result copy.
- Set `desktopVisualMode: auto` to keep every native screenshot while omitting model image delivery when semantic/action evidence is sufficient. `manual` requires an explicit `includeScreenshot: true`; neither mode deletes captured artifacts.
- Set `cacheDir`, `usageStatsPath`, `visionAttemptLogPath`, `browserArtifactsDir`, `desktopArtifactsDir` or `mcpArtifactDir` to explicit private paths.
- Set an artifact directory to `false` in headless configuration where the field supports it.
- Reduce `visionAttemptLimit`, `historyImageLimit`, `browserHistoryLimit` and `desktopHistoryLimit` for shorter retention.

## Manual deletion

Stop `dsh web` before deleting persisted runtime data.

macOS/Linux:

```bash
rm -rf "$DSH_HOME/deepseekeyes/evidence" \
       "$DSH_HOME/deepseekeyes/browser-runs" \
       "$DSH_HOME/deepseekeyes/desktop-runs" \
       "$DSH_HOME/deepseekeyes/mcp-artifacts"
rm -f "$DSH_HOME/deepseekeyes/usage-stats.json" \
      "$DSH_HOME/deepseekeyes/vision-attempts.json"
```

Windows PowerShell:

```powershell
$root = Join-Path $env:DSH_HOME 'deepseekeyes'
Remove-Item (Join-Path $root 'evidence') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root 'browser-runs') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root 'desktop-runs') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root 'mcp-artifacts') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root 'usage-stats.json') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root 'vision-attempts.json') -Force -ErrorAction SilentlyContinue
```

Deleting DeepSeekEyes-derived files does not delete original user images, MCP image attachments, deferred Code Mode `mcp-context` messages or bounded MCP result previews already retained by the DSH session. Apply the DSH session-retention workflow separately when those session records and attachments must also be removed. On both the current batch API and the legacy saveImage-only path, a storage failure after full-batch validation may leave unreachable content-addressed image blobs while returning no partial reference list; use the Host's attachment cleanup policy for those objects. Restarting DSH clears the in-memory MCP audit ring and connection-health state.
