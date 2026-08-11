import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiGetMe } from '../lib/apiClient'

// Color-coded badges matching the Jobs page pattern (amber/indigo/emerald/red).
const STATUS_BADGE = {
  TRIAL: 'bg-amber-50 text-amber-700 ring-amber-100',
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  EXPIRED: 'bg-red-50 text-red-700 ring-red-100',
  CANCELED: 'bg-slate-50 text-slate-600 ring-slate-200',
}

function StatusBadge({ status }) {
  const cls = STATUS_BADGE[status] || 'bg-slate-50 text-slate-600 ring-slate-200'
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {status}
    </span>
  )
}

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

// Human-readable trial countdown. Uses whole days remaining (ceiling so "ends today"
// still shows as "Trial ends today" rather than a confusing "0 days").
function formatTrialEnds(trialEndsAt) {
  if (!trialEndsAt) return null
  const end = new Date(trialEndsAt)
  if (Number.isNaN(end.getTime())) return null

  const msLeft = end.getTime() - Date.now()
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))
  const dateLabel = end.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  if (daysLeft > 1) return `Trial ends in ${daysLeft} days (${dateLabel})`
  if (daysLeft === 1) return `Trial ends tomorrow (${dateLabel})`
  if (daysLeft === 0) return `Trial ends today (${dateLabel})`
  return `Trial ended on ${dateLabel}`
}

function formatLimits(limits) {
  if (!limits) return null
  const jobs =
    limits.monthlyJobLimit == null
      ? 'Unlimited jobs'
      : `${limits.monthlyJobLimit} jobs/month`
  const files = `${limits.maxFilesPerJob} files per upload`
  const mb = (limits.maxUploadBytes / (1024 * 1024)).toFixed(
    limits.maxUploadBytes % (1024 * 1024) === 0 ? 0 : 2
  )
  return `${jobs}, ${files}, ${mb}MB max`
}

function SubscriptionCard({ me }) {
  const { subscription, limits } = me
  const trialLabel =
    subscription.status === 'TRIAL' ? formatTrialEnds(subscription.trialEndsAt) : null
  const limitsLabel = formatLimits(limits)

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Your plan</h2>
        <span className="text-sm font-medium text-slate-700">{subscription.plan}</span>
        <StatusBadge status={subscription.status} />
      </div>

      {trialLabel && (
        <p className="mt-2 text-sm text-slate-500">{trialLabel}</p>
      )}

      {subscription.status === 'EXPIRED' && (
        <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">
          Your trial has ended — upgrade to Pro to continue uploading.
        </div>
      )}

      {subscription.status === 'CANCELED' && (
        <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">
          Your subscription is canceled. Upgrade to Pro to continue uploading.
        </div>
      )}

      {limitsLabel && (
        <p className="mt-3 text-sm text-slate-600">{limitsLabel}</p>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [me, setMe] = useState(null)
  const [meLoading, setMeLoading] = useState(true)
  const [meError, setMeError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setMeLoading(true)
      setMeError(null)
      try {
        const data = await apiGetMe()
        if (!cancelled) setMe(data)
      } catch (err) {
        // Don't break the rest of the Dashboard — Upload / Job History stay usable.
        if (!cancelled) {
          setMeError(err?.message || 'Could not load subscription status.')
        }
      } finally {
        if (!cancelled) setMeLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <span className="text-base font-semibold tracking-tight text-slate-900">
            Word Replace Tool
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Welcome back
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          You&apos;re signed in. Upload and manage your files here soon.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/upload"
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Upload New Files
          </Link>
          <Link
            to="/jobs"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            View Job History
          </Link>
          {/* Same role source as AdminRoute: GET /auth/me → role from DB. */}
          {me?.role === 'ADMIN' && (
            <Link
              to="/admin"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Admin Panel
            </Link>
          )}
        </div>

        {/* Subscription status — isolated so a fetch failure never hides the actions above. */}
        <section className="mt-10 max-w-lg">
          {meLoading && (
            <div className="flex items-center gap-3 rounded-2xl bg-white px-6 py-5 shadow-sm ring-1 ring-slate-200">
              <Spinner />
              <span className="text-sm text-slate-500">Loading plan…</span>
            </div>
          )}

          {!meLoading && meError && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
              {meError}
            </div>
          )}

          {!meLoading && !meError && me && <SubscriptionCard me={me} />}
        </section>
      </main>
    </div>
  )
}
