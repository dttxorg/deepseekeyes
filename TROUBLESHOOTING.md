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

The Provider returned prose, truncated JSON or a wrapper outside the JSON object. Version 0.4 validates the full nested output against the canonical schema and can move to the next configured visual route.

1. Set **Fallback vision route priority** to one `provider/model` per line.
2. Keep health checks and route-attempt logging enabled.
3. Inspect `$DSH_HOME/deepseekeyes/vision-attempts.json` for status, error code and latency.
4. Raise the visual output budget or select provider-managed output (`0`) when the model truncates a dense screenshot.

Current releases keep the initial evidence pass bounded and leave the original attachment available for precise targeted rereads. If an explicit `maxTokens` value is rejected before generation, DeepSeekEyes retries that route once with Provider-managed output. This retry is limited to explicit budget-rejection diagnostics and is not used for content or Schema failures. A `max-tokens` finish after generation is reported as `VISION_OUTPUT_TRUNCATED` instead of being mislabelled as malformed JSON.

## `visual route failover exhausted after N failed attempt(s)`

If the `computer` result already contains `"ok": true`, a `stateId`, screenshot hashes and image attachments, desktop capture succeeded. This later error belongs to the visual evidence route, not the native mouse/screenshot driver.

The surfaced error now includes the ordered `provider/model [ERROR_CODE]` chain and a redacted final cause. Use that chain together with `$DSH_HOME/deepseekeyes/vision-attempts.json` to distinguish Provider budget rejection, output truncation, active-probe failure and strict Schema rejection. The attempt log remains privacy-bounded and stores error codes rather than Provider message bodies.

## Image or screenshot exceeds 5 MB

Pasted user images remain original DSH attachments. Desktop Computer Use screenshots are losslessly recompressed and, when required, split into coordinate-labelled PNG tiles without scaling or JPEG conversion.

## Context-length or unexpected Token growth

- Keep `historyImageLimit`, `browserHistoryLimit` and `desktopHistoryLimit` bounded.
- Historical images are compact hash pointers and do not trigger automatic rereads.
- Disable Browser/Desktop Computer Use when not needed; both are off by default.
- Review **Token usage statistics** in the settings card. Normal final-answer usage is displayed separately from plugin overhead.

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

Grant **Screen Recording** and **Accessibility** to the terminal that starts `dsh web`, then restart that terminal and DSH. The doctor verifies packaged native helpers; `npm run test:desktop` exercises native observation from a source checkout.

## Windows desktop actions fail

Confirm `powershell.exe` exists or configure its absolute path in the plugin card. DeepSeekEyes uses `user32`, `SendInput` and `System.Drawing`; no separate desktop automation runtime is installed.
