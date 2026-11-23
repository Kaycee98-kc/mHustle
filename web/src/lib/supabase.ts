import { createClient } from '@supabase/supabase-js'

// Tolerate common copy/paste slips: surrounding spaces and a trailing /rest/v1/
const rawUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

function validUrl(u: string) {
  try { return /^https?:$/.test(new URL(u).protocol) } catch { return false }
}

export const configError: string | null = !rawUrl || !key
  ? 'This deployment is missing its Supabase settings (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).'
  : !validUrl(rawUrl)
    ? 'VITE_SUPABASE_URL is not a valid web address. It should look like https://abcd1234.supabase.co'
    : null

export const configured = configError === null

export const supabase = createClient(configured ? rawUrl : 'http://localhost', configured ? key : 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mhustle-auth' },
})

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
  if (/Invalid API key/i.test(msg)) return 'Invalid API key — VITE_SUPABASE_ANON_KEY in Vercel must be the full publishable (sb_publishable_…) or anon key.'
  if (/JWT|not signed in/i.test(msg)) return 'Your session has expired. Please sign in again.'
  return msg
}
