import { useEffect, useRef, useState } from 'react'

/** State persisted in localStorage so unsaved form text survives navigation and app restarts. */
export function useDraft<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? { ...initial, ...JSON.parse(raw) } : initial
    } catch { return initial }
  })
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
  }, [key, value])
  const clear = () => { try { localStorage.removeItem(key) } catch { /* ignore */ } }
  return [value, setValue, clear]
}

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '')
