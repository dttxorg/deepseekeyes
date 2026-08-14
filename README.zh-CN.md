# DeepSeekEyes

DeepSeekEyes 是一个可安装的 DeepSeek Harness Bundle。它在模型列表中注册 `DeepSeekEyes` 虚拟供应商，使 DeepSeek 在同一个对话框里接收图片、调用已经在 Harness「模型」页面配置好的多模态模型，并在证据不足时继续向视觉模型追问。

## 工作方式

```text
同一对话框中的图片和问题
  → Harness 原始内容寻址附件
  → 已配置的视觉 Provider/Model
  → 基础 OCR、布局、对象、关系和不确定性证据
  → DeepSeek
  → 可选的内部细节追问
  → 视觉模型重新读取同一原图
  → DeepSeek 最终回答
```

插件不保存 API Key，也不实现另一套供应商客户端。视觉调用全部经过 `ctx.llm`，因此直接复用 Harness 模型页面已经配置的端点、模型和凭据。

## 安装本地交付包

```sh
npx -y @deepseek-ai/dsh plugin --profile web add /ABSOLUTE/PATH/deepseekeyes-0.1.0.tgz
```

重新启动 `dsh web`，然后在当前对话框的模型选择器中选择：

```text
DeepSeekEyes → 你的 DeepSeek 模型 + Eyes
```

此后图片仍按 Harness 原生附件方式粘贴，缩略图和会话记录都保留，不需要在视觉模型窗口和 DeepSeek 窗口之间切换。

## 视觉模型选择

默认行为是扫描所有已经注册的 Harness Provider，只采用明确声明了以下能力的模型：

```yaml
input: [text, image]
```

纯文本模型、能力未知的模型和 DeepSeekEyes 自己都不会被选作视觉模型。第一次真实图片请求前，插件还会发送一张随机排列的 3×3 色块图；模型必须正确返回九个色块的实际顺序，才会进入用户图片读取阶段。这个检测每个进程、每条视觉路由执行一次，会产生一次很小的模型调用。

如果系统内配置了多个视觉模型，可以在 `$DSH_HOME/cordis.patch.yml` 或 profile 的 `cordis.patch.yml` 中指定一个：

```yaml
- id: deepseekeyes
  config:
    upstreamProvider: deepseek-official
    visionProvider: openai
    visionModel: gpt-4.1
    activeProbe: true
    maxClarifications: 3
```

也可以通过启动环境指定：

```sh
export DEEPSEEKEYES_VISION_PROVIDER=openai
export DEEPSEEKEYES_VISION_MODEL=gpt-4.1
dsh web
```

只设置 `visionProvider` 时，会选择该 Provider 下第一个明确支持图片的模型。不设置两者时，会按 Harness Provider/Model 的注册顺序自动选择第一个视觉模型。

## 自定义网关模型

自定义模型通常只会从模型接口得到 ID，Harness 会默认按纯文本处理。需要在模型页面或 `llm-pi-ai` 配置中明确声明图片输入，例如：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      displayName: My Gateway
      apiKeyEnv: MY_GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: my-vision-model
          name: My Vision Model
          input: [text, image]
```

声明之后仍会经过随机色块检测；错误声明不会直接放行。

## 数据保真

DeepSeekEyes 只通过 `ctx.attachments.readImage()` 读取图片，并把原始 `ImageBlock` 交给 Harness 已注册的视觉适配器。插件不会裁剪、缩放、转格式或重新压缩用户图片。

每份证据记录包含：

- 原始附件 ID；
- 原始编码字节 SHA-256；
- MIME、字节数、宽度和高度；
- 视觉 Provider 和 Model；
- 能力检测方式；
- 完整结构化证据或针对性追问证据。

证据默认写入：

```text
$DSH_HOME/deepseekeyes/evidence/
```

未设置 `DSH_HOME` 时写入：

```text
~/.deepseekeyes/deepseekeyes/evidence/
```

原图始终是事实源；多轮追问每次重新引用原始附件，而不是对上一次摘要继续摘要。若视觉调用、证据 JSON、持久化或追问协议失败，本轮以错误结束，DeepSeek 不会在缺失证据时继续生成。

## 配置字段

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `providerId` | `deepseekeyes` | 虚拟 Provider ID |
| `upstreamProvider` | `deepseek-official` | DeepSeek 文本模型所在 Provider |
| `visionProvider` | 自动检测 | Harness 中已有的视觉 Provider |
| `visionModel` | 自动检测 | 视觉模型 ID |
| `activeProbe` | `true` | 启用随机像素能力检测 |
| `maxClarifications` | `3` | 每次 DeepSeek 回答最多追加的视觉追问次数 |
| `persistentEvidence` | `true` | 持久保存视觉证据 |
| `cacheDir` | DSH/Home 路径 | 证据目录；设为 `false` 时只使用进程内缓存 |
| `baseMaxTokens` | `8192` | 基础视觉证据最大输出 Token |
| `targetMaxTokens` | `4096` | 单次细节追问最大输出 Token |

## 本地验证

```sh
npm test
npm run check
npm pack --dry-run
```

已验证 DeepSeek Harness `0.1.0-rc.6`；实现参考的上游源码提交为 `47f943859bef60e4160492346772ded9b24f765a`。Node.js 版本要求为 `>=22.19`。

## 卸载

```sh
npx -y @deepseek-ai/dsh plugin --profile web remove deepseekeyes
```

卸载只移除 Bundle；Harness 会话中的原始附件保持原状。证据缓存可在确认不再需要后单独删除。
