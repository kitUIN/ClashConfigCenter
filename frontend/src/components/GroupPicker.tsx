import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { IconCheck, IconChevronDown, IconPlus, IconX } from './icons'

/**
 * 多选下拉：可从候选策略组中选择，也可输入自定义名称后回车。
 */
export function GroupPicker({
  value,
  onChange,
  options,
  loading,
  emptyText = '没有可选的策略组',
  placeholder = '选择或输入策略组',
}: {
  value: string[]
  onChange: (v: string[]) => void
  options: string[]
  loading?: boolean
  emptyText?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const q = query.trim()
  const filtered = useMemo(
    () => options.filter((o) => !q || o.toLowerCase().includes(q.toLowerCase())),
    [options, q],
  )
  const canCreate = !!q && !options.includes(q) && !value.includes(q)
  // 候选项：[自定义?, ...筛选结果]
  const items: { name: string; custom?: boolean }[] = [
    ...(canCreate ? [{ name: q, custom: true }] : []),
    ...filtered.map((name) => ({ name })),
  ]

  useEffect(() => setActive(0), [q, open])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function toggle(name: string) {
    const v = name.trim()
    if (!v) return
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
    setQuery('')
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActive((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = open ? items[active] : undefined
      if (item) toggle(item.name)
      else if (q && !value.includes(q)) toggle(q)
    } else if (e.key === ',') {
      e.preventDefault()
      if (q && !value.includes(q)) toggle(q)
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation()
        setOpen(false)
      }
    } else if (e.key === 'Backspace' && !query && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  const known = new Set(options)

  return (
    <div className="combo">
      <div
        className={`tag-input combo-control ${open ? 'open' : ''}`}
        onMouseDown={(e) => {
          if (e.target === inputRef.current) return
          e.preventDefault()
          const wasOpen = open
          inputRef.current?.focus()
          setOpen(!wasOpen)
        }}
      >
        {value.map((g) => {
          const unknown = !loading && options.length > 0 && !known.has(g)
          return (
            <span
              key={g}
              className={`tag ${unknown ? 'tag-warn' : ''}`}
              title={unknown ? '当前配置中未找到该策略组' : undefined}
            >
              {g}
              <button
                type="button"
                tabIndex={-1}
                aria-label={`移除 ${g}`}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                }}
                onClick={() => onChange(value.filter((x) => x !== g))}
              >
                <IconX style={{ width: 12, height: 12 }} />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // 与旧版行为一致：未回车直接离开时也保留已输入的名称
            if (q && !value.includes(q)) onChange([...value, q])
            setQuery('')
            setOpen(false)
          }}
          onKeyDown={onKey}
        />
        <IconChevronDown className="icon combo-caret" />
      </div>
      {open && (
        <div className="combo-menu" role="listbox" ref={listRef}>
          {loading ? (
            <div className="combo-empty">加载中…</div>
          ) : items.length === 0 ? (
            <div className="combo-empty">{q ? '没有匹配的策略组' : emptyText}</div>
          ) : (
            items.map((it, i) => {
              const selected = !it.custom && value.includes(it.name)
              return (
                <div
                  key={(it.custom ? '+' : '') + it.name}
                  data-index={i}
                  role="option"
                  aria-selected={selected}
                  className={`combo-option ${i === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  // 阻止失焦，保持下拉展开以便连续多选
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(it.name)}
                >
                  {it.custom ? (
                    <>
                      <IconPlus />
                      <span className="grow truncate">
                        使用自定义「<b>{it.name}</b>」
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="combo-check">{selected && <IconCheck />}</span>
                      <span className="grow truncate">{it.name}</span>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
