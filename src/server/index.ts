// Game server: an Express app for the built client plus a Socket.IO layer that
// carries the protocol in src/shared/protocol.ts. Every table is a Socket.IO
// room keyed by its 4-letter code, so one process hosts many games at once.

import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import express from 'express'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/protocol'
import { Room } from './room'
import type { Seat } from './types'

const PORT = Number(process.env.PORT ?? 3001)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const server = http.createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: true },
})

// ---- Room registry -----------------------------------------------------------

const rooms = new Map<string, Room>()

// No I/O/1/0: room codes get read aloud and typed in by hand.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function newRoomCode(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = ''
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    }
    if (!rooms.has(code)) return code
  }
  throw new Error('Could not allocate a room code')
}

// Sweep out tables nobody has touched in a while, so abandoned rooms don't
// hold their codes (or their memory) forever.
const ROOM_TTL_MS = 2 * 60 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (room.isEmpty && now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code)
  }
}, 10 * 60 * 1000)

// ---- Socket wiring -----------------------------------------------------------

io.on('connection', (socket) => {
  // Which table and chair this socket is currently driving.
  let room: Room | null = null
  let seatId: string | null = null

  /** Every gameplay handler needs the same "are you actually seated?" check. */
  const withSeat = (fn: (room: Room, seat: Seat) => void) => {
    const currentRoom = room
    const currentSeat = currentRoom && seatId ? currentRoom.getSeat(seatId) : undefined
    if (!currentRoom || !currentSeat) return
    fn(currentRoom, currentSeat)
  }

  socket.on('join', ({ roomCode, name, playerId }) => {
    if (room) return // already seated on this socket

    let target: Room
    if (roomCode) {
      const code = String(roomCode).trim().toUpperCase()
      const existing = rooms.get(code)
      if (!existing) {
        socket.emit('joinError', `No table with the code ${code}.`)
        return
      }
      target = existing
    } else {
      target = new Room(newRoomCode(), io)
      rooms.set(target.code, target)
    }

    const known = playerId ? target.getSeat(String(playerId)) != null : false
    const result = target.join(String(name ?? ''), playerId ? String(playerId) : null, socket.id)
    if ('error' in result) {
      socket.emit('joinError', result.error)
      return
    }

    room = target
    seatId = result.seat.id
    void socket.join(target.code)

    socket.emit('joined', {
      playerId: result.seat.id,
      roomCode: target.code,
      name: result.seat.name,
    })
    target.sendChatHistory(result.seat)
    target.systemChat(
      known ? `${result.seat.name} is back.` : `${result.seat.name} joined the table.`,
    )
    target.broadcastLobby()
    // Mid-game rejoin: replay the whole table state onto their empty client.
    if (target.gameState !== 'Lobby') target.sendState(result.seat)
  })

  socket.on('toggleReady', (ready) => withSeat((r, s) => r.setReady(s, ready === true)))
  socket.on('startGame', () => withSeat((r, s) => r.startGame(s)))
  socket.on('setMode', (mode) => withSeat((r, s) => r.setMode(s, mode)))
  socket.on('submitBid', (bid) => withSeat((r, s) => r.submitBid(s, Number(bid))))
  socket.on('declareDouble', () => withSeat((r, s) => r.declareDouble(s)))
  socket.on('playCard', (card) => withSeat((r, s) => r.playCard(s, card)))
  socket.on('useAbility', (payload) => withSeat((r, s) => r.useAbility(s, payload ?? {})))
  socket.on('requestState', () => withSeat((r, s) => r.sendState(s)))
  socket.on('chat', (text) => withSeat((r, s) => r.chat(s, String(text ?? ''))))

  socket.on('disconnect', () => {
    withSeat((r, s) => {
      // Only announce a real departure -- if this socket has already been
      // replaced by a reconnect, detach() is a no-op and nobody left.
      if (s.socketId === socket.id) r.systemChat(`${s.name} left.`)
      r.detach(s, socket.id)
    })
    room = null
    seatId = null
  })
})

// ---- Static client ------------------------------------------------------------

const clientDir = path.resolve(__dirname, '../client')

// Socket.IO intercepts /socket.io before Express sees it and does its own
// framing, so this only ever touches the static client -- where it matters:
// the bundle is ~3x smaller over the wire gzipped.
app.use(compression())

app.use(
  express.static(clientDir, {
    setHeaders(res, filePath) {
      // Vite content-hashes everything under /assets, so those URLs can never
      // point at different bytes -- cache them forever. index.html must NOT be
      // cached, or a returning player keeps loading a stale bundle after a
      // deploy and reconnects into a protocol they no longer speak.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        res.setHeader('Cache-Control', 'no-cache')
      }
    },
  }),
)

app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  res.sendFile(path.join(clientDir, 'index.html'))
})

server.listen(PORT, () => {
  console.log(`The Prediction Game server listening on http://localhost:${PORT}`)
})
