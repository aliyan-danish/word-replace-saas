import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, ApiError } from '../lib/apiClient'
import BackNav from '../components/BackNav'

// Tailwind classes for the status badge, one distinct look per JobStatus.
const STATUS_BADGE = {
  PENDING: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  REPLACING: 'bg-paper/10 text-paper/80 ring-ink-border',
  COMPLETED: 'bg-insert/15 text-insert ring-insert/30',
  FAILED: 'bg-remove/15 text-remove ring-remove/30',
}

function StatusBadge({ status }) {
  const cls = STATUS_BADGE[status] || 'bg-ink-elevated text-paper/60 ring-ink-border'
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
        <span className="truncate font-medium text-paper">
          {job.originalName}
        </span>
        <StatusBadge status={job.status} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-paper/50">
        <span className="rounded bg-ink px-1.5 py-0.5 text-paper/70">
          {job.isZip ? 'Zip' : 'Single file'}
        </span>
        <span>
          {job.fileCount} {job.fileCount === 1 ? 'file' : 'files'}
        </span>
        <span aria-hidden="true">·</span>
        <span>{formatDate(job.createdAt)}</span>
      </div>

      {showSummary && (
        <p className="mt-2 text-sm text-paper/70">
          <span className="font-mono text-remove line-through">
            {job.searchWord}
          </span>{' '}
          →{' '}
          <span className="font-mono text-insert">
            {job.replaceWord === '' ? '(removed)' : job.replaceWord}
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
        <p className="mt-2 text-xs text-remove">{job.errorMessage}</p>
      )}

      {job.status === 'REPLACING' && (
        <p className="mt-2 text-xs text-paper/50">Processing…</p>
      )}
    </>
  )
}

function JobItem({ job }) {
  const to = destinationFor(job)
  const baseCard =
    'block rounded-xl bg-ink-elevated p-5 ring-1 ring-ink-border'

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
      className={`${baseCard} transition hover:ring-insert/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-insert`}
    >
      <JobCardInner job={job} />
    </Link>
  )
}

function Spinner() {
  return (
    <svg
      className="h-6 w-6 animate-spin text-insert"
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
    <div className="min-h-screen bg-ink text-paper">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <BackNav to="/dashboard" label="Dashboard" />

        <h1 className="mt-4 page-title">
          Job History
        </h1>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <div className="mt-8">
            <div className="rounded-lg bg-remove/10 px-4 py-3 text-sm text-remove ring-1 ring-remove/30">
              {error}
            </div>
            <button
              type="button"
              onClick={fetchJobs}
              className="btn-primary mt-4"
            >
              Retry
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="mt-8 card p-8 text-center">
            <p className="text-sm text-paper/60">
              No jobs yet — upload a file to get started.
            </p>
            <Link
              to="/upload"
              className="btn-primary mt-6"
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
