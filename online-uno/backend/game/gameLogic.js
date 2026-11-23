import { COLORS, createDeck, shuffle, drawCard as drawFromPile } from './deck.js'

export class GameActionError extends Error {
  constructor(message, code = 'INVALID_ACTION') { super(message); this.name = 'GameActionError'; this.code = code }
}

export function normalizeCard(card) {
  if (!card || typeof card !== 'object') throw new GameActionError('Invalid card')
  return { id: String(card.id || ''), color: String(card.color || ''), value: String(card.value || ''), type: String(card.type || '') }
}

export function isWildCard(card) { return card?.color === 'wild' || card?.type === 'wild' || card?.type === 'wild_draw_four' }
export function getPenaltyValue(card) {
  if (card?.value === 'draw2') return 2
  if (card?.value === 'draw3' || card?.type === 'draw3') return 3
  if (card?.value === 'draw4' || card?.type === 'wild_draw_four') return 4
  return 0
}

export function isPenaltyCard(card) { return getPenaltyValue(card) > 0 }

export function canPlayCard(card, topCard, currentColor, hand = [], pendingPenalty = null, pendingPenaltyType = null) {
  if (!card || !topCard) return false
  const penaltyAmount = typeof pendingPenalty === 'number' ? pendingPenalty : Number(pendingPenalty?.amount || 0)
  if (card.type === 'pass') return penaltyAmount > 0

  const playedPenaltyValue = getPenaltyValue(card)
  if (penaltyAmount > 0) {
    if (!playedPenaltyValue) return false
    const legacyTypeValue = pendingPenalty?.type === 'WILD_DRAW_FOUR' ? 4 : pendingPenalty?.type === 'DRAW_THREE' ? 3 : pendingPenalty?.type === 'DRAW_TWO' ? 2 : 0
    const currentTypeValue = Number(pendingPenaltyType || (typeof pendingPenalty === 'object' ? (pendingPenalty.typeValue || legacyTypeValue) : 0))
    return playedPenaltyValue >= currentTypeValue
  }

  if (card.type === 'wild_draw_four' || card.value === 'draw4') {
    return !hand.some((entry) => !isWildCard(entry) && entry.color === currentColor)
  }
  if (isWildCard(card)) return true
  if (card.color === currentColor) return true
  return card.value === topCard.value
}

export function getPlayableCardIds(hand, topCard, currentColor, pendingPenalty = null, pendingPenaltyType = null) {
  if (!Array.isArray(hand)) return []
  return hand.filter((card) => canPlayCard(card, topCard, currentColor, hand, pendingPenalty, pendingPenaltyType)).map((card) => card.id)
}

export function getStartingCard(drawPile) {
  if (!Array.isArray(drawPile)) throw new TypeError('drawPile must be an array')
  while (drawPile.length) {
    const index = drawPile.findIndex((card) => COLORS.includes(card.color) && card.type === 'number')
    if (index === -1) break
    return drawPile.splice(index, 1)[0]
  }
  return null
}

export function drawCards(game, playerIndex, count = 1) {
  if (!Number.isInteger(count) || count < 0) throw new GameActionError('Invalid draw count')
  const drawn = []
  for (let i = 0; i < count; i += 1) {
    const card = drawFromPile(game.drawPile, game.discardPile)
    if (!card) break
    game.players[playerIndex].hand.push(card)
    drawn.push(card)
  }
  return drawn
}

export function advancePlayer(game, steps = 1) {
  const count = game.players.length
  game.currentPlayerIndex = (game.currentPlayerIndex + game.direction * steps + count * 100) % count
}

export function applyCardEffect(game, playedCard) {
  const count = game.players.length
  if (playedCard.value === 'reverse') {
    game.direction *= -1
    if (count === 2) advancePlayer(game, 2)
    else advancePlayer(game, 1)
  } else if (playedCard.value === 'skip') {
    game.lastAction = { ...(game.lastAction || {}), skippedPlayerId: game.players[(game.currentPlayerIndex + game.direction + count) % count]?.id || null }
    advancePlayer(game, 2)
  } else if (getPenaltyValue(playedCard) > 0) {
    const target = (game.currentPlayerIndex + game.direction + count) % count
    const value = getPenaltyValue(playedCard)
    const previousAmount = game.pendingPenalty || 0
    const previousTypeValue = game.pendingPenaltyType || 0
    const history = [...(game.pendingPenaltyHistory || [])]
    history.push(`+${value}`)
    game.pendingPenalty = previousAmount + value
    game.pendingPenaltyType = Math.max(previousTypeValue, value)
    game.pendingPenaltyTargetIndex = target
    game.pendingPenaltyHistory = history
    advancePlayer(game, 1)
  } else if (playedCard.type === 'pass') {
    const target = (game.currentPlayerIndex + game.direction + count) % count
    game.pendingPenaltyTargetIndex = target
    advancePlayer(game, 1)
  } else {
    advancePlayer(game, 1)
  }
}

export function getWinner(game) { return game?.players?.find((player) => player.hand.length === 0) || null }

export function createInitialGame(players, random = Math.random) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 4) throw new GameActionError('UNO games require 2 to 4 players', 'INVALID_PLAYER_COUNT')
  if (new Set(players.map((player) => player.id)).size !== players.length) throw new GameActionError('Player IDs must be unique', 'INVALID_PLAYERS')
  let drawPile = shuffle(createDeck(2), random)
  const startingCard = getStartingCard(drawPile)
  if (!startingCard) throw new GameActionError('Unable to start game', 'EMPTY_DECK')
  const game = { status: 'playing', players: players.map((player) => ({ ...player, hand: [] })), drawPile, discardPile: [startingCard], currentColor: startingCard.color, currentPlayerIndex: 0, direction: 1, pendingPenalty: 0, pendingPenaltyType: null, pendingPenaltyTargetIndex: null, pendingPenaltyHistory: [], turnDrawn: false, bankruptcyLimit: 20, winner: null, lastAction: null, actionSequence: 0 }
  for (let round = 0; round < 7; round += 1) for (let index = 0; index < game.players.length; index += 1) {
    const card = drawFromPile(game.drawPile, game.discardPile)
    if (card) game.players[index].hand.push(card)
  }
  return game
}
