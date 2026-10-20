import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { NodeInput, NodeView, ProxyConfig } from '../api/types'
import { toYaml } from '../lib/format'
import { Button, ErrorNote, Modal, Note, Segmented } from './ui'

type Mode = 'form' | 'uri' | 'yaml'
type Proto = 'ss' | 'vless'

const SS_CIPHERS = [
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
]

interface FormState {
  proto: Proto
  name: string
  server: string
  port: string
  cipher: string
  password: string
  uuid: string
  tls: boolean
  servername: string
  network: 'tcp' | 'ws' | 'grpc'
  path: string
  host: string
  serviceName: string
  udp: boolean
}

const EMPTY: FormState = {
  proto: 'ss',
  name: '',
  server: '',
  port: '443',
  cipher: 'aes-128-gcm',
  password: '',
  uuid: '',
  tls: true,
  servername: '',
  network: 'tcp',
  path: '/',
  host: '',
  serviceName: '',
  udp: true,
}

function buildConfig(f: FormState): ProxyConfig {
  const base: ProxyConfig = {
    name: f.name.trim(),
    type: f.proto,
    server: f.server.trim(),
    port: Number(f.port),
  }
  if (f.udp) base.udp = true
  if (f.proto === 'ss') return { ...base, cipher: f.cipher, password: f.password }
  const cfg: ProxyConfig = { ...base, uuid: f.uuid.trim(), network: f.network }
  if (f.tls) {
    cfg.tls = true
    if (f.servername.trim()) cfg.servername = f.servername.trim()
  }
  if (f.network === 'ws') {
    const opts: Record<string, unknown> = { path: f.path || '/' }
    if (f.host.trim()) opts.headers = { Host: f.host.trim() }
    cfg['ws-opts'] = opts
  }
  if (f.network === 'grpc') cfg['grpc-opts'] = { 'grpc-service-name': f.serviceName.trim() }
  return cfg
}

export default function NodeEditor({
  open,
  onClose,
  sourceId,
  node,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  sourceId: string
  node?: NodeView
  onSaved: (nodes: NodeView[]) => void
}) {
  const editing = !!node
  const [mode, setMode] = useState<Mode>('uri')
  const [uri, setUri] = useState('')
  const [yaml, setYaml] = useState('')
  const [form, setForm] = useState<FormState>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setUri('')
    setForm(EMPTY)
    if (node) {
      setMode('yaml')
      setYaml(toYaml(node.config) + '\n')
    } else {
      setMode('uri')
      setYaml('')
    }
  }, [open, node])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const formValid =
    form.name.trim() &&
    form.server.trim() &&
    Number(form.port) > 0 &&
    Number(form.port) < 65536 &&
    (form.proto === 'ss' ? form.password : form.uuid.trim())

  const canSubmit = mode === 'uri' ? !!uri.trim() : mode === 'yaml' ? !!yaml.trim() : !!formValid

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    const body: NodeInput =
      mode === 'uri' ? { uri: uri.trim() } : mode === 'yaml' ? { yaml } : { config: buildConfig(form) }
    setBusy(true)
    setError(null)
    try {
      const nodes = node?.id
        ? await api.updateNode(sourceId, node.id, body)
        : await api.addNode(sourceId, body)
      onSaved(nodes)
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
      size="lg"
      title={editing ? '编辑节点' : '添加节点'}
      description={
        editing ? '保存将整体替换该节点配置（不是按字段合并）。' : '粘贴分享链接、编写节点 YAML，或使用表单录入。'
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" type="submit" form="node-form" loading={busy} disabled={!canSubmit}>
            {editing ? '保存节点' : '添加节点'}
          </Button>
        </>
      }
    >
      <form id="node-form" onSubmit={submit} className="stack" style={{ gap: 16 }}>
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'uri', label: '分享链接' },
            { value: 'yaml', label: 'YAML' },
            { value: 'form', label: '表单' },
          ]}
        />

        {mode === 'uri' && (
          <div className="field">
            <label className="label">ss:// 或 vless:// 链接</label>
            <textarea
              className="textarea"
              rows={4}
              placeholder="vless://uuid@example.com:443?security=tls&type=ws&path=%2Fws#节点名"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              autoFocus
            />
            <span className="hint">SS 插件参数和部分 VLESS 参数不支持链接形式，请改用 YAML。</span>
          </div>
        )}

        {mode === 'yaml' && (
          <div className="field">
            <label className="label">单个节点 YAML 对象</label>
            <textarea
              className="textarea"
              rows={12}
              spellCheck={false}
              placeholder={'name: 自建Trojan\ntype: trojan\nserver: example.com\nport: 443\npassword: replace-me\nsni: example.com'}
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              autoFocus
            />
            <span className="hint">支持任意 Mihomo 节点类型，服务端只做结构校验。</span>
          </div>
        )}

        {mode === 'form' && (
          <div className="stack" style={{ gap: 14 }}>
            <div className="row">
              <Segmented<Proto>
                value={form.proto}
                onChange={(v) => set('proto', v)}
                options={[
                  { value: 'ss', label: 'Shadowsocks' },
                  { value: 'vless', label: 'VLESS' },
                ]}
              />
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="名称">
                <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <div className="grid" style={{ gridTemplateColumns: '1fr 110px', gap: 12 }}>
                <Field label="服务器">
                  <input
                    className="input mono"
                    value={form.server}
                    placeholder="example.com"
                    onChange={(e) => set('server', e.target.value)}
                  />
                </Field>
                <Field label="端口">
                  <input
                    className="input mono"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => set('port', e.target.value)}
                  />
                </Field>
              </div>
              {form.proto === 'ss' ? (
                <>
                  <Field label="加密方式">
                    <select className="select" value={form.cipher} onChange={(e) => set('cipher', e.target.value)}>
                      {SS_CIPHERS.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="密码">
                    <input
                      className="input mono"
                      type="password"
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="UUID">
                    <input
                      className="input mono"
                      value={form.uuid}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      onChange={(e) => set('uuid', e.target.value)}
                    />
                  </Field>
                  <Field label="传输">
                    <select
                      className="select"
                      value={form.network}
                      onChange={(e) => set('network', e.target.value as FormState['network'])}
                    >
                      <option value="tcp">TCP</option>
                      <option value="ws">WebSocket</option>
                      <option value="grpc">gRPC</option>
                    </select>
                  </Field>
                  {form.network === 'ws' && (
                    <>
                      <Field label="WS 路径">
                        <input className="input mono" value={form.path} onChange={(e) => set('path', e.target.value)} />
                      </Field>
                      <Field label="WS Host（可选）">
                        <input className="input mono" value={form.host} onChange={(e) => set('host', e.target.value)} />
                      </Field>
                    </>
                  )}
                  {form.network === 'grpc' && (
                    <Field label="gRPC 服务名">
                      <input
                        className="input mono"
                        value={form.serviceName}
                        onChange={(e) => set('serviceName', e.target.value)}
                      />
                    </Field>
                  )}
                  <Field label="SNI（可选）">
                    <input
                      className="input mono"
                      value={form.servername}
                      disabled={!form.tls}
                      onChange={(e) => set('servername', e.target.value)}
                    />
                  </Field>
                </>
              )}
            </div>
            <div className="row row-wrap" style={{ gap: 20 }}>
              <label className="row small" style={{ cursor: 'pointer' }}>
                <input type="checkbox" className="check" checked={form.udp} onChange={(e) => set('udp', e.target.checked)} />
                启用 UDP
              </label>
              {form.proto === 'vless' && (
                <label className="row small" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" className="check" checked={form.tls} onChange={(e) => set('tls', e.target.checked)} />
                  TLS
                </label>
              )}
            </div>
            {form.proto === 'vless' && (
              <Note type="plain">Reality、flow 等高级参数请使用 YAML 或分享链接录入。</Note>
            )}
          </div>
        )}
        <ErrorNote error={error} />
      </form>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

export function ImportDialog({
  open,
  onClose,
  sourceId,
  currentCount,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  sourceId: string
  currentCount: number
  onSaved: (nodes: NodeView[], added: number) => void
}) {
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (open) {
      setContent('')
      setError(null)
    }
  }, [open])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const nodes = await api.importNodes(sourceId, content)
      onSaved(nodes, nodes.length - currentCount)
      onClose()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="lg"
      title="批量导入节点"
      description="追加到现有节点之后。整批先校验，任意一项错误都不会写入。"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" loading={busy} disabled={!content.trim()} onClick={submit}>
            导入
          </Button>
        </>
      }
    >
      <textarea
        className="textarea"
        rows={14}
        spellCheck={false}
        placeholder={'每行一个 ss:// / vless:// 链接，或其 Base64 编码\n也可以粘贴 proxies: 列表、节点 YAML 列表或单个节点 YAML'}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        autoFocus
      />
      <ErrorNote error={error} />
    </Modal>
  )
}
