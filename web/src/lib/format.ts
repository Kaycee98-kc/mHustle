import { sgtDateTime, shortDate, time12 } from '@shared/time.ts'
import type { Client } from './types'

export { sgtDateTime, shortDate, time12 }

/** One-line schedule summary for a client card. */
export function scheduleLine(c: Client): string {
  if (c.schedule_type === 'appointment') return `${shortDate(c.appointment_date)}, ${time12(c.appointment_time)}`
  if (c.schedule_type === 'lesson') {
    const from = `${shortDate(c.lesson_date_from)}, ${time12(c.lesson_time_from)}`
    const toDate = c.lesson_date_to && c.lesson_date_to !== c.lesson_date_from ? shortDate(c.lesson_date_to) : ''
    const toTime = c.lesson_time_to ? time12(c.lesson_time_to) : ''
    const to = [toDate, toTime].filter(Boolean).join(', ')
    return to ? `${from} → ${to}` : from
  }
  return 'No date required'
}

export const clientLabel = (c: Pick<Client, 'name' | 'company'>) => (c.company ? `${c.name} — ${c.company}` : c.name)

/** wa.me link for a phone number; 8-digit Singapore numbers get +65. */
export function waLink(contact: string): string | null {
  let d = contact.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  if (/^[689]\d{7}$/.test(d)) d = '65' + d
  return d.length >= 8 ? `https://wa.me/${d}` : null
}

/** "abdul.matin@hustle.com.sg" → "Abdul Matin" */
export function personName(email?: string | null): string {
  if (!email) return 'Unknown'
  return email.split('@')[0].split(/[._-]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Upcoming schedule instant used for "by schedule" sorting (null for Potential). */
export function scheduleKey(c: Client): string | null {
  if (c.schedule_type === 'appointment' && c.appointment_date) return `${c.appointment_date}T${(c.appointment_time ?? '00:00').slice(0, 5)}`
  if (c.schedule_type === 'lesson' && c.lesson_date_from) return `${c.lesson_date_from}T${(c.lesson_time_from ?? '00:00').slice(0, 5)}`
  return null
}
