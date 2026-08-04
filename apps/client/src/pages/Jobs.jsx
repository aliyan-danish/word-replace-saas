import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, ApiError } from '../lib/apiClient'

// Tailwind classes for the status badge, one distinct look per JobStatus.
const STATUS_BADGE = {
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-100',
  REPLACING: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  FAILED: 'bg-red-50 text-red-700 ring-red-100',
}

function StatusBadge({ status }) {
  const cls = STATUS_BADGE[status] || 'bg-slate-50 text-slate-600 ring-slate-200'
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${cls}`}
    >
      {status}
    </span>
  )
}

function formatDate(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

// Where a job navigates when clicked — or null if it shouldn't be clickable.
function destinationFor(job) {
  if (job.status === 'PENDING') return `/jobs/${job.id}/search`
  if (job.status === 'COMPLETED' || job.status === 'FAILED') {
    return `/jobs/${job.id}/result`
  }
  return null // REPLACING (and any unknown status) is not clickable
}

function JobCardInner({ job }) {
  const showSummary =
    (job.status === 'COMPLETED' || job.status === 'FAILED') && job.searchWord != null

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="truncate font-medium text-slate-900">
          {job.originalName}
        </span>
        <StatusBadge status={job.status} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
          {job.isZip ? 'Zip' : 'Single file'}
        </span>
        <span>
          {job.fileCount} {job.fileCount === 1 ? 'file' : 'files'}
        </span>
        <span aria-hidden="true">·</span>
        <span>{formatDate(job.createdAt)}</span>
      </div>

      {showSummary && (
        <p className="mt-2 text-sm text-slate-600">
          <span className="font-medium text-slate-700">
            &ldquo;{job.searchWord}&rdquo;
          </span>{' '}
          →{' '}
          <span className="font-medium text-slate-700">
            {job.replaceWord === '' ? '(removed)' : `“${job.replaceWord}”`}
          </span>
          {job.totalMatches != null && (
            <>
              {' '}
              · {job.totalMatches} {job.totalMatches === 1 ? 'match' : 'matches'}
            </>
          )}
        </p>
      )}

      {job.status === 'FAILED' && job.errorMessage && (
        <p className="mt-2 text-xs text-red-600">{job.errorMessage}</p>
      )}

      {job.status === 'REPLACING' && (
        <p className="mt-2 text-xs text-indigo-600">Processing…</p>
      )}
    </>
  )
}

function JobItem({ job }) {
  const to = destinationFor(job)
  const baseCard =
    'block rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200'

  if (!to) {
    // REPLACING: render as a non-clickable, dimmed row.
    return (
      <div className={`${baseCard} cursor-default opacity-70`}>
        <JobCardInner job={job} />
      </div>
    )
  }

  return (
    <Link
      to={to}
      className={`${baseCard} transition hover:shadow hover:ring-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500`}
    >
      <JobCardInner job={job} />
    </Link>
  )
}

function Spinner() {
  return (
    <svg
      className="h-6 w-6 animate-spin text-indigo-600"
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

export default function Jobs() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [jobs, setJobs] = useState([])

  const fetchJobs = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiGet('/api/jobs')
      setJobs(data.jobs || [])
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to reach the server. Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Link to="/dashboard" className="text-sm text-indigo-600 hover:text-indigo-500">
          ← Dashboard
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
          Job History
        </h1>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <div className="mt-8">
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
              {error}
            </div>
            <button
              type="button"
              onClick={fetchJobs}
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Retry
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="mt-8 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
            <p className="text-sm text-slate-500">
              No jobs yet — upload a file to get started.
            </p>
            <Link
              to="/upload"
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Upload a file
            </Link>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-3">
            {jobs.map((job) => (
              <JobItem key={job.id} job={job} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
