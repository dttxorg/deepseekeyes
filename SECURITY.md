# Security Policy

DeepSeekEyes is an auditable vision and Computer Use runtime for DeepSeek Harness. Its security boundary includes untrusted image pixels, untrusted model output, Provider failures, browser pages, native desktop state and local evidence files.

## Supported versions

| Version | Security fixes |
| :-- | :--: |
| 0.5.x | ✅ |
| 0.4.x | Critical fixes during the 0.5 migration window |
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
- **Sensitive action values are hashed.** Browser/desktop reports retain the length and SHA-256 of typed values and launch arguments instead of their plaintext.
- **Private local files.** Evidence, usage and route-attempt files are written under private directories with mode `0600` on POSIX systems.

## Dependency and release checks

Every release runs:

```bash
npm ci
npm run check
npm audit --omit=dev
npm pack --dry-run
```

CI repeats package and native-helper checks on Ubuntu, macOS and Windows. The release workflow should publish the exact commit that passed those checks.
