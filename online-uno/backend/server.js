import dotenv from "dotenv";
import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { randomBytes } from "crypto";
import { fileURLToPath, pathToFileURL } from "url";
import { GameManager } from "./game/gameManager.js";

dotenv.config({ path: new URL("../.env", import.meta.url) });
import { getPlayableCardIds } from "./game/gameLogic.js";

export const rooms = new Map();

// sessionId → { roomCode, socketId }
// Allows reverse-lookup from a persistent session token to the current socket.
export const sessions = new Map();

// sessionId → NodeJS.Timeout — pending cleanup timers for disconnected players
const disconnectTimers = new Map();

// sessionId → NodeJS.Timeout — pending auto-skip timers for disconnected current-turn players
const turnSkipTimers = new Map();

// Grace period before removing a disconnected player (2 minutes)
const GRACE_PERIOD_MS = 2 * 60 * 1000;

// Auto-skip a disconnected player's turn after 60 seconds
const TURN_SKIP_DELAY_MS = 60 * 1000;

export const REACTION_EMOJIS = Object.freeze([
  "😂",
  "😭",
  "🔥",
  "😎",
  "👏",
  "😡",
  "🤯",
  "❤️",
  "💀",
]);
// Keyed by sessionId
const reactionCooldowns = new Map();
const recentReactionIds = new Map();

export function createRoomCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += alphabet[randomBytes(1)[0] % alphabet.length];
  }
  return code;
}

function uniqueRoomCode() {
  let code;
  do {
    code = createRoomCode();
  } while (rooms.has(code));
  return code;
}

function generateSessionId() {
  return randomBytes(24).toString("hex");
}

function cleanName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Public state builders
// ---------------------------------------------------------------------------

function publicLobby(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected !== false,
      isHost: player.id === room.hostId,
      isSpectator: Boolean(player.isSpectator),
    })),
  };
}

function publicGameState(room) {
  const game = room.game;
  if (!game) return null;
  return {
    status: game.status,
    currentPlayerId: game.players[game.currentPlayerIndex]?.id || null,
    currentColor: game.currentColor,
    direction: game.direction,
    pendingPenalty:
      game.pendingPenalty > 0
        ? {
            amount: game.pendingPenalty,
            typeValue: game.pendingPenaltyType,
            type:
              game.pendingPenaltyType === 4
                ? "WILD_DRAW_FOUR"
                : game.pendingPenaltyType === 3
                  ? "DRAW_THREE"
                  : "DRAW_TWO",
            targetPlayerId:
              game.players[game.pendingPenaltyTargetIndex]?.id || null,
            history: game.pendingPenaltyHistory || [],
          }
        : null,
    pendingPenaltyType: game.pendingPenaltyType || null,
    pendingPenaltyTargetIndex: game.pendingPenaltyTargetIndex ?? null,
    pendingPenaltyHistory: game.pendingPenaltyHistory || [],
    lastAction: game.lastAction
      ? {
          actionId: game.lastAction.actionId,
          playerId: game.lastAction.playerId,
          type: game.lastAction.type,
          count: game.lastAction.count,
          timestamp: game.lastAction.timestamp,
          sequence: game.lastAction.sequence,
          skippedPlayerId: game.lastAction.skippedPlayerId || null,
          card:
            game.lastAction.card &&
            !["draw", "penalty_draw"].includes(game.lastAction.type)
              ? {
                  id: game.lastAction.card.id,
                  color: game.lastAction.card.color,
                  value: game.lastAction.card.value,
                  type:
                    game.lastAction.type === "win" ||
                    game.lastAction.type === "pass" ||
                    game.lastAction.type === "reverse" ||
                    game.lastAction.type === "play"
                      ? game.lastAction.card.type
                      : game.lastAction.card.type,
                }
              : null,
        }
      : null,
    discardTop: game.discardPile[game.discardPile.length - 1] || null,
    drawPileCount: game.drawPile.length,
    winner: game.winner ? { id: game.winner.id, name: game.winner.name } : null,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected !== false,
      cardCount: player.hand.length,
      isHost: player.id === room.hostId,
    })),
  };
}

export function getPrivateGameState(room, playerId) {
  if (!room.game) return null;
  const player = room.game.players.find((entry) => entry.id === playerId);
  const topCard =
    room.game.discardPile[room.game.discardPile.length - 1] || null;
  return {
    ...publicGameState(room),
    hand: player ? player.hand.map((card) => ({ ...card })) : [],
    playableCardIds: player
      ? getPlayableCardIds(
          player.hand,
          topCard,
          room.game.currentColor,
          room.game.pendingPenalty,
          room.game.pendingPenaltyType,
        )
      : [],
  };
}

function emitCardAction(io, room, result, playerId) {
  const action = room.game?.lastAction;
  if (!action) return;
  io.to(room.code).emit("cardPlayed", {
    actionId: action.actionId,
    playerId,
    card: result.playedCard
      ? {
          id: result.playedCard.id,
          color: result.playedCard.color,
          value: result.playedCard.value,
          type: result.playedCard.type,
        }
      : null,
    actionType: result.action,
    timestamp: action.timestamp,
    sequence: action.sequence,
    skippedPlayerId: action.skippedPlayerId || null,
  });
}

function emitDrawAction(io, room, result, playerId) {
  io.to(room.code).emit("cardDrawn", {
    actionId: room.game?.lastAction?.actionId,
    playerId,
    actionType: result.action,
    timestamp: room.game?.lastAction?.timestamp,
    sequence: room.game?.lastAction?.sequence,
  });
}

function emitLobby(io, room) {
  io.to(room.code).emit("lobbyUpdate", publicLobby(room));
  io.to(room.code).emit("room:update", publicLobby(room));
}

// Send each player their own private game state via their current socketId
function emitGame(io, room) {
  for (const player of room.players) {
    if (player.socketId) {
      const state = getPrivateGameState(room, player.id);
      io.to(player.socketId).emit("gameState", state);
      io.to(player.socketId).emit("game:state", state);
    }
  }
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function sessionForSocket(socket) {
  return socket.data.sessionId || null;
}

function roomForSessionId(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry) return null;
  return rooms.get(entry.roomCode) || null;
}

function playerBySessionId(room, sessionId) {
  return room.players.find((p) => p.id === sessionId) || null;
}

function playerBySocketId(room, socketId) {
  return room.players.find((p) => p.socketId === socketId) || null;
}

// ---------------------------------------------------------------------------
// Disconnect / cleanup logic
// ---------------------------------------------------------------------------

function cancelDisconnectTimer(sessionId) {
  const timer = disconnectTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(sessionId);
  }
}

function cancelTurnSkipTimer(sessionId) {
  const timer = turnSkipTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    turnSkipTimers.delete(sessionId);
  }
}

/**
 * Permanently remove a player from their room after the grace period expires.
 * Bankrupt players (isSpectator after bankruptcy) are cleared too.
 */
function cleanupPlayer(io, roomCode, sessionId, gameManager) {
  disconnectTimers.delete(sessionId);
  cancelTurnSkipTimer(sessionId);

  const room = rooms.get(roomCode);
  if (!room) {
    sessions.delete(sessionId);
    return;
  }

  const index = room.players.findIndex((p) => p.id === sessionId);
  if (index === -1) {
    sessions.delete(sessionId);
    return;
  }

  const player = room.players[index];
  room.players.splice(index, 1);

  // Remove from game players array if game is in progress
  if (room.game?.players) {
    const gameIndex = room.game.players.findIndex((p) => p.id === sessionId);
    if (gameIndex !== -1) room.game.players.splice(gameIndex, 1);
  }

  sessions.delete(sessionId);
  reactionCooldowns.delete(sessionId);
  recentReactionIds.delete(sessionId);

  if (room.players.length === 0) {
    rooms.delete(roomCode);
    gameManager.removeGame(roomCode);
    return;
  }

  // Transfer host only now that the grace period has expired
  if (room.hostId === sessionId) {
    const nextHost = room.players.find((p) => !p.isSpectator);
    if (nextHost) room.hostId = nextHost.id;
  }

  if (room.game) {
    if (room.game.players.length < 2) {
      room.game.status = "finished";
      room.game.winner = room.game.players[0] || null;
      room.game.currentPlayerIndex = 0;
      io.to(roomCode).emit("gameEnded", {
        winner: room.game.winner
          ? { id: room.game.winner.id, name: room.game.winner.name }
          : null,
        state: publicGameState(room),
      });
      gameManager.removeGame(roomCode);
      room.game = null;
      room.status = "lobby";
    } else {
      // Clamp currentPlayerIndex in case it went out of range
      if (room.game.currentPlayerIndex >= room.game.players.length) {
        room.game.currentPlayerIndex = 0;
      }
      emitGame(io, room);
    }
  }

  emitLobby(io, room);
  io.to(roomCode).emit("playerLeft", {
    playerId: sessionId,
    name: player.name,
    roomCode,
  });
}

/**
 * Handle a socket disconnect event: start the grace period, mark player offline.
 * Does NOT remove the player immediately.
 */
function handleDisconnect(io, socket, gameManager) {
  const sessionId = sessionForSocket(socket);
  if (!sessionId) return;

  // Update sessions Map — socket is gone
  const entry = sessions.get(sessionId);
  if (entry) entry.socketId = null;

  const roomCode = socket.data.roomCode;
  if (!roomCode) {
    sessions.delete(sessionId);
    return;
  }

  const room = rooms.get(roomCode);
  if (!room) {
    sessions.delete(sessionId);
    return;
  }

  const player = playerBySessionId(room, sessionId);
  if (!player) return;

  // If a newer socket has already taken over this player's session, ignore this old disconnect
  if (player.socketId && player.socketId !== socket.id) {
    return;
  }

  player.connected = false;
  player.socketId = null;

  // Cancel any existing timer (shouldn't happen but be safe)
  cancelDisconnectTimer(sessionId);
  cancelTurnSkipTimer(sessionId);

  // Notify others
  emitLobby(io, room);
  io.to(roomCode).emit("playerDisconnected", {
    playerId: sessionId,
    name: player.name,
    roomCode,
    reconnecting: true,
  });

  // Schedule turn auto-skip if this player holds the current turn
  if (room.game && room.game.status === "playing") {
    const currentPlayer = room.game.players[room.game.currentPlayerIndex];
    if (currentPlayer?.id === sessionId) {
      const skipTimer = setTimeout(() => {
        turnSkipTimers.delete(sessionId);
        const r = rooms.get(roomCode);
        if (!r?.game || r.game.status !== "playing") return;
        const cp = r.game.players[r.game.currentPlayerIndex];
        if (!cp || cp.id !== sessionId) return;
        // Advance to the next player
        const count = r.game.players.length;
        r.game.currentPlayerIndex =
          (r.game.currentPlayerIndex + r.game.direction + count * 100) % count;
        r.game.turnDrawn = false;
        r.game.actionSequence += 1;
        r.game.lastAction = {
          actionId: `${roomCode}-${r.game.actionSequence}-autoskip`,
          playerId: sessionId,
          type: "autoskip",
          timestamp: Date.now(),
          sequence: r.game.actionSequence,
        };
        io.to(roomCode).emit("turnAutoSkipped", {
          playerId: sessionId,
          name: player.name,
        });
        emitGame(io, r);
      }, TURN_SKIP_DELAY_MS);
      turnSkipTimers.set(sessionId, skipTimer);
    }
  }

  // Schedule permanent cleanup after grace period
  const cleanupTimer = setTimeout(() => {
    cleanupPlayer(io, roomCode, sessionId, gameManager);
  }, GRACE_PERIOD_MS);
  disconnectTimers.set(sessionId, cleanupTimer);
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createUnoServer() {
  const app = express();
  app.use(
    cors({
      origin:
        process.env.FRONTEND_ORIGIN ||
        process.env.CORS_ORIGIN ||
        "http://localhost:5173",
      credentials: true,
    }),
  );
  app.use(express.json());
  app.get("/health", (_request, response) => response.json({ ok: true }));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin:
        process.env.FRONTEND_ORIGIN ||
        process.env.CORS_ORIGIN ||
        "http://localhost:5173",
      credentials: true,
    },
  });
  const gameManager = new GameManager();

  function ack(callback, payload) {
    if (typeof callback === "function") callback(payload);
  }

  function error(socket, callback, code, message) {
    const payload = { ok: false, code, message };
    socket.emit("error", payload);
    ack(callback, payload);
  }

  function requireRoom(socket, code, callback) {
    const roomCode = String(code || "")
      .trim()
      .toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      error(socket, callback, "ROOM_NOT_FOUND", "Room not found");
      return null;
    }
    return room;
  }

  function requirePlayer(socket, room, callback) {
    const player = playerBySocketId(room, socket.id);
    if (!player) {
      error(
        socket,
        callback,
        "NOT_IN_ROOM",
        "You are not a player in this room",
      );
      return null;
    }
    return player;
  }

  function requireHost(socket, room, callback) {
    const player = requirePlayer(socket, room, callback);
    if (!player) return null;
    if (room.hostId !== player.id) {
      error(
        socket,
        callback,
        "NOT_HOST",
        "Only the host can perform this action",
      );
      return null;
    }
    return player;
  }

  function roomForSocket(socket) {
    return (
      socket.data.roomCode ||
      [...rooms.values()].some((room) => playerBySocketId(room, socket.id))
    );
  }

  // ---------------------------------------------------------------------------
  // Socket event handlers
  // ---------------------------------------------------------------------------

  io.on("connection", (socket) => {
    // ----- createRoom --------------------------------------------------------
    socket.on("createRoom", (payload = {}, callback) => {
      const name = cleanName(payload.name);
      if (!name)
        return error(
          socket,
          callback,
          "INVALID_NAME",
          "Player name is required",
        );
      if (roomForSocket(socket))
        return error(
          socket,
          callback,
          "ALREADY_IN_ROOM",
          "Leave the current room first",
        );

      const code = uniqueRoomCode();
      const sessionId = generateSessionId();

      const room = {
        code,
        hostId: sessionId,
        status: "lobby",
        players: [
          {
            id: sessionId,
            socketId: socket.id,
            name,
            connected: true,
            isSpectator: false,
          },
        ],
        game: null,
      };
      rooms.set(code, room);
      sessions.set(sessionId, { roomCode: code, socketId: socket.id });
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.sessionId = sessionId;

      const result = {
        ok: true,
        roomCode: code,
        playerId: sessionId,
        sessionId,
        lobby: publicLobby(room),
      };
      ack(callback, result);
      socket.emit("roomCreated", result);
      emitLobby(io, room);
    });

    // ----- joinRoom ----------------------------------------------------------
    socket.on("joinRoom", (payload = {}, callback) => {
      const code = String(payload.code || payload.roomCode || "")
        .trim()
        .toUpperCase();
      const name = cleanName(payload.name);
      if (!name)
        return error(
          socket,
          callback,
          "INVALID_NAME",
          "Player name is required",
        );
      if (roomForSocket(socket))
        return error(
          socket,
          callback,
          "ALREADY_IN_ROOM",
          "Leave the current room first",
        );

      const room = requireRoom(socket, code, callback);
      if (!room) return;
      if (room.status !== "lobby")
        return error(
          socket,
          callback,
          "ROOM_STARTED",
          "This room has already started",
        );
      if (room.players.length >= 4)
        return error(socket, callback, "ROOM_FULL", "This room is full");
      if (
        room.players.some(
          (player) => player.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        return error(
          socket,
          callback,
          "DUPLICATE_PLAYER",
          "A player with that name is already in the room",
        );
      }

      const sessionId = generateSessionId();
      room.players.push({
        id: sessionId,
        socketId: socket.id,
        name,
        connected: true,
        isSpectator: false,
      });
      sessions.set(sessionId, { roomCode: code, socketId: socket.id });
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.sessionId = sessionId;

      const result = {
        ok: true,
        roomCode: code,
        playerId: sessionId,
        sessionId,
        lobby: publicLobby(room),
      };
      ack(callback, result);
      socket.emit("roomJoined", result);
      emitLobby(io, room);
    });

    // ----- spectateRoom ------------------------------------------------------
    socket.on("spectateRoom", (payload = {}, callback) => {
      const code = String(
        payload.code || payload.roomId || payload.roomCode || "",
      )
        .trim()
        .toUpperCase();
      const name = cleanName(payload.name);
      if (!name)
        return error(
          socket,
          callback,
          "INVALID_NAME",
          "Player name is required",
        );
      if (roomForSocket(socket))
        return error(
          socket,
          callback,
          "ALREADY_IN_ROOM",
          "Leave the current room first",
        );
      const room = requireRoom(socket, code, callback);
      if (!room) return;
      if (room.players.length >= 4 && room.status === "lobby")
        return error(socket, callback, "ROOM_FULL", "This room is full");
      if (
        room.players.some(
          (player) => player.name.toLowerCase() === name.toLowerCase(),
        )
      )
        return error(
          socket,
          callback,
          "DUPLICATE_PLAYER",
          "A player with that name is already in the room",
        );

      const sessionId = generateSessionId();
      room.players.push({
        id: sessionId,
        socketId: socket.id,
        name,
        connected: true,
        isSpectator: true,
      });
      sessions.set(sessionId, { roomCode: code, socketId: socket.id });
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.sessionId = sessionId;

      const result = {
        ok: true,
        roomCode: code,
        playerId: sessionId,
        sessionId,
        spectator: true,
        lobby: publicLobby(room),
      };
      ack(callback, result);
      socket.emit("spectatorJoined", result);
      emitLobby(io, room);
    });

    // ----- reconnectRoom -----------------------------------------------------
    socket.on("reconnectRoom", (payload = {}, callback) => {
      const sessionId = String(
        payload.sessionId || payload.playerId || "",
      ).trim();
      const roomCode = String(payload.roomCode || "")
        .trim()
        .toUpperCase();

      if (!sessionId || !roomCode) {
        return error(
          socket,
          callback,
          "INVALID_PAYLOAD",
          "sessionId and roomCode are required",
        );
      }

      // Validate session exists and belongs to that room
      const sessionEntry = sessions.get(sessionId);
      if (!sessionEntry || sessionEntry.roomCode !== roomCode) {
        return error(
          socket,
          callback,
          "SESSION_EXPIRED",
          "Session not found or has expired",
        );
      }

      const room = rooms.get(roomCode);
      if (!room)
        return error(
          socket,
          callback,
          "ROOM_NOT_FOUND",
          "Room no longer exists",
        );

      const player = playerBySessionId(room, sessionId);
      if (!player)
        return error(
          socket,
          callback,
          "SESSION_EXPIRED",
          "Player no longer in room",
        );

      // Evict any lingering socket still attached to this session (e.g., mid-refresh in prod)
      const previousSocketId = player.socketId || sessionEntry.socketId;
      if (previousSocketId && previousSocketId !== socket.id) {
        const existingSocket = io.sockets.sockets.get(previousSocketId);
        if (existingSocket) {
          existingSocket.data.sessionId = null;
          existingSocket.data.roomCode = undefined;
          existingSocket.disconnect(true);
        }
      }

      // Cancel any pending cleanup / turn-skip timers
      cancelDisconnectTimer(sessionId);
      cancelTurnSkipTimer(sessionId);

      // Restore the session on the new socket
      player.socketId = socket.id;
      player.connected = true;
      sessionEntry.socketId = socket.id;

      socket.join(roomCode);
      socket.data.roomCode = roomCode;
      socket.data.sessionId = sessionId;

      // Notify others
      emitLobby(io, room);
      io.to(roomCode).emit("playerReconnected", {
        playerId: sessionId,
        name: player.name,
      });

      // Send private game state back to this socket
      const state = room.game ? getPrivateGameState(room, sessionId) : null;

      const result = {
        ok: true,
        roomCode,
        playerId: sessionId,
        sessionId,
        lobby: publicLobby(room),
        state,
        gameStatus: room.status,
      };
      ack(callback, result);
    });

    // ----- leaveRoom ---------------------------------------------------------
    socket.on("leaveRoom", (payload = {}, callback) => {
      const code = String(
        payload.roomCode || payload.code || socket.data.roomCode || "",
      )
        .trim()
        .toUpperCase();
      if (!code)
        return error(socket, callback, "NOT_IN_ROOM", "You are not in a room");

      const sessionId = sessionForSocket(socket);

      reactionCooldowns.delete(sessionId);
      recentReactionIds.delete(sessionId);
      cancelDisconnectTimer(sessionId);
      cancelTurnSkipTimer(sessionId);

      // Explicit leave — remove immediately (no grace period)
      const room = rooms.get(code);
      if (room) {
        const index = room.players.findIndex((p) => p.id === sessionId);
        if (index !== -1) {
          room.players.splice(index, 1);
          if (room.game?.players) {
            const gi = room.game.players.findIndex((p) => p.id === sessionId);
            if (gi !== -1) room.game.players.splice(gi, 1);
          }

          if (room.players.length === 0) {
            rooms.delete(code);
            gameManager.removeGame(code);
          } else {
            if (room.hostId === sessionId) {
              const next = room.players.find((p) => !p.isSpectator);
              if (next) room.hostId = next.id;
            }
            if (room.game) {
              if (room.game.players.length < 2) {
                room.game.status = "finished";
                room.game.winner = room.game.players[0] || null;
                io.to(code).emit("gameEnded", {
                  winner: room.game.winner
                    ? { id: room.game.winner.id, name: room.game.winner.name }
                    : null,
                  state: publicGameState(room),
                });
                gameManager.removeGame(code);
                room.game = null;
                room.status = "lobby";
              } else {
                if (room.game.currentPlayerIndex >= room.game.players.length)
                  room.game.currentPlayerIndex = 0;
                emitGame(io, room);
              }
            }
            emitLobby(io, room);
            io.to(code).emit("playerDisconnected", {
              playerId: sessionId,
              roomCode: code,
            });
          }
        }
      }

      if (sessionId) sessions.delete(sessionId);
      ack(callback, { ok: true, roomCode: code });
      socket.leave(code);
      socket.data.roomCode = undefined;
      socket.data.sessionId = undefined;
    });

    // ----- startGame ---------------------------------------------------------
    socket.on("startGame", (payload = {}, callback) => {
      const code = String(
        payload.roomCode || payload.code || socket.data.roomCode || "",
      )
        .trim()
        .toUpperCase();
      const room = requireRoom(socket, code, callback);
      if (!room) return;
      if (!requireHost(socket, room, callback)) return;
      if (room.status !== "lobby")
        return error(
          socket,
          callback,
          "GAME_ALREADY_STARTED",
          "The game has already started",
        );
      const activePlayers = room.players.filter((p) => !p.isSpectator);
      if (activePlayers.length < 2)
        return error(
          socket,
          callback,
          "NOT_ENOUGH_PLAYERS",
          "At least 2 players are required",
        );

      try {
        room.game = gameManager.createGame(
          code,
          activePlayers.map((p) => ({ id: p.id, name: p.name })),
        );
        room.status = "playing";
        emitLobby(io, room);
        emitGame(io, room);
        const hostSessionId = socket.data.sessionId;
        ack(callback, {
          ok: true,
          roomCode: code,
          state: getPrivateGameState(room, hostSessionId),
        });
        io.to(code).emit("gameStarted", publicGameState(room));
      } catch (caught) {
        error(socket, callback, caught.code || "START_FAILED", caught.message);
      }
    });

    // ----- playCard ----------------------------------------------------------
    socket.on("playCard", (payload = {}, callback) => {
      const code = String(
        payload.roomCode || payload.code || socket.data.roomCode || "",
      )
        .trim()
        .toUpperCase();
      const room = requireRoom(socket, code, callback);
      if (!room) return;
      const player = requirePlayer(socket, room, callback);
      if (!player) return;
      if (!room.game)
        return error(
          socket,
          callback,
          "GAME_NOT_STARTED",
          "The game has not started",
        );

      try {
        const result = gameManager.playCard(
          code,
          player.id,
          payload.cardId,
          payload.chosenColor,
        );
        emitGame(io, room);
        emitCardAction(io, room, result, player.id);
        if (result.action === "win")
          io.to(code).emit("gameEnded", {
            winner: result.winner,
            state: publicGameState(room),
          });
        ack(callback, {
          ok: true,
          action: result.action,
          state: getPrivateGameState(room, player.id),
        });
      } catch (caught) {
        error(socket, callback, caught.code || "INVALID_MOVE", caught.message);
      }
    });

    // ----- chooseWildColor ---------------------------------------------------
    socket.on("chooseWildColor", (payload = {}, callback) => {
      const code = String(
        payload.roomCode || payload.code || socket.data.roomCode || "",
      )
        .trim()
        .toUpperCase();
      const room = requireRoom(socket, code, callback);
      if (!room) return;
      const player = requirePlayer(socket, room, callback);
      if (!player) return;
      if (!room.game)
        return error(
          socket,
          callback,
          "GAME_NOT_STARTED",
          "The game has not started",
        );

      if (!payload.cardId)
        return error(socket, callback, "CARD_REQUIRED", "cardId is required");
      try {
        const result = gameManager.playCard(
          code,
          player.id,
          payload.cardId,
          payload.color || payload.chosenColor,
        );
        emitGame(io, room);
        emitCardAction(io, room, result, player.id);
        if (result.action === "win")
          io.to(code).emit("gameEnded", {
            winner: result.winner,
            state: publicGameState(room),
          });
        ack(callback, {
          ok: true,
          action: result.action,
          state: getPrivateGameState(room, player.id),
        });
      } catch (caught) {
        error(socket, callback, caught.code || "INVALID_MOVE", caught.message);
      }
    });

    // ----- drawCard ----------------------------------------------------------
    socket.on("drawCard", (payload = {}, callback) => {
      const code = String(
        payload.roomCode || payload.code || socket.data.roomCode || "",
      )
        .trim()
        .toUpperCase();
      const room = requireRoom(socket, code, callback);
      if (!room) return;
      const player = requirePlayer(socket, room, callback);
      if (!player) return;
      if (!room.game)
        return error(
          socket,
          callback,
          "GAME_NOT_STARTED",
          "The game has not started",
        );

      try {
        const result = gameManager.drawCard(code, player.id);
        emitGame(io, room);
        emitDrawAction(io, room, result, player.id);
        ack(callback, {
          ok: true,
          action: "draw",
          drawnCard: result.drawnCard,
          state: getPrivateGameState(room, player.id),
        });
      } catch (caught) {
        error(socket, callback, caught.code || "INVALID_MOVE", caught.message);
      }
    });

    // ----- endGame -----------------------------------------------------------
    socket.on("endGame", (payload = {}, callback) => {
      const code = String(
        payload.roomCode || payload.code || socket.data.roomCode || "",
      )
        .trim()
        .toUpperCase();
      const room = requireRoom(socket, code, callback);
      if (!room) return;
      if (!requireHost(socket, room, callback)) return;
      if (!room.game)
        return error(
          socket,
          callback,
          "GAME_NOT_STARTED",
          "The game has not started",
        );

      room.game.status = "finished";
      io.to(code).emit("gameEnded", {
        winner: room.game.winner
          ? { id: room.game.winner.id, name: room.game.winner.name }
          : null,
        state: publicGameState(room),
      });
      emitGame(io, room);
      ack(callback, { ok: true, roomCode: code });
    });

    // ----- returnToLobby -----------------------------------------------------
    socket.on("returnToLobby", (payload = {}, callback) => {
      const code = String(
        payload.roomCode || payload.code || socket.data.roomCode || "",
      )
        .trim()
        .toUpperCase();
      const room = requireRoom(socket, code, callback);
      if (!room) return;
      requirePlayer(socket, room, callback);

      room.game = null;
      room.status = "lobby";
      gameManager.removeGame(code);
      emitLobby(io, room);
      ack(callback, { ok: true, lobby: publicLobby(room) });
      io.to(code).emit("gameRestarted", publicLobby(room));
    });

    // ----- restartGame -------------------------------------------------------
    socket.on("restartGame", (payload = {}, callback) => {
      const code = String(
        payload.roomCode || payload.code || socket.data.roomCode || "",
      )
        .trim()
        .toUpperCase();
      const room = requireRoom(socket, code, callback);
      if (!room) return;
      if (!requireHost(socket, room, callback)) return;

      room.game = null;
      room.status = "lobby";
      gameManager.removeGame(code);
      emitLobby(io, room);
      ack(callback, { ok: true, lobby: publicLobby(room) });
      io.to(code).emit("gameRestarted", publicLobby(room));
    });

    // ----- reaction ----------------------------------------------------------
    socket.on("reaction", (payload = {}, callback) => {
      const code = String(
        payload.roomId ||
          payload.roomCode ||
          payload.code ||
          socket.data.roomCode ||
          "",
      )
        .trim()
        .toUpperCase();
      const room = requireRoom(socket, code, callback);
      if (!room) return;

      const member = playerBySocketId(room, socket.id);
      if (!member)
        return error(
          socket,
          callback,
          "NOT_IN_ROOM",
          "You are not a member of this room",
        );

      const sessionId = member.id;

      const emoji = String(payload.emoji || "");
      if (!REACTION_EMOJIS.includes(emoji))
        return error(
          socket,
          callback,
          "INVALID_REACTION",
          "Unsupported reaction emoji",
        );

      const now = Date.now();

      const reactionId =
        typeof payload.reactionId === "string" &&
        payload.reactionId.slice(0, 80)
          ? payload.reactionId.slice(0, 80)
          : `${sessionId}-${now}-${Math.random().toString(36).slice(2, 8)}`;
      const seenIds = recentReactionIds.get(sessionId) || new Set();
      if (seenIds.has(reactionId))
        return ack(callback, { ok: true, duplicate: true });
      seenIds.add(reactionId);
      if (seenIds.size > 100) seenIds.clear();
      recentReactionIds.set(sessionId, seenIds);

      const cooldownUntil = reactionCooldowns.get(sessionId) || 0;
      if (now < cooldownUntil)
        return error(
          socket,
          callback,
          "REACTION_COOLDOWN",
          "Please wait before sending another reaction",
        );

      reactionCooldowns.set(sessionId, now + 1000);
      const reaction = {
        roomId: code,
        playerId: sessionId,
        emoji,
        reactionId,
        timestamp: now,
      };
      io.to(code).emit("reaction", reaction);
      io.to(code).emit("reactionReceived", reaction);
      ack(callback, { ok: true, reaction });
    });

    // ----- disconnect --------------------------------------------------------
    socket.on("disconnect", () => {
      handleDisconnect(io, socket, gameManager);
    });
  });

  return { app, httpServer, io, rooms, sessions, gameManager };
}

const entryFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
const isDirectRun = entryFile === import.meta.url;

if (isDirectRun) {
  const { httpServer } = createUnoServer();
  const port = Number(process.env.PORT) || 3001;
  httpServer.listen(port, () =>
    console.log(`UNO Socket.IO server listening on port ${port}`),
  );
}
