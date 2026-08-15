# Data retention

DeepSeekEyes separates original DSH attachments, derived visual evidence, automation artifacts, usage accounting and route diagnostics.

| Data | Default location | Default bound | Contents |
| :-- | :-- | :-- | :-- |
| Original user image | DSH attachment store | Controlled by DSH/session retention | Original bytes and content-addressed attachment metadata. |
| Evidence cache | `$DSH_HOME/deepseekeyes/evidence/` | One immutable file per source/route/prompt key | Source hash/metadata, selected route and schema-valid evidence. |
| Token statistics | `$DSH_HOME/deepseekeyes/usage-stats.json` | 50 recent sessions plus totals | Provider usage, bridge estimates and operational counters. |
| Vision attempts | `$DSH_HOME/deepseekeyes/vision-attempts.json` | 1,000 attempts | Provider/model, status, phase, latency, error code, image hash and SHA-256 of session ID. |
| Browser runs | `$DSH_HOME/deepseekeyes/browser-runs/` | Operator-managed files; model history defaults to 8 summaries | Screenshots, action metadata, assertions and reports. Typed text is represented by length/hash. |
| Desktop runs | `$DSH_HOME/deepseekeyes/desktop-runs/` | Operator-managed files; model history defaults to 8 summaries | Original/lossless PNG evidence, window/element metadata, state deltas, actions, assertions and v2 reports. Typed text, assigned values and launch arguments are hashed. |
| In-memory route health | Process memory | Current process | Success/failure counts, last timestamps and circuit cooldown. |

On Windows, `$DSH_HOME` normally resolves to `%USERPROFILE%\.dsh`; on macOS/Linux it normally resolves to `~/.dsh`. When the environment variable is absent, DeepSeekEyes uses the same `~/.dsh` fallback as Harness. Explicit DSH configuration takes precedence.

## What is excluded from the route-attempt log

The attempt log does not store API keys, prompt text, model output, OCR, image bytes or raw session IDs. Persistence failures keep the current operation running and are surfaced in diagnostics.

## Configuration

- Set `persistentEvidence: false` to keep evidence memory-only.
- Set `usageStats: false` to stop new Token statistics.
- Set `visionAttemptLog: false` to stop new route-attempt records.
- Set `cacheDir`, `usageStatsPath`, `visionAttemptLogPath`, `browserArtifactsDir` or `desktopArtifactsDir` to explicit private paths.
- Set an artifact directory to `false` in headless configuration where the field supports it.
- Reduce `visionAttemptLimit`, `historyImageLimit`, `browserHistoryLimit` and `desktopHistoryLimit` for shorter retention.

## Manual deletion

Stop `dsh web` before deleting persisted runtime data.

macOS/Linux:

```bash
rm -rf "$DSH_HOME/deepseekeyes/evidence" \
       "$DSH_HOME/deepseekeyes/browser-runs" \
       "$DSH_HOME/deepseekeyes/desktop-runs"
rm -f "$DSH_HOME/deepseekeyes/usage-stats.json" \
      "$DSH_HOME/deepseekeyes/vision-attempts.json"
```

Windows PowerShell:

```powershell
$root = Join-Path $env:DSH_HOME 'deepseekeyes'
Remove-Item (Join-Path $root 'evidence') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root 'browser-runs') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root 'desktop-runs') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root 'usage-stats.json') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root 'vision-attempts.json') -Force -ErrorAction SilentlyContinue
```

Deleting DeepSeekEyes-derived files does not delete the original DSH session attachment. Apply the DSH session-retention workflow separately when original attachments must also be removed.
