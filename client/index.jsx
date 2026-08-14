import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  normalizeSettingsDraft,
  providerDeclaresVision,
  providerSettingsTarget,
  providerVisionMutation,
  settingsDraftFailure,
  settingsPathOps,
} from '../src/settings-ui.js'

const NS = 'deepseekeyes.settings'
const PROVIDER_ID = 'deepseekeyes'

const zh = {
  title: 'DeepSeekEyes',
  description: '在同一对话框内为 DeepSeek 接入视觉模型，并保留对原图的按需追问。',
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
  persistentEvidence: '持久化视觉证据缓存',
  maxClarifications: '最多追问轮数',
  baseMaxTokens: '首次读图 Token 上限',
  targetMaxTokens: '细节追问 Token 上限',
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
  maxClarificationsRange: '追问轮数必须是 0–8 的整数。',
  baseMaxTokensRange: '首次读图 Token 上限必须是 512–32768 的整数。',
  targetMaxTokensRange: '细节追问 Token 上限必须是 256–16384 的整数。',
  noProviders: 'Harness 中还没有可用 Provider，请先在「设置 → 模型」添加。',
  inactive: '（未激活）',
}

const en = {
  title: 'DeepSeekEyes',
  description: 'Give DeepSeek a visual model in the same conversation, with follow-up access to the original image.',
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
  persistentEvidence: 'Persist visual evidence cache',
  maxClarifications: 'Maximum clarification rounds',
  baseMaxTokens: 'Initial vision token limit',
  targetMaxTokens: 'Clarification token limit',
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
  maxClarificationsRange: 'Clarification rounds must be an integer from 0 through 8.',
  baseMaxTokensRange: 'Initial vision tokens must be an integer from 512 through 32768.',
  targetMaxTokensRange: 'Clarification tokens must be an integer from 256 through 16384.',
  noProviders: 'No provider is available in Harness. Add one under Settings → Models first.',
  inactive: ' (inactive)',
}

const styles = {
  card: { listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2, var(--border-color, #d9dee8))', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2, var(--card-bg, #fff))', color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))', overflow: 'hidden' },
  summary: { cursor: 'pointer', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 5 },
  title: { fontSize: 16, fontWeight: 650, color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))' },
  description: { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary, var(--text-secondary, #697386))' },
  body: { padding: '2px 20px 20px', display: 'grid', gap: 16 },
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
  details: { borderTop: '1px solid var(--dsw-alias-border-l2, var(--border-color, #e4e7ec))', paddingTop: 12 },
  detailsSummary: { cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--dsw-alias-label-primary, var(--text-primary, #172033))' },
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function numberFrom(event) {
  const value = Number(event.target.value)
  return Number.isFinite(value) ? value : event.target.value
}

function modelName(group, modelId, fallback) {
  if (modelId === '') return fallback
  return group?.models?.find(model => model.id === modelId)?.name ?? modelId
}

function routeSummary(template, vision, final) {
  return template.replace('{vision}', vision).replace('{final}', final)
}

function DeepSeekEyesSettingsCard({ scope, api, t }) {
  const snapshot = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const [draft, setDraft] = useState(() => normalizeSettingsDraft(snapshot.value))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(undefined)
  const [catalog, setCatalog] = useState({ loading: true, providers: [], groups: [], namespaces: [], failures: [], error: undefined })
  const [declareVision, setDeclareVision] = useState(false)
  const [declarationDirty, setDeclarationDirty] = useState(false)

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
      await new Promise(resolve => setTimeout(resolve, 180))
      await loadCatalog()
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
    <li style={styles.card}>
      <details open>
        <summary style={styles.summary}>
          <span style={styles.title}>{t('title')}</span>
          <span style={styles.description}>{t('description')}</span>
        </summary>
        <div style={styles.body}>
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

          <details style={styles.details}>
            <summary style={styles.detailsSummary}>{t('advanced')}</summary>
            <div style={styles.grid}>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-clarifications">{t('maxClarifications')}</label>
                <input id="deepseekeyes-clarifications" style={styles.input} type="number" min="0" max="8" step="1" value={draft.maxClarifications} disabled={saving || !snapshot.writable} onChange={event => update('maxClarifications', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-base-tokens">{t('baseMaxTokens')}</label>
                <input id="deepseekeyes-base-tokens" style={styles.input} type="number" min="512" max="32768" step="1" value={draft.baseMaxTokens} disabled={saving || !snapshot.writable} onChange={event => update('baseMaxTokens', numberFrom(event))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="deepseekeyes-target-tokens">{t('targetMaxTokens')}</label>
                <input id="deepseekeyes-target-tokens" style={styles.input} type="number" min="256" max="16384" step="1" value={draft.targetMaxTokens} disabled={saving || !snapshot.writable} onChange={event => update('targetMaxTokens', numberFrom(event))} />
              </div>
            </div>
            <label style={{ ...styles.checkboxRow, marginTop: 14 }}>
              <input type="checkbox" checked={draft.persistentEvidence} disabled={saving || !snapshot.writable} onChange={event => update('persistentEvidence', event.target.checked)} />
              <span>{t('persistentEvidence')}</span>
            </label>
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
      </details>
    </li>
  )
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx) {
  const { api } = ctx.get('connection')
  const scope = ctx.settingsScope.bind({ namespace: 'deepseekeyes' })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'deepseekeyes: settings locale')
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'deepseekeyes',
    order: 30,
    locale: NS,
    inject: () => ({ scope, api }),
  }, DeepSeekEyesSettingsCard))
}
