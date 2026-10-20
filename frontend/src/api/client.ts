import type {
  ExportCreate,
  ExportCreated,
  ExportConfig,
  ExportPatch,
  ExportView,
  NodeInput,
  NodeView,
  Preview,
  Source,
  SourceCreate,
  SourcePatch,
  SubscriptionCredentials,
} from './types'

const TOKEN_KEY = 'ccc.adminToken'
/** 可通过 VITE_API_BASE 指向其他后端（需在后端配置 CCC_CORS_ORIGINS）。默认同源，经 Vite 代理。 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''

export class ApiError extends Error {
  status: number
  details: string[]
  constructor(status: number, message: string, details: string[] = []) {
    super(message)
    this.status = status
    this.details = details
  }
}

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()

export const auth = {
  get token(): string | null {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY)
  },
  set(token: string, remember: boolean) {
    this.clear()
    ;(remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token)
  },
  clear() {
    sessionStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_KEY)
  },
  onUnauthorized(fn: Listener) {
    unauthorizedListeners.add(fn)
    return () => unauthorizedListeners.delete(fn)
  },
}

const LOC_LABELS: Record<string, string> = {
  name: '名称',
  url: 'URL',
  refresh_interval_seconds: '刷新周期',
  source_ids: '来源',
  target_groups: '目标策略组',
  template_yaml: '模板',
  base_source_id: '基础来源',
  token: 'Token',
  content: '导入内容',
  node_ids: '节点顺序',
}

function formatValidation(detail: unknown): string[] {
  if (!Array.isArray(detail)) return []
  return detail.map((err: { loc?: unknown[]; msg?: string }) => {
    const msg = (err.msg ?? '').replace(/^Value error, /, '')
    const field = (err.loc ?? []).filter((p) => p !== 'body' && typeof p === 'string').pop() as
      | string
      | undefined
    return field && LOC_LABELS[field] ? `${LOC_LABELS[field]}：${msg}` : msg
  })
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  token: string | null = auth.token,
): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, '无法连接后端服务，请确认服务已启动')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | undefined)?.detail
    if (res.status === 401) {
      unauthorizedListeners.forEach((fn) => fn())
    }
    if (Array.isArray(detail)) {
      const lines = formatValidation(detail)
      throw new ApiError(res.status, lines[0] ?? '请求参数无效', lines)
    }
    const message =
      typeof detail === 'string'
        ? detail
        : res.status === 404
          ? '资源不存在'
          : res.status >= 500
            ? `服务器错误（${res.status}）`
            : `请求失败（${res.status}）`
    throw new ApiError(res.status, message)
  }
  return data as T
}

const enc = encodeURIComponent

export const api = {
  checkAuth: (token: string) =>
    request<{ authenticated: boolean }>('GET', '/api/v1/auth/check', undefined, token),

  // Sources
  listSources: () => request<Source[]>('GET', '/api/v1/sources'),
  getSource: (id: string) => request<Source>('GET', `/api/v1/sources/${enc(id)}`),
  createSource: (body: SourceCreate) => request<Source>('POST', '/api/v1/sources', body),
  patchSource: (id: string, body: SourcePatch) =>
    request<Source>('PATCH', `/api/v1/sources/${enc(id)}`, body),
  deleteSource: (id: string) => request<void>('DELETE', `/api/v1/sources/${enc(id)}`),
  refreshSource: (id: string) => request<Source>('POST', `/api/v1/sources/${enc(id)}/refresh`),
  sourceGroups: (id: string) => request<string[]>('GET', `/api/v1/sources/${enc(id)}/groups`),

  // Nodes
  listNodes: (id: string) => request<NodeView[]>('GET', `/api/v1/sources/${enc(id)}/nodes`),
  addNode: (id: string, body: NodeInput) =>
    request<NodeView[]>('POST', `/api/v1/sources/${enc(id)}/nodes`, body),
  updateNode: (id: string, nodeId: string, body: NodeInput) =>
    request<NodeView[]>('PATCH', `/api/v1/sources/${enc(id)}/nodes/${enc(nodeId)}`, body),
  deleteNode: (id: string, nodeId: string) =>
    request<void>('DELETE', `/api/v1/sources/${enc(id)}/nodes/${enc(nodeId)}`),
  importNodes: (id: string, content: string) =>
    request<NodeView[]>('POST', `/api/v1/sources/${enc(id)}/nodes/import`, { content }),
  orderNodes: (id: string, nodeIds: string[]) =>
    request<NodeView[]>('PUT', `/api/v1/sources/${enc(id)}/nodes/order`, { node_ids: nodeIds }),

  // Exports
  listExports: () => request<ExportView[]>('GET', '/api/v1/exports'),
  getExport: (id: string) => request<ExportView>('GET', `/api/v1/exports/${enc(id)}`),
  createExport: (body: ExportCreate) => request<ExportCreated>('POST', '/api/v1/exports', body),
  patchExport: (id: string, body: ExportPatch) =>
    request<ExportView>('PATCH', `/api/v1/exports/${enc(id)}`, body),
  deleteExport: (id: string) => request<void>('DELETE', `/api/v1/exports/${enc(id)}`),
  previewExport: (body: ExportConfig) =>
    request<Preview>('POST', '/api/v1/exports/preview', body),
  rebuildExport: (id: string) => request<ExportView>('POST', `/api/v1/exports/${enc(id)}/rebuild`),
  rotateToken: (id: string, token?: string) =>
    request<SubscriptionCredentials>(
      'PUT',
      `/api/v1/exports/${enc(id)}/token`,
      token ? { token } : {},
    ),
  getCredentials: (id: string) =>
    request<SubscriptionCredentials>('GET', `/api/v1/exports/${enc(id)}/credentials`),

  health: () => request<{ status: string }>('GET', '/health', undefined, null),
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}
