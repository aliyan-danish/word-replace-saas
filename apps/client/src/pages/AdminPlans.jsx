import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPatch } from '../lib/apiClient'

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
      className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
    >
      <h2 className="text-base font-semibold text-slate-900">{plan.name}</h2>
      <p className="mt-1 text-xs text-slate-400 font-mono truncate">{plan.id}</p>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            Monthly job limit{' '}
            <span className="font-normal text-slate-400">(blank = unlimited)</span>
          </span>
          <input
            type="number"
            min="1"
            step="1"
            value={monthlyJobLimit}
            onChange={(e) => setMonthlyJobLimit(e.target.value)}
            placeholder="Unlimited"
            className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Max files per job</span>
          <input
            type="number"
            min="1"
            step="1"
            required
            value={maxFilesPerJob}
            onChange={(e) => setMaxFilesPerJob(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Max upload size (MB)</span>
          <input
            type="number"
            min="0.01"
            step="any"
            required
            value={maxUploadMb}
            onChange={(e) => setMaxUploadMb(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-100">
          {success}
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
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
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-6xl px-6 py-16">
        <Link to="/admin" className="text-sm text-indigo-600 hover:text-indigo-500">
          ← Admin
        </Link>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">
          Manage Plans
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Edit FREE and PRO limits. Upload size is edited in MB and saved as bytes.
        </p>

        {loading && (
          <div className="mt-8 flex items-center gap-3 text-sm text-slate-500">
            <Spinner />
            Loading plans…
          </div>
        )}

        {!loading && error && (
          <div className="mt-8 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
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
