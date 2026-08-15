# DeepSeekEyes

[简体中文](README.zh-CN.md)

DeepSeekEyes is an installable DeepSeek Harness bundle. It registers a virtual `deepseekeyes` provider which accepts native Harness image attachments, asks an already-configured multimodal Harness model for structured evidence, and delegates reasoning to the selected DeepSeek model. DeepSeek may privately request additional visual detail; the user stays in one conversation.

Version `0.3.0` adds opt-in native Desktop Computer Use for both Windows and macOS alongside the existing Playwright Browser Computer Use tool. The same native **Settings → Plugins → DeepSeekEyes** card controls both modes. Every desktop action is bound to the latest screenshot state, returns a new full-screen PNG and window catalog, and sends those pixels back through the DeepSeekEyes vision bridge before DeepSeek continues.

Core properties:

- no API keys or provider clients of its own;
- final-answer and vision routes come from the Harness Models configuration and are selected independently in the native plugin settings card;
- static `inputModalities: [text, image]` gating plus a randomized active pixel probe;
- original content-addressed image events and attachment bytes remain in the append-only session log;
- every visual call reuses the original attachment reference;
- persistent, source-hashed evidence records;
- historical images cause zero automatic visual calls and become bounded model-facing pointers;
- a session-scoped `deepseekeyes_look` tool can re-read one preserved original image on demand after switching models;
- final-output budgets are reduced only when input plus output would exceed the resolved context window, with one exact retry for provider-reported overflow;
- clarification failure stops the turn instead of letting DeepSeek guess;
- browser open/observe/action/assert/report loops with fresh screenshots after every step;
- stale-state rejection, semantic element refs, coordinate fallback, diagnostics and content-addressed evidence reports;
- bounded historical Browser states instead of repeatedly carrying full OCR/DOM evidence;
- native settings for installed Edge/Chrome selection, headless mode, viewport, timing and observation limits; Browser Computer Use is disabled by default so ordinary text sessions receive no browser tool/prompt overhead.
- native Windows and macOS `computer` actions for observation, pointer, keyboard, scrolling, application launch/focus, window movement/resizing/closing, waits and evidence reports;
- stale desktop state rejection, screenshot-coordinate bounds and latest-state-only window refs;
- exact desktop PNG pixel preservation: oversized screenshots are losslessly recompressed and, only when required by the Host's 5 MB attachment limit, split into coordinate-labelled lossless tiles without scaling or JPEG conversion;
- independently bounded desktop history so earlier full screenshots/window lists do not create repeated visual calls or runaway context growth;
- Desktop Computer Use is also disabled by default, so ordinary text/image sessions keep their existing tool set, prompt and token behavior.

See [README.zh-CN.md](README.zh-CN.md) for installation and configuration.
