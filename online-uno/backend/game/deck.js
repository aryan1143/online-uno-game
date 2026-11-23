export const COLORS = ['red', 'blue', 'green', 'yellow']

let cardSequence = 0

export function createCard(color, value, type = 'number') {
  if (!COLORS.includes(color) && color !== 'wild') throw new Error('Invalid card color')
  cardSequence += 1
  return { id: `${color}-${value}-${cardSequence}`, color, value: String(value), type }
}

export function createDeck(passCardCount = 2) {
  const deck = []
  for (const color of COLORS) {
    deck.push(createCard(color, 0, 'number'))
    for (let value = 1; value <= 9; value += 1) {
      deck.push(createCard(color, value, 'number'))
      deck.push(createCard(color, value, 'number'))
    }
    for (const value of ['skip', 'reverse', 'draw2', 'draw3']) {
      deck.push(createCard(color, value, 'action'))
      deck.push(createCard(color, value, 'action'))
    }
  }
  for (let i = 0; i < 4; i += 1) {
    deck.push(createCard('wild', 'wild', 'wild'))
    deck.push(createCard('wild', 'draw4', 'wild_draw_four'))
  }
  const count = Number.isInteger(passCardCount) && passCardCount >= 0 ? passCardCount : 2
  for (let i = 0; i < count; i += 1) deck.push(createCard('wild', 'pass', 'pass'))
  return deck
}

export function shuffle(cards, random = Math.random) {
  if (!Array.isArray(cards)) throw new TypeError('cards must be an array')
  const shuffled = cards.slice()
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export function reshuffleDiscard(discardPile, drawPile, random = Math.random) {
  if (!Array.isArray(discardPile) || !Array.isArray(drawPile)) throw new TypeError('Piles must be arrays')
  if (discardPile.length <= 1) return drawPile
  const topCard = discardPile.pop()
  drawPile.push(...shuffle(discardPile.splice(0), random))
  discardPile.push(topCard)
  return drawPile
}

export function drawCard(drawPile, discardPile, random = Math.random) {
  if (!Array.isArray(drawPile) || !Array.isArray(discardPile)) throw new TypeError('Piles must be arrays')
  if (drawPile.length === 0) reshuffleDiscard(discardPile, drawPile, random)
  return drawPile.pop() || null
}
