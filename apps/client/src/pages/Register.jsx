import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { API_BASE } from '../lib/apiClient'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSubmitting(true)

    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        // 409 = email already registered, 400 = missing fields.
        if (res.status === 409) {
          setError('An account with this email already exists.')
        } else if (res.status === 400) {
          setError('Please enter both an email and a password.')
        } else {
          setError('Something went wrong. Please try again.')
        }
        return
      }

      setSuccess('Account created! Redirecting to sign in…')
      // Give the user a moment to read the success message before redirecting.
      setTimeout(() => navigate('/login'), 1200)
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="font-display text-2xl font-semibold tracking-tight text-paper">
            Word Replace
          </Link>
          <p className="mt-2 text-sm text-paper/60">Create your account</p>
        </div>

        <div className="card p-8">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {error && (
              <div className="rounded-lg bg-remove/10 px-4 py-3 text-sm text-remove ring-1 ring-remove/30">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-lg bg-insert/10 px-4 py-3 text-sm text-insert ring-1 ring-insert/30">
                {success}
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-paper/80 mb-1.5"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-paper/80 mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full"
            >
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-paper/60">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-insert hover:text-insert/80"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
