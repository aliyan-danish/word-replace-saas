import { createContext, useContext, useEffect, useState } from 'react'
import { setAuthToken, setOnUnauthorized } from '../lib/apiClient'

const AuthContext = createContext(null)

const TOKEN_KEY = 'authToken'

export function AuthProvider({ children }) {
  // Deliberate trade-off: sessionStorage survives a page refresh (fixing the log-out-on-refresh UX problem) but clears on tab/browser close — a temporary middle ground until a proper refresh-token + httpOnly cookie pattern is built in the later Security Hardening phase.
  const [token, setToken] = useState(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY)
    // Prime apiClient synchronously during render, BEFORE any effects run. React fires
    // child effects (e.g. Jobs.jsx's apiGet on mount) before parent effects, so relying
    // on the useEffect below alone would let that first request go out with no token.
    setAuthToken(stored)
    return stored
  })

  const login = (newToken) => {
    sessionStorage.setItem(TOKEN_KEY, newToken)
    setToken(newToken)
  }
  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }

  // Bridge the token into the (non-React) apiClient so it can attach the Authorization
  // header. This also restores the token on load if one exists in sessionStorage.
  useEffect(() => {
    setAuthToken(token)
  }, [token])

  // On any 401 from the apiClient, clear the token (and its sessionStorage copy). That
  // flips isAuthenticated to false, and ProtectedRoute then redirects to "/".
  useEffect(() => {
    setOnUnauthorized(() => logout())
  }, [])

  const value = {
    token,
    isAuthenticated: Boolean(token),
    login,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Small helper hook so components don't have to import useContext + AuthContext
// everywhere, and so we can guard against usage outside the provider.
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
