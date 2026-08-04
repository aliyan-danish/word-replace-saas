// Shared API client. Wraps fetch with the backend base URL, automatically attaches the
// JWT as an Authorization header, and centralizes 401 handling.
//
// Base URL: same convention the existing Login/Register pages use
// (const API_BASE = 'http://localhost:5000').
//
// Token source: the JWT lives ONLY in memory (see AuthContext), not localStorage, to
// avoid XSS-persisted tokens. Since this module isn't a React component and can't call
// useAuth(), AuthContext pushes the current token in via setAuthToken() whenever it
// changes. The token is held in a module variable — still in memory, never persisted.

export const API_BASE = 'http://localhost:5000';

let authToken = null;
let onUnauthorized = null;

// Called by AuthContext whenever the in-memory token changes (login/logout).
export function setAuthToken(token) {
  authToken = token || null;
}

// Called by AuthContext to register how a 401 should be handled. We reuse the app's
// existing auth pattern: AuthContext clears the token, which makes ProtectedRoute
// redirect to "/" (the Login page). If no handler is registered (e.g. the client is
// used before the provider mounts), we fall back to a hard redirect to "/".
export function setOnUnauthorized(handler) {
  onUnauthorized = handler;
}

// Thrown for any non-2xx response so callers can inspect status/data.
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function buildHeaders(base = {}) {
  const headers = { ...base };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  return headers;
}

function handleUnauthorized() {
  authToken = null;
  if (onUnauthorized) {
    onUnauthorized();
  } else if (typeof window !== 'undefined') {
    window.location.assign('/');
  }
}

// Parse a JSON body, tolerating an empty body (e.g. 204).
async function parseJsonSafely(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request(path, { method = 'GET', headers, body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: buildHeaders(headers),
    body,
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiError('Unauthorized', 401);
  }

  const data = await parseJsonSafely(res);
  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

// GET returning parsed JSON.
export function apiGet(path) {
  return request(path, { method: 'GET' });
}

// POST a JSON body.
export function apiPost(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

// POST multipart/form-data (file uploads). Intentionally does NOT set Content-Type —
// the browser adds the correct multipart boundary automatically.
export function apiPostForm(path, formData) {
  return request(path, { method: 'POST', body: formData });
}

// GET a binary file (e.g. the /download zip). Returns the Blob plus the filename parsed
// from the Content-Disposition header, ready to hand to a save-as flow.
export async function apiDownload(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: buildHeaders(),
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiError('Unauthorized', 401);
  }

  if (!res.ok) {
    // Error responses from the backend are JSON even on this binary endpoint.
    const data = await parseJsonSafely(res);
    throw new ApiError(data?.error || `Download failed (${res.status})`, res.status, data);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match ? match[1] : 'download';
  return { blob, filename };
}
