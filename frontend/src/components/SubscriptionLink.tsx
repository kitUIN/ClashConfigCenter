import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { IconExternal, IconEye, IconEyeOff } from './icons'
import { CopyButton, IconButton, Note } from './ui'

type Mode = 'url' | 'qr' | 'clash'
const MODES: { value: Mode; label: string }[] = [
  { value: 'url', label: 'URL' },
  { value: 'qr', label: '二维码' },
  { value: 'clash', label: 'Clash 直接导入' },
]

export function SubscriptionLink({
  url,
  name,
  initiallyRevealed = false,
}: {
  url: string
  name: string
  initiallyRevealed?: boolean
}) {
  const [mode, setMode] = useState<Mode>('url')
  const [revealed, setRevealed] = useState(initiallyRevealed)
  const [qr, setQr] = useState<{ url: string; image?: string; failed?: boolean }>()

  useEffect(() => {
    if (mode !== 'qr') return
    let cancelled = false
    setQr(undefined)
    QRCode.toDataURL(url, { width: 288, margin: 4, errorCorrectionLevel: 'M' }).then(
      (image) => {
        if (!cancelled) setQr({ url, image })
      },
      () => {
        if (!cancelled) setQr({ url, failed: true })
      },
    )
    return () => {
      cancelled = true
    }
  }, [mode, url])

  const currentQr = qr?.url === url ? qr : undefined
  const clashUrl = `clash://install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`

  return (
    <div className="subscription-link stack" style={{ gap: 12 }}>
      <div className="segmented subscription-modes" role="group" aria-label="订阅链接模式">
        {MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            className={mode === item.value ? 'on' : ''}
            aria-pressed={mode === item.value}
            onClick={() => setMode(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === 'url' && (
        <div className="field">
          <span className="label">订阅 URL</span>
          <div className="copy-field">
            <span>{revealed ? url : url.replace(/([?&]token=)[^&#]*/, '$1••••••••••••')}</span>
            <IconButton
              small
              label={revealed ? '隐藏订阅链接' : '显示订阅链接'}
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? <IconEyeOff /> : <IconEye />}
            </IconButton>
            <CopyButton text={url} label="复制订阅链接" />
          </div>
          <span className="hint">复制 URL，在客户端添加订阅。</span>
        </div>
      )}

      {mode === 'qr' && (
        <div className="subscription-qr">
          {currentQr?.failed ? (
            <Note type="warning">无法生成二维码，链接可能过长，请切换到 URL 模式复制订阅链接。</Note>
          ) : currentQr?.image ? (
            <img src={currentQr.image} width={288} height={288} alt="订阅链接二维码" />
          ) : (
            <div className="subscription-qr-loading muted" role="status">正在生成二维码…</div>
          )}
          <span className="hint">使用客户端的扫码功能添加订阅，扫码设备需能访问订阅地址。</span>
        </div>
      )}

      {mode === 'clash' && (
        <div className="stack" style={{ gap: 12 }}>
          <div>
            <a className="btn btn-primary" href={clashUrl}>
              <IconExternal /> 导入到 Clash
            </a>
          </div>
          <span className="hint">
            需要已安装支持 Clash 导入协议的客户端。点击后允许浏览器打开客户端；若无响应，可切换到 URL 模式手动添加。
          </span>
        </div>
      )}
    </div>
  )
}
