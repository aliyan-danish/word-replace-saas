import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiGetMe } from '../lib/apiClient'

// Guards admin-only pages. AuthContext only holds the JWT (no role), so we fetch
// GET /auth/me for the DB role. Backend requireAdmin still enforces ADMIN on every
// /api/admin/* call — this is UX gating only.
export default function AdminRoute({ children }) {
  const { isAuthenticated } = useAuth()
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function load() {
      setLoading(true)
      setFailed(false)
      try {
        const me = await apiGetMe()
        if (!cancelled) setRole(me.role)
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-paper/60">
          <svg
            className="h-5 w-5 animate-spin text-insert"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Checking access…
        </div>
      </div>
    )
  }

  // Failed fetch or non-admin → send to Dashboard (logged-in users stay in-app).
  if (failed || role !== 'ADMIN') {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
