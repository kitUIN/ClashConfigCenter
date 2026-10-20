import { useState, type FormEvent } from 'react'
import { api, auth } from '../api/client'
import { Logo } from '../components/icons'
import { Button, ErrorNote } from '../components/ui'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = token.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      await api.checkAuth(value)
      auth.set(value, remember)
      onLogin()
    } catch (err) {
      setError(
        (err as { status?: number }).status === 401 ? new Error('Token 无效，请检查后重试') : err,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo className="auth-logo" />
        <h1>登录 ClashConfigCenter</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          使用首次启动时终端显示的管理 Token
        </p>
        <form onSubmit={submit}>
          <input
            className="input"
            type="password"
            placeholder="管理 Token"
            autoComplete="current-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoFocus
            style={{ height: 48, fontSize: 15 }}
          />
          <label className="row small muted" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              className="check"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            在此浏览器中记住
          </label>
          <ErrorNote error={error} />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={busy}
            disabled={!token.trim()}
            style={{ height: 48 }}
          >
            继续
          </Button>
        </form>
        <p className="xs subtle" style={{ marginTop: 24 }}>
          忘记 Token？在后端目录执行 <code className="kbd">uv run clash-config-center admin-token reset</code>
        </p>
      </div>
    </div>
  )
}
