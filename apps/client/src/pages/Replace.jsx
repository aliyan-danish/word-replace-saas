import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { apiGet, apiPost, ApiError } from '../lib/apiClient'
import BackNav from '../components/BackNav'

const POLL_INTERVAL_MS = 2000
// Brief pause on the success screen before moving to the result page.
const SUCCESS_REDIRECT_MS = 1200

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-current"
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

export default function Replace() {
  const { jobId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  // Read the params Search.jsx passed via navigate(path, { state }).
  const params = location.state
  const pairs = Array.isArray(params?.pairs)
    ? params.pairs.filter(
        (pair) =>
          pair &&
          typeof pair.word === 'string' &&
          pair.word.trim() !== '' &&
          typeof pair.replacement === 'string'
      )
    : params &&
        typeof params.word === 'string' &&
        params.word.trim() !== '' &&
        typeof params.replacement === 'string'
      ? [{ word: params.word, replacement: params.replacement }]
      : []
  const hasValidParams = pairs.length > 0

  // phase: 'missing' | 'starting' | 'replacing' | 'completed' | 'failed' | 'error'
  //  - 'error'  = the initial replace POST failed (never started polling)
  //  - 'failed' = the worker reported FAILED (or polling lost connection)
  const [phase, setPhase] = useState(hasValidParams ? 'starting' : 'missing')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [statusData, setStatusData] = useState(null)

  const startedRef = useRef(false) // ensures the POST fires once per page load (StrictMode-safe)
  const activeRef = useRef(true) // false after unmount, so async callbacks don't setState / poll
  const pollRef = useRef(null)
  const tickRef = useRef(null)
  const navTimerRef = useRef(null)
  const startTimeRef = useRef(null)

  const clearTimers = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    if (navTimerRef.current) {
      clearTimeout(navTimerRef.current)
      navTimerRef.current = null
    }
  }

  const checkStatus = async () => {
    try {
      const data = await apiGet(`/api/jobs/${jobId}/status`)
      if (!activeRef.current) return

      if (data.status === 'COMPLETED') {
        clearTimers()
        setStatusData(data)
        setPhase('completed')
        // Hand the result context to the (upcoming) Result page.
        navTimerRef.current = setTimeout(() => {
          if (!activeRef.current) return
          navigate(`/jobs/${jobId}/result`, {
            state: {
              totalMatches: data.totalMatches,
              searchWord: data.searchWord,
              replaceWord: data.replaceWord,
              wordPairs: data.wordPairs || pairs,
            },
          })
        }, SUCCESS_REDIRECT_MS)
      } else if (data.status === 'FAILED') {
        clearTimers()
        setError(data.errorMessage || 'The replacement job failed.')
        setPhase('failed')
      }
      // otherwise still REPLACING (or PENDING) — keep polling.
    } catch (err) {
      if (!activeRef.current) return
      clearTimers()
      setError(
        err instanceof ApiError
          ? err.message
          : 'Lost connection while checking status. Please try again.'
      )
      setPhase('failed')
    }
  }

  const startPolling = () => {
    startTimeRef.current = Date.now()
    setElapsed(0)
    // Separate 1s ticker so the elapsed counter is smooth (poll is only every 2s).
    tickRef.current = setInterval(() => {
      if (!activeRef.current) return
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    pollRef.current = setInterval(checkStatus, POLL_INTERVAL_MS)
  }

  const startReplace = async () => {
    clearTimers()
    setError('')
    setStatusData(null)
    setPhase('starting')

    try {
      // 202 Accepted — the worker does the actual work; we then poll for status.
      await apiPost(`/api/jobs/${jobId}/replace`, {
        pairs,
        caseSensitive: Boolean(params.caseSensitive),
        wholeWord: Boolean(params.wholeWord),
      })
      if (!activeRef.current) return
      setPhase('replacing')
      startPolling()
    } catch (err) {
      if (!activeRef.current) return
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to reach the server. Please try again.'
      )
      setPhase('error')
    }
  }

  useEffect(() => {
    activeRef.current = true

    if (!hasValidParams) {
      setPhase('missing')
      return
    }

    // Fire the replace POST exactly once, even under StrictMode's double-mount.
    if (!startedRef.current) {
      startedRef.current = true
      startReplace()
    }

    // Cleanup on unmount: stop all timers so no polling/navigation continues in the
    // background, and mark inactive so any in-flight request's callback is ignored.
    return () => {
      activeRef.current = false
      clearTimers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const renderContext = () => {
    if (!hasValidParams) return null
    return (
      <ul className="mt-2 space-y-1 text-sm text-paper/60">
        {pairs.map((pair) => (
          <li key={pair.word}>
            {pair.replacement === '' ? (
              <>
                Deleting{' '}
                <span className="font-mono font-medium text-remove">
                  {pair.word}
                </span>
              </>
            ) : (
              <>
                Replacing{' '}
                <span className="font-mono font-medium text-remove">
                  {pair.word}
                </span>{' '}
                with{' '}
                <span className="font-mono font-medium text-insert">
                  {pair.replacement}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="min-h-screen bg-ink text-paper">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <BackNav to={`/jobs/${jobId}/search`} label="Search" />

        <h1 className="mt-4 page-title">
          Replace
        </h1>
        {renderContext()}

        <div className="mt-8 card p-8">
          {phase === 'missing' && (
            <div>
              <div className="rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
                No replacement details found. Please start from the Search page.
              </div>
              <Link
                to={`/jobs/${jobId}/search`}
                className="btn-primary mt-6 inline-flex w-full"
              >
                Go to Search
              </Link>
            </div>
          )}

          {(phase === 'starting' || phase === 'replacing') && (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="flex items-center gap-2 text-paper">
                <Spinner />
                <span className="text-sm font-medium">
                  {phase === 'starting' ? 'Queued — starting…' : 'Replacing your files…'}
                </span>
              </div>
              <p className="mt-3 text-xs text-paper/50">
                {phase === 'starting'
                  ? 'Handing your job to the worker.'
                  : `This runs in the background. Elapsed: ${elapsed}s`}
              </p>
            </div>
          )}

          {phase === 'completed' && (
            <div className="rounded-lg bg-insert/10 px-4 py-3 text-sm text-insert ring-1 ring-insert/30">
              Done! {statusData?.totalMatches ?? 0}{' '}
              {(statusData?.totalMatches ?? 0) === 1 ? 'replacement' : 'replacements'} made.
              Taking you to the results…
            </div>
          )}

          {(phase === 'failed' || phase === 'error') && (
            <div>
              <div className="rounded-lg bg-remove/10 px-4 py-3 text-sm text-remove ring-1 ring-remove/30">
                {error}
              </div>
              <button
                type="button"
                onClick={startReplace}
                className="btn-primary mt-6 w-full"
              >
                Try again
              </button>
              <Link
                to={`/jobs/${jobId}/search`}
                className="mt-3 block text-center text-sm text-paper/70 hover:text-paper"
              >
                Back to Search
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
