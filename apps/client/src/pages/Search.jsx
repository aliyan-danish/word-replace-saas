import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiPost, ApiError } from '../lib/apiClient'
import BackNav from '../components/BackNav'

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
    <div className="min-h-screen bg-ink text-paper">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <BackNav to="/dashboard" label="Dashboard" />

        <h1 className="mt-4 page-title">
          Search
        </h1>
        <p className="mt-2 text-sm text-paper/60">
          Job ID: <span className="font-mono text-paper/70">{jobId}</span>
        </p>

        <div className="mt-8 card p-8">
          <form onSubmit={handleSearch} className="space-y-5" noValidate>
            {error && (
              <div className="rounded-lg bg-remove/10 px-4 py-3 text-sm text-remove ring-1 ring-remove/30">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="word"
                className="block text-sm font-medium text-paper/80 mb-1.5"
              >
                Word to find
              </label>
              <input
                id="word"
                type="text"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                className="field"
                placeholder="e.g. apple"
              />
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm text-paper/80">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                  className="h-4 w-4 rounded border-ink-border bg-ink text-insert focus:ring-insert"
                />
                Case sensitive
              </label>
              <label className="flex items-center gap-2 text-sm text-paper/80">
                <input
                  type="checkbox"
                  checked={wholeWord}
                  onChange={(e) => setWholeWord(e.target.checked)}
                  className="h-4 w-4 rounded border-ink-border bg-ink text-insert focus:ring-insert"
                />
                Whole word only
              </label>
            </div>

            <button
              type="submit"
              disabled={searching}
              className="btn-primary flex w-full items-center justify-center gap-2"
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
            <div className="mt-6 card p-8">
              <div className="text-center">
                <p className="font-display text-4xl font-semibold tracking-tight text-paper">
                  {result.totalOccurrences}
                </p>
                <p className="mt-1 text-sm text-paper/60">
                  {result.totalOccurrences === 1 ? 'occurrence' : 'occurrences'} of{' '}
                  <span className="font-mono font-medium text-remove">
                    {result.word}
                  </span>
                  {result.totalOccurrences === 0 && ' — try a different word or toggles'}
                </p>
              </div>

              <ul className="mt-6 divide-y divide-ink-border rounded-lg ring-1 ring-ink-border">
                {result.files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between px-4 py-2.5 text-sm"
                  >
                    <span className="truncate text-paper/80">{f.filename}</span>
                    <span className="ml-4 shrink-0 text-paper/50">
                      {f.occurrences} {f.occurrences === 1 ? 'match' : 'matches'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 card p-8">
              <h2 className="font-display text-base font-semibold tracking-tight text-paper">
                Replace
              </h2>
              <p className="mt-1 text-sm text-paper/60">
                Replace every occurrence of{' '}
                <span className="font-mono font-medium text-remove">
                  {result.word}
                </span>
                . Leave the field empty to delete the word instead.
              </p>

              <div className="mt-4">
                <label
                  htmlFor="replacement"
                  className="block text-sm font-medium text-paper/80 mb-1.5"
                >
                  Replacement word
                </label>
                <input
                  id="replacement"
                  type="text"
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                  className="field"
                  placeholder="e.g. orange (or leave empty to delete)"
                />
              </div>

              <button
                type="button"
                onClick={handleConfirmReplace}
                className="btn-primary mt-6 w-full"
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
