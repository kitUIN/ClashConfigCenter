import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { Source, SourceKind } from '../api/types'
import { IconGlobe, IconServer } from './icons'
import { Button, ErrorNote, Modal } from './ui'

const PRESETS = [
  { label: '30 分钟', value: 1800 },
  { label: '1 小时', value: 3600 },
  { label: '6 小时', value: 21600 },
  { label: '12 小时', value: 43200 },
  { label: '1 天', value: 86400 },
]

export default function SourceForm({
  open,
  onClose,
  source,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  source?: Source
  onSaved: (s: Source) => void
}) {
  const editing = !!source
  const [kind, setKind] = useState<SourceKind>('url')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [minutes, setMinutes] = useState('60')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!open) return
    setKind(source?.kind ?? 'url')
    setName(source?.name ?? '')
    setUrl(source?.url ?? '')
    setMinutes(String(Math.round((source?.refresh_interval_seconds ?? 3600) / 60)))
    setError(null)
  }, [open, source])

  const seconds = Math.round(Number(minutes) * 60)
  const nameInvalid = /[,\r\n]/.test(name)
  const intervalInvalid = kind === 'url' && (!Number.isFinite(seconds) || seconds < 60 || seconds > 604800)
  const canSubmit = name.trim() && !nameInvalid && (kind === 'manual' || (url.trim() && !intervalInvalid))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      let saved: Source
      if (editing) {
        const patch: Record<string, unknown> = {}
        if (name.trim() !== source.name) patch.name = name.trim()
        if (source.kind === 'url') {
          if (url.trim() !== source.url) patch.url = url.trim()
          if (seconds !== source.refresh_interval_seconds) patch.refresh_interval_seconds = seconds
        }
        saved = Object.keys(patch).length ? await api.patchSource(source.id, patch) : source
      } else {
        saved = await api.createSource(
          kind === 'url'
            ? { name: name.trim(), kind, url: url.trim(), refresh_interval_seconds: seconds }
            : { name: name.trim(), kind },
        )
      }
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={editing ? '编辑来源' : '添加来源'}
      description={editing ? '来源类型创建后不可修改。' : '从机场订阅拉取节点，或手动维护自建节点。'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" type="submit" form="source-form" loading={busy} disabled={!canSubmit}>
            {editing ? '保存' : '创建'}
          </Button>
        </>
      }
    >
      <form id="source-form" onSubmit={submit} className="stack" style={{ gap: 16 }}>
        {!editing && (
          <div className="choice-grid">
            <button type="button" className={`choice ${kind === 'url' ? 'on' : ''}`} onClick={() => setKind('url')}>
              <div className="choice-title">
                <span className="row">
                  <IconGlobe /> URL 订阅
                </span>
              </div>
              <div className="choice-desc">定时拉取远程订阅（Mihomo YAML / SS / VLESS 链接）</div>
            </button>
            <button
              type="button"
              className={`choice ${kind === 'manual' ? 'on' : ''}`}
              onClick={() => setKind('manual')}
            >
              <div className="choice-title">
                <span className="row">
                  <IconServer /> 自定义节点
                </span>
              </div>
              <div className="choice-desc">手动添加、导入并排序自建节点</div>
            </button>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="src-name">
            名称
          </label>
          <input
            id="src-name"
            className="input"
            value={name}
            maxLength={200}
            placeholder={kind === 'url' ? '例如：机场A' : '例如：自建节点'}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <span className="hint" style={nameInvalid ? { color: 'var(--red)' } : undefined}>
            名称会作为节点前缀 <code>[名称] 节点名</code>，不能包含逗号或换行。
          </span>
        </div>
        {kind === 'url' && (
          <>
            <div className="field">
              <label className="label" htmlFor="src-url">
                订阅 URL
              </label>
              <input
                id="src-url"
                className="input mono"
                type="url"
                value={url}
                placeholder="https://example.com/sub?token=..."
                onChange={(e) => setUrl(e.target.value)}
                style={{ fontSize: 13 }}
              />
              {editing && <span className="hint">修改 URL 后会保留原快照并标记为旧数据，直到新地址拉取成功。</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="src-interval">
                刷新周期
              </label>
              <div className="row row-wrap">
                <div className="input-group" style={{ width: 180 }}>
                  <input
                    id="src-interval"
                    className="input"
                    type="number"
                    min={1}
                    max={10080}
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                  />
                  <span className="input-addon">分钟</span>
                </div>
                {PRESETS.map((p) => (
                  <Button
                    key={p.value}
                    size="sm"
                    variant={seconds === p.value ? 'primary' : 'secondary'}
                    onClick={() => setMinutes(String(p.value / 60))}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <span className="hint" style={intervalInvalid ? { color: 'var(--red)' } : undefined}>
                范围 1 分钟 – 7 天。
              </span>
            </div>
          </>
        )}
        <ErrorNote error={error} />
      </form>
    </Modal>
  )
}
