import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiGetMe, apiPatch } from '../lib/apiClient'

const STATUSES = ['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELED']
const ROLES = ['USER', 'ADMIN']

function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin text-indigo-600"
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
  )
}

function formatTrialEnd(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function UserRow({ user, currentUserId, onUpdated }) {
  const [status, setStatus] = useState(user.subscription?.status || '')
  const [role, setRole] = useState(user.role)
  const [busy, setBusy] = useState(null) // 'status' | 'role' | null
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    setStatus(user.subscription?.status || '')
    setRole(user.role)
  }, [user])

  const isSelf = user.id === currentUserId
  const hasSub = Boolean(user.subscription)

  async function changeStatus(next) {
    setError(null)
    setSuccess(null)
    setStatus(next)
    setBusy('status')
    try {
      await apiPatch(`/api/admin/users/${user.id}/subscription`, { status: next })
      setSuccess('Subscription updated.')
      onUpdated({
        ...user,
        subscription: { ...user.subscription, status: next },
      })
    } catch (err) {
      setStatus(user.subscription?.status || '')
      setError(err?.message || 'Failed to update subscription.')
    } finally {
      setBusy(null)
    }
  }

  async function changeRole(next) {
    setError(null)
    setSuccess(null)
    setRole(next)
    setBusy('role')
    try {
      const updated = await apiPatch(`/api/admin/users/${user.id}/role`, { role: next })
      setSuccess('Role updated.')
      onUpdated({ ...user, role: updated.role })
    } catch (err) {
      setRole(user.role)
      setError(err?.message || 'Failed to update role.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-4 py-3 text-sm text-slate-900">{user.email}</td>
      <td className="px-4 py-3">
        <select
          value={role}
          disabled={isSelf || busy === 'role'}
          onChange={(e) => changeRole(e.target.value)}
          title={isSelf ? 'You cannot change your own role here.' : undefined}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-sm text-slate-700">
        {user.subscription?.plan || '—'}
      </td>
      <td className="px-4 py-3">
        {hasSub ? (
          <select
            value={status}
            disabled={busy === 'status'}
            onChange={(e) => changeStatus(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 shadow-sm disabled:opacity-60 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-slate-400">No subscription</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {formatTrialEnd(user.subscription?.trialEndsAt)}
      </td>
      <td className="px-4 py-3 text-sm min-w-[10rem]">
        {busy && (
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <Spinner /> Saving…
          </span>
        )}
        {!busy && error && <span className="text-red-600">{error}</span>}
        {!busy && success && <span className="text-emerald-600">{success}</span>}
      </td>
    </tr>
  )
}

export default function AdminUsers() {
  const [users, setUsers] = useState([])
  const [currentUserId, setCurrentUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [me, data] = await Promise.all([
          apiGetMe(),
          apiGet('/api/admin/users'),
        ])
        if (!cancelled) {
          setCurrentUserId(me.id)
          setUsers(data.users || [])
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load users.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  function handleUpdated(updated) {
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-6xl px-6 py-16">
        <Link to="/admin" className="text-sm text-indigo-600 hover:text-indigo-500">
          ← Admin
        </Link>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">
          Manage Users
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Change roles and subscription status. Your own role control is disabled.
        </p>

        {loading && (
          <div className="mt-8 flex items-center gap-3 text-sm text-slate-500">
            <Spinner />
            Loading users…
          </div>
        )}

        {!loading && error && (
          <div className="mt-8 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="mt-8 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="min-w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Trial end</th>
                  <th className="px-4 py-3">Feedback</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    currentUserId={currentUserId}
                    onUpdated={handleUpdated}
                  />
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
