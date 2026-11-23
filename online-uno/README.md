# Multiplayer UNO

A real-time, server-authoritative multiplayer UNO game built with React, Vite, Node.js, Express, Socket.IO, CSS, and Lucide React.

The project supports private rooms, 2–4 players, synchronized turn-based gameplay, custom stacking penalties, Pass cards, card-flight animations, reactions, and responsive desktop/mobile layouts.

## Features

- 2–4 player private rooms with 6-character room codes
- Real-time lobby and game synchronization
- Server-validated card plays and draws
- Private player hands and public opponent card counts
- Number, Skip, Reverse, +2, +3, +4, Wild, and Pass cards
- Voluntary drawing with automatic turn completion
- Ascending penalty stacking and a synchronized penalty indicator
- Win immediately without UNO declaration
- Bankrupt players are removed when their hand reaches 20 cards
- In-game emoji reactions for players and spectators
- Responsive tabletop UI with desktop and mobile layouts
- Card, direction, penalty, and draw animations

## Requirements

- Node.js 20 or newer
- npm

## Installation

Run these commands from the project root:

```powershell
cd backend
npm install

cd ..\frontend
npm install
```

## Running Locally

Start the backend on port `3001`:

```powershell
cd backend
npm start
```

Start the frontend in another terminal:

```powershell
cd frontend
npm run dev
```

Open `http://localhost:5173`.

To test multiplayer, open the site in at least two browser windows or tabs, create a room in one window, and join with the displayed room code in the others.

### Environment Variables

Backend:

- `PORT` — Socket.IO and API port. Default: `3001`
- `FRONTEND_ORIGIN` — Allowed frontend origin. Default: `http://localhost:5173`
- `CORS_ORIGIN` — Alternative frontend-origin setting

Frontend:

- `VITE_SOCKET_URL` — Backend URL. Default: `http://localhost:3001`

Example backend environment:

```text
PORT=3001
FRONTEND_ORIGIN=http://localhost:5173
```

## How to Play

### Objective

Be the first player to have no cards left. There is no mandatory UNO declaration or UNO penalty: the round ends immediately after a player's final valid card is played.

### Starting a Round

1. Enter a player name.
2. Create a private room or join an existing room with its 6-character code.
3. The room creator is the host.
4. At least 2 players are required to start.
5. The host starts the game when the lobby is ready.

Every player begins with 7 cards. One valid number card starts the discard pile.

### Matching and Playing Cards

On your turn, you may play a card that matches the top discard card by:

- Color, or
- Number/value/action

You may also play a Wild or other permitted special card according to the current penalty rules.

Playable cards are highlighted in your hand. Unplayable cards are dimmed. The server performs the final validation, so highlighted cards can never override illegal moves.

### Voluntary Drawing

You may click the draw deck at any time during your turn, even if you have playable cards.

- You draw exactly one card.
- The card is private and is shown only to you.
- Drawing immediately ends your turn.
- You cannot play the newly drawn card until a later turn.
- You cannot draw out of turn or draw more than once during the same turn.

### Draw Pile and Discard Pile

- The draw pile supplies cards when a player draws.
- If the draw pile empties, discard cards are reshuffled back into it while the current discard card remains in place.

## Card Guide

| Card | Effect |
|---|---|
| Number 0–9 | Match the top card by color or number |
| Skip | The next eligible player loses their turn |
| Reverse | Reverses play direction; in a 2-player game it behaves as Skip |
| +2 | Adds 2 cards to a pending penalty |
| +3 | Adds 3 cards to a pending penalty |
| +4 | Adds 4 cards to a pending penalty; a compatible wild penalty card also requires a chosen color |
| Wild | May be played and allows the player to choose Red, Blue, Green, or Yellow |
| Pass | Transfers a pending penalty to the next player without changing its total or type |

### +2, +3, and +4 Cards

Penalty cards use ascending stacking rules.

A penalty card can stack only when its value is greater than or equal to the current penalty type:

| Played | Current +2 | Current +3 | Current +4 |
|---|---|---|---|
| +2 | Allowed | Rejected | Rejected |
| +3 | Allowed | Allowed | Rejected |
| +4 | Allowed | Allowed | Allowed |

Examples:

- +2 → +2 = 4 cards
- +2 → +3 = 5 cards
- +2 → +3 → +4 = 9 cards
- +3 → +4 = 7 cards
- +4 → +4 = 8 cards

The table shows:

- The accumulated penalty amount
- The current highest penalty type
- The stacking history
- The player who must respond

### Pending Penalty Rules

When a penalty is pending, the recipient may:

1. Stack a permitted equal-or-higher penalty card, or
2. Play a Pass card, or
3. Accept the penalty by drawing the accumulated number of cards

The recipient cannot voluntarily draw as a way to bypass a penalty. The recipient also cannot play normal cards until the penalty is resolved or transferred.

### Pass Card

Pass cards are custom cards included in the deck.

- Pass can be played only while a draw penalty is pending.
- It transfers the full accumulated penalty to the next eligible player.
- It preserves the total and highest penalty type.
- It follows the current direction.
- Consecutive Pass cards keep transferring the same penalty.
- Pass cannot be used to start or create a penalty.

### Skip and Reverse

- Skip moves the turn past the next eligible player.
- Reverse reverses the play direction.
- In a 2-player game, Reverse effectively skips the opponent and leaves the turn with the Reverse player.

## Turn Indicator and Direction

- The table displays the active player's avatar and **ACTIVE TURN** label.
- The local player sees **YOUR TURN**.
- The circular direction control shows whether play is moving clockwise or counter-clockwise.
- After Reverse, Skip, Draw, Pass, or a penalty stack, the next active player updates on every client from server state.

## Winning and Bankruptcy

### Winning

The game ends immediately when a player plays their final card. No UNO declaration is required.

### Bankruptcy

If a player's hand reaches 20 or more cards, they are removed as an active player and become bankrupt/spectator status for that round.

They can still:

- Observe the round
- Send emoji reactions
- Return to the lobby through the normal room controls

## Reactions

The reaction button appears near the gameplay controls.

Available reactions:

- 😂
- 😭
- 🔥
- 😎
- 👏
- 😡
- 🤯
- ❤️
- 💀

Reaction behavior:

- Select any emoji from the compact picker.
- The emoji appears briefly above the sender's avatar.
- The popup lasts about 2 seconds.
- Sending another reaction replaces the current reaction bubble.
- Reactions are limited by a 1-second cooldown.
- Reactions do not change cards, turns, penalties, or game state.

## Room and Lobby

- The host receives the Start Game button.
- Non-host players wait for the host.
- The lobby shows real connection status and host identity.
- Leaving or disconnecting is handled by the server.
- If the host leaves, another connected player becomes host.

## Socket.IO Events

The backend exposes these primary events:

| Event | Purpose |
|---|---|
| `createRoom` | Create a private room |
| `joinRoom` | Join a room by code |
| `leaveRoom` | Leave a room |
| `spectateRoom` | Join as a spectator |
| `lobbyUpdate` / `room:update` | Broadcast lobby state |
| `startGame` | Host starts a game |
| `gameState` / `game:state` | Send private/public state to a player |
| `playCard` | Validate and play a card |
| `chooseWildColor` | Select a wild card color while playing |
| `drawCard` | Voluntarily draw or accept a pending penalty |
| `cardPlayed` | Public card-action animation event |
| `cardDrawn` | Public draw-action event |
| `gameEnded` | Broadcast the round winner |
| `restartGame` | Restart from the lobby as host |
| `returnToLobby` | Return a finished room to lobby |
| `reaction` | Send a validated room reaction |
| `reactionReceived` | Reaction broadcast alias |
| `playerDisconnected` | Notify the room of a disconnect |

The server never trusts private card IDs or player state from the client. Card hands are sent only to their owner; opponents receive card counts and public state.

## Testing

Backend tests:

```powershell
cd backend
npm test
```

Run a focused rule suite:

```powershell
cd backend
npm run test:rules
```

Frontend validation:

```powershell
cd frontend
npm run lint
npm run build
```

## Project Structure

```text
frontend/
  src/
    App.jsx
    App.css
    index.css
    socket.js
    gameRules.js
backend/
  server.js
  game/
    deck.js
    gameLogic.js
    gameManager.js
  game.test.js
  game.ascending.test.js
  game.draw.test.js
  server.test.js
README.md
PROJECT_CONTEXT.md
PROGRESS.md
```

## Browser Verification

Recommended manual test:

1. Start the backend and frontend.
2. Open 2–4 browser tabs.
3. Create a room in one tab.
4. Join the room code from other tabs.
5. Start as host.
6. Verify private hands differ per tab.
7. Verify turn highlighting and direction updates.
8. Test normal play, drawing, Reverse, Skip, penalties, Pass, and Wild cards.
9. Test reactions across every tab.

## Notes

- All game actions are authoritative on the backend.
- The frontend animates public validated events but never calculates card or turn state.
- The existing Vite/Socket.IO setup must remain running together for multiplayer browser testing.
