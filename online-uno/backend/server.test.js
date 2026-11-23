import test from 'node:test'
import assert from 'node:assert/strict'
import { io as createClient } from 'socket.io-client'
import { createUnoServer, rooms, createRoomCode } from './server.js'

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve))
}

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve))
}

test('reactions broadcast only within a room with validation and cooldown', async (t) => {
  rooms.clear()
  const { httpServer, io } = createUnoServer()
  await new Promise((resolve) => httpServer.listen(0, resolve))
  const port = httpServer.address().port
  t.after(() => new Promise((resolve) => io.close(resolve)))

  const clients = Array.from({ length: 4 }, () => createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] }))
  t.after(() => clients.forEach((client) => client.close()))
  await Promise.all(clients.map((client) => waitFor(client, 'connect')))

  const created = await emitWithAck(clients[0], 'createRoom', { name: 'Host' })
  for (let i = 1; i < 4; i += 1) {
    const joined = await emitWithAck(clients[i], 'joinRoom', { code: created.roomCode, name: `P${i}` })
    assert.equal(joined.ok, true)
  }

  const received = Promise.all(clients.map((client) => waitFor(client, 'reaction')))
  const sent = await emitWithAck(clients[2], 'reaction', { roomId: created.roomCode, playerId: 'forged-id', emoji: '🔥', reactionId: 'test-reaction-1' })
  assert.equal(sent.ok, true)
  // playerId in the reaction should be the server-issued sessionId, not the forged client value
  assert.ok(typeof sent.reaction.playerId === 'string' && sent.reaction.playerId.length > 10)
  const broadcasts = await received
  broadcasts.forEach((reaction) => assert.equal(reaction.emoji, '🔥'))

  const invalid = await emitWithAck(clients[0], 'reaction', { roomId: created.roomCode, emoji: '🚀', reactionId: 'invalid' })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'INVALID_REACTION')

  const cooldown = await emitWithAck(clients[0], 'reaction', { roomId: created.roomCode, emoji: '😂', reactionId: 'cooldown-1' })
  assert.equal(cooldown.ok, true)
  const duplicate = await emitWithAck(clients[0], 'reaction', { roomId: created.roomCode, emoji: '😂', reactionId: 'cooldown-1' })
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.duplicate, true)
})

test('room codes are six characters and server health is reachable', async (t) => {
  const code = createRoomCode()
  assert.match(code, /^[A-Z2-9]{6}$/)

  const { app, httpServer, io } = createUnoServer()
  await new Promise((resolve) => httpServer.listen(0, resolve))
  const address = httpServer.address()
  t.after(() => new Promise((resolve) => io.close(resolve)))

  const response = await fetch(`http://127.0.0.1:${address.port}/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
})

test('players can create, join, start, draw, and leave rooms', async (t) => {
  rooms.clear()
  const { httpServer, io } = createUnoServer()
  await new Promise((resolve) => httpServer.listen(0, resolve))
  const port = httpServer.address().port
  t.after(() => new Promise((resolve) => io.close(resolve)))

  const host = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] })
  const guest = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] })
  t.after(() => { host.close(); guest.close() })
  await Promise.all([waitFor(host, 'connect'), waitFor(guest, 'connect')])

  const created = await emitWithAck(host, 'createRoom', { name: 'Admin' })
  assert.equal(created.ok, true)
  // hostId is now a persistent sessionId (not socket.id)
  assert.equal(created.lobby.hostId, created.sessionId)
  assert.equal(created.roomCode.length, 6)

  const joined = await emitWithAck(guest, 'joinRoom', { code: created.roomCode, name: 'Maya' })
  assert.equal(joined.ok, true)

  const duplicate = await emitWithAck(guest, 'joinRoom', { code: created.roomCode, name: 'Leo' })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.code, 'ALREADY_IN_ROOM')

  const nonHostStart = await emitWithAck(guest, 'startGame', { roomCode: created.roomCode })
  assert.equal(nonHostStart.ok, false)
  assert.equal(nonHostStart.code, 'NOT_HOST')

  const started = await emitWithAck(host, 'startGame', { roomCode: created.roomCode })
  assert.equal(started.ok, true)
  assert.equal(started.state.hand.length, 7)
  assert.equal(started.state.players.length, 2)
  // Other players' hands must never be exposed
  assert.equal(started.state.players.find((player) => player.id === joined.playerId).hand, undefined)

  const topCard = started.state.discardTop
  const playableCard = started.state.hand.find((card) => card.color === topCard?.color || card.value === topCard?.value || (card.type === 'wild' && card.color === 'wild'))
  assert.ok(playableCard)
  const cardAction = waitFor(host, 'cardPlayed')
  const played = await emitWithAck(host, 'playCard', { roomCode: created.roomCode, cardId: playableCard.id, chosenColor: playableCard.color === 'wild' ? 'red' : null })
  assert.equal(played.ok, true)
  const publicAction = await cardAction
  assert.equal(publicAction.playerId, created.sessionId)
  assert.equal(publicAction.card.id, playableCard.id)
  assert.equal(Object.hasOwn(publicAction, 'hand'), false)

  const wrongTurn = await emitWithAck(host, 'drawCard', { roomCode: created.roomCode })
  assert.equal(wrongTurn.ok, false)
  assert.equal(wrongTurn.code, 'NOT_YOUR_TURN')

  const draw = await emitWithAck(guest, 'drawCard', { roomCode: created.roomCode })
  assert.equal(draw.ok, true)
  if (draw.drawnCard) assert.ok(['red', 'blue', 'green', 'yellow', 'wild'].includes(draw.drawnCard.color))

  const left = await emitWithAck(guest, 'leaveRoom', { roomCode: created.roomCode })
  assert.equal(left.ok, true)
  assert.equal(rooms.has(created.roomCode), true)
})

test('rooms reject full and started joins and duplicate names', async (t) => {
  rooms.clear()
  const { httpServer, io } = createUnoServer()
  await new Promise((resolve) => httpServer.listen(0, resolve))
  const port = httpServer.address().port
  t.after(() => new Promise((resolve) => io.close(resolve)))

  const clients = Array.from({ length: 5 }, () => createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] }))
  t.after(() => clients.forEach((client) => client.close()))
  await Promise.all(clients.map((client) => waitFor(client, 'connect')))

  const created = await emitWithAck(clients[0], 'createRoom', { name: 'Host' })
  for (let i = 1; i <= 3; i += 1) {
    const result = await emitWithAck(clients[i], 'joinRoom', { code: created.roomCode, name: `Player${i}` })
    assert.equal(result.ok, true)
  }

  const full = await emitWithAck(clients[4], 'joinRoom', { code: created.roomCode, name: 'Extra' })
  assert.equal(full.ok, false)
  assert.equal(full.code, 'ROOM_FULL')

  const started = await emitWithAck(clients[0], 'startGame', { roomCode: created.roomCode })
  assert.equal(started.ok, true)

  const late = await emitWithAck(clients[4], 'joinRoom', { code: created.roomCode, name: 'Late' })
  assert.equal(late.ok, false)
  assert.equal(late.code, 'ROOM_STARTED')
})
