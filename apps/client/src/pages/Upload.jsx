import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiPostForm, ApiError } from '../lib/apiClient'

const ACCEPTED_EXTENSIONS = ['.txt', '.zip']
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
      setError('Only .txt or .zip files are allowed.')
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
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <Link to="/dashboard" className="text-sm text-indigo-600 hover:text-indigo-500">
          ← Dashboard
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
          Upload
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Upload a single <span className="font-medium text-slate-700">.txt</span> file or
          a <span className="font-medium text-slate-700">.zip</span> of .txt files to get
          started.
        </p>

        <div className="mt-8 bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8">
          {isSuccess ? (
            <div>
              <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-100">
                Uploaded {result.totalFiles} file{result.totalFiles === 1 ? '' : 's'} (
                {formatBytes(result.totalSize)} total). Taking you to search…
              </div>

              <ul className="mt-4 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {result.files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between px-4 py-2.5 text-sm"
                  >
                    <span className="truncate text-slate-700">{f.filename}</span>
                    <span className="ml-4 shrink-0 text-slate-400">
                      {formatBytes(f.size)}
                    </span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={goToSearch}
                className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Continue to search
              </button>
            </div>
          ) : (
            <div>
              {error && (
                <div className="mb-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
                  {error}
                </div>
              )}

              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
                  isDragging
                    ? 'border-indigo-400 bg-indigo-50/50'
                    : 'border-slate-300 bg-slate-50'
                }`}
              >
                <p className="text-sm text-slate-600">
                  Drag &amp; drop your file here
                </p>
                <p className="mt-1 text-xs text-slate-400">.txt or .zip, one file</p>

                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={isUploading}
                  className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Browse files
                </button>

                <input
                  ref={inputRef}
                  type="file"
                  accept=".txt,.zip"
                  onChange={handleInputChange}
                  className="hidden"
                />
              </div>

              {file && (
                <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5 text-sm ring-1 ring-slate-200">
                  <span className="truncate text-slate-700">{file.name}</span>
                  <span className="ml-4 shrink-0 text-slate-400">
                    {formatBytes(file.size)}
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={handleUpload}
                disabled={!file || isUploading}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
