# DeepSeekEyes

[简体中文](README.zh-CN.md)

DeepSeekEyes is an installable DeepSeek Harness bundle. It registers a virtual `deepseekeyes` provider which accepts native Harness image attachments, asks an already-configured multimodal Harness model for structured evidence, and delegates reasoning to the selected DeepSeek model. DeepSeek may privately request additional visual detail; the user stays in one conversation.

Version `0.2.0` adds an opt-in, state-bound Playwright Browser Computer Use tool and exposes its browser settings in the native **Settings → Plugins → DeepSeekEyes** card. It also prevents old screenshots from being re-read on every turn, bounds model-facing visual/browser history, fits final output to the selected model's context window, and lets a processed-image session switch directly to a native text-only model such as DeepSeek V4 Flash. The native model receives a session-scoped `deepseekeyes_look` tool only when it needs to re-read preserved original pixels.

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

See [README.zh-CN.md](README.zh-CN.md) for installation and configuration.
