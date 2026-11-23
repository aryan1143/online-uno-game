export function isCardPlayable(card, topCard, currentColor, hand, pendingPenalty) {
  if (!card || !topCard) return false
  if (card.type === 'pass') return Boolean(pendingPenalty?.amount > 0)
  if (pendingPenalty?.amount > 0) {
    const playedValue = card.value === 'draw2' ? 2 : card.value === 'draw3' ? 3 : card.value === 'draw4' || card.type === 'wild_draw_four' ? 4 : 0
    return playedValue >= (pendingPenalty.typeValue || 0)
  }
  if (card.type === 'wild' || card.type === 'wild_draw_four') return true
  if (card.color === 'wild') return true
  if (card.color === currentColor) return true
  return card.value === topCard.value
}

export function getDrawDeckAvailable(game, playerId) {
  if (!game || game.currentPlayerId !== playerId) return false
  if (game.pendingPenalty?.amount > 0) return game.pendingPenalty.targetPlayerId === playerId
  return true
}
