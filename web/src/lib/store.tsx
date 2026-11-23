import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Client, Feedback, FollowUpTask, HustleTask, Settings, WeeklyReport } from './types'

interface Data {
  clients: Client[]
  feedback: Feedback[]
  tasks: FollowUpTask[]
  hustle: HustleTask[]
  reports: WeeklyReport[]
  settings: Settings | null
  loading: boolean
  error: string | null
  now: number
  refresh: () => Promise<void>
}

const Ctx = createContext<Data | null>(null)

export function DataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, setState] = useState<Omit<Data, 'refresh' | 'now'>>({
    clients: [], feedback: [], tasks: [], hustle: [], reports: [], settings: null, loading: true, error: null,
  })
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    try {
      // ensure the settings row exists (also registers the account for scheduled jobs)
      await supabase.from('settings').upsert({ owner_id: userId }, { onConflict: 'owner_id', ignoreDuplicates: true })
      const [c, f, t, h, r, s] = await Promise.all([
        supabase.from('clients').select('*').order('created_at', { ascending: false }),
        supabase.from('feedback').select('*').order('created_at', { ascending: false }),
        supabase.from('follow_up_tasks').select('*').eq('cancelled', false).order('due_at'),
        supabase.from('hustle_tasks').select('*').order('date', { ascending: true, nullsFirst: false }),
        supabase.from('weekly_reports').select('*').order('generated_at', { ascending: false }),
        supabase.from('settings').select('*').maybeSingle(),
      ])
      const err = c.error ?? f.error ?? t.error ?? h.error ?? r.error ?? s.error
      if (err) throw err
      setState({
        clients: c.data as Client[], feedback: f.data as Feedback[], tasks: t.data as FollowUpTask[],
        hustle: h.data as HustleTask[], reports: r.data as WeeklyReport[], settings: s.data as Settings | null,
        loading: false, error: null,
      })
    } catch (e) {
      setState((p) => ({ ...p, loading: false, error: (e as Error).message ?? 'Could not load data' }))
    }
  }, [userId])

  useEffect(() => {
    void refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') { void refresh(); setNow(Date.now()) } }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    const tick = setInterval(() => setNow(Date.now()), 60_000) // Miss detection updates every minute
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 5 * 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      clearInterval(tick); clearInterval(poll)
    }
  }, [refresh])

  const value = useMemo(() => ({ ...state, now, refresh }), [state, now, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): Data {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData outside provider')
  return v
}

/** Task bucket: To Follow Up / Miss / Completed */
export function bucket(t: FollowUpTask, now: number): 'todo' | 'miss' | 'done' {
  if (t.completed) return 'done'
  return new Date(t.due_at).getTime() < now ? 'miss' : 'todo'
}
