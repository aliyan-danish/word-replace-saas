import { Link } from 'react-router-dom'

// Compact secondary control for "up one level". Uses btn-secondary so it matches
// Dashboard / landing nav, not the old mint text link.
export default function BackNav({ to, label }) {
  return (
    <Link to={to} className="btn-secondary gap-1.5 px-3 py-1.5">
      <svg
        className="h-4 w-4 shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
          clipRule="evenodd"
        />
      </svg>
      {label}
    </Link>
  )
}
