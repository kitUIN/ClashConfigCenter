import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ApiError } from '../api/client'
import { copyText } from '../lib/format'
import { IconAlert, IconCheck, IconCopy, IconInfo, IconMore, IconX } from './icons'

/* ---------------- Button ---------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  block?: boolean
}
export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  block,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}: BtnProps) {
  const cls = [
    'btn',
    `btn-${variant}`,
    size !== 'md' ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type} className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  children,
  className = '',
  small,
  bordered,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; small?: boolean; bordered?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn ${small ? 'icon-btn-sm' : ''} ${bordered ? 'bordered' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ---------------- Status ---------------- */
const STATUS_LABEL: Record<string, string> = {
  ready: '就绪',
  pending: '等待中',
  error: '错误',
  stale: '旧快照',
  disabled: '已禁用',
}
export function StatusDot({ status, label }: { status: string; label?: string }) {
  return (
    <span className="status">
      <span className={`dot ${status}`} />
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  )
}

/* ---------------- Note ---------------- */
export function Note({
  type = 'info',
  children,
}: {
  type?: 'info' | 'error' | 'warning' | 'success' | 'plain'
  children: ReactNode
}) {
  const icon =
    type === 'error' || type === 'warning' ? <IconAlert /> : type === 'success' ? <IconCheck /> : <IconInfo />
  return (
    <div className={`note ${type !== 'plain' ? `note-${type}` : ''}`} role={type === 'error' ? 'alert' : undefined}>
      {icon}
      <div className="note-body">{children}</div>
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  if (error instanceof ApiError && error.details.length > 1) {
    return (
      <Note type="error">
        请求未通过校验：
        <ul>
          {error.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </Note>
    )
  }
  return <Note type="error">{error instanceof Error ? error.message : String(error)}</Note>
}

/* ---------------- Modal ---------------- */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size,
  dismissable = true,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'lg'
  dismissable?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, dismissable])
  if (!open) return null
  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose()
      }}
    >
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          {description && <p className="card-desc">{description}</p>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/* ---------------- Confirm ---------------- */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = '确认',
  danger,
  requireText,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
  title: string
  description?: ReactNode
  confirmLabel?: string
  danger?: boolean
  requireText?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (open) {
      setError(null)
      setTyped('')
    }
  }, [open])
  const blocked = requireText !== undefined && typed !== requireText
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={blocked}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onConfirm()
                onClose()
              } catch (e) {
                setError(e)
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="muted">{description}</div>}
      {requireText !== undefined && (
        <div className="field">
          <label className="label">
            输入 <b className="mono">{requireText}</b> 以确认
          </label>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </div>
      )}
      <ErrorNote error={error} />
    </Modal>
  )
}

/* ---------------- Menu ---------------- */
export function Menu({ children, label = '更多操作' }: { children: ReactNode; label?: string }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const open = pos !== null
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const place = useCallback(() => {
    const btn = ref.current?.getBoundingClientRect()
    if (!btn) return
    const gap = 6
    const menuH = menuRef.current?.offsetHeight ?? 160
    const right = Math.max(8, window.innerWidth - btn.right)
    const spaceBelow = window.innerHeight - btn.bottom
    if (spaceBelow < menuH + gap + 8 && btn.top > spaceBelow) {
      setPos({ bottom: window.innerHeight - btn.top + gap, right })
    } else {
      setPos({ top: btn.bottom + gap, right })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    // 首次渲染后按真实菜单高度重新定位
    place()
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setPos(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    const onClose = () => setPos(null)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <div className="menu-wrap" ref={ref} onClick={(e) => e.preventDefault()}>
      <IconButton
        label={label}
        bordered
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          if (open) setPos(null)
          else place()
        }}
      >
        <IconMore />
      </IconButton>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="menu"
            role="menu"
            style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
            onClickCapture={() => setPos(null)}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  )
}

export function MenuItem({
  onSelect,
  icon,
  children,
  danger,
}: {
  onSelect: () => void
  icon?: ReactNode
  children: ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item ${danger ? 'danger' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onSelect()
      }}
    >
      {icon}
      {children}
    </button>
  )
}

/* ---------------- Copy ---------------- */
export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  const toast = useToast()
  return (
    <IconButton
      label={label}
      small
      onClick={async () => {
        const ok = await copyText(text)
        if (ok) {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } else toast.error('复制失败，请手动选择文本')
      }}
    >
      {done ? <IconCheck style={{ color: 'var(--green)' }} /> : <IconCopy />}
    </IconButton>
  )
}

export function CopyField({ value, mask }: { value: string; mask?: boolean }) {
  return (
    <div className="copy-field">
      <span>{mask ? '•'.repeat(Math.min(value.length, 32)) : value}</span>
      <CopyButton text={value} />
    </div>
  )
}

/* ---------------- Empty / skeleton ---------------- */
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}

export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} />
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="list">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="list-item" key={i}>
          <Skeleton h={32} w={32} />
          <div className="grow stack" style={{ gap: 8 }}>
            <Skeleton h={14} w="30%" />
            <Skeleton h={12} w="50%" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------------- Switch ---------------- */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------- Page shell ---------------- */
export function PageHero({
  title,
  description,
  actions,
  before,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  before?: ReactNode
}) {
  return (
    <div className="page-hero">
      <div className="page-hero-inner">
        <div style={{ minWidth: 0 }}>
          {before}
          <h1 className="page-title">{title}</h1>
          {description && <div className="page-desc">{description}</div>}
        </div>
        {actions && <div className="row row-wrap">{actions}</div>}
      </div>
    </div>
  )
}

/* ---------------- Toasts ---------------- */
interface ToastItem {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}
interface ToastApi {
  success: (m: string) => void
  error: (m: string) => void
  info: (m: string) => void
}
const ToastCtx = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const push = useCallback((type: ToastItem['type'], message: string) => {
    const id = ++seq.current
    setItems((list) => [...list.slice(-3), { id, type, message }])
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), type === 'error' ? 6000 : 3500)
  }, [])
  const apiRef = useRef<ToastApi>({
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  })
  return (
    <ToastCtx.Provider value={apiRef.current}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`toast ${t.type}`}>
              {t.type === 'error' ? <IconAlert /> : t.type === 'success' ? <IconCheck /> : <IconInfo />}
              <div className="grow">{t.message}</div>
              <IconButton
                label="关闭"
                small
                onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}
                style={{ margin: '-4px -6px -4px 0' }}
              >
                <IconX />
              </IconButton>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('ToastProvider missing')
  return ctx
}
