import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { api } from '../api/client'
import { IconLogout, IconMoon, IconSun, Logo } from './icons'
import { IconButton } from './ui'

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('ccc.theme', dark ? 'dark' : 'light')
  }, [dark])
  return [dark, () => setDark((d) => !d)] as const
}

function HealthBadge() {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    const check = () =>
      api
        .health()
        .then(() => alive && setOk(true))
        .catch(() => alive && setOk(false))
    check()
    const t = setInterval(check, 30000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  return (
    <span className="status small muted hide-sm" title="后端 /health 状态">
      <span className={`dot ${ok === null ? 'disabled' : ok ? 'ready' : 'error'}`} />
      {ok === null ? '检查中' : ok ? '服务正常' : '服务不可达'}
    </span>
  )
}

export default function Layout({ onLogout }: { onLogout: () => void }) {
  const [dark, toggle] = useTheme()
  const tabs = [
    { to: '/', label: '概览', end: true },
    { to: '/sources', label: '来源' },
    { to: '/exports', label: '订阅出口' },
  ]
  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <Link to="/" className="brand" aria-label="首页">
            <Logo className="brand-mark" />
          </Link>
          <span className="slash">/</span>
          <span className="crumb">
            <span className="avatar" />
            ClashConfigCenter
            <span className="badge badge-outline hide-sm">Mihomo</span>
          </span>
          <div className="header-spacer" />
          <HealthBadge />
          <a className="btn btn-ghost btn-sm hide-sm" href="/docs" target="_blank" rel="noreferrer">
            API 文档
          </a>
          <IconButton label={dark ? '切换到浅色' : '切换到深色'} onClick={toggle}>
            {dark ? <IconSun /> : <IconMoon />}
          </IconButton>
          <IconButton label="退出登录" onClick={onLogout}>
            <IconLogout />
          </IconButton>
        </div>
        <nav className="tabs">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">
        <span>ClashConfigCenter · 本地 Mihomo 订阅配置中心</span>
        <span className="mono">v0.1.0</span>
      </footer>
    </div>
  )
}
