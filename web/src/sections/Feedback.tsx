import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Pencil } from 'lucide-react'
import { AutoTextarea, Empty, Field, useToast } from '../components/ui'
import { newId, useDraft } from '../lib/hooks'
import { useData } from '../lib/store'
import { friendlyError, supabase } from '../lib/supabase'
import { clientLabel, sgtDateTime } from '../lib/format'
import type { Feedback as FB } from '../lib/types'

interface Draft { draftId: string; clientId: string; content: string }

export default function Feedback({ preselectClientId, onPreselectUsed }: { preselectClientId: string | null; onPreselectUsed: () => void }) {
  const { clients, feedback, refresh } = useData()
  const toast = useToast()
  const [draft, setDraft, clearDraft] = useDraft<Draft>('mh-draft-feedback', { draftId: newId(), clientId: '', content: '' })
  const [editing, setEditing] = useState<FB | null>(null)
  const [editContent, setEditContent] = useState('')
  const [errors, setErrors] = useState<{ client?: string; content?: string }>({})
  const [saving, setSaving] = useState(false)
  const [onlySelected, setOnlySelected] = useState(false)

  useEffect(() => {
    if (preselectClientId) {
      setEditing(null)
      setDraft((d) => ({ ...d, clientId: preselectClientId }))
      setOnlySelected(true)
      onPreselectUsed()
    }
  }, [preselectClientId, onPreselectUsed, setDraft])

  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const sorted = useMemo(() => [...clients].sort((a, b) => a.name.localeCompare(b.name)), [clients])
  const selected = draft.clientId ? byId.get(draft.clientId) : undefined

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (saving) return
    if (editing) return saveEdit()
    const e: typeof errors = {}
    if (!draft.clientId || !byId.has(draft.clientId)) e.client = 'Please select a client.'
    if (!draft.content.trim()) e.content = 'Feedback cannot be empty.'
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    try {
      const { error } = await supabase.from('feedback').insert({ id: draft.draftId, client_id: draft.clientId, content: draft.content })
      if (error && error.code !== '23505') throw error
      toast('ok', selected?.schedule_type === 'appointment'
        ? 'Feedback saved — urgent follow-up created in Follow Up.'
        : 'Feedback saved.')
      clearDraft()
      setDraft({ draftId: newId(), clientId: draft.clientId, content: '' })
      await refresh()
    } catch (err) { toast('error', friendlyError(err)) } finally { setSaving(false) }
  }

  async function saveEdit() {
    if (!editing) return
    if (!editContent.trim()) { setErrors({ content: 'Feedback cannot be empty.' }); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('feedback').update({ content: editContent }).eq('id', editing.id)
      if (error) throw error
      toast('ok', 'Feedback updated.')
      setEditing(null)
      await refresh()
    } catch (err) { toast('error', friendlyError(err)) } finally { setSaving(false) }
  }

  function startEdit(f: FB) {
    setEditing(f)
    setEditContent(f.content)
    setErrors({})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const history = onlySelected && draft.clientId ? feedback.filter((f) => f.client_id === draft.clientId) : feedback
  const editClient = editing ? byId.get(editing.client_id) : undefined

  return (
    <div className="stack">
      <form className="card form" onSubmit={submit} noValidate>
        {editing ? (
          <div className="edit-banner">Editing feedback for <strong>{editClient ? clientLabel(editClient) : 'client'}</strong> · created {sgtDateTime(editing.created_at)}</div>
        ) : (
          <Field label="Select Client" htmlFor="fb-client" required error={errors.client}>
            <select id="fb-client" value={draft.clientId} onChange={(e) => { setDraft((d) => ({ ...d, clientId: e.target.value })); setErrors((x) => ({ ...x, client: undefined })) }}>
              <option value="">Choose a client…</option>
              {sorted.map((c) => (
                <option key={c.id} value={c.id}>{clientLabel(c)}{c.schedule_type === 'potential' ? ' (Potential)' : ''}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Feedback" htmlFor="fb-content" required error={errors.content}>
          <AutoTextarea id="fb-content" value={editing ? editContent : draft.content}
            onChange={(e) => { if (editing) setEditContent(e.target.value); else setDraft((d) => ({ ...d, content: e.target.value })); setErrors((x) => ({ ...x, content: undefined })) }}
            placeholder="Responses, objections, concerns, suggestions, satisfaction, follow-up discussions, changed requirements…" />
        </Field>
        {!editing && selected?.schedule_type === 'appointment' && (
          <p className="hint">This is an Appointment client — submitting will create an urgent follow-up.</p>
        )}
        <div className="form-actions">
          {editing && <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel Edit</button>}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Submit Feedback'}</button>
        </div>
      </form>

      <div className="section-head">
        <h3>Feedback History</h3>
        {draft.clientId && (
          <label className="check small">
            <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
            <span>Selected client only</span>
          </label>
        )}
      </div>
      {!history.length && <Empty>No feedback recorded yet.</Empty>}
      {history.map((f) => {
        const c = byId.get(f.client_id)
        return (
          <article key={f.id} className={`card fb-card${editing?.id === f.id ? ' is-editing' : ''}`}>
            <div className="fb-top">
              <div>
                <div className="client-name">{c?.name ?? 'Unknown client'}</div>
                <div className="client-sub">{c?.company}{c?.schedule_type === 'potential' ? ' · Potential' : ''}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(f)}><Pencil size={14} aria-hidden /> Edit</button>
            </div>
            <div className="muted small">{sgtDateTime(f.created_at)}{f.updated_at !== f.created_at && ` · edited ${sgtDateTime(f.updated_at)}`}</div>
            <div className="pre">{f.content}</div>
          </article>
        )
      })}
    </div>
  )
}
