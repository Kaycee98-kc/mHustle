import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react'

/** Large multiline field: starts at ~10 rows, grows with content, preserves line breaks. */
export function AutoTextarea({ minRows = 10, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [props.value])
  return <textarea ref={ref} rows={minRows} className="textarea" {...props} />
}

export function Field({ label, htmlFor, required, error, children }: {
  label: string; htmlFor?: string; required?: boolean; error?: string; children: ReactNode
}) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden> *</span>}</label>
      {children}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- toasts
type Toast = { id: number; kind: 'ok' | 'error'; text: string }
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}
            onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
