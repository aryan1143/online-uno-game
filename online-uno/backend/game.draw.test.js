import test from 'node:test'
import assert from 'node:assert/strict'
import { GameManager } from './game/gameManager.js'

const players = () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]

function setupPlayableHand() {
  const manager = new GameManager()
  const game = manager.createGame('DRAWABLE', players())
  game.currentPlayerIndex = 0
  game.currentColor = 'red'
  game.discardPile = [{ id: 'top', color: 'red', value: '7', type: 'number' }]
  game.players[0].hand = [{ id: 'playable', color: 'red', value: '3', type: 'number' }]
  return { manager, game }
}

test('allows voluntary drawing even with a playable card', () => {
  const { manager, game } = setupPlayableHand()
  const before = game.players[0].hand.length
  const result = manager.drawCard('DRAWABLE', 'a')
  assert.equal(result.action, 'draw')
  assert.equal(game.players[0].hand.length, before + 1)
  assert.equal(game.currentPlayerIndex, 1)
})

test('a drawn card cannot be played during the same turn', () => {
  const { manager, game } = setupPlayableHand()
  const draw = manager.drawCard('DRAWABLE', 'a')
  assert.ok(draw.drawnCard)
  assert.throws(() => manager.playCard('DRAWABLE', 'a', draw.drawnCard.id, null), /turn|not/i)
})

test('duplicate draw requests are rejected', () => {
  const { manager, game } = setupPlayableHand()
  manager.drawCard('DRAWABLE', 'a')
  assert.throws(() => manager.drawCard('DRAWABLE', 'a'), /turn/i)
})

test('out-of-turn drawing is rejected', () => {
  const { manager } = setupPlayableHand()
  assert.throws(() => manager.drawCard('DRAWABLE', 'b'), /turn/i)
})

test('pending penalty prevents voluntary drawing', () => {
  const { manager, game } = setupPlayableHand()
  game.pendingPenalty = 2
  game.pendingPenaltyType = 2
  game.pendingPenaltyTargetIndex = 1
  assert.throws(() => manager.drawCard('DRAWABLE', 'a'), /penalty|draw/i)
})

test('penalty recipient may accept and advance', () => {
  const { manager, game } = setupPlayableHand()
  game.pendingPenalty = 3
  game.pendingPenaltyType = 3
  game.pendingPenaltyTargetIndex = 0
  const before = game.players[0].hand.length
  const result = manager.drawCard('DRAWABLE', 'a')
  assert.equal(result.action, 'penalty_draw')
  assert.equal(game.players[0].hand.length, before + 3)
  assert.equal(game.pendingPenalty, 0)
  assert.equal(game.currentPlayerIndex, 1)
})

test('bankruptcy at 20 cards removes the player', () => {
  const manager = new GameManager()
  const game = manager.createGame('BANK', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }])
  game.currentPlayerIndex = 0
  game.pendingPenalty = 20
  game.pendingPenaltyType = 4
  game.pendingPenaltyTargetIndex = 0
  game.players[0].hand = Array.from({ length: 1 }, (_, i) => ({ id: `old-${i}`, color: 'red', value: '1', type: 'number' }))
  const result = manager.drawCard('BANK', 'a')
  assert.equal(result.action, 'bankruptcy')
  assert.equal(game.players.some((player) => player.id === 'a'), false)
})
