import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api, auth } from './api/client'
import Layout from './components/Layout'
import { useToast } from './components/ui'
import Dashboard from './pages/Dashboard'
import ExportDetail from './pages/ExportDetail'
import ExportEditor from './pages/ExportEditor'
import Exports from './pages/Exports'
import Login from './pages/Login'
import SourceDetail from './pages/SourceDetail'
import Sources from './pages/Sources'

type AuthState = 'checking' | 'in' | 'out'

export default function App() {
  const [state, setState] = useState<AuthState>(auth.token ? 'checking' : 'out')
  const toast = useToast()

  useEffect(() => {
    const token = auth.token
    if (!token) return
    api
      .checkAuth(token)
      .then(() => setState('in'))
      .catch((e) => {
        // 网络错误时保留 Token，交由页面显示错误；仅 401 时登出。
        if (e?.status === 401) {
          auth.clear()
          setState('out')
        } else setState('in')
      })
  }, [])

  useEffect(
    () =>
      auth.onUnauthorized(() => {
        if (!auth.token) return
        auth.clear()
        setState('out')
        toast.error('管理 Token 已失效，请重新登录')
      }) as () => void,
    [toast],
  )

  if (state === 'checking') {
    return (
      <div className="auth-page">
        <span className="spinner" style={{ width: 20, height: 20 }} />
      </div>
    )
  }

  if (state === 'out') {
    return <Login onLogin={() => setState('in')} />
  }

  return (
    <Routes>
      <Route
        element={
          <Layout
            onLogout={() => {
              auth.clear()
              setState('out')
            }}
          />
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="sources" element={<Sources />} />
        <Route path="sources/:id" element={<SourceDetail />} />
        <Route path="exports" element={<Exports />} />
        <Route path="exports/new" element={<ExportEditor />} />
        <Route path="exports/:id" element={<ExportDetail />} />
        <Route path="exports/:id/edit" element={<ExportEditor />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
