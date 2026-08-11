import { Link } from 'react-router-dom'

export default function Admin() {
  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-6xl px-6 py-16">
        <Link to="/dashboard" className="text-sm text-indigo-600 hover:text-indigo-500">
          ← Dashboard
        </Link>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">
          Admin Panel
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Manage users and subscription plans.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/admin/users"
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Manage Users
          </Link>
          <Link
            to="/admin/plans"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Manage Plans
          </Link>
        </div>
      </main>
    </div>
  )
}
