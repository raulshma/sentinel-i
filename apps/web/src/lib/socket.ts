import { io } from 'socket.io-client'

const SOCKET_BASE_URL = import.meta.env.VITE_SOCKET_URL

let socket: ReturnType<typeof io> | null = null

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_BASE_URL ?? window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      timeout: 5_000,
    })
  }
  return socket
}
