import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiPost, ApiError } from '../lib/apiClient'
import BackNav from '../components/BackNav'

const emptyPair = () => ({ word: '', replacement: '' })

export default function Search() {
  const { jobId } = useParams()
  const navigate = useNavigate()

  const [pairs, setPairs] = useState([emptyPair()])
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)

  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const updatePair = (index, field, value) => {
    setPairs((current) =>
      current.map((pair, i) => (i === index ? { ...pair, [field]: value } : pair))
    )
  }

  const addPair = () => {
    setPairs((current) => [...current, emptyPair()])
  }

  const removePair = (index) => {
    setPairs((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)))
  }

  const filledPairs = pairs
    .map((pair) => ({
      word: pair.word.trim(),
      replacement: pair.replacement,
    }))
    .filter((pair) => pair.word !== '')

  const handleSearch = async (e) => {
    e.preventDefault()
    if (searching) return

    if (filledPairs.length === 0) {
      setError('Please enter at least one word to search for.')
      return
    }

    setSearching(true)
    setError('')

    try {
      const data = await apiPost(`/api/jobs/${jobId}/search`, {
        words: filledPairs.map((pair) => pair.word),
        caseSensitive,
        wholeWord,
      })
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
    navigate(`/jobs/${jobId}/replace`, {
      state: {
        pairs: filledPairs,
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

            <div className="space-y-4">
              {pairs.map((pair, index) => (
                <div
                  key={index}
                  className="space-y-3 rounded-lg p-4 ring-1 ring-ink-border"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-paper/80">
                      Word {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePair(index)}
                      disabled={pairs.length === 1}
                      className="text-sm text-remove hover:text-remove/80 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                  <div>
                    <label
                      htmlFor={`word-${index}`}
                      className="block text-sm font-medium text-paper/80 mb-1.5"
                    >
                      Find
                    </label>
                    <input
                      id={`word-${index}`}
                      type="text"
                      value={pair.word}
                      onChange={(e) => updatePair(index, 'word', e.target.value)}
                      className="field"
                      placeholder="e.g. apple"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`replacement-${index}`}
                      className="block text-sm font-medium text-paper/80 mb-1.5"
                    >
                      Replace with
                    </label>
                    <input
                      id={`replacement-${index}`}
                      type="text"
                      value={pair.replacement}
                      onChange={(e) => updatePair(index, 'replacement', e.target.value)}
                      className="field"
                      placeholder="e.g. orange (or leave empty to delete)"
                    />
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addPair}
              className="btn-secondary w-full"
            >
              Add another word
            </button>

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
                  {result.totalOccurrences === 1 ? 'occurrence' : 'occurrences'} across{' '}
                  {(result.words || []).length}{' '}
                  {(result.words || []).length === 1 ? 'word' : 'words'}
                  {result.totalOccurrences === 0 && ' — try different words or toggles'}
                </p>
              </div>

              <ul className="mt-6 space-y-4">
                {(result.byWord || []).map((item) => (
                  <li key={item.word}>
                    <p className="text-sm text-paper/80">
                      <span className="font-mono font-medium text-remove">
                        {item.word}
                      </span>
                      <span className="text-paper/50">
                        {' '}
                        · {item.totalOccurrences}{' '}
                        {item.totalOccurrences === 1 ? 'match' : 'matches'}
                      </span>
                    </p>
                    <ul className="mt-2 divide-y divide-ink-border rounded-lg ring-1 ring-ink-border">
                      {result.files.map((f) => {
                        const wordRow = (f.words || []).find((w) => w.word === item.word)
                        const count = wordRow ? wordRow.occurrences : 0
                        return (
                          <li
                            key={`${item.word}-${f.id}`}
                            className="flex items-center justify-between px-4 py-2.5 text-sm"
                          >
                            <span className="truncate text-paper/80">{f.filename}</span>
                            <span className="ml-4 shrink-0 text-paper/50">
                              {count} {count === 1 ? 'match' : 'matches'}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 card p-8">
              <h2 className="font-display text-base font-semibold tracking-tight text-paper">
                Replace
              </h2>
              <p className="mt-1 text-sm text-paper/60">
                These replacements run in a single pass on the original files.
                Leave a replacement empty to delete that word.
              </p>

              <ul className="mt-4 divide-y divide-ink-border rounded-lg ring-1 ring-ink-border">
                {filledPairs.map((pair) => (
                  <li
                    key={pair.word}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <span className="font-mono text-remove line-through">
                      {pair.word}
                    </span>
                    <span className="font-mono text-insert">
                      {pair.replacement === '' ? '(removed)' : pair.replacement}
                    </span>
                  </li>
                ))}
              </ul>

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
