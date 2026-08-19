import { Link } from 'react-router-dom'
import BackNav from '../components/BackNav'

export default function Admin() {
  return (
    <div className="min-h-screen bg-ink text-paper">
      <main className="mx-auto max-w-6xl px-6 py-16">
        <BackNav to="/dashboard" label="Dashboard" />

        <h1 className="mt-6 page-title">
          Admin Panel
        </h1>
        <p className="mt-2 text-sm text-paper/60">
          Manage users and subscription plans.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/admin/users"
            className="btn-primary"
          >
            Manage Users
          </Link>
          <Link
            to="/admin/plans"
            className="btn-secondary"
          >
            Manage Plans
          </Link>
        </div>
      </main>
    </div>
  )
}
