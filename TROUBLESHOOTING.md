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
