import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiGet } from '../lib/apiClient'
import AnimatedDiff from '../components/AnimatedDiff'

function planTitle(name) {
  if (name === 'FREE') return 'Free'
  if (name === 'PRO') return 'Pro'
  return name
}

function planLines(plan) {
  const jobs =
    plan.monthlyJobLimit == null
      ? 'Unlimited jobs'
      : `${plan.monthlyJobLimit} jobs / month`
  const files = `${plan.maxFilesPerJob} files per upload`
  const mb = (plan.maxUploadBytes / (1024 * 1024)).toFixed(
    plan.maxUploadBytes % (1024 * 1024) === 0 ? 0 : 2
  )
  return [jobs, files, `${mb} MB max upload`]
}

export default function Landing() {
  const { isAuthenticated } = useAuth()
  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [plansError, setPlansError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadPlans() {
      setPlansLoading(true)
      setPlansError('')
      try {
        const data = await apiGet('/api/plans')
        if (cancelled) return
        const rows = Array.isArray(data.plans) ? data.plans : []
        const ordered = ['FREE', 'PRO']
          .map((name) => rows.find((plan) => plan.name === name))
          .filter(Boolean)
        setPlans(ordered.length > 0 ? ordered : rows)
      } catch {
        if (!cancelled) setPlansError('Could not load current plan limits.')
      } finally {
        if (!cancelled) setPlansLoading(false)
      }
    }
    loadPlans()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-ink text-paper">
      <header className="border-b border-ink-border">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <span className="font-display text-base font-semibold tracking-tight">
            Word Replace
          </span>
          <nav className="flex items-center gap-3">
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn-primary">
                Dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn-secondary">
                  Sign in
                </Link>
                <Link to="/register" className="btn-primary">
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-6 pb-16 pt-16 sm:pt-24">
          <AnimatedDiff />
          <p className="mt-8 max-w-xl text-base text-paper/70">
            Upload a .txt, .html, .xml, .docx, or .pdf — or a zip mixing those —
            then search one or more words, or a regex pattern. Confirm the counts,
            replace them in one pass in the background, and download a zip.
            Originals are not overwritten.
          </p>
          {!isAuthenticated && (
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="btn-primary">
                Start 7-day Pro trial
              </Link>
              <Link to="/login" className="btn-secondary">
                Sign in
              </Link>
            </div>
          )}
        </section>

        <section className="border-t border-ink-border">
          <div className="mx-auto grid max-w-5xl gap-8 px-6 py-14 sm:grid-cols-3">
            <div>
              <p className="font-mono text-xs text-paper/40">01</p>
              <h2 className="mt-2 font-display text-lg font-semibold">Upload</h2>
              <p className="mt-2 text-sm text-paper/65">
                One .txt / .html / .xml / .docx / .pdf, or a .zip mixing those. Zip-bomb
                size caps apply before anything is unzipped.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs text-paper/40">02</p>
              <h2 className="mt-2 font-display text-lg font-semibold">Search</h2>
              <p className="mt-2 text-sm text-paper/65">
                One word or several at once. Per-file and total counts.
                Case-sensitive and whole-word toggles, plus optional regex
                for advanced matching. Nothing is rewritten yet.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs text-paper/40">03</p>
              <h2 className="mt-2 font-display text-lg font-semibold">Replace</h2>
              <p className="mt-2 text-sm text-paper/65">
                Confirm, then a background job applies every pair in a single
                pass on the original files. Poll until complete and download
                the zip.
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-ink-border">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <h2 className="font-display text-lg font-semibold">Plans</h2>
            <p className="mt-2 max-w-xl text-sm text-paper/65">
              Every new account gets 7 days of Pro limits, no card. After that,
              expired trials are blocked until upgraded.
            </p>
            {plansLoading && (
              <p className="mt-8 text-sm text-paper/50">Loading plans…</p>
            )}
            {!plansLoading && plansError && (
              <div className="mt-8 rounded-lg bg-remove/10 px-4 py-3 text-sm text-remove ring-1 ring-remove/30">
                {plansError}
              </div>
            )}
            {!plansLoading && !plansError && (
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {plans.map((plan) => (
                  <div key={plan.name} className="card p-6">
                    <h3 className="font-display text-base font-semibold">
                      {planTitle(plan.name)}
                    </h3>
                    <ul className="mt-4 space-y-2 font-mono text-sm text-paper/80">
                      {planLines(plan).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
