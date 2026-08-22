# Security Policy

DeepSeekEyes is an auditable vision, MCP and Computer Use runtime for DeepSeek Harness. Its security boundary includes untrusted image pixels, untrusted model output, Provider failures, MCP servers/results, browser pages, native desktop state and local evidence files.

## Supported versions

| Version | Security fixes |
| :-- | :--: |
| 0.8.x | ✅ |
| 0.7.x | ✅ |
| 0.6.x | ✅ |
| 0.5.x | Critical fixes during the 0.6 migration window |
| Earlier | Upgrade to the current release |

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/dttxorg/deepseekeyes/security/advisories/new). Include the affected version, operating system, DSH version, reproduction steps, impact and the smallest sanitized evidence needed to reproduce the issue.

Public issues are appropriate for ordinary defects. Keep API keys, DSH settings files, original screenshots, typed Computer Use input and session exports out of public reports.

## Runtime security properties

- **Pixels are untrusted data.** Text rendered inside an image is transcribed as OCR evidence and is never promoted to a system instruction.
- **One canonical schema.** Base and targeted evidence must validate against [`schemas/visual-evidence.schema.json`](schemas/visual-evidence.schema.json). Every object rejects additional properties, and bounding boxes, confidence values and nested entries are validated.
- **Fail closed.** Invalid JSON, invalid evidence, exhausted routes, failed persistence and lost attachment identity stop the visual operation instead of producing guessed evidence.
- **Provider credentials stay in DSH.** DeepSeekEyes calls models through `ctx.llm` and does not store API keys or implement a second Provider client.
- **Original attachment authority.** Targeted rereads reference the original content-addressed DSH attachment, not a thumbnail or summary of a summary.
- **Bounded route audit.** Health and failover records contain Provider/model identifiers, status, latency, error code, image hash and a hashed session ID. Prompt text and image bytes are excluded.
- **Computer Use is opt-in.** Browser and native desktop tools are not registered until enabled. Stateful actions require the newest state ID and stale actions are rejected before mutation.
- **Window scope fails closed.** An explicit desktop window target that disappears produces an error rather than silently capturing or acting on another window.
- **Desktop text is target-bound.** Text entry requires a semantic element or screenshot coordinates bound to a current window; focus, modal and coordinate mismatches stop before text dispatch. Ambient-focus compatibility requires an explicit flag.
- **macOS pasteboard is transactional.** Coordinate-only Unicode input snapshots every current pasteboard item/type and restores them after the native paste event; semantic controls use Accessibility selected-text insertion instead.
- **Sensitive action values are hashed.** Browser/desktop reports retain the length and SHA-256 of typed values and launch arguments instead of their plaintext.
- **Private local files.** Evidence, usage, route-attempt and complete MCP-result files are written under private directories with mode `0600` on POSIX systems. Windows uses the ACL inherited from the per-user DSH home or the operator-selected artifact directory; Node's synthesized POSIX mode bits are not treated as an NTFS privacy signal. Keep a custom Windows artifact directory restricted to the account that runs DSH, or disable complete MCP artifacts with `mcpArtifactDir: false`.
- **MCP is explicit and least-exposed.** The global MCP switch is off and the server list is empty by default. A newly added server exposes zero Tools, Resources and Prompts until their independent allowlists are populated; deny rules win, and global tool-count/Schema Token budgets can block further definitions. Resources and Prompts are separately off by default, so they create no Content connection or schema unless enabled.
- **MCP is Provider-isolated.** Tool registrations are process-global for live reconfiguration, but prompt assembly retains their schemas and guidance only for the DeepSeekEyes virtual Provider. Assembly for every other Provider strips both. Execution independently rejects a wrong Provider and every agentless call before contacting the server.
- **Code Mode result context is Host-authenticated and bounded.** A nested MCP call uses Harness `deferContext()` to append a message whose source is exactly `plugin/deepseekeyes/mcp-context`; only that source plus the private marker prefix activates MCP continuation handling. Success and failure carry status/digests rather than full results or error text, and image contexts contain content-addressed attachment references rather than base64 bytes. Native execution does not duplicate this context. A nested call without the Host channel stops before server invocation with `MCP_RESULT_CONTEXT_UNAVAILABLE`.
- **Final-model and MCP sub-call quotas are separate.** `automationMaxCallsPerTurn` limits model continuation requests. `mcpMaxExternalCallsPerRun` defaults to 64 nested calls for one `run_code` and rejects the next managed invocation before transport dispatch; `0` is explicit unlimited. ToolRuntime concurrency and individual call timeouts still apply. Set a Server's `riskPolicy` to `read-only` when the application should expose only annotated reads; this withdraws non-read schemas and blocks stale/direct calls before transport. The default `allow` mode still requires a narrow explicit allowlist, narrowly scoped credentials and server-side rate/operation limits.
- **Lifecycle changes fail closed.** Stop and reconfigure withdraw every exposed MCP schema and prompt section before awaiting transport cleanup. Exposure remains suspended across slow multi-server close/reconnect work and is rebuilt only from the validated post-change generation; cleanup failure cannot revive the old definition.
- **Credentials are env-from-process references, not settings values.** stdio `env` entries and Streamable HTTP headers accept only `{ "env": "VARIABLE_NAME" }`; the named value is resolved from the `dsh web` process environment only when the connection starts. Resolved values are excluded from settings, snapshots and audit output. Credential-bearing command arguments, URL user information and credential query keys are rejected by the strict GUI/runtime validator.
- **OAuth is opt-in and process-local.** Streamable HTTP OAuth uses only the non-interactive `client_credentials` grant. Client ID and Client Secret are environment references; access tokens and discovery state stay in the process-local session registry, are shared by Tools and Content for one server, and are refreshed after expiry or a 401. Health and audit projections expose no token, secret or raw discovery document. A static `Authorization` header is rejected when OAuth is enabled.
- **Remote MCP transport requires TLS.** A Streamable HTTP URL must use HTTPS unless its hostname/address is explicitly loopback (`localhost`/`.localhost`, IPv4 `127/8`, IPv6 loopback or its IPv4-compatible/mapped loopback forms). A private-LAN hostname/address is not loopback and still requires HTTPS.
- **The retained tool catalog is fixed-bounded and atomic.** CaptureRegistry rejects the whole generation above 256 tools, 1,000,000 measured schema characters, 4,000,000 UTF-8 schema bytes, schema depth 64 or 100,000 schema nodes; no partial generation is published. `mcpMaxTools` and the Schema Token budget are later model-exposure controls, not substitutes for these capture limits.
- **The Content catalog is separately fixed-bounded.** Resources, Resource Templates and Prompts share a 256-entry, 256-page, 1,000,000-character and 4,000,000-byte discovery budget. Invalid entries, cursor loops and limit violations reject the Content plane; the model receives only static generic schemas, never an injected copy of the catalog.
- **A non-empty-to-zero catalog transition fails closed.** The old exposure is withdrawn and connection health becomes unknown until a fresh uncached probe observes the same zero-tool catalog. A genuinely empty server can therefore be healthy, but transport loss cannot reuse zero as silent proof of health.
- **Successful adapter results have a hard post-client admission boundary.** Before DeepSeekEyes canonicalization, base64 decode, attachment writes or artifact persistence, an iterative walk limits depth to 64, nodes to 50,000, content blocks to 4,096, aggregate non-image strings to 16 Mi characters, images to 8, encoded image data to 28 MiB, decoded image data to 20 MiB and other binary data to 20 MiB. `mcpMaxResultChars` is a later model-preview limit and cannot relax these fixed guards.
- **MCP results are bounded and attributable.** An admitted adapter value receives a canonical SHA-256. The model gets a bounded preview; truncated and non-text results are written to a private, content-addressed artifact by default. Artifact write/rename failure rejects the call and runs best-effort temporary-file cleanup without masking the authoritative error. With artifact persistence disabled, the projection truthfully labels delivered image attachments and raw non-text blocks that were not retained. MCP image blocks are admitted through one Harness `saveImages()` batch before visual processing. A saveImage-only legacy Host uses finite count/byte/media limits and validates the full batch before sequential compatibility writes.
- **MCP audit is privacy-reduced.** The default in-memory ring records server/tool identity, risk, status, duration, argument/result hashes and, on failure, only a stable/redacted error code plus the error-message SHA-256. It stores neither the error message, plaintext credentials nor complete arguments/results. The complete result artifact is separate and can be disabled with `mcpArtifactDir: false`.
- **Missing MCP risk hints are conservative.** The pinned official client does not forward server annotations, and sanitized public names cannot recover protocol names such as `read.file`. In `read-only` mode, or in `allow` mode when an allow/deny selector needs the original name, DeepSeekEyes performs a bounded, short-lived SDK-owned `tools/list` metadata pass for non-OAuth transports before publishing the Host-managed capture; only the four boolean risk hints are retained. A required metadata or cleanup failure fails closed and an unannotated tool remains `unknown-write`, never silently read-only. Other `allow` configurations keep the ordinary Host-managed path and still require the explicit allowlist.

An enabled stdio server runs the configured local command with the privileges of the `dsh web` process. A Streamable HTTP server receives calls at the configured endpoint and can return untrusted text or media. Result hashing and bounding provide identity and context control; they do not make an untrusted server authoritative. Review the server package/endpoint, expose only required tools and use a narrowly scoped environment credential.

The pinned official rc.6 client and MCP SDK parse/decode the transport response before DeepSeekEyes receives a value. Whenever `content` is an array, rc.6 walks the blocks and joins extracted text before checking `isError`; the successful path discards that temporary string, while the failed path throws it. DeepSeekEyes' hard admission therefore protects only the subsequent handling of a successful adapter value, while the error path bounds and redacts the already-created exception. It does not retroactively bound the dependency's earlier network decode or pre-admission extract/join allocation.

Catalog capture also starts after an upstream allocation boundary. rc.6 fully drains and validates every `tools/list` page and builds its definition map before registering definitions into CaptureRegistry. DeepSeekEyes' catalog limits bound the persistent post-client generation and downstream traversal; they do not cap an individual page's wire bytes, cursor-page count or rc.6's temporary map before capture.

DeepSeekEyes 0.8 bridges MCP Tools, Resources, Resource Templates and Prompts and adds non-interactive OAuth client credentials for Streamable HTTP. Resources/Prompts use a separate connection because DSH rc.8's official wrapper exposes Tools only, but that plane dynamically loads the exact SDK dependency owned by the canonical Host client and never bundles a second SDK. It does not provide interactive OAuth, Sampling/Elicitation, Roots management, sandbox a stdio child, or make an external write trustworthy merely because the operation returned successfully. Server process/network privileges, authentication scope and write verification remain external application boundaries.

## Dependency and release checks

Every release runs:

```bash
npm ci
npm run check
npm run test:coverage
npm audit --omit=dev
npm pack --dry-run
```

CI repeats package and native-helper checks on Ubuntu, macOS and Windows. MCP coverage includes a real Cordis context, the official DSH Tools client, the Host-owned protocol SDK, and temporary stdio plus loopback Streamable HTTP SDK servers for Tools, Resources, Resource Templates, Prompts, text/image results, OAuth discovery/token refresh, tool-list notifications, refresh and disposal. The HTTP fixture validates the actual local protocol path; it does not substitute for a particular external server or certificate. The release workflow should publish the exact commit that passed those checks.
