import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeck, shuffle, drawCard, reshuffleDiscard, COLORS } from './game/deck.js'
import { createInitialGame, canPlayCard, applyCardEffect, getWinner } from './game/gameLogic.js'
import { GameManager } from './game/gameManager.js'
import { GameActionError } from './game/gameLogic.js'

function makePlayers(count = 2) {
  return Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}` }))
}

test('creates a standard 108-card deck plus Pass cards', () => {
  const deck = createDeck()
  assert.equal(deck.length, 118)
  for (const color of COLORS) assert.equal(deck.filter((card) => card.color === color).length, 27)
  assert.equal(deck.filter((card) => card.color === 'wild').length, 10)
})

test('shuffle preserves all cards and supports deterministic random input', () => {
  const deck = createDeck()
  const shuffled = shuffle(deck, () => 0)
  assert.equal(shuffled.length, deck.length)
  assert.deepEqual(new Set(shuffled.map((card) => card.id)).size, deck.length)
})

test('game starts with 7 cards each and valid draw/discard piles', () => {
  const game = createInitialGame(makePlayers(4), () => 0.42)
  assert.equal(game.players.length, 4)
  for (const player of game.players) assert.equal(player.hand.length, 7)
  assert.equal(game.discardPile.length, 1)
  assert.equal(game.drawPile.length, 89)
  assert.ok(COLORS.includes(game.discardPile[0].color))
  assert.equal(game.discardPile[0].type, 'number')
})

test('validates matching colors, values, and wild cards', () => {
  const top = { id: 'top', color: 'red', value: '7', type: 'number' }
  assert.equal(canPlayCard({ color: 'red', value: '3', type: 'number' }, top, 'red', []), true)
  assert.equal(canPlayCard({ color: 'blue', value: '7', type: 'number' }, top, 'red', []), true)
  assert.equal(canPlayCard({ color: 'blue', value: '3', type: 'number' }, top, 'red', []), false)
  assert.equal(canPlayCard({ color: 'wild', value: 'wild', type: 'wild' }, top, 'red', []), true)
})

test('blocks a wild draw four when a matching color is available', () => {
  const top = { id: 'top', color: 'red', value: '7', type: 'number' }
  const hand = [{ color: 'red', value: '2', type: 'number' }]
  assert.equal(canPlayCard({ color: 'wild', value: 'draw4', type: 'wild_draw_four' }, top, 'red', hand), false)
  assert.equal(canPlayCard({ color: 'wild', value: 'draw4', type: 'wild_draw_four' }, top, 'red', []), true)
})

test('skip, draw two, reverse, and direction advancement update turns', () => {
  const game = { players: makePlayers(3).map((p) => ({ ...p, hand: [] })), currentPlayerIndex: 0, direction: 1, drawPile: createDeck(), discardPile: [] }
  applyCardEffect(game, { value: 'skip', type: 'action' })
  assert.equal(game.currentPlayerIndex, 2)

  game.currentPlayerIndex = 0
  applyCardEffect(game, { value: 'draw2', type: 'action' })
  assert.equal(game.currentPlayerIndex, 1)

  game.currentPlayerIndex = 0
  applyCardEffect(game, { value: 'reverse', type: 'action' })
  assert.equal(game.direction, -1)
  assert.equal(game.currentPlayerIndex, 2)
})

test('reshuffles discard pile when draw pile is empty', () => {
  const top = { id: 'top', color: 'red', value: '7', type: 'number' }
  const discarded = [{ id: 'b', color: 'blue', value: '2', type: 'number' }, top]
  const draw = []
  reshuffleDiscard(discarded, draw, () => 0.5)
  assert.equal(draw.length, 1)
  assert.equal(discarded.length, 1)
  assert.equal(drawCard(draw, discarded)?.id, 'b')
})

test('game manager validates turns, cards, UNO, penalties, and winners', () => {
  const manager = new GameManager()
  const game = manager.createGame('ROOM1', makePlayers(2), () => 0.4)
  assert.throws(() => manager.drawCard('ROOM1', 'p2'), GameActionError)

  const player = game.players[0]
  player.hand = [{ id: 'only-card', color: 'red', value: '9', type: 'number' }]
  game.discardPile = [{ id: 'top', color: 'red', value: '7', type: 'number' }]
  game.currentColor = 'red'

  const result = manager.playCard('ROOM1', 'p1', 'only-card', null)
  assert.equal(result.winner.id, 'p1')
  assert.equal(manager.getWinner('ROOM1').id, 'p1')
})
