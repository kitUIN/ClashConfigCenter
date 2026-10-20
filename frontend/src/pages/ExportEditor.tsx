import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type {
  ExportConfig,
  ExportMode,
  ExportView,
  Injection,
  Preview,
  Source,
  SubscriptionCredentials,
} from '../api/types'
import { CredentialsModal } from '../components/Credentials'
import { GroupPicker } from '../components/GroupPicker'
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconCheck,
  IconEye,
  IconGlobe,
  IconPlus,
  IconServer,
  IconX,
} from '../components/icons'
import {
  Button,
  CopyButton,
  ErrorNote,
  IconButton,
  Note,
  PageHero,
  Skeleton,
  StatusDot,
  useToast,
} from '../components/ui'

/** 与后端 schemas.DEFAULT_TEMPLATE 保持一致 */
const DEFAULT_TEMPLATE = `mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
proxy-groups:
  - name: 代理选择
    type: select
    proxies: [DIRECT]
rules:
  - MATCH,代理选择
`

/** 从模板中粗略提取策略组名称，用于目标组候选。 */
function groupsFromTemplate(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((l) => /^proxy-groups\s*:/.test(l))
  if (start < 0) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^\S/.test(l)) break
    const m = l.match(/^\s*-\s*(?:\{\s*)?name\s*:\s*(['"]?)(.+?)\1\s*(?:,.*)?$/)
    if (m) out.push(m[2].trim())
  }
  return [...new Set(out)]
}

interface Draft {
  name: string
  enabled: boolean
  source_ids: string[]
  mode: ExportMode
  template_yaml: string
  base_source_id: string
  injection: Injection
  prefix_source_name: boolean
  target_groups: string[]
  token: string
}

function fromExport(e: ExportView): Draft {
  return {
    name: e.name,
    enabled: e.enabled,
    source_ids: e.source_ids,
    mode: e.mode,
    template_yaml: e.template_yaml ?? DEFAULT_TEMPLATE,
    base_source_id: e.base_source_id ?? '',
    injection: e.injection,
    prefix_source_name: e.prefix_source_name,
    target_groups: e.target_groups,
    token: '',
  }
}

const NEW_DRAFT: Draft = {
  name: '',
  enabled: true,
  source_ids: [],
  mode: 'template',
  template_yaml: DEFAULT_TEMPLATE,
  base_source_id: '',
  injection: 'grouped',
  prefix_source_name: true,
  target_groups: ['代理选择'],
  token: '',
}

function toConfig(d: Draft): ExportConfig {
  return {
    name: d.name.trim(),
    enabled: d.enabled,
    source_ids: d.source_ids,
    mode: d.mode,
    template_yaml: d.mode === 'template' ? d.template_yaml : null,
    base_source_id: d.mode === 'inherit' ? d.base_source_id || null : null,
    injection: d.injection,
    prefix_source_name: d.prefix_source_name,
    target_groups: d.target_groups,
  }
}

export default function ExportEditor() {
  const { id } = useParams()
  const editing = !!id
  const navigate = useNavigate()
  const toast = useToast()
  const [sources, setSources] = useState<Source[]>()
  const [original, setOriginal] = useState<ExportView>()
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [preview, setPreview] = useState<Preview>()
  const [previewError, setPreviewError] = useState<unknown>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [credentials, setCredentials] = useState<SubscriptionCredentials & { id: string }>()


  useEffect(() => {
    let alive = true
    Promise.all([api.listSources(), id ? api.getExport(id) : Promise.resolve(undefined)])
      .then(([s, e]) => {
        if (!alive) return
        setSources(s)
        if (e) {
          setOriginal(e)
          setDraft(fromExport(e))
        }
      })
      .catch((err) => alive && setLoadError(err))
    return () => {
      alive = false
    }
  }, [id])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }))
    setPreview(undefined)
    setPreviewError(null)
  }

  const byId = useMemo(() => new Map((sources ?? []).map((s) => [s.id, s])), [sources])
  const selected = draft.source_ids.map((sid) => byId.get(sid)).filter(Boolean) as Source[]
  const available = (sources ?? []).filter((s) => !draft.source_ids.includes(s.id))
  const urlSelected = selected.filter((s) => s.kind === 'url')
  const templateGroups = useMemo(
    () => (draft.mode === 'template' ? groupsFromTemplate(draft.template_yaml) : []),
    [draft.mode, draft.template_yaml],
  )
  const [baseGroups, setBaseGroups] = useState<string[]>([])
  const [baseGroupsLoading, setBaseGroupsLoading] = useState(false)
  const baseSnapshotKey = byId.get(draft.base_source_id)?.last_success_at ?? ''
  useEffect(() => {
    if (draft.mode !== 'inherit' || !draft.base_source_id) {
      setBaseGroups([])
      return
    }
    let alive = true
    setBaseGroupsLoading(true)
    api
      .sourceGroups(draft.base_source_id)
      .then((g) => alive && setBaseGroups(g))
      .catch(() => alive && setBaseGroups([]))
      .finally(() => alive && setBaseGroupsLoading(false))
    return () => {
      alive = false
    }
  }, [draft.mode, draft.base_source_id, baseSnapshotKey])
  const groupOptions = draft.mode === 'template' ? templateGroups : baseGroups
  const noSnapshot = selected.filter((s) => !s.has_snapshot)

  // 继承模式下，基础来源必须是已选的 URL 来源
  const urlSelectedKey = urlSelected.map((s) => s.id).join(',')
  useEffect(() => {
    if (draft.mode !== 'inherit') return
    const ids = urlSelectedKey ? urlSelectedKey.split(',') : []
    if (!ids.includes(draft.base_source_id)) {
      const target = ids[0] ?? ''
      if (target !== draft.base_source_id) setDraft((d) => ({ ...d, base_source_id: target }))
    }
  }, [draft.mode, draft.base_source_id, urlSelectedKey])

  const problems: string[] = []
  if (!draft.name.trim()) problems.push('填写出口名称')
  if (draft.source_ids.length === 0) problems.push('至少选择一个来源')
  if (draft.target_groups.length === 0) problems.push('至少指定一个目标策略组')
  if (draft.mode === 'inherit' && !draft.base_source_id) problems.push('继承模式需要选择一个 URL 来源作为基础')
  if (draft.mode === 'template' && !draft.template_yaml.trim()) problems.push('模板不能为空')
  const canSubmit = problems.length === 0

  function addSource(sid: string) {
    set('source_ids', [...draft.source_ids, sid])
  }
  function removeSource(sid: string) {
    set(
      'source_ids',
      draft.source_ids.filter((x) => x !== sid),
    )
  }
  function moveSource(i: number, delta: number) {
    const next = [...draft.source_ids]
    const j = i + delta
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    set('source_ids', next)
  }


  async function runPreview() {
    setPreviewing(true)
    setPreviewError(null)
    try {
      setPreview(await api.previewExport(toConfig(draft)))
    } catch (e) {
      setPreview(undefined)
      setPreviewError(e)
    } finally {
      setPreviewing(false)
    }
  }

  async function save() {
    if (!canSubmit) return
    setSaving(true)
    setSaveError(null)
    try {
      const config = toConfig(draft)
      if (editing && id) {
        await api.patchExport(id, config)
        toast.success('出口已保存并重新生成')
        navigate(`/exports/${id}`)
      } else {
        const created = await api.createExport({
          ...config,
          ...(draft.token.trim() ? { token: draft.token.trim() } : {}),
        })
        setCredentials({ id: created.id, token: created.token, subscription_url: created.subscription_url })
      }
    } catch (e) {
      setSaveError(e)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="page-body">
        <div className="container stack">
          <Link to="/exports" className="back-link">
            <IconArrowLeft /> 返回
          </Link>
          <ErrorNote error={loadError} />
        </div>
      </div>
    )
  }

  const loading = !sources || (editing && !original)

  return (
    <>
      <PageHero
        before={
          <Link to={editing ? `/exports/${id}` : '/exports'} className="back-link">
            <IconArrowLeft /> {editing ? (original?.name ?? '出口') : '订阅出口'}
          </Link>
        }
        title={editing ? '编辑出口' : '创建订阅出口'}
        description="保存前会完整编译并校验引用；失败时不会写入。"
        actions={
          <>
            <Button icon={<IconEye />} onClick={runPreview} loading={previewing} disabled={!canSubmit}>
              预览
            </Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={!canSubmit}>
              {editing ? '保存' : '创建出口'}
            </Button>
          </>
        }
      />
      <div className="page-body">
        <div className="container">
          {loading ? (
            <div className="stack">
              <Skeleton h={140} />
              <Skeleton h={220} />
            </div>
          ) : (
            <div className="editor-layout">
              <div className="stack">
                <ErrorNote error={saveError} />

                {/* 基本信息 */}
                <section className="card">
                  <div className="card-header">
                    <h3 className="card-title">基本信息</h3>
                  </div>
                  <div className="card-body stack" style={{ gap: 16 }}>
                    <div className="field">
                      <label className="label" htmlFor="exp-name">
                        名称
                      </label>
                      <input
                        id="exp-name"
                        className="input"
                        maxLength={200}
                        value={draft.name}
                        placeholder="例如：日常订阅"
                        onChange={(e) => set('name', e.target.value)}
                      />
                    </div>
                    {!editing && (
                      <div className="field">
                        <label className="label" htmlFor="exp-token">
                          订阅 Token（可选）
                        </label>
                        <input
                          id="exp-token"
                          className="input mono"
                          maxLength={512}
                          value={draft.token}
                          placeholder="留空自动生成"
                          onChange={(e) => set('token', e.target.value)}
                        />
                        <span className="hint">创建后可随时在出口详情页查看和复制。</span>
                      </div>
                    )}
                  </div>
                </section>

                {/* 来源 */}
                <section className="card">
                  <div className="card-header">
                    <h3 className="card-title">来源</h3>
                    <p className="card-desc">顺序决定节点输出顺序。各来源中已忽略的节点不会注入出口。</p>
                  </div>
                  <div className="card-body stack" style={{ gap: 16 }}>
                    {selected.length === 0 ? (
                      <div className="empty" style={{ padding: 24 }}>
                        <p style={{ margin: 0 }}>从下方选择至少一个来源</p>
                      </div>
                    ) : (
                      <div>
                        {selected.map((s, i) => (
                          <div key={s.id} className="sortable-item">
                            <span className="index-pill">{i + 1}</span>
                            {s.kind === 'url' ? <IconGlobe /> : <IconServer />}
                            <span className="grow truncate item-title">{s.name}</span>
                            {draft.mode === 'inherit' && draft.base_source_id === s.id && (
                              <span className="badge badge-blue">基础</span>
                            )}
                            <span className="xs subtle hide-sm">
                              {s.node_count - s.ignored_node_count} 节点
                            </span>
                            <StatusDot status={s.status} label="" />
                            <IconButton label="上移" small disabled={i === 0} onClick={() => moveSource(i, -1)}>
                              <IconArrowUp />
                            </IconButton>
                            <IconButton
                              label="下移"
                              small
                              disabled={i === selected.length - 1}
                              onClick={() => moveSource(i, 1)}
                            >
                              <IconArrowDown />
                            </IconButton>
                            <IconButton label="移除" small onClick={() => removeSource(s.id)}>
                              <IconX />
                            </IconButton>
                          </div>
                        ))}
                      </div>
                    )}
                    {noSnapshot.length > 0 && (
                      <Note type="warning">
                        {noSnapshot.map((s) => s.name).join('、')} 尚无成功快照，需先刷新或添加节点才能编译。
                      </Note>
                    )}
                    {available.length > 0 && (
                      <div className="field">
                        <span className="label">可添加</span>
                        <div className="row row-wrap">
                          {available.map((s) => (
                            <Button key={s.id} size="sm" icon={<IconPlus />} onClick={() => addSource(s.id)}>
                              {s.name}
                              <span className="subtle xs">{s.node_count - s.ignored_node_count}</span>
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                    {sources && sources.length === 0 && (
                      <Note type="info">
                        还没有任何来源，请先 <Link to="/sources" style={{ textDecoration: 'underline' }}>添加来源</Link>。
                      </Note>
                    )}
                  </div>
                </section>

                {/* 模式 */}
                <section className="card">
                  <div className="card-header">
                    <h3 className="card-title">配置模式</h3>
                  </div>
                  <div className="card-body stack" style={{ gap: 16 }}>
                    <div className="choice-grid">
                      <Choice
                        on={draft.mode === 'template'}
                        title="模板模式"
                        desc="使用内置或自定义模板（规则、DNS、监听等），将节点注入目标策略组。"
                        onClick={() => {
                          set('mode', 'template')
                          if (!draft.target_groups.length) set('target_groups', ['代理选择'])
                        }}
                      />
                      <Choice
                        on={draft.mode === 'inherit'}
                        title="继承模式"
                        desc="以某个 URL 来源的完整配置为基础，保留其分流规则，再注入其他来源。"
                        onClick={() => set('mode', 'inherit')}
                      />
                    </div>

                    {draft.mode === 'template' ? (
                      <div className="field">
                        <div className="row between">
                          <label className="label" htmlFor="exp-template">
                            模板 YAML
                          </label>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={draft.template_yaml === DEFAULT_TEMPLATE}
                            onClick={() => set('template_yaml', DEFAULT_TEMPLATE)}
                          >
                            恢复内置模板
                          </Button>
                        </div>
                        <textarea
                          id="exp-template"
                          className="textarea"
                          rows={14}
                          spellCheck={false}
                          value={draft.template_yaml}
                          onChange={(e) => set('template_yaml', e.target.value)}
                        />
                        <span className="hint">不要在模板中填写 proxies 或 proxy-providers，节点由来源注入。</span>
                      </div>
                    ) : (
                      <div className="field">
                        <label className="label" htmlFor="exp-base">
                          基础来源
                        </label>
                        <select
                          id="exp-base"
                          className="select"
                          value={draft.base_source_id}
                          onChange={(e) => set('base_source_id', e.target.value)}
                          disabled={urlSelected.length === 0}
                        >
                          {urlSelected.length === 0 && <option value="">请先选择 URL 来源</option>}
                          {urlSelected.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <span className="hint">基础来源的快照必须包含完整的策略组和规则。</span>
                      </div>
                    )}
                  </div>
                </section>

                {/* 注入 */}
                <section className="card">
                  <div className="card-header">
                    <h3 className="card-title">节点注入</h3>
                  </div>
                  <div className="card-body stack" style={{ gap: 16 }}>
                    <div className="field">
                      <label className="row small" style={{ cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          className="check"
                          checked={draft.prefix_source_name}
                          onChange={(e) => set('prefix_source_name', e.target.checked)}
                        />
                        是否产生来源分组前缀
                      </label>
                      <span className="hint">
                        开启后节点名为「[来源名称] 原节点名」；关闭后保留原节点名，重名时追加编号。
                      </span>
                    </div>
                    <div className="choice-grid">
                      <Choice
                        on={draft.injection === 'grouped'}
                        title="按来源分组"
                        desc="为每个来源生成一个选择组，再将这些组加入目标策略组。"
                        onClick={() => set('injection', 'grouped')}
                      />
                      <Choice
                        on={draft.injection === 'direct'}
                        title="直接注入"
                        desc="将所有节点逐个追加到目标策略组。"
                        onClick={() => set('injection', 'direct')}
                      />
                    </div>
                    <div className="field">
                      <label className="label">目标策略组</label>
                      <GroupPicker
                        value={draft.target_groups}
                        onChange={(v) => set('target_groups', v)}
                        options={groupOptions}
                        loading={draft.mode === 'inherit' && baseGroupsLoading}
                        emptyText={
                          draft.mode === 'template'
                            ? '模板中没有 proxy-groups，可直接输入名称'
                            : !draft.base_source_id
                              ? '请先选择基础来源'
                              : '基础来源暂无策略组（可能尚未刷新成功），可直接输入名称'
                        }
                      />
                      <span className="hint">
                        从{draft.mode === 'template' ? '模板' : '基础来源配置'}
                        的策略组中选择，可多选；也可输入名称后回车添加。
                      </span>
                    </div>
                  </div>
                </section>
              </div>

              {/* 预览 */}
              <aside className="editor-aside">
                <PreviewPanel
                  preview={preview}
                  error={previewError}
                  loading={previewing}
                  disabled={!canSubmit}
                  problems={problems}
                  onRun={runPreview}
                />
              </aside>
            </div>
          )}
        </div>
      </div>
      <CredentialsModal
        credentials={credentials}
        exportName={draft.name.trim()}
        title="出口已创建"
        onClose={() => {
          const target = credentials?.id
          setCredentials(undefined)
          if (target) navigate(`/exports/${target}`)
        }}
      />
    </>
  )
}

function Choice({ on, title, desc, onClick }: { on: boolean; title: string; desc: string; onClick: () => void }) {
  return (
    <button type="button" className={`choice ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
      <div className="choice-title">
        {title}
        {on && <IconCheck />}
      </div>
      <div className="choice-desc">{desc}</div>
    </button>
  )
}

function PreviewPanel({
  preview,
  error,
  loading,
  disabled,
  problems,
  onRun,
}: {
  preview?: Preview
  error: unknown
  loading: boolean
  disabled: boolean
  problems: string[]
  onRun: () => void
}) {
  return (
    <div className="card">
      <div className="card-header row between">
        <div>
          <h3 className="card-title">预览</h3>
          <p className="card-desc small">使用来源现有快照编译，不写入。</p>
        </div>
        <Button size="sm" icon={<IconEye />} onClick={onRun} loading={loading} disabled={disabled}>
          {preview ? '重新预览' : '生成预览'}
        </Button>
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        {problems.length > 0 && (
          <Note type="plain">
            还需要：
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Note>
        )}
        <ErrorNote error={error} />
        {preview ? (
          <>
            <div className="row" style={{ gap: 24 }}>
              <div>
                <div className="xs subtle">节点</div>
                <div className="stat-value" style={{ fontSize: 24, marginTop: 2 }}>
                  {preview.node_count}
                </div>
              </div>
              <div>
                <div className="xs subtle">策略组</div>
                <div className="stat-value" style={{ fontSize: 24, marginTop: 2 }}>
                  {preview.group_count}
                </div>
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="xs subtle">摘要</div>
                <div className="mono xs truncate" style={{ marginTop: 6 }} title={preview.digest}>
                  {preview.digest}
                </div>
              </div>
            </div>
            <div className="code-window">
              <div className="code-window-bar">
                <span className="mono">config.yaml</span>
                <CopyButton text={preview.yaml} />
              </div>
              <pre className="code" style={{ maxHeight: 'calc(100vh - 380px)', minHeight: 200 }}>
                {preview.yaml}
              </pre>
            </div>
          </>
        ) : (
          !error &&
          problems.length === 0 && (
            <div className="empty" style={{ padding: 32 }}>
              <p style={{ margin: 0 }}>点击「生成预览」查看最终 YAML</p>
            </div>
          )
        )}
      </div>
    </div>
  )
}
