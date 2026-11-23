# Online UNO

## Goal

Create a beautiful real-time multiplayer UNO website.

## Tech Stack

- React + Vite
- CSS
- Node.js
- Express
- Socket.IO
- Lucide React

## Features

- Create private rooms
- Join rooms using room codes
- 2-4 players
- Player names
- Multiplayer lobby
- Standard UNO cards
- Turn-based gameplay
- Reverse, Skip, Draw Two
- Wild and Wild Draw Four
- Pass cards and custom accumulated penalties
- Winner detection
- Play again

## Architecture

Frontend:
React application.

Backend:
Express + Socket.IO.

Game logic:
Server-authoritative game state.

Communication:
Socket.IO events.

## Important Rules

- Never trust frontend game actions.
- Validate all moves on the server.
- Never expose opponents' private cards.
- Do not use fake multiplayer.
- Do not unnecessarily rewrite working code.
- Keep the application responsive.

## Current Progress

Project setup completed. The frontend has been redesigned as a responsive tabletop card-game UI.

## Frontend Design Structure

- `HomePage`: compact player entry and private/join-room actions
- `JoinPage`: six-character room-code entry
- `LobbyPage`: host seat, open seats, connection status, copyable room code, and start control
- `GamePage`: green tabletop, opponent seats, piles, turn state, hand zone, and leave confirmation
- `GameOverPage`: server-result-ready winner presentation

Reusable primitives include `UnoLogo`, `Avatar`, `GameCard`, `IconButton`, `ConnectionBadge`, `OpponentSeat`, and `ConfirmDialog`.

No frontend sample opponents or invented game cards are used in production. Development mode includes clearly isolated visual preview state for `Admin`, opponent card counts, a playable hand, discard/draw interactions, wild color selection, and the UNO state. These previews do not emit Socket.IO actions or represent multiplayer game logic. The lobby and game remain server-state-ready until Socket.IO game events are connected. Active turns, playable-card hints, draw availability, reverse direction, and Pass penalties are synchronized from server state.

## Backend Multiplayer

The backend provides an Express/Socket.IO server at `backend/server.js`.

Room and game events:
- `createRoom`, `joinRoom`, `leaveRoom`
- `lobbyUpdate`, `room:update`
- `startGame`, `gameStarted`, `gameState`, `game:state`
- `playCard`, `chooseWildColor`, `drawCard`, `cardPlayed`
- `gameEnded`, `restartGame`, `endGame`
- `reaction`, `reactionReceived`, `spectateRoom`

Emoji reactions:
- Exactly 9 server-validated emojis are supported.
- Reactions are room-scoped and do not affect game state.
- Sender identity comes from the Socket.IO socket; client `playerId` is ignored.
- Each sender has a 1-second cooldown and duplicate reaction IDs are ignored.
- Reaction UI replaces a player's current avatar bubble and lasts 2 seconds.
- Spectators and room members remaining after bankruptcy can send reactions.
- `playerDisconnected`

The server uses private room state and sends each player their own hand plus opponent card counts. CORS and server configuration use `FRONTEND_ORIGIN` (or `CORS_ORIGIN`) and `PORT`.

## Frontend Multiplayer Integration

The frontend uses `frontend/src/socket.js` for the reusable Socket.IO connection. `VITE_SOCKET_URL` defaults to `http://localhost:3001`.

The React app synchronizes lobby and private game state through `lobbyUpdate`, `room:update`, `gameState`, `game:state`, `gameStarted`, `gameEnded`, and `playerDisconnected`. Client actions use acknowledged `createRoom`, `joinRoom`, `leaveRoom`, `startGame`, `playCard`, `chooseWildColor`, `drawCard`, `restartGame`, and `endGame` events. The frontend never derives authoritative card or turn state. Card flights use public `cardPlayed` events and player hand/seat container positions only; private hands are never broadcast.

## Custom Gameplay Rules

- The deck is extended with +3 cards, exactly two configurable Pass cards, and existing +2/+4 cards.
- Pass can only be played while a draw penalty is pending and transfers the full accumulated +2/+4 amount.
- The backend maintains `pendingPenalty`, `pendingPenaltyType`, `pendingPenaltyTargetIndex`, and `pendingPenaltyHistory`.
- Penalty stacking is ascending: a played value must be greater than or equal to the current `pendingPenaltyType`.
- +2, +3, and +4 add their values to `pendingPenalty`.
- `pendingPenaltyType` never decreases and becomes the highest stacked card value.
- An affected player may stack or accept the total by using the draw deck.
- A player may voluntarily draw exactly one card from the deck even when playable cards exist; the turn ends immediately.
- Voluntary drawing is blocked while a penalty is pending; penalty drawing accepts the full stack and can trigger bankruptcy.
- UNO declaration and UNO penalties are disabled; a player wins immediately after their final valid play.
