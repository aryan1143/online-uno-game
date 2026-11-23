import { createInitialGame, canPlayCard, normalizeCard, applyCardEffect, drawCards, getWinner, getPlayableCardIds, GameActionError } from './gameLogic.js'

export class GameManager {
  constructor() { this.games = new Map() }
  createGame(roomId, players, random) {
    if (!roomId || typeof roomId !== 'string') throw new GameActionError('Valid room ID required', 'INVALID_ROOM')
    if (this.games.has(roomId)) throw new GameActionError('Game already exists in room', 'GAME_EXISTS')
    const game = createInitialGame(players, random); this.games.set(roomId, game); return game
  }
  getGame(roomId) { return this.games.get(roomId) || null }
  removeGame(roomId) { return this.games.delete(roomId) }
  getPlayer(game, playerId) {
    const index = game.players.findIndex((player) => player.id === playerId)
    if (index === -1) throw new GameActionError('Player is not in this game', 'UNKNOWN_PLAYER')
    return { player: game.players[index], index }
  }
  assertTurn(game, playerId) {
    if (game.status !== 'playing') throw new GameActionError('Game is not active', 'GAME_NOT_ACTIVE')
    if (game.players[game.currentPlayerIndex]?.id !== playerId) throw new GameActionError("It is not this player's turn", 'NOT_YOUR_TURN')
  }

  playCard(roomId, playerId, cardId, chosenColor) {
    const game = this.games.get(roomId)
    if (!game) throw new GameActionError('Game not found', 'GAME_NOT_FOUND')
    this.assertTurn(game, playerId)
    const { player } = this.getPlayer(game, playerId)
    const cardIndex = player.hand.findIndex((card) => card.id === cardId)
    if (cardIndex === -1) throw new GameActionError('Card is not in player hand', 'CARD_NOT_FOUND')
    const card = normalizeCard(player.hand[cardIndex])
    const topCard = game.discardPile[game.discardPile.length - 1]

    if (!canPlayCard(card, topCard, game.currentColor, player.hand, game.pendingPenalty, game.pendingPenaltyType)) throw new GameActionError('Card cannot be played', 'ILLEGAL_MOVE')

    if (card.type === 'pass') {
      if (!game.pendingPenalty) throw new GameActionError('Pass can only be played during a draw penalty', 'INVALID_PASS')
    } else if (card.type === 'wild' || card.type === 'wild_draw_four') {
      if (!['red', 'blue', 'green', 'yellow'].includes(chosenColor)) throw new GameActionError('A valid wild card color is required', 'COLOR_REQUIRED')
      card.color = chosenColor
    }

    player.hand.splice(cardIndex, 1)
    game.turnDrawn = false
    game.discardPile.push(card)
    if (card.type !== 'pass') game.currentColor = card.color

    if (player.hand.length === 0) {
      game.status = 'finished'; game.winner = player
      game.actionSequence += 1
      game.lastAction = { actionId: `${roomId}-${game.actionSequence}-${cardId}`, playerId, card, type: 'win', timestamp: Date.now(), sequence: game.actionSequence }
      game.pendingPenalty = 0
      game.pendingPenaltyType = null
      game.pendingPenaltyTargetIndex = null
      game.pendingPenaltyHistory = []
      return { game, winner: player, action: 'win', playedCard: card }
    }

    const count = game.players.length
    let skippedPlayerId = null
    if (card.value === 'skip') skippedPlayerId = game.players[(game.currentPlayerIndex + game.direction + count) % count]?.id || null
    applyCardEffect(game, card)
    game.turnDrawn = false
    game.actionSequence += 1
    game.lastAction = { actionId: `${roomId}-${game.actionSequence}-${cardId}`, playerId, card, type: card.type === 'pass' ? 'pass' : card.value === 'reverse' ? 'reverse' : 'play', timestamp: Date.now(), sequence: game.actionSequence, skippedPlayerId }
    return { game, action: game.lastAction.type, playedCard: card }
  }

  drawCard(roomId, playerId) {
    const game = this.games.get(roomId)
    if (!game) throw new GameActionError('Game not found', 'GAME_NOT_FOUND')
    this.assertTurn(game, playerId)
    const { index } = this.getPlayer(game, playerId)

    if (game.turnDrawn) throw new GameActionError('This player has already drawn during their turn', 'DRAW_ALREADY_USED')

    if (game.pendingPenalty > 0) {
      if (game.pendingPenaltyTargetIndex !== index) throw new GameActionError('Draw penalty is assigned to another player', 'INVALID_DRAW_TARGET')
      const amount = game.pendingPenalty
      const drawn = drawCards(game, index, amount)
      game.pendingPenalty = 0
      game.pendingPenaltyType = null
      game.pendingPenaltyTargetIndex = null
      game.pendingPenaltyHistory = []
      game.turnDrawn = true
      const bankrupt = applyBankruptcy(game, index)
      if (bankrupt) return { game, drawnCards: drawn, action: 'bankruptcy' }
      advanceAfterDrawAcceptance(game, index)
      game.actionSequence += 1
      game.lastAction = { actionId: `${roomId}-${game.actionSequence}-draw`, playerId, card: null, type: 'penalty_draw', count: amount, timestamp: Date.now(), sequence: game.actionSequence }
      return { game, drawnCards: drawn, action: 'penalty_draw' }
    }

    const drawn = drawCards(game, index, 1)
    game.turnDrawn = true
    const bankrupt = applyBankruptcy(game, index)
    if (bankrupt) return { game, drawnCard: drawn[0] || null, action: 'bankruptcy' }
    game.actionSequence += 1
    game.lastAction = { actionId: `${roomId}-${game.actionSequence}-draw`, playerId, card: null, type: 'draw', timestamp: Date.now(), sequence: game.actionSequence }
    advanceAfterDrawAcceptance(game, index)
    return { game, drawnCard: drawn[0] || null, action: 'draw' }
  }

  getWinner(roomId) { const game = this.games.get(roomId); if (!game) throw new GameActionError('Game not found', 'GAME_NOT_FOUND'); return getWinner(game) }
  getPlayableCards(roomId, playerId) {
    const game = this.games.get(roomId); if (!game) throw new GameActionError('Game not found', 'GAME_NOT_FOUND')
    const { player } = this.getPlayer(game, playerId)
    const top = game.discardPile[game.discardPile.length - 1]
    return getPlayableCardIds(player.hand, top, game.currentColor, game.pendingPenalty, game.pendingPenaltyType)
  }
}

function applyBankruptcy(game, playerIndex) {
  const player = game.players[playerIndex]
  if (!player || player.hand.length < game.bankruptcyLimit) return false

  game.players.splice(playerIndex, 1)
  if (game.pendingPenaltyTargetIndex > playerIndex) game.pendingPenaltyTargetIndex -= 1
  if (game.currentPlayerIndex >= playerIndex) game.currentPlayerIndex = Math.max(0, game.currentPlayerIndex - 1)

  if (game.players.length === 1) {
    game.status = 'finished'
    game.winner = game.players[0]
  } else {
    game.currentPlayerIndex %= game.players.length
  }
  return true
}

function advanceAfterDrawAcceptance(game, index) {
  const count = game.players.length
  game.currentPlayerIndex = (game.currentPlayerIndex + game.direction + count * 100) % count
  game.turnDrawn = false
}

export default GameManager
