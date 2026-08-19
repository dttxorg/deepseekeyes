import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  createMcpServerDraft,
  mcpToolAllowedInDraft,
  nextMcpReferenceEntry,
  normalizeSettingsDraft,
  providerDeclaresVision,
  providerSettingsTarget,
  providerVisionMutation,
  settingsDraftFailure,
  settingsPathOps,
  updateMcpToolSelection,
} from '../src/settings-ui.js'

const NS = 'deepseekeyes.settings'
const PROVIDER_ID = 'deepseekeyes'
const PLUGIN_VERSION = __DEEPSEEKEYES_VERSION__

const zh = {
  title: 'DeepSeekEyes',
  version: '版本',
  description: '在同一对话框内为 DeepSeek 接入视觉模型，并保留对原图的按需追问。',
  expand: '展开',
  collapse: '收起',
  unsaved: '未保存',
  loading: '正在读取 Harness 模型设置…',
  unavailable: 'DeepSeekEyes 设置尚未由 Host 暴露。',
  readOnly: '当前设置文件为只读。',
  upstreamProvider: '最终回答 Provider',
  upstreamModel: '最终回答模型',
  upstreamModelPlaceholder: '选择或输入模型 ID；留空则兼容显示该 Provider 的全部文本模型',
  upstreamHint: '负责读取视觉证据、推理并最终回复用户。',
  visionProvider: '后台读图 Provider',
  visionProviderAuto: '自动扫描视觉模型',
  visionHint: '只负责读取原图并回答最终模型的细节追问。',
  visionModel: '后台读图模型',
  visionModelPlaceholder: '选择或输入模型 ID；留空则选该 Provider 的首个视觉模型',
  routeSummary: '当前路由：图片 → {vision} 读图 → {final} 最终回答',
  automaticVision: '自动检测视觉模型',
  allTextModels: '该 Provider 的会话所选模型',
  declareVision: '将此自定义网关声明为支持图片输入',
  declareVisionHint: '保存时写入 llm-pi-ai 的 defaultInput: [text, image]，无需手改 settings.yaml。',
  catalogManaged: '该 Provider 的图片能力由内置模型目录管理；插件会在 Host 端再次校验 text + image。',
  autoDetect: '未指定视觉 Provider 时自动检测',
  activeProbe: '首次使用时执行随机像素探针',
  activeProbeHint: '不仅相信模型声明，还会发送随机 3×3 色块确认模型确实读取了像素。',
  visionReliability: '视觉路由可靠性',
  visionRoutePriority: '后备视觉路由优先级',
  visionRoutePriorityPlaceholder: '每行一个 provider/model；模型 ID 可继续包含 /',
  visionRoutePriorityHint: '主视觉路由失败后按顺序尝试；未列出的视觉模型仍可由自动检测补充。',
  visionHealthCheck: '启用视觉路由健康检查与熔断',
  visionHealthCheckHint: '缓存图片能力检测；调用失败后在冷却期跳过该路由，并记录每次选择与故障转移。',
  visionFailoverAttempts: '最多后备尝试次数',
  visionHealthTtlMs: '健康检查缓存（毫秒）',
  visionFailureCooldownMs: '失败路由冷却（毫秒）',
  visionAttemptLog: '记录视觉路由 attempts',
  visionAttemptLogHint: '仅保存 Provider、模型、状态、耗时、错误码及哈希后的会话 ID，不保存提示或图片内容。',
  visionAttemptLimit: '最多保留 attempts',
  persistentEvidence: '持久化视觉证据缓存',
  usageStats: '记录 DeepSeekEyes Token 统计',
  usageStatsTitle: 'Token 消耗统计',
  usageStatsHint: '精确值来自 Provider 返回的 usage；Computer Use 引发的 DeepSeek 调用会完整计入。桥接输入与上下文节省量使用 Harness 固定密度规则估算。统计查询直接走本机 RPC，不调用模型。',
  usageStatsDisabled: '统计已关闭；关闭期间不记录新的数据。',
  usageStatsLoading: '正在读取 Token 统计…',
  usageStatsUnavailable: 'Token 统计读取失败：',
  usagePersistenceError: '统计文件暂时写入失败，当前进程仍继续在内存中计数：',
  usageExactAdditional: '精确额外 Token',
  usageEstimatedBridge: '估算桥接输入',
  usageEstimatedTotal: '估算插件合计',
  usageVision: '视觉模型 Token',
  usageClarification: 'DeepSeek 追问轮次 Token',
  usageAutomation: 'Computer Use DeepSeek Token',
  usageAutomationTurns: '自动化用户指令',
  usageContextCompactions: '上下文保护次数',
  usageInputSaved: '估算避免重放输入',
  usageLimitStops: '额度保护停止次数',
  usageMcpTokens: 'MCP 调用 Token',
  usageMcpExternalCalls: 'MCP 外部调用',
  usageMcpSchemaInput: 'MCP Schema 输入估算',
  usageMcpResultInput: 'MCP 结果输入估算',
  usageMcpContextCompactions: 'MCP 上下文压缩',
  usageMcpLimitStops: 'MCP 预算停止',
  usageMcpSubsetHint: 'MCP Schema 与结果输入是 Provider input usage 的组成部分，用于解释成本来源，不会再次加到“精确额外 Token”或“MCP 调用 Token”中。',
  usageVisualTurns: '视觉轮次',
  usageLookCalls: '原图按需读取',
  usageCacheHits: '视觉缓存命中',
  usageFinalExcluded: '普通图文轮次唯一一次最终回答仍单独展示；Browser/Desktop Computer Use 引发的每次 DeepSeek 调用均计入插件额外消耗。',
  usageUpdatedAt: '更新时间：',
  usageRefresh: '刷新统计',
  usageReset: '清零统计',
  usageResetConfirm: '确认清零 DeepSeekEyes 的累计 Token 统计？',
  maxClarifications: '最多追问轮数',
  baseMaxTokens: '首次读图 Token 上限',
  targetMaxTokens: '细节追问 Token 上限',
  historyImageLimit: '最近历史图片引用数',
  historySummaryChars: '每张历史图片摘要字符',
  browserHistoryLimit: '最近 Browser 状态摘要数',
  historyBudgetHint: '旧图片保留原附件和哈希，只向模型发送有限数量的短摘要；需要细节时由 deepseekeyes_look 按原图读取。0 表示不把旧项带入模型上下文。',
  tokenPreset: '建议档位',
  tokenCustom: '自定义数值',
  tokenEconomy: '经济 · 8,192',
  tokenRecommended: '推荐 · 16,384',
  tokenDeep: '深度 · 32,768',
  tokenLarge: '超长 · 65,536',
  tokenUltra: '超大 · 131,072',
  tokenUnlimited: '不限制 · 由 Provider 决定',
  tokenUnlimitedInput: '未发送 maxTokens',
  tokenHint: '可选择建议档位，也可直接输入任意安全整数；“不限制”表示插件不发送 maxTokens，模型或 Provider 自身上限仍然生效。',
  computerUse: 'Computer Use 0.5',
  automationSpendGuard: '自动化 Token 保护',
  automationContextMaxTokens: '每次自动化调用的上下文上限',
  automationContextHint: '仅限制 Browser/Desktop 工具轮次提交给 DeepSeek 的模型副本；完整 DSH 任务、截图与报告不会删除。推荐 32,768，0 表示完整重放。普通文字和普通图片不受影响。',
  automationMaxCallsPerTurn: '每个用户指令最多模型调用',
  automationMaxCallsHint: '推荐 32。达到上限后停止自动循环，发送新的用户指令即可继续；0 表示不限制。',
  automationContextEconomy: '经济 · 8,192',
  automationContextRecommended: '推荐 · 32,768',
  automationContextComplex: '复杂任务 · 65,536',
  automationContextUltra: '超长任务 · 131,072',
  automationContextUnlimited: '不限制 · 完整会话',
  automationContextUnlimitedInput: '完整重放会话',
  browserComputerUse: '启用浏览器 Computer Use',
  browserComputerUseHint: '在当前对话中注册 browser 工具，每一步返回最新 DOM、截图、状态 ID 和测试证据。',
  browserHeadless: '无界面运行浏览器',
  browserChannel: '浏览器通道',
  browserChannelAuto: '自动发现（Windows 优先 Edge）',
  browserChannelEdge: 'Microsoft Edge',
  browserChannelChrome: 'Google Chrome',
  browserExecutablePath: '自定义浏览器路径',
  browserExecutablePlaceholder: '留空则使用上方通道或自动发现',
  browserLocale: '浏览器语言',
  browserTimeoutMs: '动作超时（毫秒）',
  browserSettleMs: '操作后稳定等待（毫秒）',
  browserViewportWidth: '视口宽度',
  browserViewportHeight: '视口高度',
  browserMaxElements: '每步最多控件数',
  browserMaxTextChars: '每步最多页面字符',
  desktopComputerUse: '启用 Windows / macOS 桌面 Computer Use',
  desktopComputerUseHint: '在当前对话中注册 computer 工具；每步仍无损保存截图，但默认优先用语义控件和状态变化直达最终模型，只有确实需要像素时才调用视觉模型。',
  desktopVisualMode: '桌面截图交付策略',
  desktopVisualModeAuto: '自动 · 语义快路径（推荐）',
  desktopVisualModeAlways: '完整审计 · 每步读图',
  desktopVisualModeManual: '手动 · 仅显式读图',
  desktopVisualModeHint: '自动模式会为完整语义状态和成功动作跳过视觉调用；游戏、画布或显式 includeScreenshot 请求仍读取原始像素。三种模式都会保存完整无损截图。',
  desktopSemantic: '读取系统无障碍语义控件',
  desktopSemanticHint: '启用后可使用稳定的 elementRef 执行点击、赋值、调用和断言；关闭后保持纯截图坐标控制。',
  desktopPermissionHint: 'macOS 首次使用时，请在「系统设置 → 隐私与安全性」为运行 DSH 的终端授予“屏幕录制”和“辅助功能”；Windows 使用系统原生 user32 与桌面截图。',
  desktopTimeoutMs: '桌面动作超时（毫秒）',
  desktopSettleMs: '桌面操作后等待（毫秒）',
  desktopMaxWindows: '每步最多窗口数',
  desktopMaxElements: '每步最多语义控件数',
  desktopMacDisplay: 'macOS 显示器编号',
  desktopWindowsPowerShell: 'Windows PowerShell 路径',
  desktopWindowsPowerShellPlaceholder: '留空使用 powershell.exe',
  desktopArtifactsDir: '桌面测试证据目录',
  desktopArtifactsDirPlaceholder: '留空使用 DSH 默认证据目录',
  desktopHistoryLimit: '最近 Desktop 状态摘要数',
  mcpTitle: 'MCP 应用与工具',
  mcpVersion: 'MCP 控制中心',
  mcpEnabled: '启用 MCP 应用执行层',
  mcpEnabledHint: '让 DeepSeek 通过结构化工具调用其他应用；没有 MCP 的界面仍由 Browser / Desktop Computer Use 处理。',
  mcpTokenCost: 'Token 提示：每个暴露工具的 Schema 都会占用模型上下文。新 Server 默认不暴露任何工具，请只勾选当前任务真正需要的工具。',
  mcpAddServer: '添加 Server',
  mcpNoServers: '尚未配置 MCP Server。添加后先保存，再测试连接并选择要暴露的工具。',
  mcpServer: 'MCP Server',
  mcpRemoveServer: '删除 Server',
  mcpServerEnabled: '启用此 Server',
  mcpServerId: 'Server ID',
  mcpServerName: '显示名称',
  mcpTransport: '传输方式',
  mcpTransportStdio: 'stdio（本机进程）',
  mcpTransportHttp: 'Streamable HTTP',
  mcpCommand: '启动命令',
  mcpCommandPlaceholder: '例如 npx 或 node',
  mcpArgs: '参数（每行一个）',
  mcpArgsPlaceholder: '-y\n@modelcontextprotocol/server-example',
  mcpCwd: '工作目录',
  mcpCwdPlaceholder: '留空使用 DSH 工作目录',
  mcpUrl: 'Server URL',
  mcpUrlPlaceholder: 'https://mcp.example.com/mcp',
  mcpServerTimeoutMs: '连接超时（毫秒）',
  mcpServerTimeoutPlaceholder: '留空继承全局超时',
  mcpEnvRefs: '环境变量引用',
  mcpHeaderRefs: '请求头引用',
  mcpReferenceKey: '注入名称',
  mcpReferenceEnv: '读取的环境变量名',
  mcpAddEnvRef: '添加环境变量引用',
  mcpAddHeaderRef: '添加请求头引用',
  mcpRemoveReference: '删除引用',
  mcpCredentialHint: '这里只保存环境变量名，不保存 Token、Header 值或其他明文凭据。',
  mcpAllowedTools: '允许工具（每行一个）',
  mcpAllowedToolsPlaceholder: '默认留空，即不暴露任何工具',
  mcpDenyTools: '拒绝工具（每行一个）',
  mcpDenyToolsPlaceholder: '即使已允许也始终拒绝',
  mcpToolsHint: '允许列表默认为空；连接后可在下方工具清单中精确选择。',
  mcpHealth: '运行状态',
  mcpStatusDisabled: '已禁用',
  mcpStatusIdle: '待连接',
  mcpStatusConnecting: '连接中',
  mcpStatusConnected: '已连接',
  mcpStatusDegraded: '已降级',
  mcpStatusError: '错误',
  mcpStatusUnknown: '尚未检测',
  mcpLatency: '延迟',
  mcpToolCount: '工具总数',
  mcpSelectedCount: '已选工具',
  mcpSchemaTokens: 'Schema Token 估算',
  mcpToolExposed: '已暴露',
  mcpToolAllowedNotExposed: '已允许 / 未暴露',
  mcpToolNotAllowed: '未允许',
  mcpLastError: '最近错误',
  mcpTestConnection: '测试连接',
  mcpRefreshTools: '刷新工具',
  mcpReconnect: '重新连接',
  mcpRuntimeUnavailable: 'MCP 状态 RPC 尚未就绪；配置仍可保存，运行时升级后会自动显示状态。',
  mcpRuntimeLoading: '正在读取 MCP 运行状态…',
  mcpRuntimeUpdatedAt: '状态更新时间：',
  mcpBudgets: 'MCP Token 与调用预算',
  mcpMaxTools: '最多暴露工具数',
  mcpMaxToolsHint: '跨所有 Server 的硬上限；0 表示不限制。是否暴露仍由每个 Server 的允许列表决定。',
  mcpMaxSchemaTokens: 'Schema Token 总预算',
  mcpMaxSchemaTokensHint: '超出预算的工具不会进入模型上下文；0 表示不限制。',
  mcpMaxResultChars: '单次结果字符上限',
  mcpMaxResultCharsHint: '超长结果只传预览、哈希和本地引用，避免上下文膨胀。',
  mcpToolCallTimeoutMs: '工具调用全局超时（毫秒）',
  mcpAudit: '记录 MCP 审计摘要',
  mcpAuditHint: '只记录 Server、工具、状态、耗时、错误码及哈希，不保存密钥或完整参数/结果。',
  mcpPersistArtifacts: '将超长 MCP 结果落盘',
  mcpArtifactDir: 'MCP 结果目录',
  mcpArtifactDirPlaceholder: '留空使用 DSH 默认 MCP 证据目录',
  advanced: '高级设置',
  statusReady: '视觉路由元数据检测已通过',
  statusReadyProbe: '；发送首张图片时还会执行随机像素探针。',
  statusReadyMetadata: '；像素探针当前已关闭。',
  statusPending: '视觉路由尚未就绪：检查所选模型的图片声明，或为自定义网关打开上方开关。',
  statusChecking: '正在检测视觉路由…',
  refresh: '重新检测',
  save: '保存并立即应用',
  saving: '正在保存…',
  saved: '设置已保存并实时生效。',
  discard: '放弃更改',
  saveFailed: '保存失败：',
  upstreamRequired: '请选择最终回答 Provider。',
  recursiveUpstream: 'DeepSeekEyes 不能把自己设为最终回答 Provider。',
  visionProviderRequired: '填写视觉模型时必须同时选择视觉 Provider。',
  visionRouteRequired: '关闭自动检测时必须选择视觉 Provider。',
  visionRoutePriorityFormat: '后备视觉路由必须每行使用 provider/model。',
  visionFailoverAttemptsRange: '后备尝试次数必须是 0–8 的整数。',
  visionHealthTtlMsRange: '健康检查缓存必须是 1000–3600000 的整数。',
  visionFailureCooldownMsRange: '失败冷却必须是 0–3600000 的整数。',
  visionAttemptLimitRange: 'attempts 保留数必须是 10–10000 的整数。',
  browserLocaleRequired: '浏览器语言不能为空。',
  maxClarificationsRange: '追问轮数必须是 0–8 的整数。',
  baseMaxTokensRange: '首次读图 Token 必须为 0（不限制）或至少 512 的安全整数。',
  targetMaxTokensRange: '细节追问 Token 必须为 0（不限制）或至少 256 的安全整数。',
  automationContextMaxTokensRange: '自动化上下文必须为 0（不限制）或至少 4096 的安全整数。',
  automationMaxCallsPerTurnRange: '每个用户指令的模型调用数必须是 0–10000 的整数。',
  historyImageLimitRange: '历史图片引用数必须是 0–32 的整数。',
  historySummaryCharsRange: '历史图片摘要字符必须是 64–2000 的整数。',
  browserHistoryLimitRange: 'Browser 状态摘要数必须是 0–32 的整数。',
  browserTimeoutMsRange: '动作超时必须是 1000–120000 的整数。',
  browserSettleMsRange: '稳定等待必须是 0–10000 的整数。',
  browserViewportWidthRange: '视口宽度必须是 320–3840 的整数。',
  browserViewportHeightRange: '视口高度必须是 240–2160 的整数。',
  browserMaxElementsRange: '控件数量必须是 20–500 的整数。',
  browserMaxTextCharsRange: '页面字符数必须是 1000–100000 的整数。',
  desktopHistoryLimitRange: 'Desktop 状态摘要数必须是 0–32 的整数。',
  desktopTimeoutMsRange: '桌面动作超时必须是 1000–120000 的整数。',
  desktopSettleMsRange: '桌面稳定等待必须是 0–10000 的整数。',
  desktopMaxWindowsRange: '窗口数量必须是 1–200 的整数。',
  desktopMaxElementsRange: '语义控件数量必须是 20–500 的整数。',
  desktopMacDisplayRange: 'macOS 显示器编号必须是 1–32 的整数。',
  desktopVisualModeInvalid: '桌面截图交付策略无效。',
  mcpServersInvalid: 'MCP Server 配置必须是列表。',
  mcpServerIdInvalid: 'Server ID 必须为 1–32 位字母、数字、下划线或连字符。',
  mcpServerIdDuplicate: 'Server ID 不能重复。',
  mcpServerNameRequired: '每个 MCP Server 都必须填写显示名称。',
  mcpServerNameDuplicate: 'MCP Server 显示名称不能重复。',
  mcpServerTransportInvalid: 'MCP Server 传输方式无效。',
  mcpServerCommandRequired: 'stdio Server 必须填写启动命令。',
  mcpServerArgsInvalid: 'stdio 参数必须是字符串列表。',
  mcpServerArgsCredential: '启动参数疑似包含凭据，请改用环境变量引用。',
  mcpServerUrlInvalid: 'Streamable HTTP Server 必须填写有效的 http/https URL。',
  mcpServerUrlHttpsRequired: '远程 Streamable HTTP Server 必须使用 HTTPS；HTTP 仅可连接 localhost、127.0.0.0/8 或 ::1 等明确本机地址。',
  mcpServerUrlCredential: 'Server URL 不能包含用户名、密码或疑似凭据查询参数，请改用请求头环境变量引用。',
  mcpServerTransportFields: '当前传输方式包含另一种传输方式专用的配置字段。',
  mcpServerTimeoutMsRange: 'Server 连接超时必须留空或为 100–3600000 的整数。',
  mcpServerEnvInvalid: '环境变量引用必须使用有效变量名，且只能指向另一个环境变量名。',
  mcpServerHeadersInvalid: '请求头名称无效，或其值不是环境变量引用。',
  mcpServerToolsInvalid: '工具允许/拒绝列表无效。',
  mcpServerToolsConflict: '同一个工具不能同时出现在允许与拒绝列表。',
  mcpMaxToolsRange: '最多暴露工具数必须是 0（不限制）或 1–1000 的整数。',
  mcpMaxSchemaTokensRange: 'Schema Token 预算必须是 0（不限制）或 256–10000000 的整数。',
  mcpMaxResultCharsRange: '结果字符上限必须是 256–10000000 的整数。',
  mcpToolCallTimeoutMsRange: 'MCP 工具调用超时必须是 100–3600000 的整数。',
  noProviders: 'Harness 中还没有可用 Provider，请先在「设置 → 模型」添加。',
  inactive: '（未激活）',
}

const en = {
  title: 'DeepSeekEyes',
  version: 'Version',
  description: 'Give DeepSeek a visual model in the same conversation, with follow-up access to the original image.',
  expand: 'Expand',
  collapse: 'Collapse',
  unsaved: 'Unsaved',
  loading: 'Loading Harness model settings…',
  unavailable: 'The Host has not exposed the DeepSeekEyes settings namespace.',
  readOnly: 'The settings document is read-only.',
  upstreamProvider: 'Final answer provider',
  upstreamModel: 'Final answer model',
  upstreamModelPlaceholder: 'Choose or type a model ID; blank keeps all text models for compatibility',
  upstreamHint: 'Reads visual evidence, reasons, and sends the final reply to the user.',
  visionProvider: 'Background vision provider',
  visionProviderAuto: 'Automatically scan vision models',
  visionHint: 'Only reads original images and answers detail requests from the final model.',
  visionModel: 'Background vision model',
  visionModelPlaceholder: 'Choose or type a model ID; blank selects the first visual model',
  routeSummary: 'Current route: image → {vision} reads it → {final} gives the final answer',
  automaticVision: 'auto-detected vision model',
  allTextModels: 'conversation-selected model from this provider',
  declareVision: 'Declare image input for this custom gateway',
  declareVisionHint: 'Writes llm-pi-ai defaultInput: [text, image] on save; no manual settings.yaml edit.',
  catalogManaged: 'Image capability is managed by this provider’s built-in catalog and rechecked by the Host.',
  autoDetect: 'Auto-detect when no vision provider is selected',
  activeProbe: 'Run a randomized pixel probe on first use',
  activeProbeHint: 'Sends a randomized 3×3 grid to prove the model actually reads pixels.',
  visionReliability: 'Vision route reliability',
  visionRoutePriority: 'Fallback vision route priority',
  visionRoutePriorityPlaceholder: 'One provider/model per line; model IDs may contain additional / characters',
  visionRoutePriorityHint: 'Tried in order after the primary route; auto-detection may append other visual models.',
  visionHealthCheck: 'Enable route health checks and circuit breaking',
  visionHealthCheckHint: 'Caches capability checks, cools down failed routes, and records every selection and failover.',
  visionFailoverAttempts: 'Maximum fallback attempts',
  visionHealthTtlMs: 'Health-check cache (ms)',
  visionFailureCooldownMs: 'Failed-route cooldown (ms)',
  visionAttemptLog: 'Record vision route attempts',
  visionAttemptLogHint: 'Stores provider, model, status, duration, error code, and a hashed session ID—never prompts or image bytes.',
  visionAttemptLimit: 'Maximum retained attempts',
  persistentEvidence: 'Persist visual evidence cache',
  usageStats: 'Record DeepSeekEyes token usage',
  usageStatsTitle: 'Token usage statistics',
  usageStatsHint: 'Exact values come from provider usage, including every DeepSeek call caused by Computer Use. Bridge input and avoided replay are estimated with the Harness fixed-density rule. Reading statistics uses local RPC and makes no model call.',
  usageStatsDisabled: 'Statistics are disabled; no new usage is recorded while disabled.',
  usageStatsLoading: 'Loading token statistics…',
  usageStatsUnavailable: 'Token statistics failed: ',
  usagePersistenceError: 'The statistics file is temporarily unavailable; this process is still counting in memory: ',
  usageExactAdditional: 'Exact additional tokens',
  usageEstimatedBridge: 'Estimated bridge input',
  usageEstimatedTotal: 'Estimated plugin total',
  usageVision: 'Vision model tokens',
  usageClarification: 'DeepSeek clarification tokens',
  usageAutomation: 'Computer Use DeepSeek tokens',
  usageAutomationTurns: 'Automation user instructions',
  usageContextCompactions: 'Context guard activations',
  usageInputSaved: 'Estimated replay input avoided',
  usageLimitStops: 'Budget guard stops',
  usageMcpTokens: 'MCP call tokens',
  usageMcpExternalCalls: 'MCP external calls',
  usageMcpSchemaInput: 'Estimated MCP schema input',
  usageMcpResultInput: 'Estimated MCP result input',
  usageMcpContextCompactions: 'MCP context compactions',
  usageMcpLimitStops: 'MCP budget stops',
  usageMcpSubsetHint: 'MCP schema and result input are subsets of provider input usage. They explain cost sources and are not added again to Exact additional tokens or MCP call tokens.',
  usageVisualTurns: 'Visual turns',
  usageLookCalls: 'On-demand original reads',
  usageCacheHits: 'Visual cache hits',
  usageFinalExcluded: 'The single final answer for an ordinary visual turn remains separate. Every DeepSeek call caused by Browser/Desktop Computer Use is included in plugin overhead.',
  usageUpdatedAt: 'Updated: ',
  usageRefresh: 'Refresh statistics',
  usageReset: 'Reset statistics',
  usageResetConfirm: 'Reset all accumulated DeepSeekEyes token statistics?',
  maxClarifications: 'Maximum clarification rounds',
  baseMaxTokens: 'Initial vision token limit',
  targetMaxTokens: 'Clarification token limit',
  historyImageLimit: 'Recent image references',
  historySummaryChars: 'History summary characters',
  browserHistoryLimit: 'Recent browser state summaries',
  historyBudgetHint: 'Old images retain their original attachment and hash while only a bounded short summary reaches the model. deepseekeyes_look rereads original pixels on demand. Zero excludes old entries from model context.',
  tokenPreset: 'Suggested tier',
  tokenCustom: 'Custom value',
  tokenEconomy: 'Economy · 8,192',
  tokenRecommended: 'Recommended · 16,384',
  tokenDeep: 'Deep · 32,768',
  tokenLarge: 'Long · 65,536',
  tokenUltra: 'Ultra · 131,072',
  tokenUnlimited: 'Unlimited · provider managed',
  tokenUnlimitedInput: 'maxTokens omitted',
  tokenHint: 'Choose a suggested tier or enter any safe integer. Unlimited omits maxTokens; the model or provider may still impose its own limit.',
  computerUse: 'Computer Use 0.5',
  automationSpendGuard: 'Automation token guard',
  automationContextMaxTokens: 'Context limit per automation call',
  automationContextHint: 'Applies only to the model-facing copy of Browser/Desktop tool turns. The full DSH task, screenshots and reports remain preserved. Recommended: 32,768. Zero replays the full context. Ordinary text and image turns are unchanged.',
  automationMaxCallsPerTurn: 'Maximum model calls per user instruction',
  automationMaxCallsHint: 'Recommended: 32. The loop stops at the limit and a new user instruction can continue. Zero is unlimited.',
  automationContextEconomy: 'Economy · 8,192',
  automationContextRecommended: 'Recommended · 32,768',
  automationContextComplex: 'Complex · 65,536',
  automationContextUltra: 'Ultra · 131,072',
  automationContextUnlimited: 'Unlimited · full context',
  automationContextUnlimitedInput: 'Full context replay',
  browserComputerUse: 'Enable browser computer use',
  browserComputerUseHint: 'Registers the browser tool in this conversation and returns fresh DOM, screenshot, state ID, and test evidence after every step.',
  browserHeadless: 'Run browser headless',
  browserChannel: 'Browser channel',
  browserChannelAuto: 'Auto-detect (Edge first on Windows)',
  browserChannelEdge: 'Microsoft Edge',
  browserChannelChrome: 'Google Chrome',
  browserExecutablePath: 'Custom browser path',
  browserExecutablePlaceholder: 'Blank uses the selected channel or auto-detection',
  browserLocale: 'Browser locale',
  browserTimeoutMs: 'Action timeout (ms)',
  browserSettleMs: 'Post-action settle (ms)',
  browserViewportWidth: 'Viewport width',
  browserViewportHeight: 'Viewport height',
  browserMaxElements: 'Maximum controls per step',
  browserMaxTextChars: 'Maximum page characters per step',
  desktopComputerUse: 'Enable Windows / macOS desktop computer use',
  desktopComputerUseHint: 'Registers the computer tool in this conversation. Every step still preserves a lossless screenshot, while the default fast path sends semantic controls and state changes directly to the final model and invokes vision only when pixels are needed.',
  desktopVisualMode: 'Desktop screenshot delivery',
  desktopVisualModeAuto: 'Auto · semantic fast path (recommended)',
  desktopVisualModeAlways: 'Full audit · read every step',
  desktopVisualModeManual: 'Manual · explicit reads only',
  desktopVisualModeHint: 'Auto skips visual calls for complete semantic states and successful actions. Games, canvases, and explicit includeScreenshot requests still read original pixels. Every mode preserves the full lossless screenshot.',
  desktopSemantic: 'Read accessibility controls',
  desktopSemanticHint: 'Enables stable elementRef click, value, invoke, action, and assertion operations. Disable it for screenshot-only coordinate control.',
  desktopPermissionHint: 'On first use, grant Screen Recording and Accessibility to the terminal running DSH under macOS System Settings → Privacy & Security. Windows uses native user32 input and desktop capture.',
  desktopTimeoutMs: 'Desktop action timeout (ms)',
  desktopSettleMs: 'Desktop post-action settle (ms)',
  desktopMaxWindows: 'Maximum windows per step',
  desktopMaxElements: 'Maximum semantic controls per step',
  desktopMacDisplay: 'macOS display number',
  desktopWindowsPowerShell: 'Windows PowerShell path',
  desktopWindowsPowerShellPlaceholder: 'Blank uses powershell.exe',
  desktopArtifactsDir: 'Desktop evidence directory',
  desktopArtifactsDirPlaceholder: 'Blank uses the DSH evidence default',
  desktopHistoryLimit: 'Recent desktop state summaries',
  mcpTitle: 'MCP apps and tools',
  mcpVersion: 'MCP control center',
  mcpEnabled: 'Enable the MCP application layer',
  mcpEnabledHint: 'Let DeepSeek call other apps through structured tools. Interfaces without MCP still use Browser / Desktop Computer Use.',
  mcpTokenCost: 'Token note: every exposed tool schema consumes model context. New servers expose no tools by default; select only the tools needed for the current task.',
  mcpAddServer: 'Add server',
  mcpNoServers: 'No MCP server is configured. Add one, save, test the connection, then select the tools to expose.',
  mcpServer: 'MCP server',
  mcpRemoveServer: 'Remove server',
  mcpServerEnabled: 'Enable this server',
  mcpServerId: 'Server ID',
  mcpServerName: 'Display name',
  mcpTransport: 'Transport',
  mcpTransportStdio: 'stdio (local process)',
  mcpTransportHttp: 'Streamable HTTP',
  mcpCommand: 'Launch command',
  mcpCommandPlaceholder: 'For example: npx or node',
  mcpArgs: 'Arguments (one per line)',
  mcpArgsPlaceholder: '-y\n@modelcontextprotocol/server-example',
  mcpCwd: 'Working directory',
  mcpCwdPlaceholder: 'Blank uses the DSH working directory',
  mcpUrl: 'Server URL',
  mcpUrlPlaceholder: 'https://mcp.example.com/mcp',
  mcpServerTimeoutMs: 'Connection timeout (ms)',
  mcpServerTimeoutPlaceholder: 'Blank inherits the global timeout',
  mcpEnvRefs: 'Environment references',
  mcpHeaderRefs: 'Request-header references',
  mcpReferenceKey: 'Injected name',
  mcpReferenceEnv: 'Source environment variable',
  mcpAddEnvRef: 'Add environment reference',
  mcpAddHeaderRef: 'Add header reference',
  mcpRemoveReference: 'Remove reference',
  mcpCredentialHint: 'Only environment-variable names are stored here—never tokens, header values, or other plaintext credentials.',
  mcpAllowedTools: 'Allowed tools (one per line)',
  mcpAllowedToolsPlaceholder: 'Blank by default, which exposes no tools',
  mcpDenyTools: 'Denied tools (one per line)',
  mcpDenyToolsPlaceholder: 'Always denied, even when also allowed',
  mcpToolsHint: 'The allowlist starts empty. After connecting, select exact tools from the list below.',
  mcpHealth: 'Runtime health',
  mcpStatusDisabled: 'Disabled',
  mcpStatusIdle: 'Idle',
  mcpStatusConnecting: 'Connecting',
  mcpStatusConnected: 'Connected',
  mcpStatusDegraded: 'Degraded',
  mcpStatusError: 'Error',
  mcpStatusUnknown: 'Not checked',
  mcpLatency: 'Latency',
  mcpToolCount: 'Total tools',
  mcpSelectedCount: 'Selected tools',
  mcpSchemaTokens: 'Estimated schema tokens',
  mcpToolExposed: 'Exposed',
  mcpToolAllowedNotExposed: 'Allowed / not exposed',
  mcpToolNotAllowed: 'Not allowed',
  mcpLastError: 'Latest error',
  mcpTestConnection: 'Test connection',
  mcpRefreshTools: 'Refresh tools',
  mcpReconnect: 'Reconnect',
  mcpRuntimeUnavailable: 'The MCP status RPC is not ready. Configuration can still be saved and status will appear after the runtime is upgraded.',
  mcpRuntimeLoading: 'Loading MCP runtime health…',
  mcpRuntimeUpdatedAt: 'Health updated: ',
  mcpBudgets: 'MCP token and call budgets',
  mcpMaxTools: 'Maximum exposed tools',
  mcpMaxToolsHint: 'Hard limit across all servers. Zero is unlimited; each server allowlist still decides which tools are exposed.',
  mcpMaxSchemaTokens: 'Total schema token budget',
  mcpMaxSchemaTokensHint: 'Tools beyond this budget never enter model context. Zero is unlimited.',
  mcpMaxResultChars: 'Result character limit',
  mcpMaxResultCharsHint: 'Long results provide only a preview, hash, and local reference to prevent context growth.',
  mcpToolCallTimeoutMs: 'Global tool-call timeout (ms)',
  mcpAudit: 'Record MCP audit summaries',
  mcpAuditHint: 'Stores server, tool, status, duration, error code and hashes—not secrets or full arguments/results.',
  mcpPersistArtifacts: 'Persist long MCP results',
  mcpArtifactDir: 'MCP result directory',
  mcpArtifactDirPlaceholder: 'Blank uses the default DSH MCP evidence directory',
  advanced: 'Advanced settings',
  statusReady: 'Vision route metadata check passed',
  statusReadyProbe: '; the first image will also run the randomized pixel probe.',
  statusReadyMetadata: '; the pixel probe is disabled.',
  statusPending: 'Vision route is not ready. Check image declarations or enable the custom-gateway switch above.',
  statusChecking: 'Checking the vision route…',
  refresh: 'Check again',
  save: 'Save and apply now',
  saving: 'Saving…',
  saved: 'Settings saved and applied live.',
  discard: 'Discard changes',
  saveFailed: 'Save failed: ',
  upstreamRequired: 'Choose a final answer provider.',
  recursiveUpstream: 'DeepSeekEyes cannot use itself as the final answer provider.',
  visionProviderRequired: 'A vision model requires a vision provider.',
  visionRouteRequired: 'Choose a vision provider when auto-detection is off.',
  visionRoutePriorityFormat: 'Each fallback route must use provider/model.',
  visionFailoverAttemptsRange: 'Fallback attempts must be an integer from 0 through 8.',
  visionHealthTtlMsRange: 'Health-check cache must be an integer from 1000 through 3600000.',
  visionFailureCooldownMsRange: 'Failure cooldown must be an integer from 0 through 3600000.',
  visionAttemptLimitRange: 'Retained attempts must be an integer from 10 through 10000.',
  browserLocaleRequired: 'Browser locale must be non-empty.',
  maxClarificationsRange: 'Clarification rounds must be an integer from 0 through 8.',
  baseMaxTokensRange: 'Initial vision tokens must be 0 (unlimited) or a safe integer of at least 512.',
  targetMaxTokensRange: 'Clarification tokens must be 0 (unlimited) or a safe integer of at least 256.',
  automationContextMaxTokensRange: 'Automation context must be 0 (unlimited) or a safe integer of at least 4096.',
  automationMaxCallsPerTurnRange: 'Model calls per user instruction must be an integer from 0 through 10000.',
  historyImageLimitRange: 'Historical image references must be an integer from 0 through 32.',
  historySummaryCharsRange: 'Historical image summary characters must be an integer from 64 through 2000.',
  browserHistoryLimitRange: 'Browser state summaries must be an integer from 0 through 32.',
  browserTimeoutMsRange: 'Action timeout must be an integer from 1000 through 120000.',
  browserSettleMsRange: 'Settle time must be an integer from 0 through 10000.',
  browserViewportWidthRange: 'Viewport width must be an integer from 320 through 3840.',
  browserViewportHeightRange: 'Viewport height must be an integer from 240 through 2160.',
  browserMaxElementsRange: 'Maximum controls must be an integer from 20 through 500.',
  browserMaxTextCharsRange: 'Maximum page characters must be an integer from 1000 through 100000.',
  desktopHistoryLimitRange: 'Desktop state summaries must be an integer from 0 through 32.',
  desktopTimeoutMsRange: 'Desktop action timeout must be an integer from 1000 through 120000.',
  desktopSettleMsRange: 'Desktop settle time must be an integer from 0 through 10000.',
  desktopMaxWindowsRange: 'Maximum windows must be an integer from 1 through 200.',
  desktopMaxElementsRange: 'Maximum semantic controls must be an integer from 20 through 500.',
  desktopMacDisplayRange: 'The macOS display number must be an integer from 1 through 32.',
  desktopVisualModeInvalid: 'The desktop screenshot delivery mode is invalid.',
  mcpServersInvalid: 'MCP servers must be an array.',
  mcpServerIdInvalid: 'Server IDs must contain 1–32 letters, digits, underscores, or hyphens.',
  mcpServerIdDuplicate: 'Server IDs must be unique.',
  mcpServerNameRequired: 'Every MCP server needs a display name.',
  mcpServerNameDuplicate: 'MCP server display names must be unique.',
  mcpServerTransportInvalid: 'The MCP server transport is invalid.',
  mcpServerCommandRequired: 'A stdio server requires a launch command.',
  mcpServerArgsInvalid: 'stdio arguments must be a list of strings.',
  mcpServerArgsCredential: 'A launch argument appears to contain a credential. Use an environment reference instead.',
  mcpServerUrlInvalid: 'A Streamable HTTP server requires a valid http/https URL.',
  mcpServerUrlHttpsRequired: 'Remote Streamable HTTP servers must use HTTPS. HTTP is limited to explicit loopback addresses such as localhost, 127.0.0.0/8, or ::1.',
  mcpServerUrlCredential: 'The server URL cannot contain a username, password, or credential-like query parameter. Use a header environment reference instead.',
  mcpServerTransportFields: 'The selected transport contains fields reserved for the other transport.',
  mcpServerTimeoutMsRange: 'Server connection timeout must be blank or an integer from 100 through 3600000.',
  mcpServerEnvInvalid: 'Environment references must use valid variable names and point only to another environment variable.',
  mcpServerHeadersInvalid: 'A request-header name is invalid or does not point to an environment variable.',
  mcpServerToolsInvalid: 'The tool allow/deny lists are invalid.',
  mcpServerToolsConflict: 'A tool cannot be both allowed and denied.',
  mcpMaxToolsRange: 'Maximum exposed tools must be zero (unlimited) or an integer from 1 through 1000.',
  mcpMaxSchemaTokensRange: 'Schema token budget must be zero (unlimited) or an integer from 256 through 10000000.',
  mcpMaxResultCharsRange: 'Result character limit must be an integer from 256 through 10000000.',
  mcpToolCallTimeoutMsRange: 'MCP tool-call timeout must be an integer from 100 through 3600000.',
  noProviders: 'No provider is available in Harness. Add one under Settings → Models first.',
  inactive: ' (inactive)',
}

const styles = {
  card: { listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2, var(--border-color, #d9dee8))', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-3, var(--card-bg, #fff))', color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))', overflow: 'hidden', transition: 'border-color .16s, background .16s' },
  cardOpen: { background: 'var(--dsw-alias-bg-layer-2, var(--card-bg, #fff))', borderColor: 'var(--dsw-alias-label-dimmed, var(--border-color, #ccd3df))' },
  summary: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 },
  header: { appearance: 'none', width: '100%', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', background: 'transparent', border: 0, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' },
  headText: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  titleRow: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))' },
  version: { flex: 'none', border: '1px solid var(--dsw-alias-border-l2, var(--border-color, #d9dee8))', borderRadius: 999, padding: '0 7px', fontSize: 11, fontWeight: 500, lineHeight: '18px', fontVariantNumeric: 'tabular-nums', background: 'var(--dsw-alias-bg-module-platform, rgba(127, 127, 127, .08))', color: 'var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))' },
  description: { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))' },
  chevron: { width: 14, height: 14, flex: 'none', color: 'var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))', transition: 'transform .16s' },
  chevronOpen: { transform: 'rotate(180deg)' },
  pending: { whiteSpace: 'nowrap', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 500, lineHeight: '17px', background: 'var(--dsw-alias-bg-module-platform, rgba(127, 127, 127, .10))', color: 'var(--dsw-alias-label-secondary, var(--text-primary, #172033))' },
  body: { borderTop: '1px solid var(--dsw-alias-border-l2, var(--border-color, #e4e7ec))', margin: '0 16px', padding: '12px 0 8px', display: 'grid', gap: 16 },
  field: { display: 'grid', gap: 7, alignContent: 'start', minWidth: 0 },
  label: { fontSize: 14, fontWeight: 400, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))' },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))' },
  input: { width: '100%', height: 36, minHeight: 36, boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, var(--border-color, #ccd3df))', borderRadius: 8, padding: '0 12px', fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))', background: 'var(--dsw-alias-bg-layer-3, var(--input-bg, #fff))', colorScheme: 'inherit' },
  checkboxRow: { display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))' },
  statusOk: { margin: 0, padding: '10px 12px', borderRadius: 8, background: 'rgba(34, 197, 94, .10)', color: 'var(--dsw-alias-state-success-primary, var(--success-color, #15803d))', fontSize: 12, lineHeight: 1.5 },
  statusWarn: { margin: 0, padding: '10px 12px', borderRadius: 8, background: 'rgba(245, 158, 11, .10)', color: 'var(--dsw-alias-state-warn-primary, var(--warning-color, #a16207))', fontSize: 12, lineHeight: 1.5 },
  statusError: { margin: 0, padding: '10px 12px', borderRadius: 8, background: 'rgba(242, 90, 90, .10)', color: 'var(--dsw-alias-state-error-primary, var(--danger-color, #b91c1c))', fontSize: 12, lineHeight: 1.5 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap' },
  button: { minHeight: 32, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, var(--border-color, #ccd3df))', padding: '5px 14px', background: 'transparent', color: 'var(--dsw-alias-label-secondary, var(--text-primary, #172033))', cursor: 'pointer' },
  primary: { minHeight: 32, borderRadius: 8, border: 0, padding: '5px 14px', background: 'var(--dsw-alias-button-primary-fill, var(--accent-color, #4f46e5))', color: 'var(--dsw-alias-label-primary-foreground, #fff)', cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', alignItems: 'start', gap: 14 },
  tokenGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'start', gap: 10 },
  details: { borderTop: '1px solid var(--dsw-alias-border-l2, var(--border-color, #e4e7ec))', paddingTop: 12 },
  detailsSummary: { cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))' },
  divider: { height: 1, margin: '18px 0', background: 'var(--dsw-alias-border-l2, var(--border-color, #e4e7ec))' },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10 },
  metric: { minWidth: 0, padding: '11px 12px', border: '1px solid var(--dsw-alias-border-l2, var(--border-color, #e4e7ec))', borderRadius: 9, background: 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, .04))' },
  metricValue: { display: 'block', fontSize: 18, fontWeight: 650, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))' },
  metricLabel: { display: 'block', marginTop: 4, fontSize: 11, lineHeight: 1.4, color: 'var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))' },
  sectionTitle: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  serverList: { display: 'grid', gap: 12, marginTop: 14 },
  serverCard: { display: 'grid', gap: 14, padding: 14, border: '1px solid var(--dsw-alias-border-l2, var(--border-color, #e4e7ec))', borderRadius: 10, background: 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, .035))' },
  serverHeader: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' },
  serverHeading: { minWidth: 0, margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))' },
  textArea: { width: '100%', minHeight: 76, boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, var(--border-color, #ccd3df))', borderRadius: 8, padding: '8px 12px', resize: 'vertical', fontSize: 13, lineHeight: 1.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))', background: 'var(--dsw-alias-bg-layer-3, var(--input-bg, #fff))', colorScheme: 'inherit' },
  referenceList: { display: 'grid', gap: 8 },
  referenceRow: { display: 'grid', gridTemplateColumns: 'minmax(120px, .8fr) minmax(160px, 1fr) auto', gap: 8, alignItems: 'center' },
  iconButton: { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, var(--border-color, #ccd3df))', background: 'transparent', color: 'var(--dsw-alias-label-secondary, var(--text-primary, #172033))', cursor: 'pointer', fontSize: 18, lineHeight: 1 },
  statusBadge: { display: 'inline-flex', alignItems: 'center', minHeight: 20, borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 600, background: 'var(--dsw-alias-bg-module-platform, rgba(127, 127, 127, .10))', color: 'var(--dsw-alias-label-secondary, var(--text-primary, #172033))' },
  statusBadgeOk: { background: 'rgba(34, 197, 94, .10)', color: 'var(--dsw-alias-state-success-primary, var(--success-color, #15803d))' },
  statusBadgeWarn: { background: 'rgba(245, 158, 11, .10)', color: 'var(--dsw-alias-state-warn-primary, var(--warning-color, #a16207))' },
  statusBadgeError: { background: 'rgba(242, 90, 90, .10)', color: 'var(--dsw-alias-state-error-primary, var(--danger-color, #b91c1c))' },
  toolList: { display: 'grid', gap: 7, maxHeight: 260, overflow: 'auto', padding: '2px 2px 2px 0' },
  toolRow: { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 8, alignItems: 'start', padding: '7px 8px', borderRadius: 7, background: 'var(--dsw-alias-bg-layer-3, rgba(127, 127, 127, .035))' },
  toolName: { display: 'block', overflowWrap: 'anywhere', fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))' },
  toolDescription: { display: 'block', marginTop: 2, fontSize: 11, lineHeight: 1.4, color: 'var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))' },
  toolMeta: { display: 'grid', gap: 4, justifyItems: 'end' },
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function numberFrom(event) {
  const value = Number(event.target.value)
  return Number.isFinite(value) ? value : event.target.value
}

const TOKEN_PRESETS = Object.freeze([
  { value: 8_192, label: 'tokenEconomy' },
  { value: 16_384, label: 'tokenRecommended' },
  { value: 32_768, label: 'tokenDeep' },
  { value: 65_536, label: 'tokenLarge' },
  { value: 131_072, label: 'tokenUltra' },
  { value: 0, label: 'tokenUnlimited' },
])

const AUTOMATION_CONTEXT_PRESETS = Object.freeze([
  { value: 8_192, label: 'automationContextEconomy' },
  { value: 32_768, label: 'automationContextRecommended' },
  { value: 65_536, label: 'automationContextComplex' },
  { value: 131_072, label: 'automationContextUltra' },
  { value: 0, label: 'automationContextUnlimited' },
])

function TokenBudgetField({
  id,
  label,
  minimum,
  value,
  disabled,
  onChange,
  t,
  presets = TOKEN_PRESETS,
  hint = 'tokenHint',
  unlimitedInput = 'tokenUnlimitedInput',
}) {
  const preset = presets.find(item => item.value === value)
  return (
    <div style={styles.field}>
      <label style={styles.label} htmlFor={id}>{label}</label>
      <div style={styles.tokenGrid}>
        <select
          aria-label={t('tokenPreset')}
          style={styles.input}
          value={preset === undefined ? 'custom' : String(preset.value)}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value !== 'custom') onChange(Number(event.target.value))
          }}
        >
          <option value="custom" disabled={preset !== undefined}>{t('tokenCustom')}</option>
          {presets.map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
        </select>
        <input
          id={id}
          aria-label={t('tokenCustom')}
          style={styles.input}
          type="number"
          min={minimum}
          step="1"
          value={value === 0 ? '' : value}
          placeholder={value === 0 ? t(unlimitedInput) : undefined}
          disabled={disabled || value === 0}
          onChange={event => onChange(numberFrom(event))}
        />
      </div>
      <p style={styles.hint}>{t(hint)}</p>
    </div>
  )
}

function modelName(group, modelId, fallback) {
  if (modelId === '') return fallback
  return group?.models?.find(model => model.id === modelId)?.name ?? modelId
}

function routeSummary(template, vision, final) {
  return template.replace('{vision}', vision).replace('{final}', final)
}

function formatCount(value) {
  return new Intl.NumberFormat().format(Number.isFinite(value) ? value : 0)
}

function UsageMetric({ label, value }) {
  return (
    <div style={styles.metric}>
      <strong style={styles.metricValue}>{formatCount(value)}</strong>
      <span style={styles.metricLabel}>{label}</span>
    </div>
  )
}

function linesOf(value) {
  return Array.isArray(value) ? value.join('\n') : ''
}

function listFromText(value) {
  return [...new Set(value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean))]
}

function argsFromText(value) {
  return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
}

function mcpStatusLabel(status) {
  return {
    disabled: 'mcpStatusDisabled',
    idle: 'mcpStatusIdle',
    connecting: 'mcpStatusConnecting',
    connected: 'mcpStatusConnected',
    degraded: 'mcpStatusDegraded',
    error: 'mcpStatusError',
  }[status] ?? 'mcpStatusUnknown'
}

function mcpStatusStyle(status) {
  if (status === 'connected') return styles.statusBadgeOk
  if (status === 'degraded' || status === 'connecting') return styles.statusBadgeWarn
  if (status === 'error') return styles.statusBadgeError
  return undefined
}

function rpcEnvelope(response) {
  return response?.result ?? response
}

function rpcMethodUnavailable(error) {
  const code = String(error?.code ?? '').toLowerCase()
  const message = messageOf(error).toLowerCase()
  return ['not-found', 'not_found', 'method_not_found', 'unknown_method', 'unavailable'].includes(code)
    || /method.*(not found|unknown)|rpc.*(not found|unavailable)/.test(message)
}

async function callMcpRpc(rpc, method, payload) {
  if (typeof rpc?.call !== 'function') throw new Error('MCP RPC unavailable')
  const endpoint = method === 'snapshot' ? 'mcp.status' : `mcp.${method}`
  const routes = [
    ['/deepseekeyes', endpoint],
    ['/deepseekeyes/mcp', method],
    ['deepseekeyes/mcp', method],
  ]
  let lastError
  for (const [namespace, routedMethod] of routes) {
    try {
      const result = rpcEnvelope(await rpc.call(namespace, routedMethod, payload))
      if (result?.ok === false) {
        const error = Object.assign(new Error(result.error?.message ?? 'MCP RPC failed'), result.error)
        throw error
      }
      return result?.ok === true ? result.value : result
    } catch (error) {
      lastError = error
      if (!rpcMethodUnavailable(error)) break
    }
  }
  throw lastError ?? new Error('MCP RPC unavailable')
}

function McpMetric({ label, value }) {
  return (
    <div style={styles.metric}>
      <strong style={styles.metricValue}>{value ?? '—'}</strong>
      <span style={styles.metricLabel}>{label}</span>
    </div>
  )
}

function McpReferenceEditor({ id, title, addLabel, value, disabled, header, onChange, t }) {
  const entries = Object.entries(value ?? {})
  const replaceAt = (index, key, env) => {
    const next = entries.map(([currentKey, reference], currentIndex) => (
      currentIndex === index ? [key, { env }] : [currentKey, reference]
    ))
    onChange(Object.fromEntries(next))
  }
  const add = () => {
    const { key, reference } = nextMcpReferenceEntry(value, { header })
    onChange({ ...(value ?? {}), [key]: reference })
  }
  return (
    <div style={styles.field}>
      <span style={styles.label}>{title}</span>
      <div style={styles.referenceList}>
        {entries.map(([key, reference], index) => (
          <div style={styles.referenceRow} key={index}>
            <input
              aria-label={`${title}: ${t('mcpReferenceKey')} ${index + 1}`}
              style={styles.input}
              type="text"
              value={key}
              disabled={disabled}
              onChange={event => replaceAt(index, event.target.value, reference.env)}
            />
            <input
              aria-label={`${title}: ${t('mcpReferenceEnv')} ${index + 1}`}
              style={styles.input}
              type="text"
              value={reference.env}
              disabled={disabled}
              onChange={event => replaceAt(index, key, event.target.value)}
            />
            <button
              type="button"
              style={styles.iconButton}
              aria-label={`${t('mcpRemoveReference')}: ${key}`}
              title={t('mcpRemoveReference')}
              disabled={disabled}
              onClick={() => onChange(Object.fromEntries(entries.filter((_, current) => current !== index)))}
            >×</button>
          </div>
        ))}
      </div>
      <div>
        <button id={id} type="button" style={styles.button} disabled={disabled} onClick={add}>{addLabel}</button>
      </div>
    </div>
  )
}

function McpServerEditor({ server, index, runtimeServer, disabled, busy, onChange, onRemove, onAction, t }) {
  const serverDisabled = disabled || !server.enabled
  const tools = Array.isArray(runtimeServer?.tools) ? runtimeServer.tools : []
  const status = runtimeServer?.status
  const setAllowed = (tool, allowed) => {
    onChange(updateMcpToolSelection(server, tool, allowed))
  }
  return (
    <section style={styles.serverCard} aria-label={`${t('mcpServer')}: ${server.name || server.id}`}>
      <div style={styles.serverHeader}>
        <div style={styles.sectionTitle}>
          <h4 style={styles.serverHeading}>{server.name || `${t('mcpServer')} ${index + 1}`}</h4>
          <span style={{ ...styles.statusBadge, ...mcpStatusStyle(status) }}>{t(mcpStatusLabel(status))}</span>
        </div>
        <button type="button" style={styles.button} disabled={disabled} onClick={onRemove}>{t('mcpRemoveServer')}</button>
      </div>

      <label style={styles.checkboxRow}>
        <input type="checkbox" checked={server.enabled} disabled={disabled} onChange={event => onChange({ ...server, enabled: event.target.checked })} />
        <span>{t('mcpServerEnabled')}</span>
      </label>

      <div style={styles.grid}>
        <div style={styles.field}>
          <label style={styles.label} htmlFor={`deepseekeyes-mcp-id-${index}`}>{t('mcpServerId')}</label>
          <input id={`deepseekeyes-mcp-id-${index}`} style={styles.input} type="text" value={server.id} disabled={disabled} onChange={event => onChange({ ...server, id: event.target.value })} />
        </div>
        <div style={styles.field}>
          <label style={styles.label} htmlFor={`deepseekeyes-mcp-name-${index}`}>{t('mcpServerName')}</label>
          <input id={`deepseekeyes-mcp-name-${index}`} style={styles.input} type="text" value={server.name} disabled={disabled} onChange={event => onChange({ ...server, name: event.target.value })} />
        </div>
        <div style={styles.field}>
          <label style={styles.label} htmlFor={`deepseekeyes-mcp-transport-${index}`}>{t('mcpTransport')}</label>
          <select
            id={`deepseekeyes-mcp-transport-${index}`}
            style={styles.input}
            value={server.transport}
            disabled={disabled}
            onChange={(event) => {
              const transport = event.target.value
              onChange(transport === 'stdio'
                ? { ...server, transport, url: '', headers: {} }
                : { ...server, transport, command: '', args: [], cwd: '', env: {} })
            }}
          >
            <option value="stdio">{t('mcpTransportStdio')}</option>
            <option value="streamable-http">{t('mcpTransportHttp')}</option>
          </select>
        </div>
        <div style={styles.field}>
          <label style={styles.label} htmlFor={`deepseekeyes-mcp-timeout-${index}`}>{t('mcpServerTimeoutMs')}</label>
          <input
            id={`deepseekeyes-mcp-timeout-${index}`}
            style={styles.input}
            type="number"
            min="100"
            max="3600000"
            step="1"
            value={server.timeoutMs ?? ''}
            placeholder={t('mcpServerTimeoutPlaceholder')}
            disabled={serverDisabled}
            onChange={event => onChange({ ...server, timeoutMs: event.target.value === '' ? undefined : numberFrom(event) })}
          />
        </div>
      </div>

      {server.transport === 'stdio'
        ? (
          <div style={styles.grid}>
            <div style={styles.field}>
              <label style={styles.label} htmlFor={`deepseekeyes-mcp-command-${index}`}>{t('mcpCommand')}</label>
              <input id={`deepseekeyes-mcp-command-${index}`} style={styles.input} type="text" value={server.command} placeholder={t('mcpCommandPlaceholder')} disabled={serverDisabled} onChange={event => onChange({ ...server, command: event.target.value })} />
            </div>
            <div style={styles.field}>
              <label style={styles.label} htmlFor={`deepseekeyes-mcp-cwd-${index}`}>{t('mcpCwd')}</label>
              <input id={`deepseekeyes-mcp-cwd-${index}`} style={styles.input} type="text" value={server.cwd} placeholder={t('mcpCwdPlaceholder')} disabled={serverDisabled} onChange={event => onChange({ ...server, cwd: event.target.value })} />
            </div>
            <div style={styles.field}>
              <label style={styles.label} htmlFor={`deepseekeyes-mcp-args-${index}`}>{t('mcpArgs')}</label>
              <textarea id={`deepseekeyes-mcp-args-${index}`} style={styles.textArea} value={linesOf(server.args)} placeholder={t('mcpArgsPlaceholder')} disabled={serverDisabled} onChange={event => onChange({ ...server, args: argsFromText(event.target.value) })} />
            </div>
          </div>
        )
        : (
          <div style={styles.field}>
            <label style={styles.label} htmlFor={`deepseekeyes-mcp-url-${index}`}>{t('mcpUrl')}</label>
            <input id={`deepseekeyes-mcp-url-${index}`} style={styles.input} type="url" value={server.url} placeholder={t('mcpUrlPlaceholder')} disabled={serverDisabled} onChange={event => onChange({ ...server, url: event.target.value })} />
          </div>
        )}

      <div style={styles.grid}>
        {server.transport === 'stdio'
          ? <McpReferenceEditor id={`deepseekeyes-mcp-env-add-${index}`} title={t('mcpEnvRefs')} addLabel={t('mcpAddEnvRef')} value={server.env} disabled={serverDisabled} onChange={env => onChange({ ...server, env })} t={t} />
          : null}
        {server.transport === 'streamable-http'
          ? <McpReferenceEditor id={`deepseekeyes-mcp-header-add-${index}`} title={t('mcpHeaderRefs')} addLabel={t('mcpAddHeaderRef')} value={server.headers} disabled={serverDisabled} header onChange={headers => onChange({ ...server, headers })} t={t} />
          : null}
      </div>
      <p style={styles.hint}>{t('mcpCredentialHint')}</p>

      <div style={styles.grid}>
        <div style={styles.field}>
          <label style={styles.label} htmlFor={`deepseekeyes-mcp-allow-${index}`}>{t('mcpAllowedTools')}</label>
          <textarea id={`deepseekeyes-mcp-allow-${index}`} style={styles.textArea} value={linesOf(server.allowedTools)} placeholder={t('mcpAllowedToolsPlaceholder')} disabled={serverDisabled} onChange={event => onChange({ ...server, allowedTools: listFromText(event.target.value) })} />
        </div>
        <div style={styles.field}>
          <label style={styles.label} htmlFor={`deepseekeyes-mcp-deny-${index}`}>{t('mcpDenyTools')}</label>
          <textarea id={`deepseekeyes-mcp-deny-${index}`} style={styles.textArea} value={linesOf(server.denyTools)} placeholder={t('mcpDenyToolsPlaceholder')} disabled={serverDisabled} onChange={event => onChange({ ...server, denyTools: listFromText(event.target.value) })} />
        </div>
      </div>
      <p style={styles.hint}>{t('mcpToolsHint')}</p>

      <div style={styles.metricGrid}>
        <McpMetric label={t('mcpLatency')} value={Number.isFinite(runtimeServer?.latencyMs) ? `${formatCount(runtimeServer.latencyMs)} ms` : '—'} />
        <McpMetric label={t('mcpToolCount')} value={formatCount(runtimeServer?.toolCount)} />
        <McpMetric label={t('mcpSelectedCount')} value={formatCount(runtimeServer?.exposedToolCount ?? server.allowedTools.length)} />
        <McpMetric label={t('mcpSchemaTokens')} value={formatCount(runtimeServer?.schemaTokensEstimated)} />
      </div>
      {runtimeServer?.lastError?.message
        ? <p style={styles.statusError}>{t('mcpLastError')}: {runtimeServer.lastError.code ? `[${runtimeServer.lastError.code}] ` : ''}{runtimeServer.lastError.message}</p>
        : null}

      {tools.length > 0
        ? (
          <div style={styles.toolList}>
            {tools.map(tool => (
              <label key={tool.name} style={styles.toolRow}>
                <input type="checkbox" checked={mcpToolAllowedInDraft(server, tool)} disabled={serverDisabled} onChange={event => setAllowed(tool, event.target.checked)} />
                <span>
                  <span style={styles.toolName}>{tool.name}</span>
                  {tool.description ? <span style={styles.toolDescription}>{tool.description}</span> : null}
                </span>
                <span style={styles.toolMeta}>
                  <span style={styles.statusBadge}>{formatCount(tool.schemaTokensEstimated)}</span>
                  <span style={{ ...styles.statusBadge, ...(tool.exposed ? styles.statusBadgeOk : tool.allowed ? styles.statusBadgeWarn : undefined) }}>
                    {t(tool.exposed ? 'mcpToolExposed' : tool.allowed ? 'mcpToolAllowedNotExposed' : 'mcpToolNotAllowed')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )
        : null}

      <div style={styles.actions}>
        <button type="button" style={styles.button} disabled={busy || !server.enabled} onClick={() => onAction('test', server.id)}>{t('mcpTestConnection')}</button>
        <button type="button" style={styles.button} disabled={busy || !server.enabled} onClick={() => onAction('tools', server.id)}>{t('mcpRefreshTools')}</button>
        <button type="button" style={styles.button} disabled={busy || !server.enabled} onClick={() => onAction('reconnect', server.id)}>{t('mcpReconnect')}</button>
      </div>
    </section>
  )
}

function McpSettingsSection({ draft, disabled, rpc, refreshRevision, onUpdate, t }) {
  const [runtime, setRuntime] = useState({ loading: true, value: undefined, error: undefined, busy: undefined })
  const loadRuntime = useCallback(async () => {
    setRuntime(current => ({ ...current, loading: true, error: undefined }))
    try {
      const value = await callMcpRpc(rpc, 'snapshot', {})
      setRuntime({ loading: false, value, error: undefined, busy: undefined })
    } catch (error) {
      setRuntime({ loading: false, value: undefined, error: messageOf(error), busy: undefined })
    }
  }, [rpc])
  useEffect(() => { void loadRuntime() }, [loadRuntime, refreshRevision])

  const updateServer = (index, server) => {
    onUpdate('mcpServers', draft.mcpServers.map((current, currentIndex) => currentIndex === index ? server : current))
  }
  const addServer = () => {
    let index = draft.mcpServers.length + 1
    let server = createMcpServerDraft(index)
    const ids = new Set(draft.mcpServers.map(item => item.id))
    while (ids.has(server.id)) server = createMcpServerDraft(++index)
    onUpdate('mcpServers', [...draft.mcpServers, server])
  }
  const act = async (method, serverId) => {
    setRuntime(current => ({ ...current, busy: `${method}:${serverId}`, error: undefined }))
    try {
      const action = await callMcpRpc(rpc, method, method === 'tools' ? { serverId, refresh: true } : { serverId })
      const value = await callMcpRpc(rpc, 'snapshot', {})
      const actionError = action?.ok === false
        ? `${action.error?.code ? `[${action.error.code}] ` : ''}${action.error?.message ?? 'MCP connection test failed'}`
        : undefined
      setRuntime({ loading: false, value, error: actionError, busy: undefined })
    } catch (error) {
      setRuntime(current => ({ ...current, loading: false, error: messageOf(error), busy: undefined }))
    }
  }
  return (
    <details style={styles.details}>
      <summary style={{ ...styles.detailsSummary, marginBottom: 0 }}>
        <span style={styles.sectionTitle}>
          <span>{t('mcpTitle')}</span>
          <span style={styles.version} aria-label={`${t('mcpVersion')}: ${PLUGIN_VERSION}`}>v{PLUGIN_VERSION}</span>
        </span>
      </summary>
      <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
        <label style={styles.checkboxRow}>
          <input type="checkbox" checked={draft.mcpEnabled} disabled={disabled} onChange={event => onUpdate('mcpEnabled', event.target.checked)} />
          <span>{t('mcpEnabled')}<br /><small style={styles.hint}>{t('mcpEnabledHint')}</small></span>
        </label>
        <p style={styles.statusWarn}>{t('mcpTokenCost')}</p>

        <details style={{ ...styles.details, borderTop: 0, paddingTop: 0 }}>
          <summary style={{ ...styles.detailsSummary, marginBottom: 0 }}>{t('mcpBudgets')}</summary>
          <div style={{ ...styles.grid, marginTop: 14 }}>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="deepseekeyes-mcp-max-tools">{t('mcpMaxTools')}</label>
              <input id="deepseekeyes-mcp-max-tools" style={styles.input} type="number" min="0" max="1000" step="1" value={draft.mcpMaxTools} disabled={disabled} onChange={event => onUpdate('mcpMaxTools', numberFrom(event))} />
              <small style={styles.hint}>{t('mcpMaxToolsHint')}</small>
            </div>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="deepseekeyes-mcp-schema-budget">{t('mcpMaxSchemaTokens')}</label>
              <input id="deepseekeyes-mcp-schema-budget" style={styles.input} type="number" min="0" max="10000000" step="1" value={draft.mcpMaxSchemaTokens} disabled={disabled} onChange={event => onUpdate('mcpMaxSchemaTokens', numberFrom(event))} />
              <small style={styles.hint}>{t('mcpMaxSchemaTokensHint')}</small>
            </div>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="deepseekeyes-mcp-result-chars">{t('mcpMaxResultChars')}</label>
              <input id="deepseekeyes-mcp-result-chars" style={styles.input} type="number" min="256" max="10000000" step="1" value={draft.mcpMaxResultChars} disabled={disabled} onChange={event => onUpdate('mcpMaxResultChars', numberFrom(event))} />
              <small style={styles.hint}>{t('mcpMaxResultCharsHint')}</small>
            </div>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="deepseekeyes-mcp-call-timeout">{t('mcpToolCallTimeoutMs')}</label>
              <input id="deepseekeyes-mcp-call-timeout" style={styles.input} type="number" min="100" max="3600000" step="1" value={draft.mcpToolCallTimeoutMs} disabled={disabled} onChange={event => onUpdate('mcpToolCallTimeoutMs', numberFrom(event))} />
            </div>
          </div>
          <label style={{ ...styles.checkboxRow, marginTop: 14 }}>
            <input type="checkbox" checked={draft.mcpAudit} disabled={disabled} onChange={event => onUpdate('mcpAudit', event.target.checked)} />
            <span>{t('mcpAudit')}<br /><small style={styles.hint}>{t('mcpAuditHint')}</small></span>
          </label>
          <label style={{ ...styles.checkboxRow, marginTop: 12 }}>
            <input type="checkbox" checked={draft.mcpArtifactDir !== false} disabled={disabled} onChange={event => onUpdate('mcpArtifactDir', event.target.checked ? '' : false)} />
            <span>{t('mcpPersistArtifacts')}</span>
          </label>
          <div style={{ ...styles.field, marginTop: 12 }}>
            <label style={styles.label} htmlFor="deepseekeyes-mcp-artifact-dir">{t('mcpArtifactDir')}</label>
            <input id="deepseekeyes-mcp-artifact-dir" style={styles.input} type="text" value={typeof draft.mcpArtifactDir === 'string' ? draft.mcpArtifactDir : ''} placeholder={t('mcpArtifactDirPlaceholder')} disabled={disabled || draft.mcpArtifactDir === false} onChange={event => onUpdate('mcpArtifactDir', event.target.value)} />
          </div>
        </details>

        <div style={styles.serverHeader}>
          <strong style={styles.serverHeading}>{t('mcpServer')}</strong>
          <button type="button" style={styles.button} disabled={disabled} onClick={addServer}>{t('mcpAddServer')}</button>
        </div>
        {draft.mcpServers.length === 0 ? <p style={styles.hint}>{t('mcpNoServers')}</p> : null}
        <div style={styles.serverList}>
          {draft.mcpServers.map((server, index) => (
            <McpServerEditor
              key={index}
              server={server}
              index={index}
              runtimeServer={runtime.value?.servers?.find(item => item.id === server.id)}
              disabled={disabled}
              busy={runtime.busy !== undefined}
              onChange={value => updateServer(index, value)}
              onRemove={() => onUpdate('mcpServers', draft.mcpServers.filter((_, currentIndex) => currentIndex !== index))}
              onAction={(method, serverId) => { void act(method, serverId) }}
              t={t}
            />
          ))}
        </div>

        <div style={styles.divider} />
        <div style={styles.serverHeader}>
          <strong style={styles.serverHeading}>{t('mcpHealth')}</strong>
          <button type="button" style={styles.button} disabled={runtime.loading} onClick={() => { void loadRuntime() }}>{t('mcpRefreshTools')}</button>
        </div>
        {runtime.loading ? <p style={styles.statusWarn}>{t('mcpRuntimeLoading')}</p> : null}
        {runtime.error !== undefined
          ? <p style={styles.statusWarn}>{runtime.value === undefined ? <>{t('mcpRuntimeUnavailable')}<br /></> : null}{runtime.error}</p>
          : null}
        {!runtime.loading && runtime.value !== undefined
          ? (
            <>
              <div style={styles.metricGrid}>
                <McpMetric label={t('mcpServer')} value={`${formatCount(runtime.value.summary?.connectedServers)} / ${formatCount(runtime.value.summary?.enabledServers)}`} />
                <McpMetric label={t('mcpSelectedCount')} value={formatCount(runtime.value.summary?.exposedTools)} />
                <McpMetric label={t('mcpSchemaTokens')} value={formatCount(runtime.value.summary?.schemaTokensEstimated)} />
              </div>
              {runtime.value.updatedAt ? <p style={styles.hint}>{t('mcpRuntimeUpdatedAt')}{runtime.value.updatedAt}</p> : null}
            </>
          )
          : null}
      </div>
    </details>
  )
}

function DeepSeekEyesSettingsCard({ scope, api, usageRpc, t }) {
  const snapshot = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => normalizeSettingsDraft(snapshot.value))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(undefined)
  const [catalog, setCatalog] = useState({ loading: true, providers: [], groups: [], namespaces: [], failures: [], error: undefined })
  const [declareVision, setDeclareVision] = useState(false)
  const [declarationDirty, setDeclarationDirty] = useState(false)
  const [usage, setUsage] = useState({ loading: true, value: undefined, error: undefined })
  const [mcpRuntimeRefreshRevision, setMcpRuntimeRefreshRevision] = useState(0)

  useEffect(() => {
    if (snapshot.status === 'ready' && !dirty) setDraft(normalizeSettingsDraft(snapshot.value))
  }, [snapshot.status, snapshot.revision, snapshot.value, dirty])

  const loadCatalog = useCallback(async () => {
    setCatalog(current => ({ ...current, loading: true, error: undefined }))
    try {
      const [providersResponse, modelsResponse, settingsResponse] = await Promise.all([
        api.llm.providers({}),
        api.llm.models({}),
        api.settings.describe({}),
      ])
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
      if (!modelsResponse.result.ok) throw new Error(modelsResponse.result.error.message)
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message)
      setCatalog({
        loading: false,
        providers: providersResponse.result.value.providers,
        groups: modelsResponse.result.value.groups,
        failures: modelsResponse.result.value.failures,
        namespaces: settingsResponse.result.value.namespaces,
        error: undefined,
      })
    } catch (error) {
      setCatalog(current => ({ ...current, loading: false, error: messageOf(error) }))
    }
  }, [api])

  useEffect(() => { void loadCatalog() }, [loadCatalog, snapshot.revision])

  const loadUsage = useCallback(async () => {
    setUsage(current => ({ ...current, loading: true, error: undefined }))
    try {
      const response = await usageRpc.call('/deepseekeyes', 'usage.snapshot', {})
      if (!response.ok) throw new Error(response.error.message)
      setUsage({ loading: false, value: response.value, error: undefined })
    } catch (error) {
      setUsage({ loading: false, value: undefined, error: messageOf(error) })
    }
  }, [usageRpc])

  const resetUsage = useCallback(async () => {
    if (globalThis.confirm?.(t('usageResetConfirm')) === false) return
    setUsage(current => ({ ...current, loading: true, error: undefined }))
    try {
      const response = await usageRpc.call('/deepseekeyes', 'usage.reset', { confirm: true })
      if (!response.ok) throw new Error(response.error.message)
      setUsage({ loading: false, value: response.value, error: undefined })
    } catch (error) {
      setUsage({ loading: false, value: undefined, error: messageOf(error) })
    }
  }, [t, usageRpc])

  useEffect(() => { void loadUsage() }, [loadUsage])

  const providers = useMemo(() => {
    const selected = new Set([draft.upstreamProvider, draft.visionProvider])
    return catalog.providers.filter(entry => entry.provider !== PROVIDER_ID
      && (entry.active || selected.has(entry.provider)))
  }, [catalog.providers, draft.upstreamProvider, draft.visionProvider])
  const upstreamGroup = useMemo(
    () => catalog.groups.find(group => group.id === draft.upstreamProvider),
    [catalog.groups, draft.upstreamProvider],
  )
  const visionGroup = useMemo(
    () => catalog.groups.find(group => group.id === draft.visionProvider),
    [catalog.groups, draft.visionProvider],
  )
  const visionTarget = useMemo(
    () => providerSettingsTarget(catalog.providers, draft.visionProvider),
    [catalog.providers, draft.visionProvider],
  )
  const storedDeclaration = useMemo(
    () => providerDeclaresVision(catalog.namespaces, visionTarget),
    [catalog.namespaces, visionTarget],
  )

  useEffect(() => {
    if (!declarationDirty) setDeclareVision(storedDeclaration)
  }, [storedDeclaration, declarationDirty, draft.visionProvider])

  const update = (field, value) => {
    setDraft(current => ({ ...current, [field]: value }))
    setDirty(true)
    setNotice(undefined)
  }
  const updateProvider = (providerField, modelField, value) => {
    setDraft(current => ({ ...current, [providerField]: value, [modelField]: '' }))
    setDirty(true)
    setNotice(undefined)
  }
  const failureKey = settingsDraftFailure(draft, PROVIDER_ID)
  const readyGroup = catalog.groups.find(group => group.id === PROVIDER_ID && group.models.length > 0)
  const selectedFailure = catalog.failures.find(item => item.id === draft.visionProvider || item.id === draft.upstreamProvider)
  const saveBlocked = saving || snapshot.status !== 'ready' || !snapshot.writable || failureKey !== undefined
    || (!dirty && !declarationDirty)
  const finalRouteName = modelName(upstreamGroup, draft.upstreamModel, t('allTextModels'))
  const visionRouteName = modelName(visionGroup, draft.visionModel, t('automaticVision'))

  const discard = () => {
    setDraft(normalizeSettingsDraft(snapshot.value))
    setDeclareVision(storedDeclaration)
    setDirty(false)
    setDeclarationDirty(false)
    setNotice(undefined)
  }

  const save = async () => {
    if (saveBlocked) return
    setSaving(true)
    setNotice(undefined)
    try {
      if (declarationDirty) {
        const mutation = providerVisionMutation(catalog.namespaces, visionTarget, declareVision)
        if (mutation !== undefined) {
          const result = await api.settings.mutate(mutation)
          if (!result.result.ok) throw new Error(result.result.error.message)
        }
      }
      const ops = settingsPathOps(snapshot.value, draft)
      if (ops.length > 0) {
        const response = await api.settings.mutate({
          ns: 'deepseekeyes',
          ops,
          ...(snapshot.revision === undefined ? {} : { expectedRevision: snapshot.revision }),
        })
        if (!response.result.ok) throw new Error(response.result.error.message)
      }
      setDirty(false)
      setDeclarationDirty(false)
      setNotice({ kind: 'ok', text: t('saved') })
      setMcpRuntimeRefreshRevision(current => current + 1)
      await new Promise(resolve => setTimeout(resolve, 180))
      await Promise.all([loadCatalog(), loadUsage()])
    } catch (error) {
      setNotice({ kind: 'error', text: `${t('saveFailed')}${messageOf(error)}` })
    } finally {
      setSaving(false)
    }
  }

  if (snapshot.status === 'loading') {
    return <li style={styles.card}><div style={styles.summary}>{t('loading')}</div></li>
  }
  if (snapshot.status !== 'ready') {
    return <li style={styles.card}><div style={styles.summary}>{t('unavailable')}</div></li>
  }

  return (
    <li style={{ ...styles.card, ...(open ? styles.cardOpen : {}) }}>
      <button
        type="button"
        style={styles.header}
        aria-expanded={open}
        aria-controls="deepseekeyes-settings-body"
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')} v${PLUGIN_VERSION}`}
        onClick={() => setOpen(current => !current)}
      >
        <span style={styles.headText}>
          <span style={styles.titleRow}>
            <span style={styles.title}>{t('title')}</span>
            <span style={styles.version} aria-label={`${t('version')}: ${PLUGIN_VERSION}`}>v{PLUGIN_VERSION}</span>
          </span>
          <span style={styles.description}>{t('description')}</span>
        </span>
        {dirty || declarationDirty ? <span style={styles.pending}>{t('unsaved')}</span> : null}
        <svg
          data-deepseekeyes-chevron=""
          aria-hidden="true"
          viewBox="0 0 14 14"
          width="14"
          height="14"
          style={{ ...styles.chevron, ...(open ? styles.chevronOpen : {}) }}
        >
          <path d="m3.5 5.25 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" />
        </svg>
      </button>
      {open ? (
        <div id="deepseekeyes-settings-body" style={styles.body}>
          {!snapshot.writable ? <p style={styles.statusWarn}>{t('readOnly')}</p> : null}
          <div style={styles.grid}>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="deepseekeyes-upstream">{t('upstreamProvider')}</label>
              <select
                id="deepseekeyes-upstream"
                style={styles.input}
                value={draft.upstreamProvider}
                disabled={saving || !snapshot.writable}
                onChange={event => updateProvider('upstreamProvider', 'upstreamModel', event.target.value)}
              >
                {providers.length === 0 ? <option value="">{t('noProviders')}</option> : null}
                {!providers.some(item => item.provider === draft.upstreamProvider) && draft.upstreamProvider !== ''
                  ? <option value={draft.upstreamProvider}>{draft.upstreamProvider}</option>
                  : null}
                {providers.map(item => (
                  <option key={item.provider} value={item.provider}>
                    {item.displayName} ({item.provider}){item.active ? '' : t('inactive')}
                  </option>
                ))}
              </select>
              <p style={styles.hint}>{t('upstreamHint')}</p>
            </div>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="deepseekeyes-upstream-model">{t('upstreamModel')}</label>
              <input
                id="deepseekeyes-upstream-model"
                list="deepseekeyes-upstream-models"
                style={styles.input}
                type="text"
                value={draft.upstreamModel}
                placeholder={t('upstreamModelPlaceholder')}
                disabled={saving || !snapshot.writable || draft.upstreamProvider === ''}
                onChange={event => update('upstreamModel', event.target.value)}
              />
              <datalist id="deepseekeyes-upstream-models">
                {(upstreamGroup?.models ?? []).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
              </datalist>
            </div>
          </div>

          <div style={styles.grid}>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="deepseekeyes-vision-provider">{t('visionProvider')}</label>
              <select
                id="deepseekeyes-vision-provider"
                style={styles.input}
                value={draft.visionProvider}
                disabled={saving || !snapshot.writable}
                onChange={(event) => {
                  updateProvider('visionProvider', 'visionModel', event.target.value)
                  setDeclarationDirty(false)
                }}
              >
                <option value="">{t('visionProviderAuto')}</option>
                {providers.map(item => (
                  <option key={item.provider} value={item.provider}>
                    {item.displayName} ({item.provider}){item.active ? '' : t('inactive')}
                  </option>
                ))}
              </select>
              <p style={styles.hint}>{t('visionHint')}</p>
            </div>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="deepseekeyes-vision-model">{t('visionModel')}</label>
              <input
                id="deepseekeyes-vision-model"
                list="deepseekeyes-vision-models"
                style={styles.input}
                type="text"
                value={draft.visionModel}
                placeholder={t('visionModelPlaceholder')}
                disabled={saving || !snapshot.writable || draft.visionProvider === ''}
                onChange={event => update('visionModel', event.target.value)}
              />
              <datalist id="deepseekeyes-vision-models">
                {(visionGroup?.models ?? []).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
              </datalist>
            </div>
          </div>

          <p style={styles.statusOk}>
            {routeSummary(t('routeSummary'), visionRouteName, finalRouteName)}
          </p>

          {draft.visionProvider !== '' && visionTarget !== undefined
            ? (
              <div style={styles.field}>
                <label style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={declareVision}
                    disabled={saving || !snapshot.writable}
                    onChange={(event) => {
                      setDeclareVision(event.target.checked)
                      setDeclarationDirty(true)
                      setNotice(undefined)
                    }}
                  />
                  <span>{t('declareVision')}</span>
                </label>
                <p style={styles.hint}>{t('declareVisionHint')}</p>
              </div>
            )
            : draft.visionProvider !== ''
              ? <p style={styles.hint}>{t('catalogManaged')}</p>
              : null}

          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={draft.autoDetectVision}
              disabled={saving || !snapshot.writable}
              onChange={event => update('autoDetectVision', event.target.checked)}
            />
            <span>{t('autoDetect')}</span>
          </label>
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={draft.activeProbe}
              disabled={saving || !snapshot.writable}
              onChange={event => update('activeProbe', event.target.checked)}
            />
            <span>{t('activeProbe')}<br /><small style={styles.hint}>{t('activeProbeHint')}</small></span>
          </label>

          <details style={styles.details} open>
            <summary style={styles.detailsSummary}>{t('visionReliability')}</summary>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="deepseekeyes-vision-priority">{t('visionRoutePriority')}</label>
              <textarea
                id="deepseekeyes-vision-priority"
                style={{ ...styles.input, minHeight: 78, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
                value={draft.visionRoutePriority}
                placeholder={t('visionRoutePriorityPlaceholder')}
                disabled={saving || !snapshot.writable}
                onChange={event => update('visionRoutePriority', event.target.value)}
              />
              <p style={styles.hint}>{t('visionRoutePriorityHint')}</p>
            </div>
            <label style={{ ...styles.checkboxRow, marginTop: 12 }}>
              <input type="checkbox" checked={draft.visionHealthCheck} disabled={saving || !snapshot.writable} onChange={event => update('visionHealthCheck', event.target.checked)} />
              <span>{t('visionHealthCheck')}<br /><small style={styles.hint}>{t('visionHealthCheckHint')}</small></span>
            </label>
            <div style={{ ...styles.grid, marginTop: 14 }}>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-failover-attempts">{t('visionFailoverAttempts')}</label>
                <input id="deepseekeyes-failover-attempts" style={styles.input} type="number" min="0" max="8" step="1" value={draft.visionFailoverAttempts} disabled={saving || !snapshot.writable} onChange={event => update('visionFailoverAttempts', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-health-ttl">{t('visionHealthTtlMs')}</label>
                <input id="deepseekeyes-health-ttl" style={styles.input} type="number" min="1000" max="3600000" step="1" value={draft.visionHealthTtlMs} disabled={saving || !snapshot.writable || !draft.visionHealthCheck} onChange={event => update('visionHealthTtlMs', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-failure-cooldown">{t('visionFailureCooldownMs')}</label>
                <input id="deepseekeyes-failure-cooldown" style={styles.input} type="number" min="0" max="3600000" step="1" value={draft.visionFailureCooldownMs} disabled={saving || !snapshot.writable || !draft.visionHealthCheck} onChange={event => update('visionFailureCooldownMs', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-attempt-limit">{t('visionAttemptLimit')}</label>
                <input id="deepseekeyes-attempt-limit" style={styles.input} type="number" min="10" max="10000" step="1" value={draft.visionAttemptLimit} disabled={saving || !snapshot.writable || !draft.visionAttemptLog} onChange={event => update('visionAttemptLimit', numberFrom(event))} />
              </div>
            </div>
            <label style={{ ...styles.checkboxRow, marginTop: 12 }}>
              <input type="checkbox" checked={draft.visionAttemptLog} disabled={saving || !snapshot.writable} onChange={event => update('visionAttemptLog', event.target.checked)} />
              <span>{t('visionAttemptLog')}<br /><small style={styles.hint}>{t('visionAttemptLogHint')}</small></span>
            </label>
          </details>

          <details style={styles.details} open>
            <summary style={styles.detailsSummary}>{t('computerUse')}</summary>
            <div style={styles.field}>
              <strong style={styles.label}>{t('automationSpendGuard')}</strong>
              <TokenBudgetField
                id="deepseekeyes-automation-context-tokens"
                label={t('automationContextMaxTokens')}
                minimum={4_096}
                value={draft.automationContextMaxTokens}
                disabled={saving || !snapshot.writable}
                onChange={value => update('automationContextMaxTokens', value)}
                t={t}
                presets={AUTOMATION_CONTEXT_PRESETS}
                hint="automationContextHint"
                unlimitedInput="automationContextUnlimitedInput"
              />
              <div style={{ ...styles.field, marginTop: 10 }}>
                <label style={styles.label} htmlFor="deepseekeyes-automation-max-calls">{t('automationMaxCallsPerTurn')}</label>
                <input
                  id="deepseekeyes-automation-max-calls"
                  style={styles.input}
                  type="number"
                  min="0"
                  max="10000"
                  step="1"
                  value={draft.automationMaxCallsPerTurn}
                  disabled={saving || !snapshot.writable}
                  onChange={event => update('automationMaxCallsPerTurn', numberFrom(event))}
                />
                <small style={styles.hint}>{t('automationMaxCallsHint')}</small>
              </div>
            </div>
            <div style={styles.divider} />
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={draft.browserComputerUse}
                disabled={saving || !snapshot.writable}
                onChange={event => update('browserComputerUse', event.target.checked)}
              />
              <span>{t('browserComputerUse')}<br /><small style={styles.hint}>{t('browserComputerUseHint')}</small></span>
            </label>
            <label style={{ ...styles.checkboxRow, marginTop: 12 }}>
              <input
                type="checkbox"
                checked={draft.browserHeadless}
                disabled={saving || !snapshot.writable || !draft.browserComputerUse}
                onChange={event => update('browserHeadless', event.target.checked)}
              />
              <span>{t('browserHeadless')}</span>
            </label>
            <div style={{ ...styles.grid, marginTop: 14 }}>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-browser-channel">{t('browserChannel')}</label>
                <select id="deepseekeyes-browser-channel" style={styles.input} value={draft.browserChannel} disabled={saving || !snapshot.writable || !draft.browserComputerUse} onChange={event => update('browserChannel', event.target.value)}>
                  <option value="">{t('browserChannelAuto')}</option>
                  <option value="msedge">{t('browserChannelEdge')}</option>
                  <option value="chrome">{t('browserChannelChrome')}</option>
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-browser-executable">{t('browserExecutablePath')}</label>
                <input id="deepseekeyes-browser-executable" style={styles.input} type="text" value={draft.browserExecutablePath} placeholder={t('browserExecutablePlaceholder')} disabled={saving || !snapshot.writable || !draft.browserComputerUse} onChange={event => update('browserExecutablePath', event.target.value)} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-browser-locale">{t('browserLocale')}</label>
                <input id="deepseekeyes-browser-locale" style={styles.input} type="text" value={draft.browserLocale} disabled={saving || !snapshot.writable || !draft.browserComputerUse} onChange={event => update('browserLocale', event.target.value)} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-browser-timeout">{t('browserTimeoutMs')}</label>
                <input id="deepseekeyes-browser-timeout" style={styles.input} type="number" min="1000" max="120000" step="1" value={draft.browserTimeoutMs} disabled={saving || !snapshot.writable || !draft.browserComputerUse} onChange={event => update('browserTimeoutMs', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-browser-settle">{t('browserSettleMs')}</label>
                <input id="deepseekeyes-browser-settle" style={styles.input} type="number" min="0" max="10000" step="1" value={draft.browserSettleMs} disabled={saving || !snapshot.writable || !draft.browserComputerUse} onChange={event => update('browserSettleMs', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-browser-width">{t('browserViewportWidth')}</label>
                <input id="deepseekeyes-browser-width" style={styles.input} type="number" min="320" max="3840" step="1" value={draft.browserViewportWidth} disabled={saving || !snapshot.writable || !draft.browserComputerUse} onChange={event => update('browserViewportWidth', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-browser-height">{t('browserViewportHeight')}</label>
                <input id="deepseekeyes-browser-height" style={styles.input} type="number" min="240" max="2160" step="1" value={draft.browserViewportHeight} disabled={saving || !snapshot.writable || !draft.browserComputerUse} onChange={event => update('browserViewportHeight', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-browser-elements">{t('browserMaxElements')}</label>
                <input id="deepseekeyes-browser-elements" style={styles.input} type="number" min="20" max="500" step="1" value={draft.browserMaxElements} disabled={saving || !snapshot.writable || !draft.browserComputerUse} onChange={event => update('browserMaxElements', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-browser-text">{t('browserMaxTextChars')}</label>
                <input id="deepseekeyes-browser-text" style={styles.input} type="number" min="1000" max="100000" step="1" value={draft.browserMaxTextChars} disabled={saving || !snapshot.writable || !draft.browserComputerUse} onChange={event => update('browserMaxTextChars', numberFrom(event))} />
              </div>
            </div>
            <div style={styles.divider} />
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={draft.desktopComputerUse}
                disabled={saving || !snapshot.writable}
                onChange={event => update('desktopComputerUse', event.target.checked)}
              />
              <span>{t('desktopComputerUse')}<br /><small style={styles.hint}>{t('desktopComputerUseHint')}</small></span>
            </label>
            <p style={{ ...styles.hint, marginTop: 10 }}>{t('desktopPermissionHint')}</p>
            <label style={{ ...styles.checkboxRow, marginTop: 12 }}>
              <input
                type="checkbox"
                checked={draft.desktopSemantic}
                disabled={saving || !snapshot.writable || !draft.desktopComputerUse}
                onChange={event => update('desktopSemantic', event.target.checked)}
              />
              <span>{t('desktopSemantic')}<br /><small style={styles.hint}>{t('desktopSemanticHint')}</small></span>
            </label>
            <div style={{ ...styles.field, marginTop: 14 }}>
              <label style={styles.label} htmlFor="deepseekeyes-desktop-visual-mode">{t('desktopVisualMode')}</label>
              <select id="deepseekeyes-desktop-visual-mode" style={styles.input} value={draft.desktopVisualMode} disabled={saving || !snapshot.writable || !draft.desktopComputerUse} onChange={event => update('desktopVisualMode', event.target.value)}>
                <option value="auto">{t('desktopVisualModeAuto')}</option>
                <option value="always">{t('desktopVisualModeAlways')}</option>
                <option value="manual">{t('desktopVisualModeManual')}</option>
              </select>
              <small style={styles.hint}>{t('desktopVisualModeHint')}</small>
            </div>
            <div style={{ ...styles.grid, marginTop: 14 }}>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-desktop-timeout">{t('desktopTimeoutMs')}</label>
                <input id="deepseekeyes-desktop-timeout" style={styles.input} type="number" min="1000" max="120000" step="1" value={draft.desktopTimeoutMs} disabled={saving || !snapshot.writable || !draft.desktopComputerUse} onChange={event => update('desktopTimeoutMs', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-desktop-settle">{t('desktopSettleMs')}</label>
                <input id="deepseekeyes-desktop-settle" style={styles.input} type="number" min="0" max="10000" step="1" value={draft.desktopSettleMs} disabled={saving || !snapshot.writable || !draft.desktopComputerUse} onChange={event => update('desktopSettleMs', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-desktop-windows">{t('desktopMaxWindows')}</label>
                <input id="deepseekeyes-desktop-windows" style={styles.input} type="number" min="1" max="200" step="1" value={draft.desktopMaxWindows} disabled={saving || !snapshot.writable || !draft.desktopComputerUse} onChange={event => update('desktopMaxWindows', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-desktop-elements">{t('desktopMaxElements')}</label>
                <input id="deepseekeyes-desktop-elements" style={styles.input} type="number" min="20" max="500" step="1" value={draft.desktopMaxElements} disabled={saving || !snapshot.writable || !draft.desktopComputerUse || !draft.desktopSemantic} onChange={event => update('desktopMaxElements', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-desktop-display">{t('desktopMacDisplay')}</label>
                <input id="deepseekeyes-desktop-display" style={styles.input} type="number" min="1" max="32" step="1" value={draft.desktopMacDisplay} disabled={saving || !snapshot.writable || !draft.desktopComputerUse} onChange={event => update('desktopMacDisplay', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-desktop-powershell">{t('desktopWindowsPowerShell')}</label>
                <input id="deepseekeyes-desktop-powershell" style={styles.input} type="text" value={draft.desktopWindowsPowerShell} placeholder={t('desktopWindowsPowerShellPlaceholder')} disabled={saving || !snapshot.writable || !draft.desktopComputerUse} onChange={event => update('desktopWindowsPowerShell', event.target.value)} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-desktop-artifacts">{t('desktopArtifactsDir')}</label>
                <input id="deepseekeyes-desktop-artifacts" style={styles.input} type="text" value={draft.desktopArtifactsDir} placeholder={t('desktopArtifactsDirPlaceholder')} disabled={saving || !snapshot.writable || !draft.desktopComputerUse} onChange={event => update('desktopArtifactsDir', event.target.value)} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-desktop-history">{t('desktopHistoryLimit')}</label>
                <input id="deepseekeyes-desktop-history" style={styles.input} type="number" min="0" max="32" step="1" value={draft.desktopHistoryLimit} disabled={saving || !snapshot.writable || !draft.desktopComputerUse} onChange={event => update('desktopHistoryLimit', numberFrom(event))} />
              </div>
            </div>
          </details>

          <McpSettingsSection
            draft={draft}
            disabled={saving || !snapshot.writable}
            rpc={usageRpc}
            refreshRevision={mcpRuntimeRefreshRevision}
            onUpdate={update}
            t={t}
          />

          <details style={styles.details}>
            <summary style={styles.detailsSummary}>{t('advanced')}</summary>
            <div style={styles.grid}>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-clarifications">{t('maxClarifications')}</label>
                <input id="deepseekeyes-clarifications" style={styles.input} type="number" min="0" max="8" step="1" value={draft.maxClarifications} disabled={saving || !snapshot.writable} onChange={event => update('maxClarifications', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-history-images">{t('historyImageLimit')}</label>
                <input id="deepseekeyes-history-images" style={styles.input} type="number" min="0" max="32" step="1" value={draft.historyImageLimit} disabled={saving || !snapshot.writable} onChange={event => update('historyImageLimit', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-history-summary">{t('historySummaryChars')}</label>
                <input id="deepseekeyes-history-summary" style={styles.input} type="number" min="64" max="2000" step="1" value={draft.historySummaryChars} disabled={saving || !snapshot.writable} onChange={event => update('historySummaryChars', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-browser-history">{t('browserHistoryLimit')}</label>
                <input id="deepseekeyes-browser-history" style={styles.input} type="number" min="0" max="32" step="1" value={draft.browserHistoryLimit} disabled={saving || !snapshot.writable} onChange={event => update('browserHistoryLimit', numberFrom(event))} />
              </div>
            </div>
            <p style={{ ...styles.hint, marginTop: 10 }}>{t('historyBudgetHint')}</p>
            <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
              <TokenBudgetField id="deepseekeyes-base-tokens" label={t('baseMaxTokens')} minimum={512} value={draft.baseMaxTokens} disabled={saving || !snapshot.writable} onChange={value => update('baseMaxTokens', value)} t={t} />
              <TokenBudgetField id="deepseekeyes-target-tokens" label={t('targetMaxTokens')} minimum={256} value={draft.targetMaxTokens} disabled={saving || !snapshot.writable} onChange={value => update('targetMaxTokens', value)} t={t} />
            </div>
            <label style={{ ...styles.checkboxRow, marginTop: 14 }}>
              <input type="checkbox" checked={draft.persistentEvidence} disabled={saving || !snapshot.writable} onChange={event => update('persistentEvidence', event.target.checked)} />
              <span>{t('persistentEvidence')}</span>
            </label>
          </details>

          <details style={styles.details} open>
            <summary style={styles.detailsSummary}>{t('usageStatsTitle')}</summary>
            <label style={styles.checkboxRow}>
              <input type="checkbox" checked={draft.usageStats} disabled={saving || !snapshot.writable} onChange={event => update('usageStats', event.target.checked)} />
              <span>{t('usageStats')}</span>
            </label>
            <p style={{ ...styles.hint, marginTop: 10 }}>{t('usageStatsHint')}</p>
            {usage.loading
              ? <p style={{ ...styles.statusWarn, marginTop: 12 }}>{t('usageStatsLoading')}</p>
              : usage.error !== undefined
                ? <p style={{ ...styles.statusError, marginTop: 12 }}>{t('usageStatsUnavailable')}{usage.error}</p>
                : usage.value !== undefined
                  ? (
                    <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                      {!usage.value.enabled ? <p style={styles.statusWarn}>{t('usageStatsDisabled')}</p> : null}
                      {usage.value.persistence?.healthy === false
                        ? <p style={styles.statusWarn}>{t('usagePersistenceError')}{usage.value.persistence.error}</p>
                        : null}
                      <div style={styles.metricGrid}>
                        <UsageMetric label={t('usageExactAdditional')} value={usage.value.totals.derived.exactAdditionalTokens} />
                        <UsageMetric label={t('usageEstimatedBridge')} value={usage.value.totals.derived.estimatedBridgeInputTokens} />
                        <UsageMetric label={t('usageEstimatedTotal')} value={usage.value.totals.derived.estimatedAdditionalTokens} />
                        <UsageMetric label={t('usageVision')} value={usage.value.totals.derived.visionTokens} />
                        <UsageMetric label={t('usageClarification')} value={usage.value.totals.derived.upstreamClarificationTokens} />
                        <UsageMetric label={t('usageAutomation')} value={usage.value.totals.derived.automationTokens} />
                        <UsageMetric label={t('usageAutomationTurns')} value={usage.value.totals.automationTurns} />
                        <UsageMetric label={t('usageContextCompactions')} value={usage.value.totals.automationContextCompactions} />
                        <UsageMetric label={t('usageInputSaved')} value={usage.value.totals.estimatedAutomationInputTokensSaved} />
                        <UsageMetric label={t('usageLimitStops')} value={usage.value.totals.automationLimitStops} />
                        <UsageMetric label={t('usageMcpTokens')} value={usage.value.totals.derived.mcpTokens} />
                        <UsageMetric label={t('usageMcpExternalCalls')} value={usage.value.totals.mcpExternalCalls} />
                        <UsageMetric label={t('usageMcpSchemaInput')} value={usage.value.totals.mcpSchemaInputTokensEstimated} />
                        <UsageMetric label={t('usageMcpResultInput')} value={usage.value.totals.mcpResultInputTokensEstimated} />
                        <UsageMetric label={t('usageMcpContextCompactions')} value={usage.value.totals.mcpContextCompactions} />
                        <UsageMetric label={t('usageMcpLimitStops')} value={usage.value.totals.mcpLimitStops} />
                        <UsageMetric label={t('usageVisualTurns')} value={usage.value.totals.visualTurns} />
                        <UsageMetric label={t('usageLookCalls')} value={usage.value.totals.lookCalls} />
                        <UsageMetric label={t('usageCacheHits')} value={usage.value.totals.cacheHits} />
                      </div>
                      <p style={styles.hint}>{t('usageMcpSubsetHint')}</p>
                      <p style={styles.hint}>{t('usageFinalExcluded')}</p>
                      <p style={styles.hint}>{t('usageUpdatedAt')}{usage.value.updatedAt}</p>
                    </div>
                  )
                  : null}
            <div style={{ ...styles.actions, marginTop: 12 }}>
              <button type="button" style={styles.button} disabled={usage.loading} onClick={() => { void loadUsage() }}>{t('usageRefresh')}</button>
              <button type="button" style={styles.button} disabled={usage.loading} onClick={() => { void resetUsage() }}>{t('usageReset')}</button>
            </div>
          </details>

          {catalog.loading
            ? <p style={styles.statusWarn}>{t('statusChecking')}</p>
            : catalog.error !== undefined
              ? <p style={styles.statusError}>{catalog.error}</p>
              : readyGroup !== undefined
                ? <p style={styles.statusOk}>{t('statusReady')}{t(draft.activeProbe ? 'statusReadyProbe' : 'statusReadyMetadata')}</p>
                : <p style={styles.statusWarn}>{selectedFailure?.message ?? t('statusPending')}</p>}
          {failureKey !== undefined ? <p style={styles.statusError}>{t(failureKey)}</p> : null}
          {notice !== undefined ? <p style={notice.kind === 'ok' ? styles.statusOk : styles.statusError}>{notice.text}</p> : null}

          <div style={styles.actions}>
            <button type="button" style={styles.button} disabled={saving} onClick={() => { void loadCatalog() }}>{t('refresh')}</button>
            <button type="button" style={styles.button} disabled={saving || (!dirty && !declarationDirty)} onClick={discard}>{t('discard')}</button>
            <button type="button" style={{ ...styles.primary, opacity: saveBlocked ? 0.55 : 1 }} disabled={saveBlocked} onClick={() => { void save() }}>{t(saving ? 'saving' : 'save')}</button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx) {
  const { api, rpc } = ctx.get('connection')
  const scope = ctx.settingsScope.bind({ namespace: 'deepseekeyes' })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'deepseekeyes: settings locale')
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'deepseekeyes',
    order: 30,
    locale: NS,
    inject: () => ({ scope, api, usageRpc: rpc }),
  }, DeepSeekEyesSettingsCard))
}
