# DeepSeekEyes

[简体中文](README.zh-CN.md)

DeepSeekEyes is an installable DeepSeek Harness bundle. It registers a virtual `deepseekeyes` provider which accepts native Harness image attachments, asks an already-configured multimodal Harness model for structured evidence, and delegates reasoning to the selected DeepSeek model. DeepSeek may privately request additional visual detail; the user stays in one conversation.

Version `0.1.1-alpha.1` adds a native **Settings → Plugins → DeepSeekEyes** card. Text/vision providers, the vision model, probing, clarification limits, evidence persistence, and token caps are editable in the Harness GUI and apply live. For custom `llm-pi-ai` gateways, the same card can write `defaultInput: [text, image]` with a path mutation that preserves every sibling provider field.

Core properties:

- no API keys or provider clients of its own;
- vision routes come from the Harness Models configuration and are selected in the native plugin settings card;
- static `inputModalities: [text, image]` gating plus a randomized active pixel probe;
- original content-addressed image blocks remain in the session;
- every visual call reuses the original attachment reference;
- persistent, source-hashed evidence records;
- clarification failure stops the turn instead of letting DeepSeek guess.

See [README.zh-CN.md](README.zh-CN.md) for installation and configuration.
