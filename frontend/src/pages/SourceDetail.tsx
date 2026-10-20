import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { NodeView } from '../api/types'
import NodeEditor, { ImportDialog } from '../components/NodeEditor'
import SourceForm from '../components/SourceForm'
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconEdit,
  IconEye,
  IconLayers,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconServer,
  IconTrash,
  IconUpload,
} from '../components/icons'
import {
  Button,
  ConfirmDialog,
  CopyButton,
  Empty,
  ErrorNote,
  IconButton,
  ListSkeleton,
  Modal,
  Note,
  PageHero,
  Skeleton,
  StatusDot,
  useToast,
} from '../components/ui'
import { formatInterval, fullTime, timeAgo, toYaml } from '../lib/format'
import { useAsync, usePolling } from '../lib/useAsync'

export default function SourceDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const source = useAsync(() => api.getSource(id), [id])
  const nodes = useAsync(() => api.listNodes(id), [id])
  const exports = useAsync(api.listExports, [])
  const [editingSource, setEditingSource] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [nodeEditor, setNodeEditor] = useState<{ open: boolean; node?: NodeView }>({ open: false })
  const [importing, setImporting] = useState(false)
  const [deletingNode, setDeletingNode] = useState<NodeView>()
  const [viewing, setViewing] = useState<NodeView>()
  const [query, setQuery] = useState('')
  const [reordering, setReordering] = useState(false)

  const s = source.data
  const isManual = s?.kind === 'manual'
  const usedBy = useMemo(
    () => (exports.data ?? []).filter((e) => e.source_ids.includes(id)),
    [exports.data, id],
  )

  usePolling(
    () => {
      void source.reload()
      void nodes.reload()
    },
    s?.status === 'pending',
    4000,
  )

  const filtered = useMemo(() => {
    const list = nodes.data ?? []
    if (!query) return list
    const q = query.toLowerCase()
    return list.filter((n) =>
      [n.config.name, n.config.type, n.config.server].some((v) =>
        String(v ?? '').toLowerCase().includes(q),
      ),
    )
  }, [nodes.data, query])

  function applyNodes(list: NodeView[]) {
    nodes.setData(list)
    // 节点修改会刷新来源快照并触发出口重编译，重新获取来源状态
    void source.reload()
  }

  async function refresh() {
    if (!s) return
    setRefreshing(true)
    try {
      const next = await api.refreshSource(s.id)
      source.setData(next)
      await nodes.reload()
      if (next.last_error) toast.error(`刷新失败：${next.last_error}`)
      else toast.success(`已刷新，${next.node_count} 个节点`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setRefreshing(false)
    }
  }

  async function move(index: number, delta: number) {
    const list = nodes.data
    if (!list) return
    const target = index + delta
    if (target < 0 || target >= list.length) return
    const next = [...list]
    ;[next[index], next[target]] = [next[target], next[index]]
    nodes.setData(next)
    setReordering(true)
    try {
      const saved = await api.orderNodes(
        id,
        next.map((n) => n.id as string),
      )
      nodes.setData(saved)
    } catch (e) {
      nodes.setData(list)
      toast.error(errorMessage(e))
    } finally {
      setReordering(false)
    }
  }

  if (source.error && !s) {
    return (
      <div className="page-body">
        <div className="container stack">
          <Link to="/sources" className="back-link">
            <IconArrowLeft /> 返回来源
          </Link>
          <ErrorNote error={source.error} />
        </div>
      </div>
    )
  }

  const total = nodes.data?.length ?? 0

  return (
    <>
      <PageHero
        before={
          <Link to="/sources" className="back-link">
            <IconArrowLeft /> 来源
          </Link>
        }
        title={s ? s.name : <Skeleton h={38} w={240} />}
        description={
          s && (
            <span className="row row-wrap" style={{ gap: 12 }}>
              <StatusDot status={s.status} />
              <span className="badge">{s.kind === 'url' ? 'URL 订阅' : '自定义节点'}</span>
              {s.using_stale_snapshot && <span className="badge badge-amber">使用旧快照</span>}
              <span className="small subtle mono">{s.id}</span>
            </span>
          )
        }
        actions={
          s && (
            <>
              {s.kind === 'url' && (
                <Button icon={<IconRefresh />} loading={refreshing} onClick={refresh}>
                  立即刷新
                </Button>
              )}
              <Button icon={<IconEdit />} onClick={() => setEditingSource(true)}>
                编辑
              </Button>
              {isManual && (
                <Button
                  variant="primary"
                  icon={<IconPlus />}
                  onClick={() => setNodeEditor({ open: true })}
                >
                  添加节点
                </Button>
              )}
            </>
          )
        }
      />
      <div className="page-body">
        <div className="container stack">
          {s?.last_error && (
            <Note type={s.has_snapshot ? 'warning' : 'error'}>
              <b>最近一次拉取失败：</b>
              {s.last_error}
              {s.has_snapshot && (
                <div className="small">
                  出口仍在使用最近一次成功的快照（{fullTime(s.last_success_at)}）。
                </div>
              )}
            </Note>
          )}
          {s?.status === 'pending' && (
            <Note type="info">
              等待首次拉取。后台调度器会在下一次检查时拉取，也可以点击「立即刷新」。
            </Note>
          )}

          <div className="card">
            <div className="card-body">
              {s ? (
                <dl className="dl">
                  {s.kind === 'url' && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <dt>订阅 URL</dt>
                      <dd className="row">
                        <span className="mono small truncate grow">{s.url}</span>
                        <CopyButton text={s.url ?? ''} />
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>节点数</dt>
                    <dd>{s.node_count}</dd>
                  </div>
                  {s.kind === 'url' && (
                    <>
                      <div>
                        <dt>刷新周期</dt>
                        <dd>每 {formatInterval(s.refresh_interval_seconds)}</dd>
                      </div>
                      <div>
                        <dt>最近成功</dt>
                        <dd title={fullTime(s.last_success_at)}>{timeAgo(s.last_success_at)}</dd>
                      </div>
                      <div>
                        <dt>最近尝试</dt>
                        <dd title={fullTime(s.last_attempt_at)}>{timeAgo(s.last_attempt_at)}</dd>
                      </div>
                      <div>
                        <dt>下次刷新</dt>
                        <dd title={fullTime(s.next_refresh_at)}>{timeAgo(s.next_refresh_at)}</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>创建时间</dt>
                    <dd>{fullTime(s.created_at)}</dd>
                  </div>
                </dl>
              ) : (
                <Skeleton h={60} />
              )}
            </div>
            <div className="card-footer">
              <span className="small muted row">
                <IconLayers />
                {exports.data === undefined
                  ? '…'
                  : usedBy.length === 0
                    ? '未被任何订阅出口引用'
                    : `被 ${usedBy.length} 个订阅出口引用`}
              </span>
              <div className="row row-wrap">
                {usedBy.slice(0, 4).map((e) => (
                  <Link key={e.id} to={`/exports/${e.id}`} className="badge badge-outline">
                    {e.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <section className="stack" style={{ gap: 12 }}>
            <div className="row row-wrap between">
              <div>
                <h2 className="section-title">节点</h2>
                <p className="small muted" style={{ margin: '2px 0 0' }}>
                  {isManual
                    ? '自定义节点可编辑、删除和排序，顺序决定输出顺序。'
                    : 'URL 来源节点来自最近一次成功的快照，只读。'}
                </p>
              </div>
              <div className="row row-wrap">
                <div className="input-group" style={{ width: 240 }}>
                  <span className="input-addon">
                    <IconSearch />
                  </span>
                  <input
                    className="input"
                    style={{ height: 32 }}
                    placeholder="筛选节点…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                {isManual && (
                  <Button icon={<IconUpload />} onClick={() => setImporting(true)}>
                    批量导入
                  </Button>
                )}
              </div>
            </div>

            <ErrorNote error={nodes.error} />
            {nodes.loading && !nodes.data ? (
              <ListSkeleton rows={4} />
            ) : total === 0 ? (
              <Empty
                icon={<IconServer />}
                title="暂无节点"
                description={
                  isManual
                    ? '添加单个节点，或批量导入 SS/VLESS 链接、proxies YAML。'
                    : s?.has_snapshot
                      ? '上游订阅没有返回节点。'
                      : '尚未成功拉取，刷新后在此查看节点。'
                }
                action={
                  isManual ? (
                    <div className="row" style={{ justifyContent: 'center' }}>
                      <Button icon={<IconUpload />} onClick={() => setImporting(true)}>
                        批量导入
                      </Button>
                      <Button
                        variant="primary"
                        icon={<IconPlus />}
                        onClick={() => setNodeEditor({ open: true })}
                      >
                        添加节点
                      </Button>
                    </div>
                  ) : (
                    s?.kind === 'url' && (
                      <Button icon={<IconRefresh />} loading={refreshing} onClick={refresh}>
                        立即刷新
                      </Button>
                    )
                  )
                }
              />
            ) : (
              <div className="list">
                <div className="list-head">
                  <span style={{ width: 28 }}>#</span>
                  <span className="grow">名称</span>
                  <span className="hide-sm" style={{ width: 220 }}>
                    服务器
                  </span>
                  <span style={{ width: isManual ? 148 : 32 }} />
                </div>
                {filtered.map((n) => {
                  const index = (nodes.data ?? []).indexOf(n)
                  return (
                    <div
                      key={n.id ?? `p-${n.position}`}
                      className="list-item"
                      style={{ padding: '10px 20px' }}
                    >
                      <span className="index-pill" style={{ width: 28 }}>
                        {index + 1}
                      </span>
                      <div className="grow row" style={{ minWidth: 0 }}>
                        <span className="proto">{String(n.config.type ?? '?')}</span>
                        <span className="truncate item-title">
                          {String(n.config.name ?? '(未命名)')}
                        </span>
                      </div>
                      <span
                        className="hide-sm mono small muted truncate"
                        style={{ width: 220 }}
                      >
                        {String(n.config.server ?? '')}
                        {n.config.port !== undefined ? `:${n.config.port}` : ''}
                      </span>
                      <div className="row" style={{ gap: 2 }}>
                        <IconButton label="查看配置" small onClick={() => setViewing(n)}>
                          <IconEye />
                        </IconButton>
                        {isManual && n.id && (
                          <>
                            <IconButton
                              label="上移"
                              small
                              disabled={reordering || !!query || index === 0}
                              onClick={() => move(index, -1)}
                            >
                              <IconArrowUp />
                            </IconButton>
                            <IconButton
                              label="下移"
                              small
                              disabled={reordering || !!query || index === total - 1}
                              onClick={() => move(index, 1)}
                            >
                              <IconArrowDown />
                            </IconButton>
                            <IconButton
                              label="编辑"
                              small
                              onClick={() => setNodeEditor({ open: true, node: n })}
                            >
                              <IconEdit />
                            </IconButton>
                            <IconButton label="删除" small onClick={() => setDeletingNode(n)}>
                              <IconTrash />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
                {filtered.length === 0 && (
                  <div className="list-item small muted" style={{ justifyContent: 'center' }}>
                    没有匹配的节点
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="card danger">
            <div className="card-header" style={{ paddingBottom: 20 }}>
              <h3 className="card-title">删除来源</h3>
              <p className="card-desc">
                永久删除此来源及其节点快照。仍被订阅出口引用时无法删除，请先从出口中移除。
              </p>
            </div>
            <div className="card-footer danger">
              <span className="small muted">此操作不可撤销</span>
              <Button variant="danger" onClick={() => setDeleting(true)} disabled={!s}>
                删除来源
              </Button>
            </div>
          </div>
        </div>
      </div>

      {s && (
        <SourceForm
          open={editingSource}
          source={s}
          onClose={() => setEditingSource(false)}
          onSaved={(next) => {
            source.setData(next)
            toast.success('已保存')
          }}
        />
      )}
      <NodeEditor
        open={nodeEditor.open}
        node={nodeEditor.node}
        sourceId={id}
        onClose={() => setNodeEditor({ open: false })}
        onSaved={(list) => {
          applyNodes(list)
          toast.success(nodeEditor.node ? '节点已更新' : '节点已添加')
        }}
      />
      <ImportDialog
        open={importing}
        sourceId={id}
        currentCount={total}
        onClose={() => setImporting(false)}
        onSaved={(list, added) => {
          applyNodes(list)
          toast.success(`已导入 ${added} 个节点`)
        }}
      />
      <ConfirmDialog
        open={!!deletingNode}
        onClose={() => setDeletingNode(undefined)}
        title="删除节点"
        danger
        confirmLabel="删除"
        description={
          <>
            确认删除节点「<b>{String(deletingNode?.config.name ?? '')}</b>
            」？引用此来源的订阅出口将重新编译。
          </>
        }
        onConfirm={async () => {
          if (!deletingNode?.id) return
          await api.deleteNode(id, deletingNode.id)
          applyNodes(
            (nodes.data ?? [])
              .filter((n) => n.id !== deletingNode.id)
              .map((n, i) => ({ ...n, position: i })),
          )
          toast.success('节点已删除')
        }}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="删除来源"
        danger
        confirmLabel="删除"
        requireText={s?.name}
        description={
          usedBy.length > 0 ? (
            <Note type="warning">
              此来源仍被 {usedBy.length} 个订阅出口引用（{usedBy.map((e) => e.name).join('、')}
              ），删除会失败。
            </Note>
          ) : (
            '将永久删除此来源及其所有节点快照。'
          )
        }
        onConfirm={async () => {
          await api.deleteSource(id)
          toast.success('来源已删除')
          navigate('/sources')
        }}
      />
      <Modal
        open={!!viewing}
        onClose={() => setViewing(undefined)}
        title={String(viewing?.config.name ?? '节点配置')}
      >
        <div className="code-window">
          <div className="code-window-bar">
            <span className="mono">node.yaml</span>
            <CopyButton text={viewing ? toYaml(viewing.config) : ''} />
          </div>
          <pre className="code">{viewing ? toYaml(viewing.config) : ''}</pre>
        </div>
        <p className="xs subtle" style={{ margin: 0 }}>
          配置包含节点凭据，请勿公开分享。
        </p>
      </Modal>
    </>
  )
}
