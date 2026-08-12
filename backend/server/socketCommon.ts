import type { Server } from 'socket.io'

export const socketCommon = {
  getSocket() {
    return globalThis.io
  },
  setSocket(io: Server) {
    globalThis.io = io
  },
  emit(name: string, data: any) {
    const io = this.getSocket()
    if (io) {
      io.emit(name, data)
    }
  },
}
