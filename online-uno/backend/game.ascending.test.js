import test from 'node:test'
import assert from 'node:assert/strict'
import { canPlayCard, getPenaltyValue, getPlayableCardIds } from './game/gameLogic.js'
import { GameManager } from './game/gameManager.js'

const top = { id: 'top', color: 'red', value: '7', type: 'number' }
const card = (id, value) => value === 4
  ? { id, color: 'wild', value: 'draw4', type: 'wild_draw_four' }
  : { id, color: 'red', value: `draw${value}`, type: 'action' }

function penalty(amount, typeValue) { return { amount, typeValue } }

test('+2 on +2 is allowed', () => assert.equal(canPlayCard(card('+2', 2), top, 'red', [], 2, 2), true))
test('+2 on +3 is rejected', () => assert.equal(canPlayCard(card('+2', 2), top, 'red', [], 3, 3), false))
test('+2 on +4 is rejected', () => assert.equal(canPlayCard(card('+2', 2), top, 'red', [], 4, 4), false))
test('+3 on +2 is allowed', () => assert.equal(canPlayCard(card('+3', 3), top, 'red', [], 2, 2), true))
test('+3 on +3 is allowed', () => assert.equal(canPlayCard(card('+3', 3), top, 'red', [], 3, 3), true))
test('+3 on +4 is rejected', () => assert.equal(canPlayCard(card('+3', 3), top, 'red', [], 4, 4), false))
test('+4 on +2 is allowed', () => assert.equal(canPlayCard(card('+4', 4), top, 'red', [], 2, 2), true))
test('+4 on +3 is allowed', () => assert.equal(canPlayCard(card('+4', 4), top, 'red', [], 3, 3), true))
test('+4 on +4 is allowed', () => assert.equal(canPlayCard(card('+4', 4), top, 'red', [], 4, 4), true))

test('penalty values and totals update monotonically', () => {
  const manager = new GameManager()
  const game = manager.createGame('ASC1', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  game.currentPlayerIndex = 0
  game.pendingPenalty = 2
  game.pendingPenaltyType = 2
  game.pendingPenaltyTargetIndex = 1
  game.pendingPenaltyHistory = ['+2']
  game.currentColor = 'red'
  game.discardPile = [top]
  game.players[0].hand = [card('+3', 3), card('+2bad', 2)]

  const result = manager.playCard('ASC1', 'a', '+3', null)
  assert.equal(result.action, 'play')
  assert.equal(game.pendingPenalty, 5)
  assert.equal(game.pendingPenaltyType, 3)
  assert.deepEqual(game.pendingPenaltyHistory, ['+2', '+3'])

  game.currentPlayerIndex = 1
  game.players[1].hand = [card('+4', 4), card('+2bad2', 2)]
  assert.equal(canPlayCard(game.players[1].hand[0], top, 'red', game.players[1].hand, game.pendingPenalty, game.pendingPenaltyType), true)
  assert.equal(canPlayCard(game.players[1].hand[1], top, 'red', game.players[1].hand, game.pendingPenalty, game.pendingPenaltyType), false)
  manager.playCard('ASC1', 'b', '+4', 'blue')
  assert.equal(game.pendingPenalty, 9)
  assert.equal(game.pendingPenaltyType, 4)
})

test('Pass preserves penalty, type, and history', () => {
  const manager = new GameManager()
  const game = manager.createGame('PASS_ASC', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  game.currentPlayerIndex = 0
  game.pendingPenalty = 9
  game.pendingPenaltyType = 4
  game.pendingPenaltyTargetIndex = 1
  game.pendingPenaltyHistory = ['+2', '+3', '+4']
  game.players[0].hand = [{ id: 'pass', color: 'wild', value: 'pass', type: 'pass' }, { id: 'filler', color: 'blue', value: '1', type: 'number' }]
  manager.playCard('PASS_ASC', 'a', 'pass', null)
  assert.equal(game.pendingPenalty, 9)
  assert.equal(game.pendingPenaltyType, 4)
  assert.deepEqual(game.pendingPenaltyHistory, ['+2', '+3', '+4'])
  assert.equal(game.pendingPenaltyTargetIndex, 1)
})

test('invalid Pass without penalty is rejected', () => {
  const manager = new GameManager()
  const game = manager.createGame('NOPASS', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  game.pendingPenalty = 0
  game.pendingPenaltyType = null
  game.players[0].hand = [{ id: 'pass', color: 'wild', value: 'pass', type: 'pass' }]
  assert.throws(() => manager.playCard('NOPASS', 'a', 'pass', null), /cannot be played|Pass/i)
})

test('penalty resolution clears all authoritative penalty state', () => {
  const manager = new GameManager()
  const game = manager.createGame('RESOLVE', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  game.currentPlayerIndex = 1
  game.pendingPenalty = 7
  game.pendingPenaltyType = 3
  game.pendingPenaltyTargetIndex = 1
  game.pendingPenaltyHistory = ['+3', '+4']
  game.players[1].hand = []
  const result = manager.drawCard('RESOLVE', 'b')
  assert.equal(result.action, 'penalty_draw')
  assert.equal(game.pendingPenalty, 0)
  assert.equal(game.pendingPenaltyType, null)
  assert.equal(game.pendingPenaltyTargetIndex, null)
})

test('frontend server-provided playable IDs include equal/higher and exclude lower', () => {
  const hand = [card('a', 2), card('b', 3), card('c', 4), { id: 'pass', color: 'wild', value: 'pass', type: 'pass' }]
  assert.deepEqual(getPlayableCardIds(hand, top, 'red', 3, 3), ['b', 'c', 'pass'])
})
