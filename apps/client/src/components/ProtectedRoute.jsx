import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Guards routes that require a logged-in user. Because the JWT lives only in
// memory (see AuthContext), an unauthenticated visitor — including anyone who
// refreshes the page and loses the in-memory token — is sent back to Login.
export default function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    // `replace` avoids pushing the guarded URL onto history, so the back button
    // doesn't bounce the user between Login and the protected page.
    return <Navigate to="/login" replace />
  }

  return children
}
