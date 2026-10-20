const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return diff < 0 ? '刚刚' : '即将'
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['month', 2592000],
    ['year', 31536000],
  ]
  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0]
  for (const u of units) if (abs >= u[1]) chosen = u
  return rtf.format(Math.round(diff / chosen[1]), chosen[0])
}

export function fullTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

export function formatInterval(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} 天`
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`
  return `${seconds} 秒`
}

export function maskUrl(url: string | null): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    const q = u.search ? '?•••' : ''
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}${q}`
  } catch {
    return url
  }
}

export function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** Very small YAML-ish serializer for displaying node configs. */
export function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  const scalar = (v: unknown): string => {
    if (v === null || v === undefined) return 'null'
    if (typeof v === 'string') {
      return /^[\w.\-/@:]+$/.test(v) && !/^(true|false|null|yes|no|\d+(\.\d+)?)$/i.test(v)
        ? v
        : JSON.stringify(v)
    }
    return String(v)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value
      .map((item) =>
        item !== null && typeof item === 'object'
          ? `${pad}- ${toYaml(item, indent + 1).trimStart()}`
          : `${pad}- ${scalar(item)}`,
      )
      .join('\n')
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return entries
      .map(([k, v]) => {
        if (v !== null && typeof v === 'object') {
          const inner = toYaml(v, indent + 1)
          if (inner === '[]' || inner === '{}') return `${pad}${k}: ${inner}`
          return `${pad}${k}:\n${inner}`
        }
        return `${pad}${k}: ${scalar(v)}`
      })
      .join('\n')
  }
  return pad + scalar(value)
}
