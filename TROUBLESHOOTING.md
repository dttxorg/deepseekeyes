# Troubleshooting

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

## The selected DeepSeek model still rejects images

Select the virtual model under **DeepSeekEyes** in the conversation model picker. Choosing the native DeepSeek entry bypasses the image bridge by design. In **Settings → Plugins → DeepSeekEyes**, verify both the final-answer route and the visual route, save, then refresh the model catalog.

For a custom OpenAI-compatible gateway, enable **Declare image input** so DSH stores `defaultInput: [text, image]` for that Provider.

## The settings card shows a different model from the conversation picker

The two model roles are independent:

- **Final answer model** is the DeepSeek model shown in the virtual model name.
- **Background visual model** reads pixels and appears after `Eyes` in the same name.

Changing one does not change the other. Save the settings card before reopening the picker.

## `base visual evidence was not one valid JSON object`

The Provider returned prose, truncated JSON or a wrapper outside the JSON object. Version 0.4.2 restores 0.2-compatible extraction of one uniquely identifiable JSON object for visual evidence and the active probe; multiple objects and malformed JSON remain rejected. Clarification control messages remain whole-response strict.

1. Set **Fallback vision route priority** to one `provider/model` per line.
2. Keep health checks and route-attempt logging enabled.
3. Inspect `$DSH_HOME/deepseekeyes/vision-attempts.json` for status, error code and latency.
4. Raise the visual output budget or select provider-managed output (`0`) when the model truncates a dense screenshot.

Current releases keep the initial evidence pass bounded and leave the original attachment available for precise targeted rereads. If an explicit `maxTokens` value is rejected before generation, DeepSeekEyes retries that route once with Provider-managed output. This retry is limited to explicit budget-rejection diagnostics and is not used for content or Schema failures. A `max-tokens` finish after generation is reported as `VISION_OUTPUT_TRUNCATED` instead of being mislabelled as malformed JSON.

## `bbox/N must be <= 1` or `normalizedBox` validation failures

This was a 0.4 compatibility regression when a working visual route returned pixel or `xyxy` coordinates instead of canonical normalized `xywh`. Version 0.4.2 converts the common normalized/pixel `xywh`, normalized/pixel `xyxy`, and Qwen 0–1000 `xyxy` conventions locally before running the unchanged strict Schema validator. The evidence record stores `vision.coordinateNormalization`, including every original and normalized box. No repair-model request is made and the original attachment is unchanged.

Upgrade and restart DSH:

```bash
npx -y @dttxorg/deepseekeyes@latest upgrade
```

## `visual route failover exhausted after N failed attempt(s)`

If the `computer` result already contains `"ok": true`, a `stateId`, screenshot hashes and image attachments, desktop capture succeeded. This later error belongs to the visual evidence route, not the native mouse/screenshot driver.

The surfaced error now includes the ordered `provider/model [ERROR_CODE]` chain and a redacted final cause. Use that chain together with `$DSH_HOME/deepseekeyes/vision-attempts.json` to distinguish Provider budget rejection, output truncation, active-probe failure and strict Schema rejection. The attempt log remains privacy-bounded and stores error codes rather than Provider message bodies.

When `DSH_HOME` is not exported into the web process, 0.4.2 follows Harness and resolves it to `~/.dsh`; logs and evidence therefore remain under `~/.dsh/deepseekeyes/` on Windows, macOS and Linux.

## Image or screenshot exceeds 5 MB

Pasted user images remain original DSH attachments. Desktop Computer Use screenshots are losslessly recompressed and, when required, split into coordinate-labelled PNG tiles without scaling or JPEG conversion.

## Context-length or unexpected Token growth

- Keep `historyImageLimit`, `browserHistoryLimit` and `desktopHistoryLimit` bounded.
- Historical images are compact hash pointers and do not trigger automatic rereads.
- Disable Browser/Desktop Computer Use when not needed; both are off by default.
- Review **Token usage statistics** in the settings card. Normal final-answer usage is displayed separately from plugin overhead.

For Desktop 0.5, start with `observe` using `scope: "window"` plus the target application/title once it is known. This avoids repeatedly sending unrelated displays and windows. Reduce **Maximum semantic controls per step** when a large accessibility tree adds unnecessary tool text; disabling semantic controls returns to screenshot-only coordinate mode. Both settings affect only explicitly enabled Desktop Computer Use sessions.

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

## macOS desktop actions fail

Grant **Screen Recording** and **Accessibility** to the terminal that starts `dsh web`, then restart that terminal and DSH. Screen Recording provides PNG capture; Accessibility provides element discovery and actions. The doctor verifies packaged native helpers; `npm run test:desktop` exercises desktop discovery, window capture and semantic metadata from a source checkout.

## Windows desktop actions fail

Confirm `powershell.exe` exists or configure its absolute path in the plugin card. DeepSeekEyes uses Windows UI Automation, `user32`, `SendInput` and `System.Drawing`; no separate desktop automation runtime is installed. If screenshots work but `elements` is empty, confirm the target app exposes UI Automation and that the DSH process runs at a compatible integrity level.

## A window-scoped observation returns an error

Desktop 0.5 intentionally fails an explicit `scope: "window"` request when the named/ref window disappeared. Run one fresh `observe` with `scope: "desktop"`, choose a current `windowRef`, then retry the window observation with the new `stateId`. The runtime does not silently substitute the active window or widen the screenshot because that would make screenshot coordinates and visual evidence refer to a different target.
