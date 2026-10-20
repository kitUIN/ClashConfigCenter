import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { Source } from '../api/types'
import SourceForm from '../components/SourceForm'
import { IconEdit, IconGlobe, IconPlus, IconRefresh, IconSearch, IconServer, IconTrash } from '../components/icons'
import {
  Button,
  ConfirmDialog,
  Empty,
  ErrorNote,
  ListSkeleton,
  Menu,
  MenuItem,
  PageHero,
  Segmented,
  StatusDot,
  useToast,
} from '../components/ui'
import { formatInterval, fullTime, maskUrl, timeAgo } from '../lib/format'
import { useAsync, usePolling } from '../lib/useAsync'

type Filter = 'all' | 'url' | 'manual'

export default function Sources() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data, error, loading, reload, setData } = useAsync(api.listSources, [])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Source>()
  const [deleting, setDeleting] = useState<Source>()
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set())

  usePolling(reload, !!data?.some((s) => s.status === 'pending'), 5000)

  const list = useMemo(
    () =>
      (data ?? []).filter(
        (s) =>
          (filter === 'all' || s.kind === filter) &&
          (!query || s.name.toLowerCase().includes(query.toLowerCase())),
      ),
    [data, filter, query],
  )

  const replace = (s: Source) => setData((prev) => (prev ?? []).map((x) => (x.id === s.id ? s : x)))

  async function refresh(s: Source) {
    setRefreshing((r) => new Set(r).add(s.id))
    try {
      const next = await api.refreshSource(s.id)
      replace(next)
      if (next.status === 'error' || next.last_error) toast.error(`刷新失败：${next.last_error ?? '未知错误'}`)
      else toast.success(`「${s.name}」已刷新，${next.node_count} 个节点`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setRefreshing((r) => {
        const n = new Set(r)
        n.delete(s.id)
        return n
      })
    }
  }

  return (
    <>
      <PageHero
        title="来源"
        description="URL 订阅按周期自动刷新；拉取失败时保留最近一次成功的快照。"
        actions={
          <Button variant="primary" icon={<IconPlus />} onClick={() => setCreating(true)}>
            添加来源
          </Button>
        }
      />
      <div className="page-body">
        <div className="container stack" style={{ gap: 16 }}>
          <div className="row row-wrap between">
            <div className="input-group" style={{ width: 320, maxWidth: '100%' }}>
              <span className="input-addon">
                <IconSearch />
              </span>
              <input
                className="input"
                placeholder="搜索来源…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: '全部' },
                { value: 'url', label: 'URL' },
                { value: 'manual', label: '自定义' },
              ]}
            />
          </div>

          <ErrorNote error={error} />

          {loading && !data ? (
            <ListSkeleton rows={4} />
          ) : data && data.length === 0 ? (
            <Empty
              icon={<IconGlobe />}
              title="还没有来源"
              description="添加一个机场订阅 URL，或创建自定义来源来手动维护节点。"
              action={
                <Button variant="primary" icon={<IconPlus />} onClick={() => setCreating(true)}>
                  添加来源
                </Button>
              }
            />
          ) : list.length === 0 ? (
            <div className="empty muted">没有匹配的来源</div>
          ) : (
            <div className="list">
              {list.map((s) => (
                <div
                  key={s.id}
                  className="list-item clickable"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/sources/${s.id}`)}
                >
                  <div className="item-icon">{s.kind === 'url' ? <IconGlobe /> : <IconServer />}</div>
                  <div className="grow">
                    <div className="row">
                      <span className="item-title truncate">{s.name}</span>
                      <span className="badge">{s.kind === 'url' ? 'URL' : '自定义'}</span>
                      {s.using_stale_snapshot && <span className="badge badge-amber">旧快照</span>}
                    </div>
                    <div className="small muted truncate mono" style={{ fontSize: 12 }}>
                      {s.kind === 'url' ? maskUrl(s.url) : `${s.node_count} 个自定义节点`}
                    </div>
                    {s.last_error && (
                      <div className="xs truncate" style={{ color: 'var(--red)', marginTop: 2 }}>
                        {s.last_error}
                      </div>
                    )}
                  </div>
                  <div className="col-status hide-sm">
                    <StatusDot status={s.status} />
                    <div className="xs subtle" style={{ marginTop: 2 }}>
                      {s.node_count} 个节点
                    </div>
                  </div>
                  <div className="col-meta hide-sm small muted">
                    {s.kind === 'url' ? (
                      <>
                        <div title={fullTime(s.last_success_at)}>更新于 {timeAgo(s.last_success_at)}</div>
                        <div className="xs subtle">每 {formatInterval(s.refresh_interval_seconds)}</div>
                      </>
                    ) : (
                      <div title={fullTime(s.created_at)}>创建于 {timeAgo(s.created_at)}</div>
                    )}
                  </div>
                  <div className="row col-actions" onClick={(e) => e.stopPropagation()}>
                    {s.kind === 'url' ? (
                      <Button
                        size="sm"
                        icon={<IconRefresh />}
                        loading={refreshing.has(s.id)}
                        onClick={() => refresh(s)}
                        className="hide-sm"
                      >
                        刷新
                      </Button>
                    ) : (
                      // 占位：与 URL 行的「刷新」按钮等宽，保证各列对齐
                      <Button size="sm" icon={<IconRefresh />} className="hide-sm placeholder" aria-hidden tabIndex={-1}>
                        刷新
                      </Button>
                    )}
                    <Menu>
                      {s.kind === 'url' && (
                        <MenuItem icon={<IconRefresh />} onSelect={() => refresh(s)}>
                          立即刷新
                        </MenuItem>
                      )}
                      <MenuItem icon={<IconEdit />} onSelect={() => setEditing(s)}>
                        编辑
                      </MenuItem>
                      <div className="menu-sep" />
                      <MenuItem icon={<IconTrash />} danger onSelect={() => setDeleting(s)}>
                        删除
                      </MenuItem>
                    </Menu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <SourceForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(s) => {
          toast.success(`已创建「${s.name}」`)
          navigate(`/sources/${s.id}`)
        }}
      />
      <SourceForm
        open={!!editing}
        source={editing}
        onClose={() => setEditing(undefined)}
        onSaved={(s) => {
          replace(s)
          toast.success('已保存')
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        title="删除来源"
        danger
        confirmLabel="删除"
        description={
          <>
            将永久删除「<b>{deleting?.name}</b>」及其节点快照。仍被订阅出口引用的来源无法删除。
          </>
        }
        onConfirm={async () => {
          if (!deleting) return
          await api.deleteSource(deleting.id)
          setData((prev) => (prev ?? []).filter((x) => x.id !== deleting.id))
          toast.success('已删除')
        }}
      />
    </>
  )
}
