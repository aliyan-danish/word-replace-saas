import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiGetMe } from '../lib/apiClient'

// Color-coded badges matching the Jobs page pattern (amber/indigo/emerald/red).
const STATUS_BADGE = {
  TRIAL: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  ACTIVE: 'bg-insert/15 text-insert ring-insert/30',
  EXPIRED: 'bg-remove/15 text-remove ring-remove/30',
  CANCELED: 'bg-ink-elevated text-paper/60 ring-ink-border',
}

function StatusBadge({ status }) {
  const cls = STATUS_BADGE[status] || 'bg-ink-elevated text-paper/60 ring-ink-border'
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
    <div className="card p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-paper">Your plan</h2>
        <span className="text-sm font-medium text-paper/80">{subscription.plan}</span>
        <StatusBadge status={subscription.status} />
      </div>

      {trialLabel && (
        <p className="mt-2 text-sm text-paper/60">{trialLabel}</p>
      )}

      {subscription.status === 'EXPIRED' && (
        <div className="mt-3 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
          Your trial has ended — upgrade to Pro to continue uploading.
        </div>
      )}

      {subscription.status === 'CANCELED' && (
        <div className="mt-3 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
          Your subscription is canceled. Upgrade to Pro to continue uploading.
        </div>
      )}

      {limitsLabel && (
        <p className="mt-3 text-sm text-paper/70">{limitsLabel}</p>
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
    <div className="min-h-screen bg-ink text-paper">
      <header className="border-b border-ink-border">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <span className="font-display text-base font-semibold tracking-tight text-paper">
            Word Replace
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="btn-secondary"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="page-title">
          Welcome back
        </h1>
        <p className="mt-2 text-sm text-paper/60">
          Upload files, search a word, confirm replace, download results.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/upload"
            className="btn-primary"
          >
            Upload New Files
          </Link>
          <Link
            to="/jobs"
            className="btn-secondary"
          >
            View Job History
          </Link>
          {/* Same role source as AdminRoute: GET /auth/me → role from DB. */}
          {me?.role === 'ADMIN' && (
            <Link
              to="/admin"
              className="btn-secondary"
            >
              Admin Panel
            </Link>
          )}
        </div>

        {/* Subscription status — isolated so a fetch failure never hides the actions above. */}
        <section className="mt-10 max-w-lg">
          {meLoading && (
            <div className="flex items-center gap-3 card px-6 py-5">
              <Spinner />
              <span className="text-sm text-paper/60">Loading plan…</span>
            </div>
          )}

          {!meLoading && meError && (
            <div className="rounded-lg bg-remove/10 px-4 py-3 text-sm text-remove ring-1 ring-remove/30">
              {meError}
            </div>
          )}

          {!meLoading && !meError && me && <SubscriptionCard me={me} />}
        </section>
      </main>
    </div>
  )
}
