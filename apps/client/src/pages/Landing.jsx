import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AnimatedDiff from '../components/AnimatedDiff'

export default function Landing() {
  const { isAuthenticated } = useAuth()

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
            Upload a .txt file or a zip of text files, search a word, confirm the
            counts, then replace it in the background. Download a zip of the
            results — originals are not overwritten.
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
                One .txt, or a .zip of .txt files. Zip-bomb size caps apply before
                anything is unzipped.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs text-paper/40">02</p>
              <h2 className="mt-2 font-display text-lg font-semibold">Search</h2>
              <p className="mt-2 text-sm text-paper/65">
                See per-file and total occurrence counts. Case-sensitive and
                whole-word toggles. Nothing is rewritten yet.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs text-paper/40">03</p>
              <h2 className="mt-2 font-display text-lg font-semibold">Replace</h2>
              <p className="mt-2 text-sm text-paper/65">
                Confirm, then a background job does the replace. Poll until
                complete and download the zip.
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-ink-border">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <h2 className="font-display text-lg font-semibold">Plans</h2>
            <p className="mt-2 max-w-xl text-sm text-paper/65">
              Every new account gets 7 days of Pro limits, no card. After that,
              expired trials are blocked until upgraded. Limits can be changed in
              the admin panel without a code deploy.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="card p-6">
                <h3 className="font-display text-base font-semibold">Free</h3>
                <ul className="mt-4 space-y-2 font-mono text-sm text-paper/80">
                  <li>5 jobs / month</li>
                  <li>3 files per upload</li>
                  <li>2 MB max upload</li>
                </ul>
              </div>
              <div className="card p-6">
                <h3 className="font-display text-base font-semibold">Pro</h3>
                <ul className="mt-4 space-y-2 font-mono text-sm text-paper/80">
                  <li>Unlimited jobs</li>
                  <li>100 files per upload</li>
                  <li>10 MB max upload</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
