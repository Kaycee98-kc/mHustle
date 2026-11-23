import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configured = Boolean(url && key)

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mhustle-auth' },
})

export const functionsUrl = `${url ?? ''}/functions/v1`

/** Turn Supabase/Postgres errors into readable messages. */
export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string } | null
  const msg = err?.message ?? String(e)
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'No connection. Your changes were not saved — please try again when online.'
  if (err?.code === '23514' || /check constraint/i.test(msg)) {
    if (/email_format/.test(msg)) return 'Please enter a valid email address.'
    if (/lesson_range/.test(msg)) return 'Lesson Date To cannot be earlier than Lesson Date From.'
    if (/lesson_time_range/.test(msg)) return 'Lesson Time To cannot be earlier than Lesson Time From on the same day.'
    if (/appointment_fields/.test(msg)) return 'Appointment Date and Appointment Time are required.'
    if (/lesson_fields/.test(msg)) return 'Lesson Date From and Lesson Time From are required.'
  }
  if (/JWT|not signed in/i.test(msg)) return 'Your session has expired. Please sign in again.'
  return msg
}
