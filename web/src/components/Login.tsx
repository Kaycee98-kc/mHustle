import { useState, type FormEvent } from 'react'
import { Field } from './ui'
import { configured, friendlyError, supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : friendlyError(error))
    setBusy(false)
  }

  return (
    <div className="login">
      <h1 className="brand">mHustle</h1>
      {!configured ? (
        <div className="card"><p>This deployment is missing its Supabase settings (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY). See the README.</p></div>
      ) : (
        <form className="card form" onSubmit={submit}>
          <Field label="Email" htmlFor="li-email">
            <input id="li-email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" htmlFor="li-pw" error={error || undefined}>
            <input id="li-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      )}
    </div>
  )
}
