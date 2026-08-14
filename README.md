# DeepSeekEyes

[简体中文](README.zh-CN.md)

DeepSeekEyes is an installable DeepSeek Harness bundle. It registers a virtual `deepseekeyes` provider which accepts native Harness image attachments, asks an already-configured multimodal Harness model for structured evidence, and delegates reasoning to the selected DeepSeek model. DeepSeek may privately request additional visual detail; the user stays in one conversation.

Core properties:

- no API keys or provider clients of its own;
- vision routes come from the Harness Models configuration;
- static `inputModalities: [text, image]` gating plus a randomized active pixel probe;
- original content-addressed image blocks remain in the session;
- every visual call reuses the original attachment reference;
- persistent, source-hashed evidence records;
- clarification failure stops the turn instead of letting DeepSeek guess.

See [README.zh-CN.md](README.zh-CN.md) for installation and configuration.
