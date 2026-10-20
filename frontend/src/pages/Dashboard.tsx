import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { ExportView, Source } from '../api/types'
import { IconChevronRight, IconGlobe, IconLayers, IconPlus, IconServer } from '../components/icons'
import { ErrorNote, PageHero, Skeleton, StatusDot } from '../components/ui'
import { timeAgo } from '../lib/format'
import { useAsync } from '../lib/useAsync'

function count<T extends { status: string }>(items: T[] | undefined, status: string) {
  return items?.filter((i) => i.status === status).length ?? 0
}

export default function Dashboard() {
  const { data, error, loading } = useAsync(
    () => Promise.all([api.listSources(), api.listExports()]),
    [],
  )
  const [sources, exports] = data ?? [undefined, undefined]
  const nodes = sources?.reduce((s, x) => s + x.node_count, 0) ?? 0
  const problems = [
    ...(sources ?? [])
      .filter((s) => s.status === 'error')
      .map((s) => ({ key: `s-${s.id}`, to: `/sources/${s.id}`, name: s.name, kind: '来源', msg: s.last_error, status: 'error' })),
    ...(exports ?? [])
      .filter((e) => e.status === 'error' || e.status === 'stale')
      .map((e) => ({
        key: `e-${e.id}`,
        to: `/exports/${e.id}`,
        name: e.name,
        kind: '出口',
        msg: e.last_error ?? e.source_errors[0]?.message ?? '使用旧快照',
        status: e.status,
      })),
  ]

  return (
    <>
      <PageHero
        title="概览"
        description="管理 URL 订阅与自定义节点，聚合生成带独立 Token 的 Mihomo 订阅。"
        actions={
          <>
            <Link to="/sources" className="btn btn-secondary">
              <IconPlus /> 添加来源
            </Link>
            <Link to="/exports/new" className="btn btn-primary">
              <IconPlus /> 创建出口
            </Link>
          </>
        }
      />
      <div className="page-body">
        <div className="container stack">
          <ErrorNote error={error} />
          <div className="grid grid-4">
            <Stat
              label="来源"
              icon={<IconGlobe />}
              value={sources?.length}
              loading={loading && !data}
              meta={
                <>
                  <span>URL {sources?.filter((s) => s.kind === 'url').length ?? 0}</span>
                  <span>自定义 {sources?.filter((s) => s.kind === 'manual').length ?? 0}</span>
                </>
              }
            />
            <Stat label="节点" icon={<IconServer />} value={nodes} loading={loading && !data} meta={<span>所有来源当前快照合计</span>} />
            <Stat
              label="订阅出口"
              icon={<IconLayers />}
              value={exports?.length}
              loading={loading && !data}
              meta={
                <>
                  <span>就绪 {count(exports, 'ready')}</span>
                  <span>禁用 {count(exports, 'disabled')}</span>
                </>
              }
            />
            <Stat
              label="需要关注"
              icon={<span className={`dot ${problems.length ? 'error' : 'ready'}`} />}
              value={problems.length}
              loading={loading && !data}
              meta={<span>{problems.length ? '错误或使用旧快照' : '一切正常'}</span>}
            />
          </div>

          {problems.length > 0 && (
            <section className="stack" style={{ gap: 12 }}>
              <h2 className="section-title">需要关注</h2>
              <div className="list">
                {problems.map((p) => (
                  <Link key={p.key} to={p.to} className="list-item">
                    <StatusDot status={p.status} label="" />
                    <span className="badge">{p.kind}</span>
                    <div className="grow">
                      <div className="item-title truncate">{p.name}</div>
                      <div className="small muted truncate">{p.msg}</div>
                    </div>
                    <IconChevronRight />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <div className="grid grid-2">
            <RecentList
              title="来源"
              to="/sources"
              items={sources}
              empty="还没有来源"
              render={(s: Source) => (
                <Link key={s.id} to={`/sources/${s.id}`} className="list-item">
                  <div className="item-icon">{s.kind === 'url' ? <IconGlobe /> : <IconServer />}</div>
                  <div className="grow">
                    <div className="item-title truncate">{s.name}</div>
                    <div className="xs subtle">
                      {s.node_count} 个节点 · {s.kind === 'url' ? `更新于 ${timeAgo(s.last_success_at)}` : '自定义'}
                    </div>
                  </div>
                  <StatusDot status={s.status} />
                </Link>
              )}
            />
            <RecentList
              title="订阅出口"
              to="/exports"
              items={exports}
              empty="还没有订阅出口"
              render={(e: ExportView) => (
                <Link key={e.id} to={`/exports/${e.id}`} className="list-item">
                  <div className="item-icon">
                    <IconLayers />
                  </div>
                  <div className="grow">
                    <div className="item-title truncate">{e.name}</div>
                    <div className="xs subtle">
                      {e.source_ids.length} 个来源 · {e.mode === 'template' ? '模板模式' : '继承模式'} · 生成于{' '}
                      {timeAgo(e.last_success_at)}
                    </div>
                  </div>
                  <StatusDot status={e.status} />
                </Link>
              )}
            />
          </div>
        </div>
      </div>
    </>
  )
}

function Stat({
  label,
  icon,
  value,
  loading,
  meta,
}: {
  label: string
  icon: React.ReactNode
  value: number | undefined
  loading: boolean
  meta?: React.ReactNode
}) {
  return (
    <div className="card stat">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{loading ? <Skeleton h={32} w={60} /> : (value ?? 0)}</div>
      <div className="stat-meta">{meta}</div>
    </div>
  )
}

function RecentList<T>({
  title,
  to,
  items,
  render,
  empty,
}: {
  title: string
  to: string
  items: T[] | undefined
  render: (item: T) => React.ReactNode
  empty: string
}) {
  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="row between">
        <h2 className="section-title">{title}</h2>
        <Link to={to} className="btn btn-ghost btn-sm">
          查看全部 <IconChevronRight />
        </Link>
      </div>
      <div className="list">
        {items === undefined ? (
          <div className="list-item">
            <Skeleton h={32} />
          </div>
        ) : items.length === 0 ? (
          <div className="list-item muted small" style={{ justifyContent: 'center', padding: 32 }}>
            {empty}
          </div>
        ) : (
          items.slice(0, 5).map(render)
        )}
      </div>
    </section>
  )
}
