import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Briefcase, FileText, ListChecks, MessageSquareText, Settings as Gear, UserPlus, Users } from 'lucide-react'
import Login from './components/Login'
import SettingsSheet from './components/SettingsSheet'
import { ToastProvider } from './components/ui'
import { DataProvider, bucket, useData } from './lib/store'
import { supabase } from './lib/supabase'
import type { Section } from './lib/types'
import NewClient from './sections/NewClient'
import AllClients from './sections/AllClients'
import Feedback from './sections/Feedback'
import FollowUp from './sections/FollowUp'
import Report from './sections/Report'
import HustleTasks from './sections/HustleTasks'

const NAV: { id: Section; label: string; icon: typeof Users }[] = [
  { id: 'new', label: 'New Client', icon: UserPlus },
  { id: 'clients', label: 'All Clients', icon: Users },
  { id: 'feedback', label: 'Feedback', icon: MessageSquareText },
  { id: 'followup', label: 'Follow Up', icon: ListChecks },
  { id: 'report', label: 'Report', icon: FileText },
  { id: 'tasks', label: 'Hustle Tasks', icon: Briefcase },
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  return (
    <ToastProvider>
      {!ready ? null : !session ? <Login /> : (
        <DataProvider userId={session.user.id}>
          <Shell email={session.user.email ?? ''} />
        </DataProvider>
      )}
    </ToastProvider>
  )
}

function readDeepLink(): { section: Section | null; task: string | null } {
  const p = new URLSearchParams(window.location.search)
  const s = p.get('section') as Section | null
  return { section: s && NAV.some((n) => n.id === s) ? s : null, task: p.get('task') }
}

function Shell({ email }: { email: string }) {
  const initial = readDeepLink()
  const [section, setSection] = useState<Section>(initial.section ?? 'new')
  const [highlightTask, setHighlightTask] = useState<string | null>(initial.task)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { tasks, now } = useData()
  const missCount = tasks.filter((t) => bucket(t, now) === 'miss').length

  const go = useCallback((s: Section) => {
    setSection(s)
    window.scrollTo({ top: 0 })
  }, [])

  // Deep links from notifications (cold start and while open)
  useEffect(() => {
    if (initial.section) window.history.replaceState(null, '', '/')
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== 'navigate') return
      const u = new URL(e.data.url, window.location.origin)
      const s = u.searchParams.get('section') as Section | null
      if (s) go(s)
      setHighlightTask(u.searchParams.get('task'))
    }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go])

  useEffect(() => {
    const open = () => setSettingsOpen(true)
    window.addEventListener('mh-open-settings', open)
    return () => window.removeEventListener('mh-open-settings', open)
  }, [])

  // Hide the bottom navigation while the on-screen keyboard is likely open (mobile)
  useEffect(() => {
    const isTextInput = (el: EventTarget | null) => el instanceof HTMLElement &&
      (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
       (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type)))
    const onIn = (e: FocusEvent) => { if (isTextInput(e.target)) document.body.classList.add('kb-open') }
    const onOut = () => setTimeout(() => { if (!isTextInput(document.activeElement)) document.body.classList.remove('kb-open') }, 50)
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => { document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut) }
  }, [])

  const clearFeedbackFor = useCallback(() => setFeedbackFor(null), [])
  const title = section === 'new' && editingId ? 'Edit Client' : NAV.find((n) => n.id === section)!.label

  return (
    <div className="app">
      <header className="header">
        <h1 className="brand">mHustle</h1>
        <button type="button" className="icon-btn header-gear" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <Gear size={20} aria-hidden />
        </button>
      </header>

      <nav className="nav" aria-label="Sections">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={`nav-btn${section === id ? ' active' : ''}`}
            aria-current={section === id ? 'page' : undefined} onClick={() => go(id)}>
            <span className="nav-icon"><Icon size={22} strokeWidth={1.9} aria-hidden />
              {id === 'followup' && missCount > 0 && <span className="nav-badge" aria-label={`${missCount} missed`}>{missCount}</span>}
            </span>
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>

      <main className="main">
        <h2 className="page-title">{title}</h2>
        {/* Sections stay mounted so unsaved form input is preserved while navigating */}
        <div hidden={section !== 'new'}>
          <NewClient editingId={editingId} onEditDone={(id) => { setEditingId(null); if (id) { setExpandedId(id); go('clients') } }} />
        </div>
        <div hidden={section !== 'clients'}>
          <AllClients expandedId={expandedId} setExpandedId={setExpandedId}
            onEdit={(id) => { setEditingId(id); go('new') }}
            onAddFeedback={(id) => { setFeedbackFor(id); go('feedback') }}
            onDeleted={(id) => { if (editingId === id) setEditingId(null); setExpandedId(null) }} />
        </div>
        <div hidden={section !== 'feedback'}>
          <Feedback preselectClientId={feedbackFor} onPreselectUsed={clearFeedbackFor} />
        </div>
        <div hidden={section !== 'followup'}><FollowUp highlightTaskId={highlightTask} /></div>
        <div hidden={section !== 'report'}><Report /></div>
        <div hidden={section !== 'tasks'}><HustleTasks /></div>
      </main>

      {settingsOpen && <SettingsSheet email={email} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
