import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeck, COLORS } from './game/deck.js'
import { canPlayCard, getPlayableCardIds, createInitialGame, applyCardEffect, getWinner } from './game/gameLogic.js'
import { GameManager } from './game/gameManager.js'

const player = (id) => ({ id, name: id })

test('deck contains 108 standard cards plus exactly two Pass cards', () => {
  const deck = createDeck(2)
  assert.equal(deck.length, 110)
  assert.equal(deck.filter((card) => card.type === 'pass').length, 2)
  for (const color of COLORS) assert.ok(deck.some((card) => card.color === color))
})

test('pass is illegal without pending penalty', () => {
  const top = { id: 'top', color: 'red', value: '7', type: 'number' }
  const pass = { id: 'pass', color: 'wild', value: 'pass', type: 'pass' }
  assert.equal(canPlayCard(pass, top, 'red', [pass], null), false)
})

test('pass transfers +2, +4, and combined penalties', () => {
  const pass = { id: 'pass', color: 'wild', value: 'pass', type: 'pass' }
  const top = { id: 'top', color: 'red', value: 'draw2', type: 'action' }
  for (const amount of [2, 4, 6]) assert.equal(canPlayCard(pass, top, 'red', [pass], { amount, type: 'DRAW_TWO', targetIndex: 1 }), true)
})

test('playable card calculation excludes blocked cards and includes matching cards', () => {
  const top = { id: 'top', color: 'red', value: '7', type: 'number' }
  const hand = [
    { id: 'r', color: 'red', value: '3', type: 'number' },
    { id: 'b', color: 'blue', value: '3', type: 'number' },
    { id: 'p', color: 'wild', value: 'pass', type: 'pass' },
  ]
  assert.deepEqual(getPlayableCardIds(hand, top, 'red', null), ['r'])
  assert.deepEqual(getPlayableCardIds(hand, top, 'red', { amount: 2, type: 'DRAW_TWO', targetIndex: 1 }), ['p'])
})

test('reverse changes direction and two-player reverse keeps turn', () => {
  const reverseGame = { players: [player('a'), player('b'), player('c')], currentPlayerIndex: 0, direction: 1, drawPile: [], discardPile: [], pendingPenalty: null }
  applyCardEffect(reverseGame, { value: 'reverse', type: 'action' })
  assert.equal(reverseGame.direction, -1)
  assert.equal(reverseGame.currentPlayerIndex, 2)

  const two = { players: [player('a'), player('b')], currentPlayerIndex: 0, direction: 1, drawPile: [], discardPile: [], pendingPenalty: null }
  applyCardEffect(two, { value: 'reverse', type: 'action' })
  assert.equal(two.direction, -1)
  assert.equal(two.currentPlayerIndex, 0)
})

test('pass chains transfer accumulated +2 and +4 penalties unchanged', () => {
  const manager = new GameManager()
  const game = manager.createGame('PASS', [player('a'), player('b'), player('c')])
  game.currentPlayerIndex = 0
  game.currentColor = 'red'
  game.pendingPenalty = { amount: 2, type: 'DRAW_TWO', targetIndex: 1, history: ['+2'] }
  game.players[0].hand = [{ id: 'pass1', color: 'wild', value: 'pass', type: 'pass' }, { id: 'filler1', color: 'blue', value: '1', type: 'number' }]
  game.discardPile = [{ id: 'top', color: 'red', value: '7', type: 'number' }]

  const first = manager.playCard('PASS', 'a', 'pass1', null)
  assert.equal(first.action, 'pass')
  assert.equal(game.pendingPenalty.amount, 2)
  assert.equal(game.pendingPenalty.targetIndex, 1)

  game.currentPlayerIndex = 1
  game.players[1].hand = [{ id: 'pass2', color: 'wild', value: 'pass', type: 'pass' }, { id: 'filler2', color: 'green', value: '2', type: 'number' }]
  manager.playCard('PASS', 'b', 'pass2', null)
  assert.equal(game.pendingPenalty.amount, 2)
  assert.equal(game.pendingPenalty.targetIndex, 2)

  game.pendingPenalty.amount = 6
  game.pendingPenalty.targetIndex = 2
  game.players[2].hand = [{ id: 'pass3', color: 'wild', value: 'pass', type: 'pass' }, { id: 'filler3', color: 'yellow', value: '3', type: 'number' }]
  manager.playCard('PASS', 'c', 'pass3', null)
  assert.equal(game.pendingPenalty.amount, 6)
  assert.equal(game.pendingPenalty.targetIndex, 0)
})

test('accepting a pending penalty draws cards and advances', () => {
  const manager = new GameManager()
  const game = manager.createGame('DRAW', [player('a'), player('b')])
  game.currentPlayerIndex = 1
  game.pendingPenalty = { amount: 6, targetIndex: 1 }
  const before = game.players[1].hand.length
  const result = manager.drawCard('DRAW', 'b')
  assert.equal(result.action, 'penalty_draw')
  assert.equal(game.players[1].hand.length, before + 6)
  assert.equal(game.pendingPenalty, null)
  assert.equal(game.currentPlayerIndex, 0)
})

test('+2 stacks on +2 and updates accumulated penalty', () => {
  const manager = new GameManager()
  const game = manager.createGame('STACK22', [player('a'), player('b')])
  game.currentPlayerIndex = 0
  game.pendingPenalty = { amount: 2, type: 'DRAW_TWO', targetIndex: 1, history: ['+2'] }
  game.discardPile = [{ id: 'top', color: 'red', value: '7', type: 'number' }]
  game.currentColor = 'red'
  game.players[0].hand = [{ id: '+2', color: 'red', value: 'draw2', type: 'action' }, { id: 'filler', color: 'blue', value: '1', type: 'number' }]
  assert.equal(canPlayCard(game.players[0].hand[0], game.discardPile.at(-1), 'red', game.players[0].hand, game.pendingPenalty), true)
  manager.playCard('STACK22', 'a', '+2', null)
  assert.equal(game.pendingPenalty.amount, 4)
  assert.equal(game.pendingPenalty.type, 'DRAW_TWO')
})

test('+4 stacks on +2 and becomes the effective wild penalty', () => {
  const manager = new GameManager()
  const game = manager.createGame('STACK24', [player('a'), player('b')])
  game.currentPlayerIndex = 0
  game.pendingPenalty = { amount: 2, type: 'DRAW_TWO', targetIndex: 1, history: ['+2'] }
  game.discardPile = [{ id: 'top', color: 'red', value: '7', type: 'number' }]
  game.currentColor = 'red'
  game.players[0].hand = [{ id: '+4', color: 'wild', value: 'draw4', type: 'wild_draw_four' }, { id: 'filler', color: 'blue', value: '1', type: 'number' }]
  manager.playCard('STACK24', 'a', '+4', 'yellow')
  assert.equal(game.pendingPenalty.amount, 6)
  assert.equal(game.pendingPenalty.type, 'WILD_DRAW_FOUR')
  assert.deepEqual(game.pendingPenalty.history, ['+2', '+4'])
})

test('+4 stacks on +4 and +2 cannot stack on a wild penalty', () => {
  const manager = new GameManager()
  const game = manager.createGame('STACK44', [player('a'), player('b')])
  game.currentPlayerIndex = 0
  game.pendingPenalty = { amount: 4, type: 'WILD_DRAW_FOUR', targetIndex: 1, history: ['+4'] }
  game.discardPile = [{ id: 'top', color: 'red', value: '7', type: 'number' }]
  game.currentColor = 'red'
  game.players[0].hand = [
    { id: '+4a', color: 'wild', value: 'draw4', type: 'wild_draw_four' },
    { id: '+2a', color: 'red', value: 'draw2', type: 'action' },
  ]
  assert.equal(canPlayCard(game.players[0].hand[0], game.discardPile.at(-1), 'red', game.players[0].hand, game.pendingPenalty), true)
  assert.equal(canPlayCard(game.players[0].hand[1], game.discardPile.at(-1), 'red', game.players[0].hand, game.pendingPenalty), false)
  manager.playCard('STACK44', 'a', '+4a', 'green')
  assert.equal(game.pendingPenalty.amount, 8)
  assert.equal(game.pendingPenalty.type, 'WILD_DRAW_FOUR')
})

test('Pass preserves total and effective penalty type', () => {
  const manager = new GameManager()
  const game = manager.createGame('PASS_TYPE', [player('a'), player('b')])
  game.currentPlayerIndex = 0
  game.pendingPenalty = { amount: 6, type: 'WILD_DRAW_FOUR', targetIndex: 1, history: ['+2', '+4'] }
  game.discardPile = [{ id: 'top', color: 'red', value: '7', type: 'number' }]
  game.currentColor = 'red'
  game.players[0].hand = [{ id: 'pass', color: 'wild', value: 'pass', type: 'pass' }, { id: 'filler', color: 'blue', value: '1', type: 'number' }]
  manager.playCard('PASS_TYPE', 'a', 'pass', null)
  assert.equal(game.pendingPenalty.amount, 6)
  assert.equal(game.pendingPenalty.type, 'WILD_DRAW_FOUR')
  assert.deepEqual(game.pendingPenalty.history, ['+2', '+4'])
  assert.equal(game.pendingPenalty.targetIndex, 1)
})

test('+2 to +2 to +4 reaches +8 with wild effective type', () => {
  const manager = new GameManager()
  const game = manager.createGame('STACK224', [player('a'), player('b'), player('c')])
  game.currentPlayerIndex = 0
  game.pendingPenalty = { amount: 2, type: 'DRAW_TWO', targetIndex: 1, history: ['+2'] }
  game.discardPile = [{ id: 'top', color: 'red', value: '7', type: 'number' }]
  game.currentColor = 'red'
  game.players[1].hand = [{ id: '+2b', color: 'blue', value: 'draw2', type: 'action' }, { id: 'filler', color: 'green', value: '1', type: 'number' }]
  game.currentPlayerIndex = 1
  manager.playCard('STACK224', 'b', '+2b', null)
  assert.equal(game.pendingPenalty.amount, 4)
  assert.equal(game.pendingPenalty.type, 'DRAW_TWO')

  game.pendingPenalty.history = ['+2', '+2']
  game.players[2].hand = [{ id: '+4c', color: 'wild', value: 'draw4', type: 'wild_draw_four' }, { id: 'filler2', color: 'yellow', value: '2', type: 'number' }]
  game.currentPlayerIndex = 2
  manager.playCard('STACK224', 'c', '+4c', 'red')
  assert.equal(game.pendingPenalty.amount, 8)
  assert.equal(game.pendingPenalty.type, 'WILD_DRAW_FOUR')
  assert.deepEqual(game.pendingPenalty.history, ['+2', '+2', '+4'])
})

test('winner is immediate with no UNO declaration', () => {
  const manager = new GameManager()
  const game = manager.createGame('WIN', [player('a'), player('b')])
  game.currentPlayerIndex = 0
  game.currentColor = 'red'
  game.pendingPenalty = null
  game.discardPile = [{ id: 'top', color: 'red', value: '7', type: 'number' }]
  game.players[0].hand = [{ id: 'win', color: 'red', value: '7', type: 'number' }]
  const result = manager.playCard('WIN', 'a', 'win', null)
  assert.equal(result.action, 'win')
  assert.equal(getWinner(game).id, 'a')
})
