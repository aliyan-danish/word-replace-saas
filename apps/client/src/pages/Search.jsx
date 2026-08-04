import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiPost, ApiError } from '../lib/apiClient'

export default function Search() {
  const { jobId } = useParams()
  const navigate = useNavigate()

  const [word, setWord] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)

  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const [replacement, setReplacement] = useState('')

  const handleSearch = async (e) => {
    e.preventDefault()
    if (searching) return

    // Client-side guard; backend validates too.
    if (word.trim() === '') {
      setError('Please enter a word to search for.')
      return
    }

    setSearching(true)
    setError('')

    try {
      const data = await apiPost(`/api/jobs/${jobId}/search`, {
        word: word.trim(),
        caseSensitive,
        wholeWord,
      })
      // Replace any previously displayed results with the latest ones.
      setResult(data)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Unable to reach the server. Please try again.')
      }
    } finally {
      setSearching(false)
    }
  }

  const handleConfirmReplace = () => {
    // Pass the exact word/toggles that produced the shown results, plus the chosen
    // replacement, so the Replace page doesn't have to re-ask for them.
    navigate(`/jobs/${jobId}/replace`, {
      state: {
        word: result.word,
        replacement,
        caseSensitive: result.caseSensitive,
        wholeWord: result.wholeWord,
      },
    })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <Link to="/dashboard" className="text-sm text-indigo-600 hover:text-indigo-500">
          ← Dashboard
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
          Search
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Job ID: <span className="font-mono text-slate-700">{jobId}</span>
        </p>

        <div className="mt-8 bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8">
          <form onSubmit={handleSearch} className="space-y-5" noValidate>
            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="word"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Word to find
              </label>
              <input
                id="word"
                type="text"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="e.g. apple"
              />
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Case sensitive
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={wholeWord}
                  onChange={(e) => setWholeWord(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Whole word only
              </label>
            </div>

            <button
              type="submit"
              disabled={searching}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {searching && (
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
              {searching ? 'Searching…' : 'Search'}
            </button>
          </form>
        </div>

        {result && (
          <>
            <div className="mt-6 bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8">
              <div className="text-center">
                <p className="text-4xl font-semibold tracking-tight text-slate-900">
                  {result.totalOccurrences}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {result.totalOccurrences === 1 ? 'occurrence' : 'occurrences'} of{' '}
                  <span className="font-medium text-slate-700">
                    &ldquo;{result.word}&rdquo;
                  </span>
                  {result.totalOccurrences === 0 && ' — try a different word or toggles'}
                </p>
              </div>

              <ul className="mt-6 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {result.files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between px-4 py-2.5 text-sm"
                  >
                    <span className="truncate text-slate-700">{f.filename}</span>
                    <span className="ml-4 shrink-0 text-slate-400">
                      {f.occurrences} {f.occurrences === 1 ? 'match' : 'matches'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                Replace
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Replace every occurrence of{' '}
                <span className="font-medium text-slate-700">
                  &ldquo;{result.word}&rdquo;
                </span>
                . Leave the field empty to delete the word instead.
              </p>

              <div className="mt-4">
                <label
                  htmlFor="replacement"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Replacement word
                </label>
                <input
                  id="replacement"
                  type="text"
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="e.g. orange (or leave empty to delete)"
                />
              </div>

              <button
                type="button"
                onClick={handleConfirmReplace}
                className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Confirm &amp; Replace
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
