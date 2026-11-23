import { io } from 'socket.io-client'

const serverUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'

export const socket = io(serverUrl, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  // Socket.IO built-in reconnection — exponential back-off, up to 5 attempts
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 8000,
})

// ---------------------------------------------------------------------------
// Session persistence helpers (localStorage)
// ---------------------------------------------------------------------------

const SESSION_KEY = 'uno_session'

/** Persist session so the player can rejoin after a page refresh or tab reopen. */
export function saveSession(roomCode, sessionId) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, sessionId }))
  } catch {
    // Storage not available — silently ignore
  }
}

/** Load a previously saved session. Returns { roomCode, sessionId } or null. */
export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.roomCode === 'string' && typeof parsed.sessionId === 'string') {
      return parsed
    }
  } catch {
    // Corrupted data — clear it
    clearSession()
  }
  return null
}

/** Remove the saved session (called on explicit leave or session expiry). */
export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Acknowledged emit helper
// ---------------------------------------------------------------------------

export function emitWithAck(event, payload = {}) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, code: 'DISCONNECTED', message: 'Server is disconnected' })
      return
    }

    socket.emit(event, payload, (response) => resolve(response || { ok: false, code: 'NO_RESPONSE', message: 'No response from server' }))
  })
}
