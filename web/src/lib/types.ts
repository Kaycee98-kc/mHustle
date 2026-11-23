export type ScheduleType = 'appointment' | 'lesson' | 'potential'

export interface Client {
  id: string
  name: string
  company: string
  address: string
  contact: string
  email: string
  course: string
  partner: string
  remarks: string
  schedule_type: ScheduleType
  appointment_date: string | null
  appointment_time: string | null
  lesson_date_from: string | null
  lesson_date_to: string | null
  lesson_time_from: string | null
  lesson_time_to: string | null
  emailed: boolean
  emailed_at: string | null
  whatsapped?: boolean
  whatsapped_at?: string | null
  created_at: string
  updated_at: string
  reminder_reference: string | null
}

export interface Feedback {
  id: string
  client_id: string
  content: string
  created_at: string
  updated_at: string
  postpone_date?: string | null
  postpone_time?: string | null
  previous_date?: string | null
  previous_time?: string | null
}

export interface Partner {
  id: string
  name: string
  role: 'Partner' | 'Consultant'
  phone: string
  email: string
}

export type TaskType = 'initial_email' | 'next_monday' | 'appointment_feedback'

export interface FollowUpTask {
  id: string
  client_id: string
  feedback_id: string | null
  task_type: TaskType
  title: string
  description: string
  priority: 'urgent' | 'high' | 'normal'
  due_at: string
  remind_at: string
  completed: boolean
  completed_at: string | null
  cancelled: boolean
  created_at: string
  updated_at: string
  reminder_reference: string | null
  notification_status: string
}

export interface HustleTask {
  id: string
  remarks: string
  date: string | null
  time: string | null
  completed?: boolean
  completed_at?: string | null
  created_at: string
  updated_at: string
  reminder_reference: string | null
}

export interface WeeklyReport {
  id: string
  period_start: string
  period_end: string
  generated_at: string
  generation_type: 'automatic' | 'manual'
  generator: 'rule-based' | 'ai'
  content: string
  version: number
  status: 'generated' | 'failed'
}

export interface Settings {
  owner_id: string
  urgent_repeat_minutes: number
  email_repeat_minutes: number
  feedback_due_hours: number
  initial_email_due_hours: number
  monday_reminder_time: string
  quiet_start: string
  quiet_end: string
  sync_token_hash: string | null
}

export type Section = 'new' | 'clients' | 'feedback' | 'followup' | 'report' | 'tasks'

export const SCHEDULE_LABEL: Record<ScheduleType, string> = {
  appointment: 'Appointment',
  lesson: 'Lesson',
  potential: 'Potential',
}

export const TASK_ACTION: Record<TaskType, string> = {
  initial_email: 'Send initial email or WhatsApp',
  next_monday: 'Next-Monday follow-up',
  appointment_feedback: 'Urgent follow-up on appointment feedback',
}
