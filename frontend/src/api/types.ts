export type SourceKind = 'url' | 'manual'
export type SourceStatus = 'pending' | 'ready' | 'error'
export type ExportStatus = 'disabled' | 'pending' | 'ready' | 'stale' | 'error'
export type ExportMode = 'template' | 'inherit'
export type Injection = 'grouped' | 'direct'

export interface Source {
  id: string
  name: string
  kind: SourceKind
  url: string | null
  refresh_interval_seconds: number
  created_at: string
  last_attempt_at: string | null
  last_success_at: string | null
  next_refresh_at: string | null
  last_error: string | null
  using_stale_snapshot: boolean
  status: SourceStatus
  node_count: number
  has_snapshot: boolean
}

export interface SourceCreate {
  name: string
  kind: SourceKind
  url?: string
  refresh_interval_seconds?: number
}

export interface SourcePatch {
  name?: string
  url?: string
  refresh_interval_seconds?: number
}

export type ProxyConfig = Record<string, unknown> & {
  name?: string
  type?: string
  server?: string
  port?: number
}

export interface NodeView {
  id: string | null
  position: number
  config: ProxyConfig
}

export type NodeInput = { config: ProxyConfig } | { yaml: string } | { uri: string }

export interface ExportConfig {
  name: string
  enabled?: boolean
  source_ids: string[]
  mode: ExportMode
  template_yaml?: string | null
  base_source_id?: string | null
  injection: Injection
  target_groups: string[]
}

export interface ExportCreate extends ExportConfig {
  token?: string
}

export type ExportPatch = Partial<ExportConfig>

export interface ExportView extends Required<Omit<ExportConfig, 'template_yaml' | 'base_source_id'>> {
  id: string
  template_yaml: string | null
  base_source_id: string | null
  created_at: string
  last_attempt_at: string | null
  last_success_at: string | null
  last_error: string | null
  source_errors: { source_id: string; message: string }[]
  using_stale_snapshot: boolean
  has_snapshot: boolean
  status: ExportStatus
}

export interface SubscriptionCredentials {
  token: string
  subscription_url: string
}

export type ExportCreated = ExportView & SubscriptionCredentials

export interface Preview {
  yaml: string
  digest: string
  node_count: number
  group_count: number
}
