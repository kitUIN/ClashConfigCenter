import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SubscriptionCredentials } from '../api/types'
import { IconKey } from './icons'
import { SubscriptionLink } from './SubscriptionLink'
import { Button, CopyField, ErrorNote, Modal, Note } from './ui'

/** 展示订阅凭据；之后也可在出口详情页再次查看和复制。 */
export function CredentialsModal({
  credentials,
  exportName,
  onClose,
  title = '订阅已就绪',
}: {
  credentials?: SubscriptionCredentials
  exportName: string
  onClose: () => void
  title?: string
}) {
  return (
    <Modal
      open={!!credentials}
      onClose={onClose}
      title={
        <span className="row">
          <IconKey /> {title}
        </span>
      }
      description="将订阅链接添加到 Mihomo / Clash 客户端即可使用。"
      footer={
        <Button variant="primary" onClick={onClose}>
          完成
        </Button>
      }
    >
      <Note type="info">之后可随时在出口详情页的「订阅链接」中再次复制。请勿将链接分享给他人。</Note>
      {credentials && (
        <SubscriptionLink
          key={credentials.subscription_url}
          url={credentials.subscription_url}
          name={exportName}
          initiallyRevealed
        />
      )}
      <div className="field">
        <label className="label">订阅 Token</label>
        <CopyField value={credentials?.token ?? ''} />
      </div>
    </Modal>
  )
}

export function RotateTokenDialog({
  exportId,
  open,
  onClose,
  onRotated,
}: {
  exportId: string
  open: boolean
  onClose: () => void
  onRotated: (c: SubscriptionCredentials) => void
}) {
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (open) {
      setCustom('')
      setError(null)
    }
  }, [open])
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="更换订阅 Token"
      description="旧 Token 会立即失效，所有使用旧链接的客户端需要更新订阅地址。"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                const c = await api.rotateToken(exportId, custom.trim() || undefined)
                onClose()
                onRotated(c)
              } catch (e) {
                setError(e)
              } finally {
                setBusy(false)
              }
            }}
          >
            更换 Token
          </Button>
        </>
      }
    >
      <div className="field">
        <label className="label">自定义 Token（可选）</label>
        <input
          className="input mono"
          value={custom}
          maxLength={512}
          placeholder="留空则自动生成安全随机 Token"
          onChange={(e) => setCustom(e.target.value)}
        />
      </div>
      <ErrorNote error={error} />
    </Modal>
  )
}
