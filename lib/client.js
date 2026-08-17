window.__ModuleLoader__.load({ id: "@dttxorg/deepseekeyes", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");

// src/settings-ui.js
var SETTINGS_FIELDS = Object.freeze([
  "upstreamProvider",
  "upstreamModel",
  "visionProvider",
  "visionModel",
  "visionRoutePriority",
  "autoDetectVision",
  "activeProbe",
  "visionHealthCheck",
  "visionFailoverAttempts",
  "visionHealthTtlMs",
  "visionFailureCooldownMs",
  "visionAttemptLog",
  "visionAttemptLimit",
  "persistentEvidence",
  "usageStats",
  "maxClarifications",
  "baseMaxTokens",
  "targetMaxTokens",
  "automationContextMaxTokens",
  "automationMaxCallsPerTurn",
  "historyImageLimit",
  "historySummaryChars",
  "browserHistoryLimit",
  "browserComputerUse",
  "browserHeadless",
  "browserChannel",
  "browserExecutablePath",
  "browserLocale",
  "browserTimeoutMs",
  "browserSettleMs",
  "browserViewportWidth",
  "browserViewportHeight",
  "browserMaxElements",
  "browserMaxTextChars",
  "desktopHistoryLimit",
  "desktopComputerUse",
  "desktopVisualMode",
  "desktopTimeoutMs",
  "desktopSettleMs",
  "desktopMaxWindows",
  "desktopSemantic",
  "desktopMaxElements",
  "desktopMacDisplay",
  "desktopWindowsPowerShell",
  "desktopArtifactsDir"
]);
var OPTIONAL_ROUTE_FIELDS = /* @__PURE__ */ new Set([
  "upstreamModel",
  "visionProvider",
  "visionModel",
  "visionRoutePriority",
  "browserChannel",
  "browserExecutablePath",
  "desktopWindowsPowerShell",
  "desktopArtifactsDir"
]);
function valueAt(root, path) {
  let current = root;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return void 0;
    current = current[segment];
  }
  return current;
}
function normalizeSettingsDraft(value = {}) {
  return {
    upstreamProvider: typeof value.upstreamProvider === "string" ? value.upstreamProvider : "deepseek-official",
    upstreamModel: typeof value.upstreamModel === "string" ? value.upstreamModel : "",
    visionProvider: typeof value.visionProvider === "string" ? value.visionProvider : "",
    visionModel: typeof value.visionModel === "string" ? value.visionModel : "",
    visionRoutePriority: typeof value.visionRoutePriority === "string" ? value.visionRoutePriority : "",
    autoDetectVision: value.autoDetectVision !== false,
    activeProbe: value.activeProbe !== false,
    visionHealthCheck: value.visionHealthCheck !== false,
    visionFailoverAttempts: Number.isInteger(value.visionFailoverAttempts) ? value.visionFailoverAttempts : 2,
    visionHealthTtlMs: Number.isInteger(value.visionHealthTtlMs) ? value.visionHealthTtlMs : 6e4,
    visionFailureCooldownMs: Number.isInteger(value.visionFailureCooldownMs) ? value.visionFailureCooldownMs : 3e4,
    visionAttemptLog: value.visionAttemptLog !== false,
    visionAttemptLimit: Number.isInteger(value.visionAttemptLimit) ? value.visionAttemptLimit : 1e3,
    persistentEvidence: value.persistentEvidence !== false,
    usageStats: value.usageStats !== false,
    maxClarifications: Number.isInteger(value.maxClarifications) ? value.maxClarifications : 3,
    baseMaxTokens: Number.isSafeInteger(value.baseMaxTokens) ? value.baseMaxTokens : 16384,
    targetMaxTokens: Number.isSafeInteger(value.targetMaxTokens) ? value.targetMaxTokens : 8192,
    automationContextMaxTokens: Number.isSafeInteger(value.automationContextMaxTokens) ? value.automationContextMaxTokens : 32768,
    automationMaxCallsPerTurn: Number.isInteger(value.automationMaxCallsPerTurn) ? value.automationMaxCallsPerTurn : 32,
    historyImageLimit: Number.isInteger(value.historyImageLimit) ? value.historyImageLimit : 8,
    historySummaryChars: Number.isInteger(value.historySummaryChars) ? value.historySummaryChars : 320,
    browserHistoryLimit: Number.isInteger(value.browserHistoryLimit) ? value.browserHistoryLimit : 8,
    browserComputerUse: value.browserComputerUse === true,
    browserHeadless: value.browserHeadless === true,
    browserChannel: typeof value.browserChannel === "string" ? value.browserChannel : "",
    browserExecutablePath: typeof value.browserExecutablePath === "string" ? value.browserExecutablePath : "",
    browserLocale: typeof value.browserLocale === "string" ? value.browserLocale : "zh-CN",
    browserTimeoutMs: Number.isInteger(value.browserTimeoutMs) ? value.browserTimeoutMs : 15e3,
    browserSettleMs: Number.isInteger(value.browserSettleMs) ? value.browserSettleMs : 300,
    browserViewportWidth: Number.isInteger(value.browserViewportWidth) ? value.browserViewportWidth : 1440,
    browserViewportHeight: Number.isInteger(value.browserViewportHeight) ? value.browserViewportHeight : 900,
    browserMaxElements: Number.isInteger(value.browserMaxElements) ? value.browserMaxElements : 200,
    browserMaxTextChars: Number.isInteger(value.browserMaxTextChars) ? value.browserMaxTextChars : 2e4,
    desktopHistoryLimit: Number.isInteger(value.desktopHistoryLimit) ? value.desktopHistoryLimit : 8,
    desktopComputerUse: value.desktopComputerUse === true,
    desktopVisualMode: ["auto", "always", "manual"].includes(value.desktopVisualMode) ? value.desktopVisualMode : "auto",
    desktopTimeoutMs: Number.isInteger(value.desktopTimeoutMs) ? value.desktopTimeoutMs : 3e4,
    desktopSettleMs: Number.isInteger(value.desktopSettleMs) ? value.desktopSettleMs : 300,
    desktopMaxWindows: Number.isInteger(value.desktopMaxWindows) ? value.desktopMaxWindows : 50,
    desktopSemantic: value.desktopSemantic !== false,
    desktopMaxElements: Number.isInteger(value.desktopMaxElements) ? value.desktopMaxElements : 200,
    desktopMacDisplay: Number.isInteger(value.desktopMacDisplay) ? value.desktopMacDisplay : 1,
    desktopWindowsPowerShell: typeof value.desktopWindowsPowerShell === "string" ? value.desktopWindowsPowerShell : "",
    desktopArtifactsDir: typeof value.desktopArtifactsDir === "string" ? value.desktopArtifactsDir : ""
  };
}
function settingsPathOps(currentValue, draft) {
  const current = normalizeSettingsDraft(currentValue);
  const ops = [];
  for (const field of SETTINGS_FIELDS) {
    const next = draft[field];
    if (OPTIONAL_ROUTE_FIELDS.has(field) && (next === void 0 || next === "")) {
      if (currentValue?.[field] !== void 0 && currentValue[field] !== "") {
        ops.push({ op: "unset", path: [field] });
      }
      continue;
    }
    if (JSON.stringify(current[field]) !== JSON.stringify(next)) {
      ops.push({ op: "set", path: [field], value: next });
    }
  }
  return ops;
}
function settingsDraftFailure(draft, providerId = "deepseekeyes") {
  if (typeof draft.upstreamProvider !== "string" || draft.upstreamProvider.trim() === "") {
    return "upstreamRequired";
  }
  if (draft.upstreamProvider === providerId) return "recursiveUpstream";
  if (draft.visionModel !== "" && draft.visionProvider === "") return "visionProviderRequired";
  if (!draft.autoDetectVision && draft.visionProvider === "" && draft.visionRoutePriority.trim() === "") {
    return "visionRouteRequired";
  }
  if (draft.visionRoutePriority !== "") {
    const entries = draft.visionRoutePriority.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean);
    if (entries.some((entry) => entry.indexOf("/") <= 0 || entry.endsWith("/"))) return "visionRoutePriorityFormat";
  }
  if (typeof draft.browserLocale !== "string" || draft.browserLocale.trim() === "") return "browserLocaleRequired";
  if (!["auto", "always", "manual"].includes(draft.desktopVisualMode)) return "desktopVisualModeInvalid";
  const tokenRanges = [
    ["baseMaxTokens", 512],
    ["targetMaxTokens", 256],
    ["automationContextMaxTokens", 4096]
  ];
  for (const [field, minimum] of tokenRanges) {
    if (draft[field] !== 0 && (!Number.isSafeInteger(draft[field]) || draft[field] < minimum)) {
      return `${field}Range`;
    }
  }
  const ranges = [
    ["maxClarifications", 0, 8],
    ["automationMaxCallsPerTurn", 0, 1e4],
    ["visionFailoverAttempts", 0, 8],
    ["visionHealthTtlMs", 1e3, 36e5],
    ["visionFailureCooldownMs", 0, 36e5],
    ["visionAttemptLimit", 10, 1e4],
    ["historyImageLimit", 0, 32],
    ["historySummaryChars", 64, 2e3],
    ["browserHistoryLimit", 0, 32],
    ["browserTimeoutMs", 1e3, 12e4],
    ["browserSettleMs", 0, 1e4],
    ["browserViewportWidth", 320, 3840],
    ["browserViewportHeight", 240, 2160],
    ["browserMaxElements", 20, 500],
    ["browserMaxTextChars", 1e3, 1e5],
    ["desktopHistoryLimit", 0, 32],
    ["desktopTimeoutMs", 1e3, 12e4],
    ["desktopSettleMs", 0, 1e4],
    ["desktopMaxWindows", 1, 200],
    ["desktopMaxElements", 20, 500],
    ["desktopMacDisplay", 1, 32]
  ];
  for (const [field, minimum, maximum] of ranges) {
    if (!Number.isInteger(draft[field]) || draft[field] < minimum || draft[field] > maximum) {
      return `${field}Range`;
    }
  }
  return void 0;
}
function providerSettingsTarget(providers, provider) {
  const row = providers.find((candidate) => candidate.provider === provider);
  if (row?.settingsNs !== "llm-pi-ai") return void 0;
  return { ns: row.settingsNs, path: [...row.settingsPath] };
}
function providerDeclaresVision(namespaces, target) {
  if (target === void 0) return false;
  const namespace = namespaces.find((candidate) => candidate.ns === target.ns);
  const profile = valueAt(namespace?.value, target.path);
  const input = profile?.defaultInput;
  return Array.isArray(input) && input.includes("text") && input.includes("image");
}
function providerVisionMutation(namespaces, target, enabled) {
  if (target === void 0) return void 0;
  const namespace = namespaces.find((candidate) => candidate.ns === target.ns);
  if (namespace === void 0) return void 0;
  return {
    ns: target.ns,
    expectedRevision: namespace.revision,
    ops: [{
      op: "set",
      path: [...target.path, "defaultInput"],
      value: enabled ? ["text", "image"] : ["text"]
    }]
  };
}

// client/index.jsx
var import_jsx_runtime = require("react/jsx-runtime");
var NS = "deepseekeyes.settings";
var PROVIDER_ID = "deepseekeyes";
var PLUGIN_VERSION = "0.5.7";
var zh = {
  title: "DeepSeekEyes",
  version: "\u7248\u672C",
  description: "\u5728\u540C\u4E00\u5BF9\u8BDD\u6846\u5185\u4E3A DeepSeek \u63A5\u5165\u89C6\u89C9\u6A21\u578B\uFF0C\u5E76\u4FDD\u7559\u5BF9\u539F\u56FE\u7684\u6309\u9700\u8FFD\u95EE\u3002",
  expand: "\u5C55\u5F00",
  collapse: "\u6536\u8D77",
  unsaved: "\u672A\u4FDD\u5B58",
  loading: "\u6B63\u5728\u8BFB\u53D6 Harness \u6A21\u578B\u8BBE\u7F6E\u2026",
  unavailable: "DeepSeekEyes \u8BBE\u7F6E\u5C1A\u672A\u7531 Host \u66B4\u9732\u3002",
  readOnly: "\u5F53\u524D\u8BBE\u7F6E\u6587\u4EF6\u4E3A\u53EA\u8BFB\u3002",
  upstreamProvider: "\u6700\u7EC8\u56DE\u7B54 Provider",
  upstreamModel: "\u6700\u7EC8\u56DE\u7B54\u6A21\u578B",
  upstreamModelPlaceholder: "\u9009\u62E9\u6216\u8F93\u5165\u6A21\u578B ID\uFF1B\u7559\u7A7A\u5219\u517C\u5BB9\u663E\u793A\u8BE5 Provider \u7684\u5168\u90E8\u6587\u672C\u6A21\u578B",
  upstreamHint: "\u8D1F\u8D23\u8BFB\u53D6\u89C6\u89C9\u8BC1\u636E\u3001\u63A8\u7406\u5E76\u6700\u7EC8\u56DE\u590D\u7528\u6237\u3002",
  visionProvider: "\u540E\u53F0\u8BFB\u56FE Provider",
  visionProviderAuto: "\u81EA\u52A8\u626B\u63CF\u89C6\u89C9\u6A21\u578B",
  visionHint: "\u53EA\u8D1F\u8D23\u8BFB\u53D6\u539F\u56FE\u5E76\u56DE\u7B54\u6700\u7EC8\u6A21\u578B\u7684\u7EC6\u8282\u8FFD\u95EE\u3002",
  visionModel: "\u540E\u53F0\u8BFB\u56FE\u6A21\u578B",
  visionModelPlaceholder: "\u9009\u62E9\u6216\u8F93\u5165\u6A21\u578B ID\uFF1B\u7559\u7A7A\u5219\u9009\u8BE5 Provider \u7684\u9996\u4E2A\u89C6\u89C9\u6A21\u578B",
  routeSummary: "\u5F53\u524D\u8DEF\u7531\uFF1A\u56FE\u7247 \u2192 {vision} \u8BFB\u56FE \u2192 {final} \u6700\u7EC8\u56DE\u7B54",
  automaticVision: "\u81EA\u52A8\u68C0\u6D4B\u89C6\u89C9\u6A21\u578B",
  allTextModels: "\u8BE5 Provider \u7684\u4F1A\u8BDD\u6240\u9009\u6A21\u578B",
  declareVision: "\u5C06\u6B64\u81EA\u5B9A\u4E49\u7F51\u5173\u58F0\u660E\u4E3A\u652F\u6301\u56FE\u7247\u8F93\u5165",
  declareVisionHint: "\u4FDD\u5B58\u65F6\u5199\u5165 llm-pi-ai \u7684 defaultInput: [text, image]\uFF0C\u65E0\u9700\u624B\u6539 settings.yaml\u3002",
  catalogManaged: "\u8BE5 Provider \u7684\u56FE\u7247\u80FD\u529B\u7531\u5185\u7F6E\u6A21\u578B\u76EE\u5F55\u7BA1\u7406\uFF1B\u63D2\u4EF6\u4F1A\u5728 Host \u7AEF\u518D\u6B21\u6821\u9A8C text + image\u3002",
  autoDetect: "\u672A\u6307\u5B9A\u89C6\u89C9 Provider \u65F6\u81EA\u52A8\u68C0\u6D4B",
  activeProbe: "\u9996\u6B21\u4F7F\u7528\u65F6\u6267\u884C\u968F\u673A\u50CF\u7D20\u63A2\u9488",
  activeProbeHint: "\u4E0D\u4EC5\u76F8\u4FE1\u6A21\u578B\u58F0\u660E\uFF0C\u8FD8\u4F1A\u53D1\u9001\u968F\u673A 3\xD73 \u8272\u5757\u786E\u8BA4\u6A21\u578B\u786E\u5B9E\u8BFB\u53D6\u4E86\u50CF\u7D20\u3002",
  visionReliability: "\u89C6\u89C9\u8DEF\u7531\u53EF\u9760\u6027",
  visionRoutePriority: "\u540E\u5907\u89C6\u89C9\u8DEF\u7531\u4F18\u5148\u7EA7",
  visionRoutePriorityPlaceholder: "\u6BCF\u884C\u4E00\u4E2A provider/model\uFF1B\u6A21\u578B ID \u53EF\u7EE7\u7EED\u5305\u542B /",
  visionRoutePriorityHint: "\u4E3B\u89C6\u89C9\u8DEF\u7531\u5931\u8D25\u540E\u6309\u987A\u5E8F\u5C1D\u8BD5\uFF1B\u672A\u5217\u51FA\u7684\u89C6\u89C9\u6A21\u578B\u4ECD\u53EF\u7531\u81EA\u52A8\u68C0\u6D4B\u8865\u5145\u3002",
  visionHealthCheck: "\u542F\u7528\u89C6\u89C9\u8DEF\u7531\u5065\u5EB7\u68C0\u67E5\u4E0E\u7194\u65AD",
  visionHealthCheckHint: "\u7F13\u5B58\u56FE\u7247\u80FD\u529B\u68C0\u6D4B\uFF1B\u8C03\u7528\u5931\u8D25\u540E\u5728\u51B7\u5374\u671F\u8DF3\u8FC7\u8BE5\u8DEF\u7531\uFF0C\u5E76\u8BB0\u5F55\u6BCF\u6B21\u9009\u62E9\u4E0E\u6545\u969C\u8F6C\u79FB\u3002",
  visionFailoverAttempts: "\u6700\u591A\u540E\u5907\u5C1D\u8BD5\u6B21\u6570",
  visionHealthTtlMs: "\u5065\u5EB7\u68C0\u67E5\u7F13\u5B58\uFF08\u6BEB\u79D2\uFF09",
  visionFailureCooldownMs: "\u5931\u8D25\u8DEF\u7531\u51B7\u5374\uFF08\u6BEB\u79D2\uFF09",
  visionAttemptLog: "\u8BB0\u5F55\u89C6\u89C9\u8DEF\u7531 attempts",
  visionAttemptLogHint: "\u4EC5\u4FDD\u5B58 Provider\u3001\u6A21\u578B\u3001\u72B6\u6001\u3001\u8017\u65F6\u3001\u9519\u8BEF\u7801\u53CA\u54C8\u5E0C\u540E\u7684\u4F1A\u8BDD ID\uFF0C\u4E0D\u4FDD\u5B58\u63D0\u793A\u6216\u56FE\u7247\u5185\u5BB9\u3002",
  visionAttemptLimit: "\u6700\u591A\u4FDD\u7559 attempts",
  persistentEvidence: "\u6301\u4E45\u5316\u89C6\u89C9\u8BC1\u636E\u7F13\u5B58",
  usageStats: "\u8BB0\u5F55 DeepSeekEyes Token \u7EDF\u8BA1",
  usageStatsTitle: "Token \u6D88\u8017\u7EDF\u8BA1",
  usageStatsHint: "\u7CBE\u786E\u503C\u6765\u81EA Provider \u8FD4\u56DE\u7684 usage\uFF1BComputer Use \u5F15\u53D1\u7684 DeepSeek \u8C03\u7528\u4F1A\u5B8C\u6574\u8BA1\u5165\u3002\u6865\u63A5\u8F93\u5165\u4E0E\u4E0A\u4E0B\u6587\u8282\u7701\u91CF\u4F7F\u7528 Harness \u56FA\u5B9A\u5BC6\u5EA6\u89C4\u5219\u4F30\u7B97\u3002\u7EDF\u8BA1\u67E5\u8BE2\u76F4\u63A5\u8D70\u672C\u673A RPC\uFF0C\u4E0D\u8C03\u7528\u6A21\u578B\u3002",
  usageStatsDisabled: "\u7EDF\u8BA1\u5DF2\u5173\u95ED\uFF1B\u5173\u95ED\u671F\u95F4\u4E0D\u8BB0\u5F55\u65B0\u7684\u6570\u636E\u3002",
  usageStatsLoading: "\u6B63\u5728\u8BFB\u53D6 Token \u7EDF\u8BA1\u2026",
  usageStatsUnavailable: "Token \u7EDF\u8BA1\u8BFB\u53D6\u5931\u8D25\uFF1A",
  usagePersistenceError: "\u7EDF\u8BA1\u6587\u4EF6\u6682\u65F6\u5199\u5165\u5931\u8D25\uFF0C\u5F53\u524D\u8FDB\u7A0B\u4ECD\u7EE7\u7EED\u5728\u5185\u5B58\u4E2D\u8BA1\u6570\uFF1A",
  usageExactAdditional: "\u7CBE\u786E\u989D\u5916 Token",
  usageEstimatedBridge: "\u4F30\u7B97\u6865\u63A5\u8F93\u5165",
  usageEstimatedTotal: "\u4F30\u7B97\u63D2\u4EF6\u5408\u8BA1",
  usageVision: "\u89C6\u89C9\u6A21\u578B Token",
  usageClarification: "DeepSeek \u8FFD\u95EE\u8F6E\u6B21 Token",
  usageAutomation: "Computer Use DeepSeek Token",
  usageAutomationTurns: "\u81EA\u52A8\u5316\u7528\u6237\u6307\u4EE4",
  usageContextCompactions: "\u4E0A\u4E0B\u6587\u4FDD\u62A4\u6B21\u6570",
  usageInputSaved: "\u4F30\u7B97\u907F\u514D\u91CD\u653E\u8F93\u5165",
  usageLimitStops: "\u989D\u5EA6\u4FDD\u62A4\u505C\u6B62\u6B21\u6570",
  usageVisualTurns: "\u89C6\u89C9\u8F6E\u6B21",
  usageLookCalls: "\u539F\u56FE\u6309\u9700\u8BFB\u53D6",
  usageCacheHits: "\u89C6\u89C9\u7F13\u5B58\u547D\u4E2D",
  usageFinalExcluded: "\u666E\u901A\u56FE\u6587\u8F6E\u6B21\u552F\u4E00\u4E00\u6B21\u6700\u7EC8\u56DE\u7B54\u4ECD\u5355\u72EC\u5C55\u793A\uFF1BBrowser/Desktop Computer Use \u5F15\u53D1\u7684\u6BCF\u6B21 DeepSeek \u8C03\u7528\u5747\u8BA1\u5165\u63D2\u4EF6\u989D\u5916\u6D88\u8017\u3002",
  usageUpdatedAt: "\u66F4\u65B0\u65F6\u95F4\uFF1A",
  usageRefresh: "\u5237\u65B0\u7EDF\u8BA1",
  usageReset: "\u6E05\u96F6\u7EDF\u8BA1",
  usageResetConfirm: "\u786E\u8BA4\u6E05\u96F6 DeepSeekEyes \u7684\u7D2F\u8BA1 Token \u7EDF\u8BA1\uFF1F",
  maxClarifications: "\u6700\u591A\u8FFD\u95EE\u8F6E\u6570",
  baseMaxTokens: "\u9996\u6B21\u8BFB\u56FE Token \u4E0A\u9650",
  targetMaxTokens: "\u7EC6\u8282\u8FFD\u95EE Token \u4E0A\u9650",
  historyImageLimit: "\u6700\u8FD1\u5386\u53F2\u56FE\u7247\u5F15\u7528\u6570",
  historySummaryChars: "\u6BCF\u5F20\u5386\u53F2\u56FE\u7247\u6458\u8981\u5B57\u7B26",
  browserHistoryLimit: "\u6700\u8FD1 Browser \u72B6\u6001\u6458\u8981\u6570",
  historyBudgetHint: "\u65E7\u56FE\u7247\u4FDD\u7559\u539F\u9644\u4EF6\u548C\u54C8\u5E0C\uFF0C\u53EA\u5411\u6A21\u578B\u53D1\u9001\u6709\u9650\u6570\u91CF\u7684\u77ED\u6458\u8981\uFF1B\u9700\u8981\u7EC6\u8282\u65F6\u7531 deepseekeyes_look \u6309\u539F\u56FE\u8BFB\u53D6\u30020 \u8868\u793A\u4E0D\u628A\u65E7\u9879\u5E26\u5165\u6A21\u578B\u4E0A\u4E0B\u6587\u3002",
  tokenPreset: "\u5EFA\u8BAE\u6863\u4F4D",
  tokenCustom: "\u81EA\u5B9A\u4E49\u6570\u503C",
  tokenEconomy: "\u7ECF\u6D4E \xB7 8,192",
  tokenRecommended: "\u63A8\u8350 \xB7 16,384",
  tokenDeep: "\u6DF1\u5EA6 \xB7 32,768",
  tokenLarge: "\u8D85\u957F \xB7 65,536",
  tokenUltra: "\u8D85\u5927 \xB7 131,072",
  tokenUnlimited: "\u4E0D\u9650\u5236 \xB7 \u7531 Provider \u51B3\u5B9A",
  tokenUnlimitedInput: "\u672A\u53D1\u9001 maxTokens",
  tokenHint: "\u53EF\u9009\u62E9\u5EFA\u8BAE\u6863\u4F4D\uFF0C\u4E5F\u53EF\u76F4\u63A5\u8F93\u5165\u4EFB\u610F\u5B89\u5168\u6574\u6570\uFF1B\u201C\u4E0D\u9650\u5236\u201D\u8868\u793A\u63D2\u4EF6\u4E0D\u53D1\u9001 maxTokens\uFF0C\u6A21\u578B\u6216 Provider \u81EA\u8EAB\u4E0A\u9650\u4ECD\u7136\u751F\u6548\u3002",
  computerUse: "Computer Use 0.5",
  automationSpendGuard: "\u81EA\u52A8\u5316 Token \u4FDD\u62A4",
  automationContextMaxTokens: "\u6BCF\u6B21\u81EA\u52A8\u5316\u8C03\u7528\u7684\u4E0A\u4E0B\u6587\u4E0A\u9650",
  automationContextHint: "\u4EC5\u9650\u5236 Browser/Desktop \u5DE5\u5177\u8F6E\u6B21\u63D0\u4EA4\u7ED9 DeepSeek \u7684\u6A21\u578B\u526F\u672C\uFF1B\u5B8C\u6574 DSH \u4EFB\u52A1\u3001\u622A\u56FE\u4E0E\u62A5\u544A\u4E0D\u4F1A\u5220\u9664\u3002\u63A8\u8350 32,768\uFF0C0 \u8868\u793A\u5B8C\u6574\u91CD\u653E\u3002\u666E\u901A\u6587\u5B57\u548C\u666E\u901A\u56FE\u7247\u4E0D\u53D7\u5F71\u54CD\u3002",
  automationMaxCallsPerTurn: "\u6BCF\u4E2A\u7528\u6237\u6307\u4EE4\u6700\u591A\u6A21\u578B\u8C03\u7528",
  automationMaxCallsHint: "\u63A8\u8350 32\u3002\u8FBE\u5230\u4E0A\u9650\u540E\u505C\u6B62\u81EA\u52A8\u5FAA\u73AF\uFF0C\u53D1\u9001\u65B0\u7684\u7528\u6237\u6307\u4EE4\u5373\u53EF\u7EE7\u7EED\uFF1B0 \u8868\u793A\u4E0D\u9650\u5236\u3002",
  automationContextEconomy: "\u7ECF\u6D4E \xB7 8,192",
  automationContextRecommended: "\u63A8\u8350 \xB7 32,768",
  automationContextComplex: "\u590D\u6742\u4EFB\u52A1 \xB7 65,536",
  automationContextUltra: "\u8D85\u957F\u4EFB\u52A1 \xB7 131,072",
  automationContextUnlimited: "\u4E0D\u9650\u5236 \xB7 \u5B8C\u6574\u4F1A\u8BDD",
  automationContextUnlimitedInput: "\u5B8C\u6574\u91CD\u653E\u4F1A\u8BDD",
  browserComputerUse: "\u542F\u7528\u6D4F\u89C8\u5668 Computer Use",
  browserComputerUseHint: "\u5728\u5F53\u524D\u5BF9\u8BDD\u4E2D\u6CE8\u518C browser \u5DE5\u5177\uFF0C\u6BCF\u4E00\u6B65\u8FD4\u56DE\u6700\u65B0 DOM\u3001\u622A\u56FE\u3001\u72B6\u6001 ID \u548C\u6D4B\u8BD5\u8BC1\u636E\u3002",
  browserHeadless: "\u65E0\u754C\u9762\u8FD0\u884C\u6D4F\u89C8\u5668",
  browserChannel: "\u6D4F\u89C8\u5668\u901A\u9053",
  browserChannelAuto: "\u81EA\u52A8\u53D1\u73B0\uFF08Windows \u4F18\u5148 Edge\uFF09",
  browserChannelEdge: "Microsoft Edge",
  browserChannelChrome: "Google Chrome",
  browserExecutablePath: "\u81EA\u5B9A\u4E49\u6D4F\u89C8\u5668\u8DEF\u5F84",
  browserExecutablePlaceholder: "\u7559\u7A7A\u5219\u4F7F\u7528\u4E0A\u65B9\u901A\u9053\u6216\u81EA\u52A8\u53D1\u73B0",
  browserLocale: "\u6D4F\u89C8\u5668\u8BED\u8A00",
  browserTimeoutMs: "\u52A8\u4F5C\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
  browserSettleMs: "\u64CD\u4F5C\u540E\u7A33\u5B9A\u7B49\u5F85\uFF08\u6BEB\u79D2\uFF09",
  browserViewportWidth: "\u89C6\u53E3\u5BBD\u5EA6",
  browserViewportHeight: "\u89C6\u53E3\u9AD8\u5EA6",
  browserMaxElements: "\u6BCF\u6B65\u6700\u591A\u63A7\u4EF6\u6570",
  browserMaxTextChars: "\u6BCF\u6B65\u6700\u591A\u9875\u9762\u5B57\u7B26",
  desktopComputerUse: "\u542F\u7528 Windows / macOS \u684C\u9762 Computer Use",
  desktopComputerUseHint: "\u5728\u5F53\u524D\u5BF9\u8BDD\u4E2D\u6CE8\u518C computer \u5DE5\u5177\uFF1B\u6BCF\u6B65\u4ECD\u65E0\u635F\u4FDD\u5B58\u622A\u56FE\uFF0C\u4F46\u9ED8\u8BA4\u4F18\u5148\u7528\u8BED\u4E49\u63A7\u4EF6\u548C\u72B6\u6001\u53D8\u5316\u76F4\u8FBE\u6700\u7EC8\u6A21\u578B\uFF0C\u53EA\u6709\u786E\u5B9E\u9700\u8981\u50CF\u7D20\u65F6\u624D\u8C03\u7528\u89C6\u89C9\u6A21\u578B\u3002",
  desktopVisualMode: "\u684C\u9762\u622A\u56FE\u4EA4\u4ED8\u7B56\u7565",
  desktopVisualModeAuto: "\u81EA\u52A8 \xB7 \u8BED\u4E49\u5FEB\u8DEF\u5F84\uFF08\u63A8\u8350\uFF09",
  desktopVisualModeAlways: "\u5B8C\u6574\u5BA1\u8BA1 \xB7 \u6BCF\u6B65\u8BFB\u56FE",
  desktopVisualModeManual: "\u624B\u52A8 \xB7 \u4EC5\u663E\u5F0F\u8BFB\u56FE",
  desktopVisualModeHint: "\u81EA\u52A8\u6A21\u5F0F\u4F1A\u4E3A\u5B8C\u6574\u8BED\u4E49\u72B6\u6001\u548C\u6210\u529F\u52A8\u4F5C\u8DF3\u8FC7\u89C6\u89C9\u8C03\u7528\uFF1B\u6E38\u620F\u3001\u753B\u5E03\u6216\u663E\u5F0F includeScreenshot \u8BF7\u6C42\u4ECD\u8BFB\u53D6\u539F\u59CB\u50CF\u7D20\u3002\u4E09\u79CD\u6A21\u5F0F\u90FD\u4F1A\u4FDD\u5B58\u5B8C\u6574\u65E0\u635F\u622A\u56FE\u3002",
  desktopSemantic: "\u8BFB\u53D6\u7CFB\u7EDF\u65E0\u969C\u788D\u8BED\u4E49\u63A7\u4EF6",
  desktopSemanticHint: "\u542F\u7528\u540E\u53EF\u4F7F\u7528\u7A33\u5B9A\u7684 elementRef \u6267\u884C\u70B9\u51FB\u3001\u8D4B\u503C\u3001\u8C03\u7528\u548C\u65AD\u8A00\uFF1B\u5173\u95ED\u540E\u4FDD\u6301\u7EAF\u622A\u56FE\u5750\u6807\u63A7\u5236\u3002",
  desktopPermissionHint: "macOS \u9996\u6B21\u4F7F\u7528\u65F6\uFF0C\u8BF7\u5728\u300C\u7CFB\u7EDF\u8BBE\u7F6E \u2192 \u9690\u79C1\u4E0E\u5B89\u5168\u6027\u300D\u4E3A\u8FD0\u884C DSH \u7684\u7EC8\u7AEF\u6388\u4E88\u201C\u5C4F\u5E55\u5F55\u5236\u201D\u548C\u201C\u8F85\u52A9\u529F\u80FD\u201D\uFF1BWindows \u4F7F\u7528\u7CFB\u7EDF\u539F\u751F user32 \u4E0E\u684C\u9762\u622A\u56FE\u3002",
  desktopTimeoutMs: "\u684C\u9762\u52A8\u4F5C\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
  desktopSettleMs: "\u684C\u9762\u64CD\u4F5C\u540E\u7B49\u5F85\uFF08\u6BEB\u79D2\uFF09",
  desktopMaxWindows: "\u6BCF\u6B65\u6700\u591A\u7A97\u53E3\u6570",
  desktopMaxElements: "\u6BCF\u6B65\u6700\u591A\u8BED\u4E49\u63A7\u4EF6\u6570",
  desktopMacDisplay: "macOS \u663E\u793A\u5668\u7F16\u53F7",
  desktopWindowsPowerShell: "Windows PowerShell \u8DEF\u5F84",
  desktopWindowsPowerShellPlaceholder: "\u7559\u7A7A\u4F7F\u7528 powershell.exe",
  desktopArtifactsDir: "\u684C\u9762\u6D4B\u8BD5\u8BC1\u636E\u76EE\u5F55",
  desktopArtifactsDirPlaceholder: "\u7559\u7A7A\u4F7F\u7528 DSH \u9ED8\u8BA4\u8BC1\u636E\u76EE\u5F55",
  desktopHistoryLimit: "\u6700\u8FD1 Desktop \u72B6\u6001\u6458\u8981\u6570",
  advanced: "\u9AD8\u7EA7\u8BBE\u7F6E",
  statusReady: "\u89C6\u89C9\u8DEF\u7531\u5143\u6570\u636E\u68C0\u6D4B\u5DF2\u901A\u8FC7",
  statusReadyProbe: "\uFF1B\u53D1\u9001\u9996\u5F20\u56FE\u7247\u65F6\u8FD8\u4F1A\u6267\u884C\u968F\u673A\u50CF\u7D20\u63A2\u9488\u3002",
  statusReadyMetadata: "\uFF1B\u50CF\u7D20\u63A2\u9488\u5F53\u524D\u5DF2\u5173\u95ED\u3002",
  statusPending: "\u89C6\u89C9\u8DEF\u7531\u5C1A\u672A\u5C31\u7EEA\uFF1A\u68C0\u67E5\u6240\u9009\u6A21\u578B\u7684\u56FE\u7247\u58F0\u660E\uFF0C\u6216\u4E3A\u81EA\u5B9A\u4E49\u7F51\u5173\u6253\u5F00\u4E0A\u65B9\u5F00\u5173\u3002",
  statusChecking: "\u6B63\u5728\u68C0\u6D4B\u89C6\u89C9\u8DEF\u7531\u2026",
  refresh: "\u91CD\u65B0\u68C0\u6D4B",
  save: "\u4FDD\u5B58\u5E76\u7ACB\u5373\u5E94\u7528",
  saving: "\u6B63\u5728\u4FDD\u5B58\u2026",
  saved: "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u5E76\u5B9E\u65F6\u751F\u6548\u3002",
  discard: "\u653E\u5F03\u66F4\u6539",
  saveFailed: "\u4FDD\u5B58\u5931\u8D25\uFF1A",
  upstreamRequired: "\u8BF7\u9009\u62E9\u6700\u7EC8\u56DE\u7B54 Provider\u3002",
  recursiveUpstream: "DeepSeekEyes \u4E0D\u80FD\u628A\u81EA\u5DF1\u8BBE\u4E3A\u6700\u7EC8\u56DE\u7B54 Provider\u3002",
  visionProviderRequired: "\u586B\u5199\u89C6\u89C9\u6A21\u578B\u65F6\u5FC5\u987B\u540C\u65F6\u9009\u62E9\u89C6\u89C9 Provider\u3002",
  visionRouteRequired: "\u5173\u95ED\u81EA\u52A8\u68C0\u6D4B\u65F6\u5FC5\u987B\u9009\u62E9\u89C6\u89C9 Provider\u3002",
  visionRoutePriorityFormat: "\u540E\u5907\u89C6\u89C9\u8DEF\u7531\u5FC5\u987B\u6BCF\u884C\u4F7F\u7528 provider/model\u3002",
  visionFailoverAttemptsRange: "\u540E\u5907\u5C1D\u8BD5\u6B21\u6570\u5FC5\u987B\u662F 0\u20138 \u7684\u6574\u6570\u3002",
  visionHealthTtlMsRange: "\u5065\u5EB7\u68C0\u67E5\u7F13\u5B58\u5FC5\u987B\u662F 1000\u20133600000 \u7684\u6574\u6570\u3002",
  visionFailureCooldownMsRange: "\u5931\u8D25\u51B7\u5374\u5FC5\u987B\u662F 0\u20133600000 \u7684\u6574\u6570\u3002",
  visionAttemptLimitRange: "attempts \u4FDD\u7559\u6570\u5FC5\u987B\u662F 10\u201310000 \u7684\u6574\u6570\u3002",
  browserLocaleRequired: "\u6D4F\u89C8\u5668\u8BED\u8A00\u4E0D\u80FD\u4E3A\u7A7A\u3002",
  maxClarificationsRange: "\u8FFD\u95EE\u8F6E\u6570\u5FC5\u987B\u662F 0\u20138 \u7684\u6574\u6570\u3002",
  baseMaxTokensRange: "\u9996\u6B21\u8BFB\u56FE Token \u5FC5\u987B\u4E3A 0\uFF08\u4E0D\u9650\u5236\uFF09\u6216\u81F3\u5C11 512 \u7684\u5B89\u5168\u6574\u6570\u3002",
  targetMaxTokensRange: "\u7EC6\u8282\u8FFD\u95EE Token \u5FC5\u987B\u4E3A 0\uFF08\u4E0D\u9650\u5236\uFF09\u6216\u81F3\u5C11 256 \u7684\u5B89\u5168\u6574\u6570\u3002",
  automationContextMaxTokensRange: "\u81EA\u52A8\u5316\u4E0A\u4E0B\u6587\u5FC5\u987B\u4E3A 0\uFF08\u4E0D\u9650\u5236\uFF09\u6216\u81F3\u5C11 4096 \u7684\u5B89\u5168\u6574\u6570\u3002",
  automationMaxCallsPerTurnRange: "\u6BCF\u4E2A\u7528\u6237\u6307\u4EE4\u7684\u6A21\u578B\u8C03\u7528\u6570\u5FC5\u987B\u662F 0\u201310000 \u7684\u6574\u6570\u3002",
  historyImageLimitRange: "\u5386\u53F2\u56FE\u7247\u5F15\u7528\u6570\u5FC5\u987B\u662F 0\u201332 \u7684\u6574\u6570\u3002",
  historySummaryCharsRange: "\u5386\u53F2\u56FE\u7247\u6458\u8981\u5B57\u7B26\u5FC5\u987B\u662F 64\u20132000 \u7684\u6574\u6570\u3002",
  browserHistoryLimitRange: "Browser \u72B6\u6001\u6458\u8981\u6570\u5FC5\u987B\u662F 0\u201332 \u7684\u6574\u6570\u3002",
  browserTimeoutMsRange: "\u52A8\u4F5C\u8D85\u65F6\u5FC5\u987B\u662F 1000\u2013120000 \u7684\u6574\u6570\u3002",
  browserSettleMsRange: "\u7A33\u5B9A\u7B49\u5F85\u5FC5\u987B\u662F 0\u201310000 \u7684\u6574\u6570\u3002",
  browserViewportWidthRange: "\u89C6\u53E3\u5BBD\u5EA6\u5FC5\u987B\u662F 320\u20133840 \u7684\u6574\u6570\u3002",
  browserViewportHeightRange: "\u89C6\u53E3\u9AD8\u5EA6\u5FC5\u987B\u662F 240\u20132160 \u7684\u6574\u6570\u3002",
  browserMaxElementsRange: "\u63A7\u4EF6\u6570\u91CF\u5FC5\u987B\u662F 20\u2013500 \u7684\u6574\u6570\u3002",
  browserMaxTextCharsRange: "\u9875\u9762\u5B57\u7B26\u6570\u5FC5\u987B\u662F 1000\u2013100000 \u7684\u6574\u6570\u3002",
  desktopHistoryLimitRange: "Desktop \u72B6\u6001\u6458\u8981\u6570\u5FC5\u987B\u662F 0\u201332 \u7684\u6574\u6570\u3002",
  desktopTimeoutMsRange: "\u684C\u9762\u52A8\u4F5C\u8D85\u65F6\u5FC5\u987B\u662F 1000\u2013120000 \u7684\u6574\u6570\u3002",
  desktopSettleMsRange: "\u684C\u9762\u7A33\u5B9A\u7B49\u5F85\u5FC5\u987B\u662F 0\u201310000 \u7684\u6574\u6570\u3002",
  desktopMaxWindowsRange: "\u7A97\u53E3\u6570\u91CF\u5FC5\u987B\u662F 1\u2013200 \u7684\u6574\u6570\u3002",
  desktopMaxElementsRange: "\u8BED\u4E49\u63A7\u4EF6\u6570\u91CF\u5FC5\u987B\u662F 20\u2013500 \u7684\u6574\u6570\u3002",
  desktopMacDisplayRange: "macOS \u663E\u793A\u5668\u7F16\u53F7\u5FC5\u987B\u662F 1\u201332 \u7684\u6574\u6570\u3002",
  desktopVisualModeInvalid: "\u684C\u9762\u622A\u56FE\u4EA4\u4ED8\u7B56\u7565\u65E0\u6548\u3002",
  noProviders: "Harness \u4E2D\u8FD8\u6CA1\u6709\u53EF\u7528 Provider\uFF0C\u8BF7\u5148\u5728\u300C\u8BBE\u7F6E \u2192 \u6A21\u578B\u300D\u6DFB\u52A0\u3002",
  inactive: "\uFF08\u672A\u6FC0\u6D3B\uFF09"
};
var en = {
  title: "DeepSeekEyes",
  version: "Version",
  description: "Give DeepSeek a visual model in the same conversation, with follow-up access to the original image.",
  expand: "Expand",
  collapse: "Collapse",
  unsaved: "Unsaved",
  loading: "Loading Harness model settings\u2026",
  unavailable: "The Host has not exposed the DeepSeekEyes settings namespace.",
  readOnly: "The settings document is read-only.",
  upstreamProvider: "Final answer provider",
  upstreamModel: "Final answer model",
  upstreamModelPlaceholder: "Choose or type a model ID; blank keeps all text models for compatibility",
  upstreamHint: "Reads visual evidence, reasons, and sends the final reply to the user.",
  visionProvider: "Background vision provider",
  visionProviderAuto: "Automatically scan vision models",
  visionHint: "Only reads original images and answers detail requests from the final model.",
  visionModel: "Background vision model",
  visionModelPlaceholder: "Choose or type a model ID; blank selects the first visual model",
  routeSummary: "Current route: image \u2192 {vision} reads it \u2192 {final} gives the final answer",
  automaticVision: "auto-detected vision model",
  allTextModels: "conversation-selected model from this provider",
  declareVision: "Declare image input for this custom gateway",
  declareVisionHint: "Writes llm-pi-ai defaultInput: [text, image] on save; no manual settings.yaml edit.",
  catalogManaged: "Image capability is managed by this provider\u2019s built-in catalog and rechecked by the Host.",
  autoDetect: "Auto-detect when no vision provider is selected",
  activeProbe: "Run a randomized pixel probe on first use",
  activeProbeHint: "Sends a randomized 3\xD73 grid to prove the model actually reads pixels.",
  visionReliability: "Vision route reliability",
  visionRoutePriority: "Fallback vision route priority",
  visionRoutePriorityPlaceholder: "One provider/model per line; model IDs may contain additional / characters",
  visionRoutePriorityHint: "Tried in order after the primary route; auto-detection may append other visual models.",
  visionHealthCheck: "Enable route health checks and circuit breaking",
  visionHealthCheckHint: "Caches capability checks, cools down failed routes, and records every selection and failover.",
  visionFailoverAttempts: "Maximum fallback attempts",
  visionHealthTtlMs: "Health-check cache (ms)",
  visionFailureCooldownMs: "Failed-route cooldown (ms)",
  visionAttemptLog: "Record vision route attempts",
  visionAttemptLogHint: "Stores provider, model, status, duration, error code, and a hashed session ID\u2014never prompts or image bytes.",
  visionAttemptLimit: "Maximum retained attempts",
  persistentEvidence: "Persist visual evidence cache",
  usageStats: "Record DeepSeekEyes token usage",
  usageStatsTitle: "Token usage statistics",
  usageStatsHint: "Exact values come from provider usage, including every DeepSeek call caused by Computer Use. Bridge input and avoided replay are estimated with the Harness fixed-density rule. Reading statistics uses local RPC and makes no model call.",
  usageStatsDisabled: "Statistics are disabled; no new usage is recorded while disabled.",
  usageStatsLoading: "Loading token statistics\u2026",
  usageStatsUnavailable: "Token statistics failed: ",
  usagePersistenceError: "The statistics file is temporarily unavailable; this process is still counting in memory: ",
  usageExactAdditional: "Exact additional tokens",
  usageEstimatedBridge: "Estimated bridge input",
  usageEstimatedTotal: "Estimated plugin total",
  usageVision: "Vision model tokens",
  usageClarification: "DeepSeek clarification tokens",
  usageAutomation: "Computer Use DeepSeek tokens",
  usageAutomationTurns: "Automation user instructions",
  usageContextCompactions: "Context guard activations",
  usageInputSaved: "Estimated replay input avoided",
  usageLimitStops: "Budget guard stops",
  usageVisualTurns: "Visual turns",
  usageLookCalls: "On-demand original reads",
  usageCacheHits: "Visual cache hits",
  usageFinalExcluded: "The single final answer for an ordinary visual turn remains separate. Every DeepSeek call caused by Browser/Desktop Computer Use is included in plugin overhead.",
  usageUpdatedAt: "Updated: ",
  usageRefresh: "Refresh statistics",
  usageReset: "Reset statistics",
  usageResetConfirm: "Reset all accumulated DeepSeekEyes token statistics?",
  maxClarifications: "Maximum clarification rounds",
  baseMaxTokens: "Initial vision token limit",
  targetMaxTokens: "Clarification token limit",
  historyImageLimit: "Recent image references",
  historySummaryChars: "History summary characters",
  browserHistoryLimit: "Recent browser state summaries",
  historyBudgetHint: "Old images retain their original attachment and hash while only a bounded short summary reaches the model. deepseekeyes_look rereads original pixels on demand. Zero excludes old entries from model context.",
  tokenPreset: "Suggested tier",
  tokenCustom: "Custom value",
  tokenEconomy: "Economy \xB7 8,192",
  tokenRecommended: "Recommended \xB7 16,384",
  tokenDeep: "Deep \xB7 32,768",
  tokenLarge: "Long \xB7 65,536",
  tokenUltra: "Ultra \xB7 131,072",
  tokenUnlimited: "Unlimited \xB7 provider managed",
  tokenUnlimitedInput: "maxTokens omitted",
  tokenHint: "Choose a suggested tier or enter any safe integer. Unlimited omits maxTokens; the model or provider may still impose its own limit.",
  computerUse: "Computer Use 0.5",
  automationSpendGuard: "Automation token guard",
  automationContextMaxTokens: "Context limit per automation call",
  automationContextHint: "Applies only to the model-facing copy of Browser/Desktop tool turns. The full DSH task, screenshots and reports remain preserved. Recommended: 32,768. Zero replays the full context. Ordinary text and image turns are unchanged.",
  automationMaxCallsPerTurn: "Maximum model calls per user instruction",
  automationMaxCallsHint: "Recommended: 32. The loop stops at the limit and a new user instruction can continue. Zero is unlimited.",
  automationContextEconomy: "Economy \xB7 8,192",
  automationContextRecommended: "Recommended \xB7 32,768",
  automationContextComplex: "Complex \xB7 65,536",
  automationContextUltra: "Ultra \xB7 131,072",
  automationContextUnlimited: "Unlimited \xB7 full context",
  automationContextUnlimitedInput: "Full context replay",
  browserComputerUse: "Enable browser computer use",
  browserComputerUseHint: "Registers the browser tool in this conversation and returns fresh DOM, screenshot, state ID, and test evidence after every step.",
  browserHeadless: "Run browser headless",
  browserChannel: "Browser channel",
  browserChannelAuto: "Auto-detect (Edge first on Windows)",
  browserChannelEdge: "Microsoft Edge",
  browserChannelChrome: "Google Chrome",
  browserExecutablePath: "Custom browser path",
  browserExecutablePlaceholder: "Blank uses the selected channel or auto-detection",
  browserLocale: "Browser locale",
  browserTimeoutMs: "Action timeout (ms)",
  browserSettleMs: "Post-action settle (ms)",
  browserViewportWidth: "Viewport width",
  browserViewportHeight: "Viewport height",
  browserMaxElements: "Maximum controls per step",
  browserMaxTextChars: "Maximum page characters per step",
  desktopComputerUse: "Enable Windows / macOS desktop computer use",
  desktopComputerUseHint: "Registers the computer tool in this conversation. Every step still preserves a lossless screenshot, while the default fast path sends semantic controls and state changes directly to the final model and invokes vision only when pixels are needed.",
  desktopVisualMode: "Desktop screenshot delivery",
  desktopVisualModeAuto: "Auto \xB7 semantic fast path (recommended)",
  desktopVisualModeAlways: "Full audit \xB7 read every step",
  desktopVisualModeManual: "Manual \xB7 explicit reads only",
  desktopVisualModeHint: "Auto skips visual calls for complete semantic states and successful actions. Games, canvases, and explicit includeScreenshot requests still read original pixels. Every mode preserves the full lossless screenshot.",
  desktopSemantic: "Read accessibility controls",
  desktopSemanticHint: "Enables stable elementRef click, value, invoke, action, and assertion operations. Disable it for screenshot-only coordinate control.",
  desktopPermissionHint: "On first use, grant Screen Recording and Accessibility to the terminal running DSH under macOS System Settings \u2192 Privacy & Security. Windows uses native user32 input and desktop capture.",
  desktopTimeoutMs: "Desktop action timeout (ms)",
  desktopSettleMs: "Desktop post-action settle (ms)",
  desktopMaxWindows: "Maximum windows per step",
  desktopMaxElements: "Maximum semantic controls per step",
  desktopMacDisplay: "macOS display number",
  desktopWindowsPowerShell: "Windows PowerShell path",
  desktopWindowsPowerShellPlaceholder: "Blank uses powershell.exe",
  desktopArtifactsDir: "Desktop evidence directory",
  desktopArtifactsDirPlaceholder: "Blank uses the DSH evidence default",
  desktopHistoryLimit: "Recent desktop state summaries",
  advanced: "Advanced settings",
  statusReady: "Vision route metadata check passed",
  statusReadyProbe: "; the first image will also run the randomized pixel probe.",
  statusReadyMetadata: "; the pixel probe is disabled.",
  statusPending: "Vision route is not ready. Check image declarations or enable the custom-gateway switch above.",
  statusChecking: "Checking the vision route\u2026",
  refresh: "Check again",
  save: "Save and apply now",
  saving: "Saving\u2026",
  saved: "Settings saved and applied live.",
  discard: "Discard changes",
  saveFailed: "Save failed: ",
  upstreamRequired: "Choose a final answer provider.",
  recursiveUpstream: "DeepSeekEyes cannot use itself as the final answer provider.",
  visionProviderRequired: "A vision model requires a vision provider.",
  visionRouteRequired: "Choose a vision provider when auto-detection is off.",
  visionRoutePriorityFormat: "Each fallback route must use provider/model.",
  visionFailoverAttemptsRange: "Fallback attempts must be an integer from 0 through 8.",
  visionHealthTtlMsRange: "Health-check cache must be an integer from 1000 through 3600000.",
  visionFailureCooldownMsRange: "Failure cooldown must be an integer from 0 through 3600000.",
  visionAttemptLimitRange: "Retained attempts must be an integer from 10 through 10000.",
  browserLocaleRequired: "Browser locale must be non-empty.",
  maxClarificationsRange: "Clarification rounds must be an integer from 0 through 8.",
  baseMaxTokensRange: "Initial vision tokens must be 0 (unlimited) or a safe integer of at least 512.",
  targetMaxTokensRange: "Clarification tokens must be 0 (unlimited) or a safe integer of at least 256.",
  automationContextMaxTokensRange: "Automation context must be 0 (unlimited) or a safe integer of at least 4096.",
  automationMaxCallsPerTurnRange: "Model calls per user instruction must be an integer from 0 through 10000.",
  historyImageLimitRange: "Historical image references must be an integer from 0 through 32.",
  historySummaryCharsRange: "Historical image summary characters must be an integer from 64 through 2000.",
  browserHistoryLimitRange: "Browser state summaries must be an integer from 0 through 32.",
  browserTimeoutMsRange: "Action timeout must be an integer from 1000 through 120000.",
  browserSettleMsRange: "Settle time must be an integer from 0 through 10000.",
  browserViewportWidthRange: "Viewport width must be an integer from 320 through 3840.",
  browserViewportHeightRange: "Viewport height must be an integer from 240 through 2160.",
  browserMaxElementsRange: "Maximum controls must be an integer from 20 through 500.",
  browserMaxTextCharsRange: "Maximum page characters must be an integer from 1000 through 100000.",
  desktopHistoryLimitRange: "Desktop state summaries must be an integer from 0 through 32.",
  desktopTimeoutMsRange: "Desktop action timeout must be an integer from 1000 through 120000.",
  desktopSettleMsRange: "Desktop settle time must be an integer from 0 through 10000.",
  desktopMaxWindowsRange: "Maximum windows must be an integer from 1 through 200.",
  desktopMaxElementsRange: "Maximum semantic controls must be an integer from 20 through 500.",
  desktopMacDisplayRange: "The macOS display number must be an integer from 1 through 32.",
  desktopVisualModeInvalid: "The desktop screenshot delivery mode is invalid.",
  noProviders: "No provider is available in Harness. Add one under Settings \u2192 Models first.",
  inactive: " (inactive)"
};
var styles = {
  card: { listStyle: "none", border: "1px solid var(--dsw-alias-border-l2, var(--border-color, #d9dee8))", borderRadius: 12, background: "var(--dsw-alias-bg-layer-3, var(--card-bg, #fff))", color: "var(--dsw-alias-label-primary, var(--text-primary, #172033))", overflow: "hidden", transition: "border-color .16s, background .16s" },
  cardOpen: { background: "var(--dsw-alias-bg-layer-2, var(--card-bg, #fff))", borderColor: "var(--dsw-alias-label-dimmed, var(--border-color, #ccd3df))" },
  summary: { padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4 },
  header: { appearance: "none", width: "100%", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", background: "transparent", border: 0, borderRadius: 12, display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" },
  headText: { minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 4 },
  titleRow: { minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: "var(--dsw-alias-label-primary, var(--text-primary, #172033))" },
  version: { flex: "none", border: "1px solid var(--dsw-alias-border-l2, var(--border-color, #d9dee8))", borderRadius: 999, padding: "0 7px", fontSize: 11, fontWeight: 500, lineHeight: "18px", fontVariantNumeric: "tabular-nums", background: "var(--dsw-alias-bg-module-platform, rgba(127, 127, 127, .08))", color: "var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))" },
  description: { fontSize: 13, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))" },
  chevron: { width: 14, height: 14, flex: "none", color: "var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))", transition: "transform .16s" },
  chevronOpen: { transform: "rotate(180deg)" },
  pending: { whiteSpace: "nowrap", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 500, lineHeight: "17px", background: "var(--dsw-alias-bg-module-platform, rgba(127, 127, 127, .10))", color: "var(--dsw-alias-label-secondary, var(--text-primary, #172033))" },
  body: { borderTop: "1px solid var(--dsw-alias-border-l2, var(--border-color, #e4e7ec))", margin: "0 16px", padding: "12px 0 8px", display: "grid", gap: 16 },
  field: { display: "grid", gap: 7, alignContent: "start", minWidth: 0 },
  label: { fontSize: 14, fontWeight: 400, lineHeight: 1.5, color: "var(--dsw-alias-label-primary, var(--text-primary, #172033))" },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))" },
  input: { width: "100%", height: 36, minHeight: 36, boxSizing: "border-box", border: "1px solid var(--dsw-alias-border-l2, var(--border-color, #ccd3df))", borderRadius: 8, padding: "0 12px", fontSize: 13, lineHeight: 1.5, color: "var(--dsw-alias-label-primary, var(--text-primary, #172033))", background: "var(--dsw-alias-bg-layer-3, var(--input-bg, #fff))", colorScheme: "inherit" },
  checkboxRow: { display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, color: "var(--dsw-alias-label-primary, var(--text-primary, #172033))" },
  statusOk: { margin: 0, padding: "10px 12px", borderRadius: 8, background: "rgba(34, 197, 94, .10)", color: "var(--dsw-alias-state-success-primary, var(--success-color, #15803d))", fontSize: 12, lineHeight: 1.5 },
  statusWarn: { margin: 0, padding: "10px 12px", borderRadius: 8, background: "rgba(245, 158, 11, .10)", color: "var(--dsw-alias-state-warn-primary, var(--warning-color, #a16207))", fontSize: 12, lineHeight: 1.5 },
  statusError: { margin: 0, padding: "10px 12px", borderRadius: 8, background: "rgba(242, 90, 90, .10)", color: "var(--dsw-alias-state-error-primary, var(--danger-color, #b91c1c))", fontSize: 12, lineHeight: 1.5 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 9, flexWrap: "wrap" },
  button: { minHeight: 32, borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2, var(--border-color, #ccd3df))", padding: "5px 14px", background: "transparent", color: "var(--dsw-alias-label-secondary, var(--text-primary, #172033))", cursor: "pointer" },
  primary: { minHeight: 32, borderRadius: 8, border: 0, padding: "5px 14px", background: "var(--dsw-alias-button-primary-fill, var(--accent-color, #4f46e5))", color: "var(--dsw-alias-label-primary-foreground, #fff)", cursor: "pointer" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", alignItems: "start", gap: 14 },
  tokenGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", alignItems: "start", gap: 10 },
  details: { borderTop: "1px solid var(--dsw-alias-border-l2, var(--border-color, #e4e7ec))", paddingTop: 12 },
  detailsSummary: { cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 14, color: "var(--dsw-alias-label-primary, var(--text-primary, #172033))" },
  divider: { height: 1, margin: "18px 0", background: "var(--dsw-alias-border-l2, var(--border-color, #e4e7ec))" },
  metricGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 },
  metric: { minWidth: 0, padding: "11px 12px", border: "1px solid var(--dsw-alias-border-l2, var(--border-color, #e4e7ec))", borderRadius: 9, background: "var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, .04))" },
  metricValue: { display: "block", fontSize: 18, fontWeight: 650, lineHeight: 1.25, fontVariantNumeric: "tabular-nums", color: "var(--dsw-alias-label-primary, var(--text-primary, #172033))" },
  metricLabel: { display: "block", marginTop: 4, fontSize: 11, lineHeight: 1.4, color: "var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))" }
};
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function numberFrom(event) {
  const value = Number(event.target.value);
  return Number.isFinite(value) ? value : event.target.value;
}
var TOKEN_PRESETS = Object.freeze([
  { value: 8192, label: "tokenEconomy" },
  { value: 16384, label: "tokenRecommended" },
  { value: 32768, label: "tokenDeep" },
  { value: 65536, label: "tokenLarge" },
  { value: 131072, label: "tokenUltra" },
  { value: 0, label: "tokenUnlimited" }
]);
var AUTOMATION_CONTEXT_PRESETS = Object.freeze([
  { value: 8192, label: "automationContextEconomy" },
  { value: 32768, label: "automationContextRecommended" },
  { value: 65536, label: "automationContextComplex" },
  { value: 131072, label: "automationContextUltra" },
  { value: 0, label: "automationContextUnlimited" }
]);
function TokenBudgetField({
  id,
  label,
  minimum,
  value,
  disabled,
  onChange,
  t,
  presets = TOKEN_PRESETS,
  hint = "tokenHint",
  unlimitedInput = "tokenUnlimitedInput"
}) {
  const preset = presets.find((item) => item.value === value);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: id, children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.tokenGrid, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "select",
        {
          "aria-label": t("tokenPreset"),
          style: styles.input,
          value: preset === void 0 ? "custom" : String(preset.value),
          disabled,
          onChange: (event) => {
            if (event.target.value !== "custom") onChange(Number(event.target.value));
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "custom", disabled: preset !== void 0, children: t("tokenCustom") }),
            presets.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: item.value, children: t(item.label) }, item.value))
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          id,
          "aria-label": t("tokenCustom"),
          style: styles.input,
          type: "number",
          min: minimum,
          step: "1",
          value: value === 0 ? "" : value,
          placeholder: value === 0 ? t(unlimitedInput) : void 0,
          disabled: disabled || value === 0,
          onChange: (event) => onChange(numberFrom(event))
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t(hint) })
  ] });
}
function modelName(group, modelId, fallback) {
  if (modelId === "") return fallback;
  return group?.models?.find((model) => model.id === modelId)?.name ?? modelId;
}
function routeSummary(template, vision, final) {
  return template.replace("{vision}", vision).replace("{final}", final);
}
function formatCount(value) {
  return new Intl.NumberFormat().format(Number.isFinite(value) ? value : 0);
}
function UsageMetric({ label, value }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.metric, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: styles.metricValue, children: formatCount(value) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.metricLabel, children: label })
  ] });
}
function DeepSeekEyesSettingsCard({ scope, api, usageRpc, t }) {
  const snapshot = (0, import_react.useSyncExternalStore)(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot()
  );
  const [open, setOpen] = (0, import_react.useState)(false);
  const [draft, setDraft] = (0, import_react.useState)(() => normalizeSettingsDraft(snapshot.value));
  const [dirty, setDirty] = (0, import_react.useState)(false);
  const [saving, setSaving] = (0, import_react.useState)(false);
  const [notice, setNotice] = (0, import_react.useState)(void 0);
  const [catalog, setCatalog] = (0, import_react.useState)({ loading: true, providers: [], groups: [], namespaces: [], failures: [], error: void 0 });
  const [declareVision, setDeclareVision] = (0, import_react.useState)(false);
  const [declarationDirty, setDeclarationDirty] = (0, import_react.useState)(false);
  const [usage, setUsage] = (0, import_react.useState)({ loading: true, value: void 0, error: void 0 });
  (0, import_react.useEffect)(() => {
    if (snapshot.status === "ready" && !dirty) setDraft(normalizeSettingsDraft(snapshot.value));
  }, [snapshot.status, snapshot.revision, snapshot.value, dirty]);
  const loadCatalog = (0, import_react.useCallback)(async () => {
    setCatalog((current) => ({ ...current, loading: true, error: void 0 }));
    try {
      const [providersResponse, modelsResponse, settingsResponse] = await Promise.all([
        api.llm.providers({}),
        api.llm.models({}),
        api.settings.describe({})
      ]);
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message);
      if (!modelsResponse.result.ok) throw new Error(modelsResponse.result.error.message);
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message);
      setCatalog({
        loading: false,
        providers: providersResponse.result.value.providers,
        groups: modelsResponse.result.value.groups,
        failures: modelsResponse.result.value.failures,
        namespaces: settingsResponse.result.value.namespaces,
        error: void 0
      });
    } catch (error) {
      setCatalog((current) => ({ ...current, loading: false, error: messageOf(error) }));
    }
  }, [api]);
  (0, import_react.useEffect)(() => {
    void loadCatalog();
  }, [loadCatalog, snapshot.revision]);
  const loadUsage = (0, import_react.useCallback)(async () => {
    setUsage((current) => ({ ...current, loading: true, error: void 0 }));
    try {
      const response = await usageRpc.call("/deepseekeyes", "usage.snapshot", {});
      if (!response.ok) throw new Error(response.error.message);
      setUsage({ loading: false, value: response.value, error: void 0 });
    } catch (error) {
      setUsage({ loading: false, value: void 0, error: messageOf(error) });
    }
  }, [usageRpc]);
  const resetUsage = (0, import_react.useCallback)(async () => {
    if (globalThis.confirm?.(t("usageResetConfirm")) === false) return;
    setUsage((current) => ({ ...current, loading: true, error: void 0 }));
    try {
      const response = await usageRpc.call("/deepseekeyes", "usage.reset", { confirm: true });
      if (!response.ok) throw new Error(response.error.message);
      setUsage({ loading: false, value: response.value, error: void 0 });
    } catch (error) {
      setUsage({ loading: false, value: void 0, error: messageOf(error) });
    }
  }, [t, usageRpc]);
  (0, import_react.useEffect)(() => {
    void loadUsage();
  }, [loadUsage]);
  const providers = (0, import_react.useMemo)(() => {
    const selected = /* @__PURE__ */ new Set([draft.upstreamProvider, draft.visionProvider]);
    return catalog.providers.filter((entry) => entry.provider !== PROVIDER_ID && (entry.active || selected.has(entry.provider)));
  }, [catalog.providers, draft.upstreamProvider, draft.visionProvider]);
  const upstreamGroup = (0, import_react.useMemo)(
    () => catalog.groups.find((group) => group.id === draft.upstreamProvider),
    [catalog.groups, draft.upstreamProvider]
  );
  const visionGroup = (0, import_react.useMemo)(
    () => catalog.groups.find((group) => group.id === draft.visionProvider),
    [catalog.groups, draft.visionProvider]
  );
  const visionTarget = (0, import_react.useMemo)(
    () => providerSettingsTarget(catalog.providers, draft.visionProvider),
    [catalog.providers, draft.visionProvider]
  );
  const storedDeclaration = (0, import_react.useMemo)(
    () => providerDeclaresVision(catalog.namespaces, visionTarget),
    [catalog.namespaces, visionTarget]
  );
  (0, import_react.useEffect)(() => {
    if (!declarationDirty) setDeclareVision(storedDeclaration);
  }, [storedDeclaration, declarationDirty, draft.visionProvider]);
  const update = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setNotice(void 0);
  };
  const updateProvider = (providerField, modelField, value) => {
    setDraft((current) => ({ ...current, [providerField]: value, [modelField]: "" }));
    setDirty(true);
    setNotice(void 0);
  };
  const failureKey = settingsDraftFailure(draft, PROVIDER_ID);
  const readyGroup = catalog.groups.find((group) => group.id === PROVIDER_ID && group.models.length > 0);
  const selectedFailure = catalog.failures.find((item) => item.id === draft.visionProvider || item.id === draft.upstreamProvider);
  const saveBlocked = saving || snapshot.status !== "ready" || !snapshot.writable || failureKey !== void 0 || !dirty && !declarationDirty;
  const finalRouteName = modelName(upstreamGroup, draft.upstreamModel, t("allTextModels"));
  const visionRouteName = modelName(visionGroup, draft.visionModel, t("automaticVision"));
  const discard = () => {
    setDraft(normalizeSettingsDraft(snapshot.value));
    setDeclareVision(storedDeclaration);
    setDirty(false);
    setDeclarationDirty(false);
    setNotice(void 0);
  };
  const save = async () => {
    if (saveBlocked) return;
    setSaving(true);
    setNotice(void 0);
    try {
      if (declarationDirty) {
        const mutation = providerVisionMutation(catalog.namespaces, visionTarget, declareVision);
        if (mutation !== void 0) {
          const result = await api.settings.mutate(mutation);
          if (!result.result.ok) throw new Error(result.result.error.message);
        }
      }
      const ops = settingsPathOps(snapshot.value, draft);
      if (ops.length > 0) {
        const response = await api.settings.mutate({
          ns: "deepseekeyes",
          ops,
          ...snapshot.revision === void 0 ? {} : { expectedRevision: snapshot.revision }
        });
        if (!response.result.ok) throw new Error(response.result.error.message);
      }
      setDirty(false);
      setDeclarationDirty(false);
      setNotice({ kind: "ok", text: t("saved") });
      await new Promise((resolve) => setTimeout(resolve, 180));
      await Promise.all([loadCatalog(), loadUsage()]);
    } catch (error) {
      setNotice({ kind: "error", text: `${t("saveFailed")}${messageOf(error)}` });
    } finally {
      setSaving(false);
    }
  };
  if (snapshot.status === "loading") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { style: styles.card, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.summary, children: t("loading") }) });
  }
  if (snapshot.status !== "ready") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { style: styles.card, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.summary, children: t("unavailable") }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { style: { ...styles.card, ...open ? styles.cardOpen : {} }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        style: styles.header,
        "aria-expanded": open,
        "aria-controls": "deepseekeyes-settings-body",
        "aria-label": `${t(open ? "collapse" : "expand")}: ${t("title")} v${PLUGIN_VERSION}`,
        onClick: () => setOpen((current) => !current),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.headText, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.titleRow, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.title, children: t("title") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.version, "aria-label": `${t("version")}: ${PLUGIN_VERSION}`, children: [
                "v",
                PLUGIN_VERSION
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.description, children: t("description") })
          ] }),
          dirty || declarationDirty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.pending, children: t("unsaved") }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "svg",
            {
              "data-deepseekeyes-chevron": "",
              "aria-hidden": "true",
              viewBox: "0 0 14 14",
              width: "14",
              height: "14",
              style: { ...styles.chevron, ...open ? styles.chevronOpen : {} },
              children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m3.5 5.25 3.5 3.5 3.5-3.5", fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1.25" })
            }
          )
        ]
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { id: "deepseekeyes-settings-body", style: styles.body, children: [
      !snapshot.writable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.statusWarn, children: t("readOnly") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.grid, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-upstream", children: t("upstreamProvider") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "select",
            {
              id: "deepseekeyes-upstream",
              style: styles.input,
              value: draft.upstreamProvider,
              disabled: saving || !snapshot.writable,
              onChange: (event) => updateProvider("upstreamProvider", "upstreamModel", event.target.value),
              children: [
                providers.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: t("noProviders") }) : null,
                !providers.some((item) => item.provider === draft.upstreamProvider) && draft.upstreamProvider !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: draft.upstreamProvider, children: draft.upstreamProvider }) : null,
                providers.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: item.provider, children: [
                  item.displayName,
                  " (",
                  item.provider,
                  ")",
                  item.active ? "" : t("inactive")
                ] }, item.provider))
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t("upstreamHint") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-upstream-model", children: t("upstreamModel") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: "deepseekeyes-upstream-model",
              list: "deepseekeyes-upstream-models",
              style: styles.input,
              type: "text",
              value: draft.upstreamModel,
              placeholder: t("upstreamModelPlaceholder"),
              disabled: saving || !snapshot.writable || draft.upstreamProvider === "",
              onChange: (event) => update("upstreamModel", event.target.value)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("datalist", { id: "deepseekeyes-upstream-models", children: (upstreamGroup?.models ?? []).map((model) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: model.id, children: model.name }, model.id)) })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.grid, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-vision-provider", children: t("visionProvider") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "select",
            {
              id: "deepseekeyes-vision-provider",
              style: styles.input,
              value: draft.visionProvider,
              disabled: saving || !snapshot.writable,
              onChange: (event) => {
                updateProvider("visionProvider", "visionModel", event.target.value);
                setDeclarationDirty(false);
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: t("visionProviderAuto") }),
                providers.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: item.provider, children: [
                  item.displayName,
                  " (",
                  item.provider,
                  ")",
                  item.active ? "" : t("inactive")
                ] }, item.provider))
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t("visionHint") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-vision-model", children: t("visionModel") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: "deepseekeyes-vision-model",
              list: "deepseekeyes-vision-models",
              style: styles.input,
              type: "text",
              value: draft.visionModel,
              placeholder: t("visionModelPlaceholder"),
              disabled: saving || !snapshot.writable || draft.visionProvider === "",
              onChange: (event) => update("visionModel", event.target.value)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("datalist", { id: "deepseekeyes-vision-models", children: (visionGroup?.models ?? []).map((model) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: model.id, children: model.name }, model.id)) })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.statusOk, children: routeSummary(t("routeSummary"), visionRouteName, finalRouteName) }),
      draft.visionProvider !== "" && visionTarget !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.checkboxRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "checkbox",
              checked: declareVision,
              disabled: saving || !snapshot.writable,
              onChange: (event) => {
                setDeclareVision(event.target.checked);
                setDeclarationDirty(true);
                setNotice(void 0);
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("declareVision") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t("declareVisionHint") })
      ] }) : draft.visionProvider !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t("catalogManaged") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.checkboxRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: draft.autoDetectVision,
            disabled: saving || !snapshot.writable,
            onChange: (event) => update("autoDetectVision", event.target.checked)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("autoDetect") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.checkboxRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: draft.activeProbe,
            disabled: saving || !snapshot.writable,
            onChange: (event) => update("activeProbe", event.target.checked)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          t("activeProbe"),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { style: styles.hint, children: t("activeProbeHint") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: styles.details, open: true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { style: styles.detailsSummary, children: t("visionReliability") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-vision-priority", children: t("visionRoutePriority") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "textarea",
            {
              id: "deepseekeyes-vision-priority",
              style: { ...styles.input, minHeight: 78, height: "auto", padding: "8px 12px", resize: "vertical" },
              value: draft.visionRoutePriority,
              placeholder: t("visionRoutePriorityPlaceholder"),
              disabled: saving || !snapshot.writable,
              onChange: (event) => update("visionRoutePriority", event.target.value)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t("visionRoutePriorityHint") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { ...styles.checkboxRow, marginTop: 12 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.visionHealthCheck, disabled: saving || !snapshot.writable, onChange: (event) => update("visionHealthCheck", event.target.checked) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            t("visionHealthCheck"),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { style: styles.hint, children: t("visionHealthCheckHint") })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.grid, marginTop: 14 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-failover-attempts", children: t("visionFailoverAttempts") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-failover-attempts", style: styles.input, type: "number", min: "0", max: "8", step: "1", value: draft.visionFailoverAttempts, disabled: saving || !snapshot.writable, onChange: (event) => update("visionFailoverAttempts", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-health-ttl", children: t("visionHealthTtlMs") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-health-ttl", style: styles.input, type: "number", min: "1000", max: "3600000", step: "1", value: draft.visionHealthTtlMs, disabled: saving || !snapshot.writable || !draft.visionHealthCheck, onChange: (event) => update("visionHealthTtlMs", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-failure-cooldown", children: t("visionFailureCooldownMs") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-failure-cooldown", style: styles.input, type: "number", min: "0", max: "3600000", step: "1", value: draft.visionFailureCooldownMs, disabled: saving || !snapshot.writable || !draft.visionHealthCheck, onChange: (event) => update("visionFailureCooldownMs", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-attempt-limit", children: t("visionAttemptLimit") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-attempt-limit", style: styles.input, type: "number", min: "10", max: "10000", step: "1", value: draft.visionAttemptLimit, disabled: saving || !snapshot.writable || !draft.visionAttemptLog, onChange: (event) => update("visionAttemptLimit", numberFrom(event)) })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { ...styles.checkboxRow, marginTop: 12 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.visionAttemptLog, disabled: saving || !snapshot.writable, onChange: (event) => update("visionAttemptLog", event.target.checked) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            t("visionAttemptLog"),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { style: styles.hint, children: t("visionAttemptLogHint") })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: styles.details, open: true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { style: styles.detailsSummary, children: t("computerUse") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: styles.label, children: t("automationSpendGuard") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            TokenBudgetField,
            {
              id: "deepseekeyes-automation-context-tokens",
              label: t("automationContextMaxTokens"),
              minimum: 4096,
              value: draft.automationContextMaxTokens,
              disabled: saving || !snapshot.writable,
              onChange: (value) => update("automationContextMaxTokens", value),
              t,
              presets: AUTOMATION_CONTEXT_PRESETS,
              hint: "automationContextHint",
              unlimitedInput: "automationContextUnlimitedInput"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.field, marginTop: 10 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-automation-max-calls", children: t("automationMaxCallsPerTurn") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                id: "deepseekeyes-automation-max-calls",
                style: styles.input,
                type: "number",
                min: "0",
                max: "10000",
                step: "1",
                value: draft.automationMaxCallsPerTurn,
                disabled: saving || !snapshot.writable,
                onChange: (event) => update("automationMaxCallsPerTurn", numberFrom(event))
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { style: styles.hint, children: t("automationMaxCallsHint") })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.divider }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.checkboxRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "checkbox",
              checked: draft.browserComputerUse,
              disabled: saving || !snapshot.writable,
              onChange: (event) => update("browserComputerUse", event.target.checked)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            t("browserComputerUse"),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { style: styles.hint, children: t("browserComputerUseHint") })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { ...styles.checkboxRow, marginTop: 12 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "checkbox",
              checked: draft.browserHeadless,
              disabled: saving || !snapshot.writable || !draft.browserComputerUse,
              onChange: (event) => update("browserHeadless", event.target.checked)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("browserHeadless") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.grid, marginTop: 14 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-browser-channel", children: t("browserChannel") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { id: "deepseekeyes-browser-channel", style: styles.input, value: draft.browserChannel, disabled: saving || !snapshot.writable || !draft.browserComputerUse, onChange: (event) => update("browserChannel", event.target.value), children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: t("browserChannelAuto") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "msedge", children: t("browserChannelEdge") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "chrome", children: t("browserChannelChrome") })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-browser-executable", children: t("browserExecutablePath") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-browser-executable", style: styles.input, type: "text", value: draft.browserExecutablePath, placeholder: t("browserExecutablePlaceholder"), disabled: saving || !snapshot.writable || !draft.browserComputerUse, onChange: (event) => update("browserExecutablePath", event.target.value) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-browser-locale", children: t("browserLocale") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-browser-locale", style: styles.input, type: "text", value: draft.browserLocale, disabled: saving || !snapshot.writable || !draft.browserComputerUse, onChange: (event) => update("browserLocale", event.target.value) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-browser-timeout", children: t("browserTimeoutMs") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-browser-timeout", style: styles.input, type: "number", min: "1000", max: "120000", step: "1", value: draft.browserTimeoutMs, disabled: saving || !snapshot.writable || !draft.browserComputerUse, onChange: (event) => update("browserTimeoutMs", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-browser-settle", children: t("browserSettleMs") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-browser-settle", style: styles.input, type: "number", min: "0", max: "10000", step: "1", value: draft.browserSettleMs, disabled: saving || !snapshot.writable || !draft.browserComputerUse, onChange: (event) => update("browserSettleMs", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-browser-width", children: t("browserViewportWidth") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-browser-width", style: styles.input, type: "number", min: "320", max: "3840", step: "1", value: draft.browserViewportWidth, disabled: saving || !snapshot.writable || !draft.browserComputerUse, onChange: (event) => update("browserViewportWidth", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-browser-height", children: t("browserViewportHeight") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-browser-height", style: styles.input, type: "number", min: "240", max: "2160", step: "1", value: draft.browserViewportHeight, disabled: saving || !snapshot.writable || !draft.browserComputerUse, onChange: (event) => update("browserViewportHeight", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-browser-elements", children: t("browserMaxElements") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-browser-elements", style: styles.input, type: "number", min: "20", max: "500", step: "1", value: draft.browserMaxElements, disabled: saving || !snapshot.writable || !draft.browserComputerUse, onChange: (event) => update("browserMaxElements", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-browser-text", children: t("browserMaxTextChars") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-browser-text", style: styles.input, type: "number", min: "1000", max: "100000", step: "1", value: draft.browserMaxTextChars, disabled: saving || !snapshot.writable || !draft.browserComputerUse, onChange: (event) => update("browserMaxTextChars", numberFrom(event)) })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.divider }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.checkboxRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "checkbox",
              checked: draft.desktopComputerUse,
              disabled: saving || !snapshot.writable,
              onChange: (event) => update("desktopComputerUse", event.target.checked)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            t("desktopComputerUse"),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { style: styles.hint, children: t("desktopComputerUseHint") })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.hint, marginTop: 10 }, children: t("desktopPermissionHint") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { ...styles.checkboxRow, marginTop: 12 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "checkbox",
              checked: draft.desktopSemantic,
              disabled: saving || !snapshot.writable || !draft.desktopComputerUse,
              onChange: (event) => update("desktopSemantic", event.target.checked)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            t("desktopSemantic"),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { style: styles.hint, children: t("desktopSemanticHint") })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.field, marginTop: 14 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-desktop-visual-mode", children: t("desktopVisualMode") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { id: "deepseekeyes-desktop-visual-mode", style: styles.input, value: draft.desktopVisualMode, disabled: saving || !snapshot.writable || !draft.desktopComputerUse, onChange: (event) => update("desktopVisualMode", event.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "auto", children: t("desktopVisualModeAuto") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "always", children: t("desktopVisualModeAlways") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "manual", children: t("desktopVisualModeManual") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { style: styles.hint, children: t("desktopVisualModeHint") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.grid, marginTop: 14 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-desktop-timeout", children: t("desktopTimeoutMs") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-desktop-timeout", style: styles.input, type: "number", min: "1000", max: "120000", step: "1", value: draft.desktopTimeoutMs, disabled: saving || !snapshot.writable || !draft.desktopComputerUse, onChange: (event) => update("desktopTimeoutMs", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-desktop-settle", children: t("desktopSettleMs") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-desktop-settle", style: styles.input, type: "number", min: "0", max: "10000", step: "1", value: draft.desktopSettleMs, disabled: saving || !snapshot.writable || !draft.desktopComputerUse, onChange: (event) => update("desktopSettleMs", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-desktop-windows", children: t("desktopMaxWindows") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-desktop-windows", style: styles.input, type: "number", min: "1", max: "200", step: "1", value: draft.desktopMaxWindows, disabled: saving || !snapshot.writable || !draft.desktopComputerUse, onChange: (event) => update("desktopMaxWindows", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-desktop-elements", children: t("desktopMaxElements") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-desktop-elements", style: styles.input, type: "number", min: "20", max: "500", step: "1", value: draft.desktopMaxElements, disabled: saving || !snapshot.writable || !draft.desktopComputerUse || !draft.desktopSemantic, onChange: (event) => update("desktopMaxElements", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-desktop-display", children: t("desktopMacDisplay") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-desktop-display", style: styles.input, type: "number", min: "1", max: "32", step: "1", value: draft.desktopMacDisplay, disabled: saving || !snapshot.writable || !draft.desktopComputerUse, onChange: (event) => update("desktopMacDisplay", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-desktop-powershell", children: t("desktopWindowsPowerShell") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-desktop-powershell", style: styles.input, type: "text", value: draft.desktopWindowsPowerShell, placeholder: t("desktopWindowsPowerShellPlaceholder"), disabled: saving || !snapshot.writable || !draft.desktopComputerUse, onChange: (event) => update("desktopWindowsPowerShell", event.target.value) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-desktop-artifacts", children: t("desktopArtifactsDir") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-desktop-artifacts", style: styles.input, type: "text", value: draft.desktopArtifactsDir, placeholder: t("desktopArtifactsDirPlaceholder"), disabled: saving || !snapshot.writable || !draft.desktopComputerUse, onChange: (event) => update("desktopArtifactsDir", event.target.value) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-desktop-history", children: t("desktopHistoryLimit") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-desktop-history", style: styles.input, type: "number", min: "0", max: "32", step: "1", value: draft.desktopHistoryLimit, disabled: saving || !snapshot.writable || !draft.desktopComputerUse, onChange: (event) => update("desktopHistoryLimit", numberFrom(event)) })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: styles.details, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { style: styles.detailsSummary, children: t("advanced") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.grid, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-clarifications", children: t("maxClarifications") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-clarifications", style: styles.input, type: "number", min: "0", max: "8", step: "1", value: draft.maxClarifications, disabled: saving || !snapshot.writable, onChange: (event) => update("maxClarifications", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-history-images", children: t("historyImageLimit") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-history-images", style: styles.input, type: "number", min: "0", max: "32", step: "1", value: draft.historyImageLimit, disabled: saving || !snapshot.writable, onChange: (event) => update("historyImageLimit", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-history-summary", children: t("historySummaryChars") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-history-summary", style: styles.input, type: "number", min: "64", max: "2000", step: "1", value: draft.historySummaryChars, disabled: saving || !snapshot.writable, onChange: (event) => update("historySummaryChars", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-browser-history", children: t("browserHistoryLimit") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-browser-history", style: styles.input, type: "number", min: "0", max: "32", step: "1", value: draft.browserHistoryLimit, disabled: saving || !snapshot.writable, onChange: (event) => update("browserHistoryLimit", numberFrom(event)) })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.hint, marginTop: 10 }, children: t("historyBudgetHint") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gap: 14, marginTop: 14 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TokenBudgetField, { id: "deepseekeyes-base-tokens", label: t("baseMaxTokens"), minimum: 512, value: draft.baseMaxTokens, disabled: saving || !snapshot.writable, onChange: (value) => update("baseMaxTokens", value), t }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TokenBudgetField, { id: "deepseekeyes-target-tokens", label: t("targetMaxTokens"), minimum: 256, value: draft.targetMaxTokens, disabled: saving || !snapshot.writable, onChange: (value) => update("targetMaxTokens", value), t })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { ...styles.checkboxRow, marginTop: 14 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.persistentEvidence, disabled: saving || !snapshot.writable, onChange: (event) => update("persistentEvidence", event.target.checked) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("persistentEvidence") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: styles.details, open: true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { style: styles.detailsSummary, children: t("usageStatsTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.checkboxRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.usageStats, disabled: saving || !snapshot.writable, onChange: (event) => update("usageStats", event.target.checked) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("usageStats") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.hint, marginTop: 10 }, children: t("usageStatsHint") }),
        usage.loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.statusWarn, marginTop: 12 }, children: t("usageStatsLoading") }) : usage.error !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: { ...styles.statusError, marginTop: 12 }, children: [
          t("usageStatsUnavailable"),
          usage.error
        ] }) : usage.value !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gap: 10, marginTop: 12 }, children: [
          !usage.value.enabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.statusWarn, children: t("usageStatsDisabled") }) : null,
          usage.value.persistence?.healthy === false ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: styles.statusWarn, children: [
            t("usagePersistenceError"),
            usage.value.persistence.error
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.metricGrid, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageExactAdditional"), value: usage.value.totals.derived.exactAdditionalTokens }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageEstimatedBridge"), value: usage.value.totals.derived.estimatedBridgeInputTokens }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageEstimatedTotal"), value: usage.value.totals.derived.estimatedAdditionalTokens }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageVision"), value: usage.value.totals.derived.visionTokens }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageClarification"), value: usage.value.totals.derived.upstreamClarificationTokens }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageAutomation"), value: usage.value.totals.derived.automationTokens }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageAutomationTurns"), value: usage.value.totals.automationTurns }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageContextCompactions"), value: usage.value.totals.automationContextCompactions }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageInputSaved"), value: usage.value.totals.estimatedAutomationInputTokensSaved }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageLimitStops"), value: usage.value.totals.automationLimitStops }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageVisualTurns"), value: usage.value.totals.visualTurns }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageLookCalls"), value: usage.value.totals.lookCalls }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMetric, { label: t("usageCacheHits"), value: usage.value.totals.cacheHits })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t("usageFinalExcluded") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: styles.hint, children: [
            t("usageUpdatedAt"),
            usage.value.updatedAt
          ] })
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.actions, marginTop: 12 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.button, disabled: usage.loading, onClick: () => {
            void loadUsage();
          }, children: t("usageRefresh") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.button, disabled: usage.loading, onClick: () => {
            void resetUsage();
          }, children: t("usageReset") })
        ] })
      ] }),
      catalog.loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.statusWarn, children: t("statusChecking") }) : catalog.error !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.statusError, children: catalog.error }) : readyGroup !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: styles.statusOk, children: [
        t("statusReady"),
        t(draft.activeProbe ? "statusReadyProbe" : "statusReadyMetadata")
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.statusWarn, children: selectedFailure?.message ?? t("statusPending") }),
      failureKey !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.statusError, children: t(failureKey) }) : null,
      notice !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: notice.kind === "ok" ? styles.statusOk : styles.statusError, children: notice.text }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.actions, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.button, disabled: saving, onClick: () => {
          void loadCatalog();
        }, children: t("refresh") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.button, disabled: saving || !dirty && !declarationDirty, onClick: discard, children: t("discard") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: { ...styles.primary, opacity: saveBlocked ? 0.55 : 1 }, disabled: saveBlocked, onClick: () => {
          void save();
        }, children: t(saving ? "saving" : "save") })
      ] })
    ] }) : null
  ] });
}
var inject = ["slots", "locale", "connection", "remote", "settingsScope"];
function apply(ctx) {
  const { api, rpc } = ctx.get("connection");
  const scope = ctx.settingsScope.bind({ namespace: "deepseekeyes" });
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "deepseekeyes: settings locale");
  ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
    name: "settings.plugin.item",
    id: "deepseekeyes",
    order: 30,
    locale: NS,
    inject: () => ({ scope, api, usageRpc: rpc })
  }, DeepSeekEyesSettingsCard));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
