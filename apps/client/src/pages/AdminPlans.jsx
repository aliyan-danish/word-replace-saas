import { useEffect, useState } from 'react'
import { apiGet, apiPatch } from '../lib/apiClient'
import BackNav from '../components/BackNav'

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

function bytesToMbInput(bytes) {
  if (bytes == null) return ''
  const mb = bytes / (1024 * 1024)
  return Number.isInteger(mb) ? String(mb) : String(Number(mb.toFixed(4)))
}

function PlanEditor({ plan, onSaved }) {
  const [monthlyJobLimit, setMonthlyJobLimit] = useState(
    plan.monthlyJobLimit == null ? '' : String(plan.monthlyJobLimit)
  )
  const [maxFilesPerJob, setMaxFilesPerJob] = useState(String(plan.maxFilesPerJob))
  const [maxUploadMb, setMaxUploadMb] = useState(bytesToMbInput(plan.maxUploadBytes))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Keep local form in sync if the parent refreshes the plan after save.
  useEffect(() => {
    setMonthlyJobLimit(plan.monthlyJobLimit == null ? '' : String(plan.monthlyJobLimit))
    setMaxFilesPerJob(String(plan.maxFilesPerJob))
    setMaxUploadMb(bytesToMbInput(plan.maxUploadBytes))
  }, [plan])

  async function handleSave(e) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const files = Number(maxFilesPerJob)
    const mb = Number(maxUploadMb)
    if (!Number.isInteger(files) || files <= 0) {
      setError('Max files per job must be a positive integer.')
      return
    }
    if (!(mb > 0)) {
      setError('Max upload size must be a positive number (MB).')
      return
    }

    let monthly = null
    if (monthlyJobLimit.trim() !== '') {
      monthly = Number(monthlyJobLimit)
      if (!Number.isInteger(monthly) || monthly <= 0) {
        setError('Monthly job limit must be blank (unlimited) or a positive integer.')
        return
      }
    }

    const maxUploadBytes = Math.round(mb * 1024 * 1024)

    setSaving(true)
    try {
      const updated = await apiPatch(`/api/admin/plans/${plan.id}`, {
        monthlyJobLimit: monthly,
        maxFilesPerJob: files,
        maxUploadBytes,
      })
      setSuccess('Plan saved.')
      onSaved(updated)
    } catch (err) {
      setError(err?.message || 'Failed to save plan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSave}
      className="card p-6"
    >
      <h2 className="font-display text-base font-semibold text-paper">{plan.name}</h2>
      <p className="mt-1 truncate font-mono text-xs text-paper/50">{plan.id}</p>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-paper/80">
            Monthly job limit{' '}
            <span className="font-normal text-paper/50">(blank = unlimited)</span>
          </span>
          <input
            type="number"
            min="1"
            step="1"
            value={monthlyJobLimit}
            onChange={(e) => setMonthlyJobLimit(e.target.value)}
            placeholder="Unlimited"
            className="field mt-1.5"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-paper/80">Max files per job</span>
          <input
            type="number"
            min="1"
            step="1"
            required
            value={maxFilesPerJob}
            onChange={(e) => setMaxFilesPerJob(e.target.value)}
            className="field mt-1.5"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-paper/80">Max upload size (MB)</span>
          <input
            type="number"
            min="0.01"
            step="any"
            required
            value={maxUploadMb}
            onChange={(e) => setMaxUploadMb(e.target.value)}
            className="field mt-1.5"
          />
        </label>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-remove/10 px-4 py-3 text-sm text-remove ring-1 ring-remove/30">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-4 rounded-lg bg-insert/10 px-4 py-3 text-sm text-insert ring-1 ring-insert/30">
          {success}
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="btn-primary mt-5"
      >
        {saving && <Spinner />}
        {saving ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}

export default function AdminPlans() {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await apiGet('/api/admin/plans')
        if (!cancelled) setPlans(data.plans || [])
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load plans.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  function handleSaved(updated) {
    setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  return (
    <div className="min-h-screen bg-ink text-paper">
      <main className="mx-auto max-w-6xl px-6 py-16">
        <BackNav to="/admin" label="Admin" />

        <h1 className="mt-6 page-title">
          Manage Plans
        </h1>
        <p className="mt-2 text-sm text-paper/60">
          Edit Free and Pro job, file, and upload-size limits.
        </p>

        {loading && (
          <div className="mt-8 flex items-center gap-3 text-sm text-paper/60">
            <Spinner />
            Loading plans…
          </div>
        )}

        {!loading && error && (
          <div className="mt-8 rounded-lg bg-remove/10 px-4 py-3 text-sm text-remove ring-1 ring-remove/30">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {plans.map((plan) => (
              <PlanEditor key={plan.id} plan={plan} onSaved={handleSaved} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
