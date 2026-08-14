window.__ModuleLoader__.load({ id: "deepseekeyes", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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
  "autoDetectVision",
  "activeProbe",
  "persistentEvidence",
  "maxClarifications",
  "baseMaxTokens",
  "targetMaxTokens"
]);
var OPTIONAL_ROUTE_FIELDS = /* @__PURE__ */ new Set(["upstreamModel", "visionProvider", "visionModel"]);
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
    autoDetectVision: value.autoDetectVision !== false,
    activeProbe: value.activeProbe !== false,
    persistentEvidence: value.persistentEvidence !== false,
    maxClarifications: Number.isInteger(value.maxClarifications) ? value.maxClarifications : 3,
    baseMaxTokens: Number.isInteger(value.baseMaxTokens) ? value.baseMaxTokens : 8192,
    targetMaxTokens: Number.isInteger(value.targetMaxTokens) ? value.targetMaxTokens : 4096
  };
}
function settingsPathOps(currentValue, draft) {
  const current = normalizeSettingsDraft(currentValue);
  const ops = [];
  for (const field of SETTINGS_FIELDS) {
    const next = draft[field];
    if (OPTIONAL_ROUTE_FIELDS.has(field) && (next === void 0 || next === "")) {
      if (currentValue?.[field] !== void 0) ops.push({ op: "unset", path: [field] });
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
  if (!draft.autoDetectVision && draft.visionProvider === "") return "visionRouteRequired";
  const ranges = [
    ["maxClarifications", 0, 8],
    ["baseMaxTokens", 512, 32768],
    ["targetMaxTokens", 256, 16384]
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
var zh = {
  title: "DeepSeekEyes",
  description: "\u5728\u540C\u4E00\u5BF9\u8BDD\u6846\u5185\u4E3A DeepSeek \u63A5\u5165\u89C6\u89C9\u6A21\u578B\uFF0C\u5E76\u4FDD\u7559\u5BF9\u539F\u56FE\u7684\u6309\u9700\u8FFD\u95EE\u3002",
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
  persistentEvidence: "\u6301\u4E45\u5316\u89C6\u89C9\u8BC1\u636E\u7F13\u5B58",
  maxClarifications: "\u6700\u591A\u8FFD\u95EE\u8F6E\u6570",
  baseMaxTokens: "\u9996\u6B21\u8BFB\u56FE Token \u4E0A\u9650",
  targetMaxTokens: "\u7EC6\u8282\u8FFD\u95EE Token \u4E0A\u9650",
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
  maxClarificationsRange: "\u8FFD\u95EE\u8F6E\u6570\u5FC5\u987B\u662F 0\u20138 \u7684\u6574\u6570\u3002",
  baseMaxTokensRange: "\u9996\u6B21\u8BFB\u56FE Token \u4E0A\u9650\u5FC5\u987B\u662F 512\u201332768 \u7684\u6574\u6570\u3002",
  targetMaxTokensRange: "\u7EC6\u8282\u8FFD\u95EE Token \u4E0A\u9650\u5FC5\u987B\u662F 256\u201316384 \u7684\u6574\u6570\u3002",
  noProviders: "Harness \u4E2D\u8FD8\u6CA1\u6709\u53EF\u7528 Provider\uFF0C\u8BF7\u5148\u5728\u300C\u8BBE\u7F6E \u2192 \u6A21\u578B\u300D\u6DFB\u52A0\u3002",
  inactive: "\uFF08\u672A\u6FC0\u6D3B\uFF09"
};
var en = {
  title: "DeepSeekEyes",
  description: "Give DeepSeek a visual model in the same conversation, with follow-up access to the original image.",
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
  persistentEvidence: "Persist visual evidence cache",
  maxClarifications: "Maximum clarification rounds",
  baseMaxTokens: "Initial vision token limit",
  targetMaxTokens: "Clarification token limit",
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
  maxClarificationsRange: "Clarification rounds must be an integer from 0 through 8.",
  baseMaxTokensRange: "Initial vision tokens must be an integer from 512 through 32768.",
  targetMaxTokensRange: "Clarification tokens must be an integer from 256 through 16384.",
  noProviders: "No provider is available in Harness. Add one under Settings \u2192 Models first.",
  inactive: " (inactive)"
};
var styles = {
  card: { listStyle: "none", border: "1px solid var(--dsw-alias-border-l2, var(--border-color, #d9dee8))", borderRadius: 12, background: "var(--dsw-alias-bg-layer-2, var(--card-bg, #fff))", color: "var(--dsw-alias-label-primary, var(--text-primary, #172033))", overflow: "hidden" },
  summary: { cursor: "pointer", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 5 },
  title: { fontSize: 16, fontWeight: 650, color: "var(--dsw-alias-label-primary, var(--text-primary, #172033))" },
  description: { fontSize: 13, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))" },
  body: { padding: "2px 20px 20px", display: "grid", gap: 16 },
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
  details: { borderTop: "1px solid var(--dsw-alias-border-l2, var(--border-color, #e4e7ec))", paddingTop: 12 },
  detailsSummary: { cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 14, color: "var(--dsw-alias-label-primary, var(--text-primary, #172033))" }
};
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function numberFrom(event) {
  const value = Number(event.target.value);
  return Number.isFinite(value) ? value : event.target.value;
}
function modelName(group, modelId, fallback) {
  if (modelId === "") return fallback;
  return group?.models?.find((model) => model.id === modelId)?.name ?? modelId;
}
function routeSummary(template, vision, final) {
  return template.replace("{vision}", vision).replace("{final}", final);
}
function DeepSeekEyesSettingsCard({ scope, api, t }) {
  const snapshot = (0, import_react.useSyncExternalStore)(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot()
  );
  const [draft, setDraft] = (0, import_react.useState)(() => normalizeSettingsDraft(snapshot.value));
  const [dirty, setDirty] = (0, import_react.useState)(false);
  const [saving, setSaving] = (0, import_react.useState)(false);
  const [notice, setNotice] = (0, import_react.useState)(void 0);
  const [catalog, setCatalog] = (0, import_react.useState)({ loading: true, providers: [], groups: [], namespaces: [], failures: [], error: void 0 });
  const [declareVision, setDeclareVision] = (0, import_react.useState)(false);
  const [declarationDirty, setDeclarationDirty] = (0, import_react.useState)(false);
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
      await loadCatalog();
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { style: styles.card, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { open: true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { style: styles.summary, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.title, children: t("title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.description, children: t("description") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.body, children: [
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: styles.details, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { style: styles.detailsSummary, children: t("advanced") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.grid, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-clarifications", children: t("maxClarifications") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-clarifications", style: styles.input, type: "number", min: "0", max: "8", step: "1", value: draft.maxClarifications, disabled: saving || !snapshot.writable, onChange: (event) => update("maxClarifications", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-base-tokens", children: t("baseMaxTokens") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-base-tokens", style: styles.input, type: "number", min: "512", max: "32768", step: "1", value: draft.baseMaxTokens, disabled: saving || !snapshot.writable, onChange: (event) => update("baseMaxTokens", numberFrom(event)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, htmlFor: "deepseekeyes-target-tokens", children: t("targetMaxTokens") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "deepseekeyes-target-tokens", style: styles.input, type: "number", min: "256", max: "16384", step: "1", value: draft.targetMaxTokens, disabled: saving || !snapshot.writable, onChange: (event) => update("targetMaxTokens", numberFrom(event)) })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { ...styles.checkboxRow, marginTop: 14 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.persistentEvidence, disabled: saving || !snapshot.writable, onChange: (event) => update("persistentEvidence", event.target.checked) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("persistentEvidence") })
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
    ] })
  ] }) });
}
var inject = ["slots", "locale", "connection", "remote", "settingsScope"];
function apply(ctx) {
  const { api } = ctx.get("connection");
  const scope = ctx.settingsScope.bind({ namespace: "deepseekeyes" });
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "deepseekeyes: settings locale");
  ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
    name: "settings.plugin.item",
    id: "deepseekeyes",
    order: 30,
    locale: NS,
    inject: () => ({ scope, api })
  }, DeepSeekEyesSettingsCard));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
