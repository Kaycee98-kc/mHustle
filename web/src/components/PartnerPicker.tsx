import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Users } from 'lucide-react'
import { useData } from '../lib/store'

/** Comma-separated names <-> array */
export const splitNames = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean)
export const openSettings = () => window.dispatchEvent(new CustomEvent('mh-open-settings'))
export const joinNames = (a: string[]) => [...new Set(a)].join(', ')

/**
 * Dropdown with checkboxes to tick one or more Partners / Consultants from the
 * saved list (⚙ Settings). Names typed earlier that are not in the list are kept.
 */
export default function PartnerPicker({ id, value, onChange, onManage, compact }: {
  id?: string; value: string; onChange: (v: string) => void; onManage?: () => void; compact?: boolean
}) {
  const { partners } = useData()
  const [open, setOpenState] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLDivElement>(null)
  // compact mode (on Follow Up cards) saves once, when the dropdown closes
  const current = compact ? draft : value
  const selected = splitNames(current)
  const setOpen = (o: boolean) => {
    if (o) setDraft(value)
    else if (compact && draft !== value) onChange(draft)
    setOpenState(o)
  }
  const change = (v: string) => (compact ? setDraft(v) : onChange(v))
  const known = new Set(partners.map((p) => p.name))
  const extras = selected.filter((n) => !known.has(n))

  const closeRef = useRef(() => {})
  closeRef.current = () => setOpen(false)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('mousedown', close); document.addEventListener('touchstart', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const groups = useMemo(() => ([
    ['Partners', partners.filter((p) => p.role === 'Partner')],
    ['Consultants', partners.filter((p) => p.role === 'Consultant')],
  ] as const), [partners])

  const toggle = (name: string) =>
    change(joinNames(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]))

  return (
    <div className={`picker${compact ? ' picker-compact' : ''}`} ref={ref}>
      <button id={id} type="button" className="picker-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Users size={16} aria-hidden />
        <span className={selected.length ? '' : 'muted'}>{compact ? (selected.length ? 'Change' : 'Assign') : selected.length ? selected.join(', ') : 'Select partner / consultant'}</span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div className="picker-panel" role="listbox" aria-multiselectable="true">
          {!partners.length && <p className="hint">No partners saved yet.</p>}
          {groups.map(([label, list]) => list.length ? (
            <div key={label} className="picker-group">
              <div className="picker-group-label">{label}</div>
              {list.map((p) => (
                <label key={p.id} className="picker-item">
                  <input type="checkbox" checked={selected.includes(p.name)} onChange={() => toggle(p.name)} />
                  <span>{p.name}</span>
                  {selected.includes(p.name) && <Check size={14} aria-hidden className="picker-check" />}
                </label>
              ))}
            </div>
          ) : null)}
          {extras.length > 0 && (
            <div className="picker-group">
              <div className="picker-group-label">Not in your list</div>
              {extras.map((n) => (
                <label key={n} className="picker-item">
                  <input type="checkbox" checked onChange={() => toggle(n)} /><span>{n}</span>
                </label>
              ))}
            </div>
          )}
          <div className="picker-foot">
            {selected.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => change('')}>Clear</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); (onManage ?? openSettings)() }}>Manage list</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
