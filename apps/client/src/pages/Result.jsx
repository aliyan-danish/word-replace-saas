import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { apiDownload, ApiError } from '../lib/apiClient'

export default function Result() {
  const { jobId } = useParams()
  const location = useLocation()

  // Passed by Replace.jsx; may be absent on a direct visit or after a reload.
  const summary = location.state
  const hasSummary =
    !!summary &&
    typeof summary.searchWord === 'string' &&
    typeof summary.replaceWord === 'string'

  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    setError('')

    try {
      // apiDownload returns the zip Blob + the filename from Content-Disposition.
      const { blob, filename } = await apiDownload(`/api/jobs/${jobId}/download`)

      // Trigger a real "save file" via a temporary object URL + <a download>.
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      // Release the object URL so the Blob can be garbage-collected (no memory leak).
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to reach the server. Please try again.'
      )
    } finally {
      // Always re-enable the button so the user can retry after an error.
      setDownloading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <Link to="/dashboard" className="text-sm text-indigo-600 hover:text-indigo-500">
          ← Dashboard
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
          Result
        </h1>

        <div className="mt-8 bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8">
          {hasSummary && (
            <div className="mb-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-100">
              {summary.replaceWord === '' ? (
                <>
                  Deleted {summary.totalMatches ?? 0}{' '}
                  {(summary.totalMatches ?? 0) === 1 ? 'occurrence' : 'occurrences'} of{' '}
                  <span className="font-medium">&ldquo;{summary.searchWord}&rdquo;</span>.
                </>
              ) : (
                <>
                  Replaced {summary.totalMatches ?? 0}{' '}
                  {(summary.totalMatches ?? 0) === 1 ? 'occurrence' : 'occurrences'} of{' '}
                  <span className="font-medium">&ldquo;{summary.searchWord}&rdquo;</span>{' '}
                  with{' '}
                  <span className="font-medium">&ldquo;{summary.replaceWord}&rdquo;</span>.
                </>
              )}
            </div>
          )}

          <p className="text-sm text-slate-500">
            Your replaced files are ready. Download them as a zip archive.
          </p>

          {error && (
            <div className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading && (
              <svg
                className="h-4 w-4 animate-spin text-white"
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
            )}
            {downloading ? 'Preparing download…' : 'Download results'}
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link to="/upload" className="text-indigo-600 hover:text-indigo-500">
            Upload another file
          </Link>
          <Link to="/jobs" className="text-indigo-600 hover:text-indigo-500">
            View job history
          </Link>
        </div>
      </main>
    </div>
  )
}
