import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiPostForm, ApiError } from '../lib/apiClient'
import BackNav from '../components/BackNav'

const ACCEPTED_EXTENSIONS = ['.txt', '.html', '.htm', '.xml', '.docx', '.zip']
// After a successful upload we pause briefly on the summary, then move to search.
const REDIRECT_DELAY_MS = 1300

function getExtension(filename) {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

function isAcceptedFile(file) {
  return ACCEPTED_EXTENSIONS.includes(getExtension(file.name))
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function Upload() {
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('idle') // 'idle' | 'uploading' | 'success'
  const [result, setResult] = useState(null)
  const [isDragging, setIsDragging] = useState(false)

  const inputRef = useRef(null)
  const redirectTimer = useRef(null)
  const navigate = useNavigate()

  // Clear any pending redirect timer if the user leaves before it fires.
  useEffect(() => {
    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current)
    }
  }, [])

  const chooseFile = (candidate) => {
    if (!candidate) return
    if (!isAcceptedFile(candidate)) {
      setFile(null)
      setError('Only .txt, .html, .xml, .docx, or .zip files are allowed.')
      return
    }
    setError('')
    setFile(candidate)
  }

  const handleInputChange = (e) => {
    chooseFile(e.target.files?.[0])
    // Reset so selecting the same file again still fires onChange.
    e.target.value = ''
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (status === 'uploading') return
    chooseFile(e.dataTransfer.files?.[0])
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    if (status !== 'uploading') setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleUpload = async () => {
    if (!file || status === 'uploading') return

    setStatus('uploading')
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const data = await apiPostForm('/api/jobs/upload', formData)
      setResult(data)
      setStatus('success')

      // Auto-advance to the search step; the "Continue" button does the same instantly.
      redirectTimer.current = setTimeout(() => {
        navigate(`/jobs/${data.jobId}/search`)
      }, REDIRECT_DELAY_MS)
    } catch (err) {
      setStatus('idle')
      // Prefer the backend's specific message (via ApiError); fall back for network errors.
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Unable to reach the server. Please try again.')
      }
    }
  }

  const goToSearch = () => {
    if (redirectTimer.current) clearTimeout(redirectTimer.current)
    if (result) navigate(`/jobs/${result.jobId}/search`)
  }

  const isUploading = status === 'uploading'
  const isSuccess = status === 'success'

  return (
    <div className="min-h-screen bg-ink text-paper">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <BackNav to="/dashboard" label="Dashboard" />

        <h1 className="mt-4 page-title">
          Upload
        </h1>
        <p className="mt-2 text-sm text-paper/60">
          Upload a single .txt, .html, .xml, or .docx file, or a
          {' '}
          <span className="font-medium text-paper">.zip</span> mixing those types.
        </p>

        <div className="mt-8 card p-8">
          {isSuccess ? (
            <div>
              <div className="rounded-lg bg-insert/10 px-4 py-3 text-sm text-insert ring-1 ring-insert/30">
                Uploaded {result.totalFiles} file{result.totalFiles === 1 ? '' : 's'} (
                {formatBytes(result.totalSize)} total). Taking you to search…
              </div>

              <ul className="mt-4 divide-y divide-ink-border rounded-lg ring-1 ring-ink-border">
                {result.files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between px-4 py-2.5 text-sm"
                  >
                    <span className="truncate text-paper/80">{f.filename}</span>
                    <span className="ml-4 shrink-0 text-paper/40">
                      {formatBytes(f.size)}
                    </span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={goToSearch}
                className="btn-primary mt-6 w-full"
              >
                Continue to search
              </button>
            </div>
          ) : (
            <div>
              {error && (
                <div className="mb-5 rounded-lg bg-remove/10 px-4 py-3 text-sm text-remove ring-1 ring-remove/30">
                  {error}
                </div>
              )}

              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
                  isDragging
                    ? 'border-insert bg-insert/10'
                    : 'border-ink-border bg-ink'
                }`}
              >
                <p className="text-sm text-paper/70">
                  Drag &amp; drop your file here
                </p>
                <p className="mt-1 text-xs text-paper/40">.txt, .html, .xml, .docx, or .zip — one file</p>

                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={isUploading}
                  className="btn-secondary mt-4"
                >
                  Browse files
                </button>

                <input
                  ref={inputRef}
                  type="file"
                  accept=".txt,.html,.htm,.xml,.docx,.zip"
                  onChange={handleInputChange}
                  className="hidden"
                />
              </div>

              {file && (
                <div className="mt-4 flex items-center justify-between rounded-lg bg-ink px-4 py-2.5 text-sm ring-1 ring-ink-border">
                  <span className="truncate text-paper/80">{file.name}</span>
                  <span className="ml-4 shrink-0 text-paper/40">
                    {formatBytes(file.size)}
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={handleUpload}
                disabled={!file || isUploading}
                className="btn-primary mt-6 flex w-full gap-2"
              >
                {isUploading && (
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
                {isUploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
