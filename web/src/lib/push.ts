import { supabase } from './supabase'

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function pushSupport(): { ok: boolean; reason?: string } {
  if (!VAPID) return { ok: false, reason: 'Push is not configured (VITE_VAPID_PUBLIC_KEY missing).' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    return { ok: false, reason: ios
      ? 'On iPhone, notifications work only after adding mHustle to the Home Screen (Share → Add to Home Screen) and opening it from there (iOS 16.4+).'
      : 'This browser does not support push notifications.' }
  }
  return { ok: true }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupport().ok) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function enablePush(): Promise<void> {
  const s = pushSupport()
  if (!s.ok) throw new Error(s.reason)
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notification permission was not granted. You can allow it in your device settings.')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID!) }))
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: sub.endpoint, p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '', user_agent: navigator.userAgent.slice(0, 200),
  }, { onConflict: 'endpoint' })
  if (error) throw error
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}
