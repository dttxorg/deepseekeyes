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
npx -y @deepseek-ai/dsh plugin --profile web add /ABSOLUTE/PATH/deepseekeyes-0.1.1-alpha.2.tgz
```

重新启动 `dsh web`，然后在当前对话框的模型选择器中选择：

```text
DeepSeekEyes → 最终回答模型 · 后台读图模型 Eyes
```

此后图片仍按 Harness 原生附件方式粘贴，缩略图和会话记录都保留，不需要在视觉模型窗口和 DeepSeek 窗口之间切换。

## 全 GUI 配置（0.1.1 Alpha）

安装后只需重启一次 `dsh web`。此后的路由与插件参数都可以在 Harness 原生设置界面完成，保存后实时生效：

1. 打开 **设置 → 模型**，按 Harness 原有方式添加文本 Provider、视觉 Provider、模型和 API Key。
2. 打开 **设置 → 插件 → 可配置 → DeepSeekEyes**。
3. 分别选择两条明确路由：
   - **最终回答 Provider**；
   - **最终回答模型**（负责推理和回复用户）；
   - **后台读图 Provider**；
   - **后台读图模型**（只读取原图并回答细节追问）。
4. 选择是否自动检测、是否运行随机像素探针、追问轮数和 Token 上限。
5. 先核对卡片里的实时摘要，例如 `图片 → MiniMax-M3 读图 → DeepSeek-V4-Pro 最终回答`，再点击 **保存并立即应用**。
6. 在对话模型选择器中选择 `DeepSeekEyes → DeepSeek-V4-Pro · MiniMax-M3 Eyes`。

DeepSeekEyes 的 GUI 数据写入 Harness 自己的 `settings.yaml` namespace；不再要求把 `upstreamProvider`、`upstreamModel`、`visionProvider` 或 `visionModel` 写进 `cordis.patch.yml`。切换最终回答 Provider 时，界面会清空旧模型，避免把上一个 Provider 的模型 ID 带入新路由。

## 自定义网关的图片能力

自定义网关通常只能从接口发现模型 ID，Harness 会保守地把能力未知的模型当作纯文本。在 DeepSeekEyes 设置卡片选择一个 `llm-pi-ai` 自定义 Provider 后，会出现：

```text
将此自定义网关声明为支持图片输入
```

打开后随同保存，插件通过 Harness 的精确 settings-path mutation 写入：

```yaml
defaultInput: [text, image]
```

这个写入保留同一 Provider 的 BaseURL、API 协议、模型列表、凭据引用和其他未展示字段，因此无需手改 `settings.yaml`。所有 `llm-pi-ai` 路由都可以显示此开关，以兼容内置路由下新增的自定义模型；目录已经明确声明图片能力时无需开启。

能力声明不是最终放行条件：

1. Host 先要求所选模型同时声明 `text` 和 `image`；
2. 第一次真实图片请求前，再发送随机排列的 3×3 色块图；
3. 模型必须返回九个色块的真实顺序，才会读取用户图片。

因此把纯文本模型误设为视觉模型时，视觉探针会终止该轮，不会形成“两个纯文本模型互相猜图”。探针对每个进程、每条视觉路由只执行一次，会产生一次很小的模型调用。

## YAML / 环境变量后备入口

无 Web 设置界面的部署仍可使用原有配置：

```yaml
- id: deepseekeyes
  config:
    upstreamProvider: deepseek-official
    upstreamModel: deepseek-v4-pro
    visionProvider: openai
    visionModel: gpt-4.1
    activeProbe: true
    maxClarifications: 3
```

也可以通过启动环境指定最终模型和视觉路由：

```sh
export DEEPSEEKEYES_UPSTREAM_MODEL=deepseek-v4-pro
export DEEPSEEKEYES_VISION_PROVIDER=openai
export DEEPSEEKEYES_VISION_MODEL=gpt-4.1
dsh web
```

只设置 `visionProvider` 时，会选择该 Provider 下第一个明确支持图片的模型。不设置两者时，会按 Harness Provider/Model 的注册顺序自动选择第一个视觉模型。`upstreamModel` 留空时保留 0.1.1-alpha.1 的兼容行为，即把最终 Provider 下所有纯文本模型显示为可选；在 GUI 选定一个最终回答模型后，目录和每次文本/图片请求都会锁定到该模型。

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
| `upstreamModel` | 兼容模式 | 最终推理与回答模型 ID；设置后目录和调用都锁定该模型 |
| `visionProvider` | 自动检测 | Harness 中已有的视觉 Provider |
| `visionModel` | 自动检测 | 视觉模型 ID |
| `autoDetectVision` | `true` | 未选择视觉 Provider 时自动扫描 |
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

设置接口和 Client 插槽按 DeepSeek Harness `0.1.0-rc.6` 验证；实现参考的上游源码提交为 `47f943859bef60e4160492346772ded9b24f765a`。Node.js 版本要求为 `>=22.19`。

## 卸载

```sh
npx -y @deepseek-ai/dsh plugin --profile web remove deepseekeyes
```

卸载只移除 Bundle；Harness 会话中的原始附件保持原状。证据缓存可在确认不再需要后单独删除。
