import dotenv from 'dotenv'
import 'dotenv/config'
import express from 'express'
import http from 'http'
import cors from 'cors'
import { Server } from 'socket.io'
import { randomBytes } from 'crypto'
import { fileURLToPath, pathToFileURL } from 'url'
import { GameManager } from './game/gameManager.js'

dotenv.config({ path: new URL('../.env', import.meta.url) })
import { getPlayableCardIds } from './game/gameLogic.js'

export const rooms = new Map()

export const REACTION_EMOJIS = Object.freeze(['😂', '😭', '🔥', '😎', '👏', '😡', '🤯', '❤️', '💀'])
const reactionCooldowns = new Map()
const recentReactionIds = new Map()

export function createRoomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += alphabet[randomBytes(1)[0] % alphabet.length]
  }
  return code
}

function uniqueRoomCode() {
  let code
  do {
    code = createRoomCode()
  } while (rooms.has(code))
  return code
}

function cleanName(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, 16)
}

function publicLobby(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected !== false,
      isHost: player.id === room.hostId,
      isSpectator: Boolean(player.isSpectator),
    })),
  }
}

function publicGameState(room) {
  const game = room.game
  if (!game) return null
  return {
    status: game.status,
    currentPlayerId: game.players[game.currentPlayerIndex]?.id || null,
    currentColor: game.currentColor,
    direction: game.direction,
    pendingPenalty: game.pendingPenalty > 0 ? {
      amount: game.pendingPenalty,
      typeValue: game.pendingPenaltyType,
      type: game.pendingPenaltyType === 4 ? 'WILD_DRAW_FOUR' : game.pendingPenaltyType === 3 ? 'DRAW_THREE' : 'DRAW_TWO',
      targetPlayerId: game.players[game.pendingPenaltyTargetIndex]?.id || null,
      history: game.pendingPenaltyHistory || [],
    } : null,
    pendingPenaltyType: game.pendingPenaltyType || null,
    pendingPenaltyTargetIndex: game.pendingPenaltyTargetIndex ?? null,
    pendingPenaltyHistory: game.pendingPenaltyHistory || [],
    lastAction: game.lastAction ? {
      actionId: game.lastAction.actionId,
      playerId: game.lastAction.playerId,
      type: game.lastAction.type,
      count: game.lastAction.count,
      timestamp: game.lastAction.timestamp,
      sequence: game.lastAction.sequence,
      skippedPlayerId: game.lastAction.skippedPlayerId || null,
      card: game.lastAction.card && !['draw', 'penalty_draw'].includes(game.lastAction.type) ? { id: game.lastAction.card.id, color: game.lastAction.card.color, value: game.lastAction.card.value, type: game.lastAction.type === 'win' || game.lastAction.type === 'pass' || game.lastAction.type === 'reverse' || game.lastAction.type === 'play' ? game.lastAction.card.type : game.lastAction.card.type } : null,
    } : null,
    discardTop: game.discardPile[game.discardPile.length - 1] || null,
    drawPileCount: game.drawPile.length,
    winner: game.winner ? { id: game.winner.id, name: game.winner.name } : null,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected !== false,
      cardCount: player.hand.length,
      isHost: player.id === room.hostId,
    })),
  }
}

export function getPrivateGameState(room, playerId) {
  if (!room.game) return null
  const player = room.game.players.find((entry) => entry.id === playerId)
  const topCard = room.game.discardPile[room.game.discardPile.length - 1] || null
  return {
    ...publicGameState(room),
    hand: player ? player.hand.map((card) => ({ ...card })) : [],
    playableCardIds: player ? getPlayableCardIds(player.hand, topCard, room.game.currentColor, room.game.pendingPenalty, room.game.pendingPenaltyType) : [],
  }
}

function emitCardAction(io, room, result, playerId) {
  const action = room.game?.lastAction
  if (!action) return
  io.to(room.code).emit('cardPlayed', {
    actionId: action.actionId,
    playerId,
    card: result.playedCard ? {
      id: result.playedCard.id,
      color: result.playedCard.color,
      value: result.playedCard.value,
      type: result.playedCard.type,
    } : null,
    actionType: result.action,
    timestamp: action.timestamp,
    sequence: action.sequence,
    skippedPlayerId: action.skippedPlayerId || null,
  })
}

function emitDrawAction(io, room, result, playerId) {
  io.to(room.code).emit('cardDrawn', {
    actionId: room.game?.lastAction?.actionId,
    playerId,
    actionType: result.action,
    timestamp: room.game?.lastAction?.timestamp,
    sequence: room.game?.lastAction?.sequence,
  })
}

function emitLobby(io, room) {
  io.to(room.code).emit('lobbyUpdate', publicLobby(room))
  io.to(room.code).emit('room:update', publicLobby(room))
}

function emitGame(io, room) {
  for (const player of room.players) {
    io.to(player.id).emit('gameState', getPrivateGameState(room, player.id))
    io.to(player.id).emit('game:state', getPrivateGameState(room, player.id))
  }
}

export function createUnoServer() {
  const app = express()
  app.use(cors({
    origin: process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  }))
  app.use(express.json())
  app.get('/health', (_request, response) => response.json({ ok: true }))

  const httpServer = http.createServer(app)
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || 'http://localhost:5173',
      credentials: true,
    },
  })
  const gameManager = new GameManager()

  function ack(callback, payload) {
    if (typeof callback === 'function') callback(payload)
  }

  function error(socket, callback, code, message) {
    const payload = { ok: false, code, message }
    socket.emit('error', payload)
    ack(callback, payload)
  }

  function requireRoom(socket, code, callback) {
    const roomCode = String(code || '').trim().toUpperCase()
    const room = rooms.get(roomCode)
    if (!room) {
      error(socket, callback, 'ROOM_NOT_FOUND', 'Room not found')
      return null
    }
    return room
  }

  function requirePlayer(socket, room, callback) {
    const player = room.players.find((entry) => entry.id === socket.id)
    if (!player) {
      error(socket, callback, 'NOT_IN_ROOM', 'You are not a player in this room')
      return null
    }
    return player
  }

  function requireHost(socket, room, callback) {
    const player = requirePlayer(socket, room, callback)
    if (!player) return null
    if (room.hostId !== player.id) {
      error(socket, callback, 'NOT_HOST', 'Only the host can perform this action')
      return null
    }
    return player
  }

  function handleDisconnect(socket) {
    for (const [code, room] of rooms) {
      const index = room.players.findIndex((player) => player.id === socket.id)
      if (index === -1) continue

      room.players.splice(index, 1)
      if (room.game?.players) {
        const gameIndex = room.game.players.findIndex((player) => player.id === socket.id)
        if (gameIndex !== -1) room.game.players.splice(gameIndex, 1)
      }

      if (room.players.length === 0) {
        rooms.delete(code)
        gameManager.removeGame(code)
      } else {
        if (room.hostId === socket.id) room.hostId = room.players[0].id
        room.status = 'lobby'

        if (room.game) {
          room.game.status = room.game.players.length >= 2 ? 'waiting' : 'finished'
          room.game.currentPlayerIndex = 0
          if (room.game.players.length < 2) room.game.winner = null
          gameManager.removeGame(code)
          room.game = null
        }

        emitLobby(io, room)
        if (room.game) emitGame(io, room)
        io.to(code).emit('playerDisconnected', { playerId: socket.id, roomCode: code })
      }
      break
    }
  }

  io.on('connection', (socket) => {
    socket.on('createRoom', (payload = {}, callback) => {
      const name = cleanName(payload.name)
      if (!name) return error(socket, callback, 'INVALID_NAME', 'Player name is required')
      if (roomForSocket(socket)) return error(socket, callback, 'ALREADY_IN_ROOM', 'Leave the current room first')

      const code = uniqueRoomCode()
      const room = {
        code,
        hostId: socket.id,
        status: 'lobby',
        players: [{ id: socket.id, name, connected: true }],
        game: null,
      }
      rooms.set(code, room)
      socket.join(code)
      socket.data.roomCode = code
      socket.data.playerId = socket.id

      const result = { ok: true, roomCode: code, playerId: socket.id, lobby: publicLobby(room) }
      ack(callback, result)
      socket.emit('roomCreated', result)
      emitLobby(io, room)
    })

    socket.on('joinRoom', (payload = {}, callback) => {
      const code = String(payload.code || payload.roomCode || '').trim().toUpperCase()
      const name = cleanName(payload.name)
      if (!name) return error(socket, callback, 'INVALID_NAME', 'Player name is required')
      if (roomForSocket(socket)) return error(socket, callback, 'ALREADY_IN_ROOM', 'Leave the current room first')

      const room = requireRoom(socket, code, callback)
      if (!room) return
      if (room.status !== 'lobby') return error(socket, callback, 'ROOM_STARTED', 'This room has already started')
      if (room.players.length >= 4) return error(socket, callback, 'ROOM_FULL', 'This room is full')
      if (room.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
        return error(socket, callback, 'DUPLICATE_PLAYER', 'A player with that name is already in the room')
      }

      room.players.push({ id: socket.id, name, connected: true })
      socket.join(code)
      socket.data.roomCode = code
      socket.data.playerId = socket.id

      const result = { ok: true, roomCode: code, playerId: socket.id, lobby: publicLobby(room) }
      ack(callback, result)
      socket.emit('roomJoined', result)
      emitLobby(io, room)
    })

    socket.on('spectateRoom', (payload = {}, callback) => {
      const code = String(payload.code || payload.roomId || payload.roomCode || '').trim().toUpperCase()
      const name = cleanName(payload.name)
      if (!name) return error(socket, callback, 'INVALID_NAME', 'Player name is required')
      if (roomForSocket(socket)) return error(socket, callback, 'ALREADY_IN_ROOM', 'Leave the current room first')
      const room = requireRoom(socket, code, callback)
      if (!room) return
      if (room.players.length >= 4 && room.status === 'lobby') return error(socket, callback, 'ROOM_FULL', 'This room is full')
      if (room.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) return error(socket, callback, 'DUPLICATE_PLAYER', 'A player with that name is already in the room')

      room.players.push({ id: socket.id, name, connected: true, isSpectator: true })
      socket.join(code)
      socket.data.roomCode = code
      socket.data.playerId = socket.id
      const result = { ok: true, roomCode: code, playerId: socket.id, spectator: true, lobby: publicLobby(room) }
      ack(callback, result)
      socket.emit('spectatorJoined', result)
      emitLobby(io, room)
    })

    socket.on('leaveRoom', (payload = {}, callback) => {
      const code = String(payload.roomCode || payload.code || socket.data.roomCode || '').trim().toUpperCase()
      if (!code) return error(socket, callback, 'NOT_IN_ROOM', 'You are not in a room')
      reactionCooldowns.delete(socket.id)
      recentReactionIds.delete(socket.id)
      handleDisconnect(socket)
      ack(callback, { ok: true, roomCode: code })
      socket.leave(code)
      socket.data.roomCode = undefined
    })

    socket.on('startGame', (payload = {}, callback) => {
      const code = String(payload.roomCode || payload.code || socket.data.roomCode || '').trim().toUpperCase()
      const room = requireRoom(socket, code, callback)
      if (!room) return
      if (!requireHost(socket, room, callback)) return
      if (room.status !== 'lobby') return error(socket, callback, 'GAME_ALREADY_STARTED', 'The game has already started')
      if (room.players.length < 2) return error(socket, callback, 'NOT_ENOUGH_PLAYERS', 'At least 2 players are required')

      try {
        room.game = gameManager.createGame(code, room.players.map((player) => ({ id: player.id, name: player.name })))
        room.status = 'playing'
        emitLobby(io, room)
        emitGame(io, room)
        ack(callback, { ok: true, roomCode: code, state: getPrivateGameState(room, socket.id) })
        io.to(code).emit('gameStarted', publicGameState(room))
      } catch (caught) {
        error(socket, callback, caught.code || 'START_FAILED', caught.message)
      }
    })

    socket.on('playCard', (payload = {}, callback) => {
      const code = String(payload.roomCode || payload.code || socket.data.roomCode || '').trim().toUpperCase()
      const room = requireRoom(socket, code, callback)
      if (!room) return
      requirePlayer(socket, room, callback)
      if (!room.game) return error(socket, callback, 'GAME_NOT_STARTED', 'The game has not started')

      try {
        const result = gameManager.playCard(code, socket.id, payload.cardId, payload.chosenColor)
        emitGame(io, room)
        emitCardAction(io, room, result, socket.id)
        if (result.action === 'win') io.to(code).emit('gameEnded', { winner: result.winner, state: publicGameState(room) })
        ack(callback, { ok: true, action: result.action, state: getPrivateGameState(room, socket.id) })
      } catch (caught) {
        error(socket, callback, caught.code || 'INVALID_MOVE', caught.message)
      }
    })

    socket.on('chooseWildColor', (payload = {}, callback) => {
      const code = String(payload.roomCode || payload.code || socket.data.roomCode || '').trim().toUpperCase()
      const room = requireRoom(socket, code, callback)
      if (!room) return
      requirePlayer(socket, room, callback)
      if (!room.game) return error(socket, callback, 'GAME_NOT_STARTED', 'The game has not started')

      if (!payload.cardId) return error(socket, callback, 'CARD_REQUIRED', 'cardId is required')
      try {
        const result = gameManager.playCard(code, socket.id, payload.cardId, payload.color || payload.chosenColor)
        emitGame(io, room)
        emitCardAction(io, room, result, socket.id)
        if (result.action === 'win') io.to(code).emit('gameEnded', { winner: result.winner, state: publicGameState(room) })
        ack(callback, { ok: true, action: result.action, state: getPrivateGameState(room, socket.id) })
      } catch (caught) {
        error(socket, callback, caught.code || 'INVALID_MOVE', caught.message)
      }
    })

    socket.on('drawCard', (payload = {}, callback) => {
      const code = String(payload.roomCode || payload.code || socket.data.roomCode || '').trim().toUpperCase()
      const room = requireRoom(socket, code, callback)
      if (!room) return
      requirePlayer(socket, room, callback)
      if (!room.game) return error(socket, callback, 'GAME_NOT_STARTED', 'The game has not started')

      try {
        const result = gameManager.drawCard(code, socket.id)
        emitGame(io, room)
        emitDrawAction(io, room, result, socket.id)
        ack(callback, { ok: true, action: 'draw', drawnCard: result.drawnCard, state: getPrivateGameState(room, socket.id) })
      } catch (caught) {
        error(socket, callback, caught.code || 'INVALID_MOVE', caught.message)
      }
    })

    socket.on('endGame', (payload = {}, callback) => {
      const code = String(payload.roomCode || payload.code || socket.data.roomCode || '').trim().toUpperCase()
      const room = requireRoom(socket, code, callback)
      if (!room) return
      if (!requireHost(socket, room, callback)) return
      if (!room.game) return error(socket, callback, 'GAME_NOT_STARTED', 'The game has not started')

      room.game.status = 'finished'
      io.to(code).emit('gameEnded', { winner: room.game.winner ? { id: room.game.winner.id, name: room.game.winner.name } : null, state: publicGameState(room) })
      emitGame(io, room)
      ack(callback, { ok: true, roomCode: code })
    })

    socket.on('returnToLobby', (payload = {}, callback) => {
      const code = String(payload.roomCode || payload.code || socket.data.roomCode || '').trim().toUpperCase()
      const room = requireRoom(socket, code, callback)
      if (!room) return
      requirePlayer(socket, room, callback)

      room.game = null
      room.status = 'lobby'
      gameManager.removeGame(code)
      emitLobby(io, room)
      ack(callback, { ok: true, lobby: publicLobby(room) })
      io.to(code).emit('gameRestarted', publicLobby(room))
    })

    socket.on('restartGame', (payload = {}, callback) => {
      const code = String(payload.roomCode || payload.code || socket.data.roomCode || '').trim().toUpperCase()
      const room = requireRoom(socket, code, callback)
      if (!room) return
      if (!requireHost(socket, room, callback)) return

      room.game = null
      room.status = 'lobby'
      gameManager.removeGame(code)
      emitLobby(io, room)
      ack(callback, { ok: true, lobby: publicLobby(room) })
      io.to(code).emit('gameRestarted', publicLobby(room))
    })

    socket.on('reaction', (payload = {}, callback) => {
      const code = String(payload.roomId || payload.roomCode || payload.code || socket.data.roomCode || '').trim().toUpperCase()
      const room = requireRoom(socket, code, callback)
      if (!room) return

      const member = room.players.find((player) => player.id === socket.id)
      if (!member) return error(socket, callback, 'NOT_IN_ROOM', 'You are not a member of this room')

      const emoji = String(payload.emoji || '')
      if (!REACTION_EMOJIS.includes(emoji)) return error(socket, callback, 'INVALID_REACTION', 'Unsupported reaction emoji')

      const now = Date.now()

      const reactionId = typeof payload.reactionId === 'string' && payload.reactionId.slice(0, 80)
        ? payload.reactionId.slice(0, 80)
        : `${socket.id}-${now}-${Math.random().toString(36).slice(2, 8)}`
      const seenIds = recentReactionIds.get(socket.id) || new Set()
      if (seenIds.has(reactionId)) return ack(callback, { ok: true, duplicate: true })
      seenIds.add(reactionId)
      if (seenIds.size > 100) seenIds.clear()
      recentReactionIds.set(socket.id, seenIds)

      const cooldownUntil = reactionCooldowns.get(socket.id) || 0
      if (now < cooldownUntil) return error(socket, callback, 'REACTION_COOLDOWN', 'Please wait before sending another reaction')

      reactionCooldowns.set(socket.id, now + 1000)
      const reaction = { roomId: code, playerId: socket.id, emoji, reactionId, timestamp: now }
      io.to(code).emit('reaction', reaction)
      io.to(code).emit('reactionReceived', reaction)
      ack(callback, { ok: true, reaction })
    })

    socket.on('disconnect', () => {
      reactionCooldowns.delete(socket.id)
      recentReactionIds.delete(socket.id)
      handleDisconnect(socket)
    })
  })

  function roomForSocket(socket) {
    return socket.data.roomCode || [...rooms.values()].some((room) => room.players.some((player) => player.id === socket.id))
  }

  return { app, httpServer, io, rooms, gameManager }
}

const entryFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
const isDirectRun = entryFile === import.meta.url

if (isDirectRun) {
  const { httpServer } = createUnoServer()
  const port = Number(process.env.PORT) || 3001
  httpServer.listen(port, () => console.log(`UNO Socket.IO server listening on port ${port}`))
}
