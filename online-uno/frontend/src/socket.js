import { io } from 'socket.io-client'

const serverUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'

export const socket = io(serverUrl, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
})

export function emitWithAck(event, payload = {}) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, code: 'DISCONNECTED', message: 'Server is disconnected' })
      return
    }

    socket.emit(event, payload, (response) => resolve(response || { ok: false, code: 'NO_RESPONSE', message: 'No response from server' }))
  })
}
