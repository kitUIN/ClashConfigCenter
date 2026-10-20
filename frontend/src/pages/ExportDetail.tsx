import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { ExportView, Preview, SubscriptionCredentials } from '../api/types'
import { CredentialsModal, RotateTokenDialog } from '../components/Credentials'
import { SubscriptionLink } from '../components/SubscriptionLink'
import {
  IconArrowLeft,
  IconEdit,
  IconEye,
  IconGlobe,
  IconHammer,
  IconEyeOff,
  IconKey,
  IconServer,
  IconTrash,
} from '../components/icons'
import {
  Button,
  ConfirmDialog,
  CopyButton,
  ErrorNote,
  IconButton,
  Menu,
  MenuItem,
  Note,
  PageHero,
  Skeleton,
  StatusDot,
  Switch,
  useToast,
} from '../components/ui'
import { fullTime, timeAgo } from '../lib/format'
import { useAsync } from '../lib/useAsync'

const STATUS_HELP: Record<ExportView['status'], string> = {
  ready: '订阅正在提供最新编译结果。',
  pending: '尚未生成有效结果，客户端请求将返回 503。',
  stale: '订阅仍在提供旧结果：某些来源刷新失败或已变更但尚未重新编译。',
  error: '最近一次编译失败，订阅继续提供上一次成功的结果（如果有）。',
  disabled: '出口已禁用，订阅链接返回 404。',
}

function SecretField({
  value,
  masked,
  revealed,
  onToggle,
  copyLabel,
}: {
  value: string
  masked: string
  revealed: boolean
  onToggle: () => void
  copyLabel: string
}) {
  return (
    <div className="copy-field">
      <span>{revealed ? value : masked}</span>
      <IconButton small label={revealed ? '隐藏' : '显示'} onClick={onToggle}>
        {revealed ? <IconEyeOff /> : <IconEye />}
      </IconButton>
      <CopyButton text={value} label={copyLabel} />
    </div>
  )
}

export default function ExportDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const exp = useAsync(() => api.getExport(id), [id])
  const sources = useAsync(api.listSources, [])
  const [busy, setBusy] = useState<'rebuild' | 'toggle'>()
  const [rotating, setRotating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [credentials, setCredentials] = useState<SubscriptionCredentials>()
  const [preview, setPreview] = useState<Preview>()
  const [previewError, setPreviewError] = useState<unknown>(null)
  const [previewing, setPreviewing] = useState(false)
  const creds = useAsync(() => api.getCredentials(id), [id])
  const [revealed, setRevealed] = useState(false)

  const e = exp.data
  const byId = useMemo(() => new Map((sources.data ?? []).map((s) => [s.id, s])), [sources.data])
  const srcErrors = new Map((e?.source_errors ?? []).map((x) => [x.source_id, x.message]))

  async function rebuild() {
    setBusy('rebuild')
    try {
      const next = await api.rebuildExport(id)
      exp.setData(next)
      if (next.last_error) toast.error(`重建失败：${next.last_error}`)
      else toast.success('已使用现有快照重建')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(undefined)
    }
  }

  async function toggle(enabled: boolean) {
    setBusy('toggle')
    try {
      exp.setData(await api.patchExport(id, { enabled }))
      toast.success(enabled ? '出口已启用' : '出口已禁用')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(undefined)
    }
  }

  async function runPreview() {
    if (!e) return
    setPreviewing(true)
    setPreviewError(null)
    try {
      setPreview(
        await api.previewExport({
          name: e.name,
          enabled: e.enabled,
          source_ids: e.source_ids,
          mode: e.mode,
          template_yaml: e.mode === 'template' ? e.template_yaml : null,
          base_source_id: e.mode === 'inherit' ? e.base_source_id : null,
          injection: e.injection,
          prefix_source_name: e.prefix_source_name,
          target_groups: e.target_groups,
        }),
      )
    } catch (err) {
      setPreviewError(err)
    } finally {
      setPreviewing(false)
    }
  }

  if (exp.error && !e) {
    return (
      <div className="page-body">
        <div className="container stack">
          <Link to="/exports" className="back-link">
            <IconArrowLeft /> 返回订阅出口
          </Link>
          <ErrorNote error={exp.error} />
        </div>
      </div>
    )
  }

  return (
    <>
      <PageHero
        before={
          <Link to="/exports" className="back-link">
            <IconArrowLeft /> 订阅出口
          </Link>
        }
        title={e ? e.name : <Skeleton h={38} w={240} />}
        description={
          e && (
            <span className="row row-wrap" style={{ gap: 12 }}>
              <StatusDot status={e.status} />
              <span className="badge">{e.mode === 'template' ? '模板模式' : '继承模式'}</span>
              <span className="badge badge-outline">{e.injection === 'grouped' ? '按来源分组' : '直接注入'}</span>
              <span className="small subtle mono">{e.id}</span>
            </span>
          )
        }
        actions={
          e && (
            <>
              <label className="row small muted" style={{ marginRight: 8 }}>
                <Switch
                  checked={e.enabled}
                  label={e.enabled ? '禁用出口' : '启用出口'}
                  disabled={busy === 'toggle'}
                  onChange={toggle}
                />
                {e.enabled ? '已启用' : '已禁用'}
              </label>
              <Button icon={<IconHammer />} loading={busy === 'rebuild'} onClick={rebuild}>
                重建
              </Button>
              <Link to={`/exports/${id}/edit`} className="btn btn-primary">
                <IconEdit /> 编辑
              </Link>
              <Menu>
                <MenuItem icon={<IconKey />} onSelect={() => setRotating(true)}>
                  更换订阅 Token
                </MenuItem>
                <div className="menu-sep" />
                <MenuItem icon={<IconTrash />} danger onSelect={() => setDeleting(true)}>
                  删除出口
                </MenuItem>
              </Menu>
            </>
          )
        }
      />
      <div className="page-body">
        <div className="container stack">
          {!e ? (
            <>
              <Skeleton h={120} />
              <Skeleton h={200} />
            </>
          ) : (
            <>
              {e.last_error && (
                <Note type="error">
                  <b>编译失败：</b>
                  {e.last_error}
                  {e.has_snapshot && (
                    <div className="small">订阅继续提供上一次成功的结果（{fullTime(e.last_success_at)}）。</div>
                  )}
                </Note>
              )}
              {e.source_errors.length > 0 && (
                <Note type="warning">
                  <b>来源拉取失败，正在使用旧快照：</b>
                  <ul>
                    {e.source_errors.map((x) => (
                      <li key={x.source_id}>
                        <Link to={`/sources/${x.source_id}`} style={{ textDecoration: 'underline' }}>
                          {byId.get(x.source_id)?.name ?? x.source_id}
                        </Link>
                        ：{x.message}
                      </li>
                    ))}
                  </ul>
                </Note>
              )}
              {!e.last_error && e.source_errors.length === 0 && e.using_stale_snapshot && (
                <Note type="warning">
                  来源已更新但订阅尚未重新编译。点击「重建」使用最新快照生成。
                </Note>
              )}

              {/* 概况 */}
              <div className="card">
                <div className="card-body">
                  <dl className="dl">
                    <div>
                      <dt>状态</dt>
                      <dd>
                        <StatusDot status={e.status} />
                      </dd>
                    </div>
                    <div>
                      <dt>最近生成</dt>
                      <dd title={fullTime(e.last_success_at)}>
                        {e.has_snapshot ? timeAgo(e.last_success_at) : '尚未生成'}
                      </dd>
                    </div>
                    <div>
                      <dt>最近尝试</dt>
                      <dd title={fullTime(e.last_attempt_at)}>{timeAgo(e.last_attempt_at)}</dd>
                    </div>
                    <div>
                      <dt>创建时间</dt>
                      <dd>{fullTime(e.created_at)}</dd>
                    </div>
                  </dl>
                </div>
                <div className="card-footer">
                  <span className="small muted">{STATUS_HELP[e.status]}</span>
                </div>
              </div>

              {/* 订阅链接 */}
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">订阅链接</h3>
                  <p className="card-desc">支持 URL、二维码和 Clash 直接导入；如怀疑泄露，请更换 Token。</p>
                </div>
                <div className="card-body stack" style={{ gap: 12 }}>
                  {creds.data ? (
                    <>
                      <SubscriptionLink
                        key={creds.data.subscription_url}
                        url={creds.data.subscription_url}
                        name={e.name}
                      />
                      <div className="field">
                        <label className="label">订阅 Token</label>
                        <SecretField
                          value={creds.data.token}
                          masked={'•'.repeat(Math.min(creds.data.token.length, 32))}
                          revealed={revealed}
                          onToggle={() => setRevealed((v) => !v)}
                          copyLabel="复制 Token"
                        />
                      </div>
                    </>
                  ) : creds.error ? (
                    <Note type="warning">{errorMessage(creds.error)}</Note>
                  ) : (
                    <Skeleton h={38} />
                  )}
                  <span className="hint">
                    客户端使用 <code>ETag</code> 条件请求，内容未变化时返回 304。
                  </span>
                </div>
                <div className="card-footer">
                  <span className="small muted">更换后旧链接立即失效</span>
                  <Button icon={<IconKey />} onClick={() => setRotating(true)}>
                    更换 Token
                  </Button>
                </div>
              </div>

              <div className="grid grid-2">
                {/* 来源 */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">来源（{e.source_ids.length}）</h3>
                    <p className="card-desc">按输出顺序排列</p>
                  </div>
                  <div className="card-body">
                    {e.source_ids.map((sid, i) => {
                      const s = byId.get(sid)
                      return (
                        <Link key={sid} to={`/sources/${sid}`} className="sortable-item" style={{ display: 'flex' }}>
                          <span className="index-pill">{i + 1}</span>
                          {s?.kind === 'manual' ? <IconServer /> : <IconGlobe />}
                          <span className="grow truncate item-title">{s?.name ?? sid}</span>
                          {e.base_source_id === sid && <span className="badge badge-blue">基础</span>}
                          {srcErrors.has(sid) && <span className="badge badge-amber">拉取失败</span>}
                          <span className="xs subtle">
                            {s ? `${s.node_count - s.ignored_node_count} 节点` : ''}
                          </span>
                          {s && <StatusDot status={s.status} label="" />}
                        </Link>
                      )
                    })}
                  </div>
                </div>

                {/* 配置 */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">配置</h3>
                  </div>
                  <div className="card-body">
                    <dl className="dl" style={{ gridTemplateColumns: '1fr 1fr' }}>
                      <div>
                        <dt>模式</dt>
                        <dd>{e.mode === 'template' ? '模板模式' : '继承模式'}</dd>
                      </div>
                      <div>
                        <dt>注入方式</dt>
                        <dd>{e.injection === 'grouped' ? '按来源分组' : '直接注入'}</dd>
                      </div>
                      <div>
                        <dt>来源分组前缀</dt>
                        <dd>{e.prefix_source_name ? '开启' : '关闭'}</dd>
                      </div>
                      {e.mode === 'inherit' && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <dt>基础来源</dt>
                          <dd>{byId.get(e.base_source_id ?? '')?.name ?? e.base_source_id}</dd>
                        </div>
                      )}
                      <div style={{ gridColumn: '1 / -1' }}>
                        <dt>目标策略组</dt>
                        <dd className="row row-wrap">
                          {e.target_groups.map((g) => (
                            <span key={g} className="badge badge-outline">
                              {g}
                            </span>
                          ))}
                        </dd>
                      </div>
                    </dl>
                    {e.mode === 'template' && e.template_yaml && (
                      <details style={{ marginTop: 16 }}>
                        <summary className="small muted" style={{ cursor: 'pointer' }}>
                          查看模板 YAML
                        </summary>
                        <pre className="code" style={{ marginTop: 8, maxHeight: 300 }}>
                          {e.template_yaml}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>

              {/* 预览 */}
              <div className="card">
                <div className="card-header row between">
                  <div>
                    <h3 className="card-title">配置预览</h3>
                    <p className="card-desc">按当前配置与来源最新快照编译（不发布），可用于在重建前检查结果。</p>
                  </div>
                  <Button icon={<IconEye />} loading={previewing} onClick={runPreview}>
                    {preview ? '重新生成' : '生成预览'}
                  </Button>
                </div>
                <div className="card-body stack" style={{ gap: 12 }}>
                  <ErrorNote error={previewError} />
                  {preview && (
                    <>
                      <div className="row small muted" style={{ gap: 16 }}>
                        <span>
                          节点 <b style={{ color: 'var(--fg)' }}>{preview.node_count}</b>
                        </span>
                        <span>
                          策略组 <b style={{ color: 'var(--fg)' }}>{preview.group_count}</b>
                        </span>
                        <span className="mono xs truncate grow">{preview.digest}</span>
                      </div>
                      <div className="code-window">
                        <div className="code-window-bar">
                          <span className="mono">config.yaml</span>
                          <CopyButton text={preview.yaml} />
                        </div>
                        <pre className="code">{preview.yaml}</pre>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="card danger">
                <div className="card-header" style={{ paddingBottom: 20 }}>
                  <h3 className="card-title">删除出口</h3>
                  <p className="card-desc">删除后订阅链接立即失效，来源不受影响。</p>
                </div>
                <div className="card-footer danger">
                  <span className="small muted">此操作不可撤销</span>
                  <Button variant="danger" onClick={() => setDeleting(true)}>
                    删除出口
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <RotateTokenDialog
        exportId={id}
        open={rotating}
        onClose={() => setRotating(false)}
        onRotated={(c) => {
          creds.setData(c)
          setCredentials(c)
          toast.success('Token 已更换')
        }}
      />
      <CredentialsModal
        credentials={credentials}
        exportName={e?.name ?? 'ClashConfigCenter'}
        title="新的订阅凭据"
        onClose={() => setCredentials(undefined)}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="删除订阅出口"
        danger
        confirmLabel="删除"
        requireText={e?.name}
        description="删除后，使用此订阅链接的客户端将无法再更新配置。"
        onConfirm={async () => {
          await api.deleteExport(id)
          toast.success('出口已删除')
          navigate('/exports')
        }}
      />
    </>
  )
}
