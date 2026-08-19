import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { apiDownload, ApiError } from '../lib/apiClient'
import BackNav from '../components/BackNav'

export default function Result() {
  const { jobId } = useParams()
  const location = useLocation()

  // Passed by Replace.jsx; may be absent on a direct visit or after a reload.
  const summary = location.state
  const pairs = Array.isArray(summary?.wordPairs) && summary.wordPairs.length
    ? summary.wordPairs
    : summary &&
        typeof summary.searchWord === 'string' &&
        typeof summary.replaceWord === 'string'
      ? [{ word: summary.searchWord, replacement: summary.replaceWord }]
      : []
  const hasSummary = pairs.length > 0

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
    <div className="min-h-screen bg-ink text-paper">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <BackNav to="/dashboard" label="Dashboard" />

        <h1 className="mt-4 page-title">
          Result
        </h1>

        <div className="mt-8 card p-8">
          {hasSummary && (
            <div className="mb-6 rounded-lg bg-insert/10 px-4 py-3 text-sm text-insert ring-1 ring-insert/30">
              <p>
                Replaced {summary.totalMatches ?? 0}{' '}
                {(summary.totalMatches ?? 0) === 1 ? 'occurrence' : 'occurrences'}.
              </p>
              <ul className="mt-2 space-y-1">
                {pairs.map((pair) => (
                  <li key={pair.word}>
                    {pair.replacement === '' ? (
                      <>
                        Deleted{' '}
                        <span className="font-medium">&ldquo;{pair.word}&rdquo;</span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium">&ldquo;{pair.word}&rdquo;</span>
                        {' → '}
                        <span className="font-medium">&ldquo;{pair.replacement}&rdquo;</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-sm text-paper/60">
            Your replaced files are ready. Download them as a zip archive.
          </p>

          {error && (
            <div className="mt-5 rounded-lg bg-remove/10 px-4 py-3 text-sm text-remove ring-1 ring-remove/30">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="btn-primary mt-6 flex w-full gap-2"
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
          <Link to="/upload" className="text-sm text-paper/70 hover:text-paper">
            Upload another file
          </Link>
          <Link to="/jobs" className="text-sm text-paper/70 hover:text-paper">
            View job history
          </Link>
        </div>
      </main>
    </div>
  )
}
