import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { ExportView } from '../api/types'
import { IconEdit, IconHammer, IconLayers, IconPlus, IconTrash } from '../components/icons'
import {
  ConfirmDialog,
  Empty,
  ErrorNote,
  ListSkeleton,
  Menu,
  MenuItem,
  PageHero,
  StatusDot,
  Switch,
  useToast,
} from '../components/ui'
import { fullTime, timeAgo } from '../lib/format'
import { useAsync } from '../lib/useAsync'

export default function Exports() {
  const navigate = useNavigate()
  const toast = useToast()
  const exportsQ = useAsync(api.listExports, [])
  const sourcesQ = useAsync(api.listSources, [])
  const [deleting, setDeleting] = useState<ExportView>()
  const [busy, setBusy] = useState<string>()

  const sourceName = (id: string) => sourcesQ.data?.find((s) => s.id === id)?.name ?? id.slice(0, 8)
  const replace = (e: ExportView) =>
    exportsQ.setData((prev) => (prev ?? []).map((x) => (x.id === e.id ? e : x)))

  async function rebuild(e: ExportView) {
    setBusy(e.id)
    try {
      const next = await api.rebuildExport(e.id)
      replace(next)
      if (next.last_error) toast.error(`重建失败：${next.last_error}`)
      else toast.success(`「${e.name}」已重建`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(undefined)
    }
  }

  async function toggle(e: ExportView, enabled: boolean) {
    setBusy(e.id)
    try {
      replace(await api.patchExport(e.id, { enabled }))
      toast.success(enabled ? '已启用' : '已禁用，订阅链接立即停止响应')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(undefined)
    }
  }

  const data = exportsQ.data

  return (
    <>
      <PageHero
        title="订阅出口"
        description="组合多个来源生成一份 Mihomo 配置，每个出口拥有独立的订阅 Token。"
        actions={
          <Link to="/exports/new" className="btn btn-primary">
            <IconPlus /> 创建出口
          </Link>
        }
      />
      <div className="page-body">
        <div className="container stack" style={{ gap: 16 }}>
          <ErrorNote error={exportsQ.error} />
          {exportsQ.loading && !data ? (
            <ListSkeleton rows={3} />
          ) : data && data.length === 0 ? (
            <Empty
              icon={<IconLayers />}
              title="还没有订阅出口"
              description="选择来源、配置模板或继承上游分流规则，生成可直接在客户端使用的订阅链接。"
              action={
                <Link to="/exports/new" className="btn btn-primary">
                  <IconPlus /> 创建出口
                </Link>
              }
            />
          ) : (
            <div className="list">
              {(data ?? []).map((e) => (
                <div
                  key={e.id}
                  className="list-item clickable"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/exports/${e.id}`)}
                >
                  <div className="item-icon">
                    <IconLayers />
                  </div>
                  <div className="grow">
                    <div className="row">
                      <span className="item-title truncate">{e.name}</span>
                      <span className="badge">{e.mode === 'template' ? '模板' : '继承'}</span>
                      <span className="badge badge-outline hide-sm">
                        {e.injection === 'grouped' ? '按来源分组' : '直接注入'}
                      </span>
                    </div>
                    <div className="small muted truncate">
                      {e.source_ids.map(sourceName).join(' → ')}
                    </div>
                    {(e.last_error || e.source_errors.length > 0) && (
                      <div className="xs truncate" style={{ color: e.last_error ? 'var(--red)' : 'var(--amber)', marginTop: 2 }}>
                        {e.last_error ?? `来源错误：${e.source_errors.map((x) => sourceName(x.source_id)).join('、')}`}
                      </div>
                    )}
                  </div>
                  <div className="col-status hide-sm">
                    <StatusDot status={e.status} />
                  </div>
                  <div className="col-meta hide-sm small muted" title={fullTime(e.last_success_at)}>
                    {e.has_snapshot ? `生成于 ${timeAgo(e.last_success_at)}` : '尚未生成'}
                  </div>
                  <div className="row" onClick={(ev) => ev.stopPropagation()}>
                    <Switch
                      checked={e.enabled}
                      label={e.enabled ? '禁用出口' : '启用出口'}
                      disabled={busy === e.id}
                      onChange={(v) => toggle(e, v)}
                    />
                    <Menu>
                      <MenuItem icon={<IconHammer />} onSelect={() => rebuild(e)}>
                        使用现有快照重建
                      </MenuItem>
                      <MenuItem icon={<IconEdit />} onSelect={() => navigate(`/exports/${e.id}/edit`)}>
                        编辑配置
                      </MenuItem>
                      <div className="menu-sep" />
                      <MenuItem icon={<IconTrash />} danger onSelect={() => setDeleting(e)}>
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
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        title="删除订阅出口"
        danger
        confirmLabel="删除"
        description={
          <>
            删除「<b>{deleting?.name}</b>」后，其订阅链接立即失效。来源不受影响。
          </>
        }
        onConfirm={async () => {
          if (!deleting) return
          await api.deleteExport(deleting.id)
          exportsQ.setData((prev) => (prev ?? []).filter((x) => x.id !== deleting.id))
          toast.success('已删除')
        }}
      />
    </>
  )
}
