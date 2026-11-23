import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, Crown, DoorOpen, LogOut, Plus, Play, RotateCcw, Trophy, Users, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react'
import { socket, emitWithAck } from './socket.js'
import './App.css'

const colorNames = { red: 'Red', blue: 'Blue', green: 'Green', yellow: 'Yellow', wild: 'Wild' }
const REACTION_EMOJIS = ['😂', '😭', '🔥', '😎', '👏', '😡', '🤯', '❤️', '💀']

function UnoLogo({ large = false }) { return <div className={`uno-logo ${large ? 'uno-logo-large' : ''}`} aria-label="UNO"><span>UNO</span></div> }

function Avatar({ name = 'You', size = 'md', status, reaction }) {
  const initials = name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || 'Y'
  return <div className={`avatar avatar-${size}`} aria-label={`${name} avatar`}><span>{initials}</span>{status && <i className="avatar-status" />}{reaction && <b key={reaction.reactionId} className="avatar-reaction" aria-label={`Reaction ${reaction.emoji}`}>{reaction.emoji}</b>}</div>
}

export function GameCard({ value, color, size = 'md', onClick, disabled = false, playable = false }) {
  const isWild = color === 'wild'
  const isPass = value === 'pass'
  const display = value === 'draw2' ? '+2' : value === 'draw3' ? '+3' : value === 'draw4' ? '+4' : value === 'reverse' ? '↻' : value === 'skip' ? '⊘' : value === 'pass' ? 'PASS' : value === 'wild' ? '' : value
  return <button type="button" className={`game-card card-${color} card-${size} ${isWild ? 'card-wild' : ''} ${isPass ? 'card-pass' : ''} ${playable ? 'playable-card' : 'dimmed-card'}`} onClick={onClick} disabled={disabled} aria-label={isPass ? 'Pass card' : isWild ? `Wild ${value}` : `${colorNames[color] || color} ${display} card`}><span className="card-corner card-corner-top">{display}</span><span className="card-oval">{isPass ? <span className="pass-symbol">↻</span> : isWild ? <span className="wild-grid"><i /><i /><i /><i /></span> : <b>{display}</b>}</span><span className="card-corner card-corner-bottom">{display}</span></button>
}

function IconButton({ label, onClick, children }) { return <button type="button" className="icon-button" onClick={onClick} aria-label={label}>{children}</button> }

function ConnectionBadge({ connected }) { return <div className={`connection-badge ${connected ? 'connected' : ''}`}>{connected ? <Wifi size={15} /> : <WifiOff size={15} />}{connected ? 'Connected' : 'Disconnected'}</div> }

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }) { return <div className="dialog-backdrop" onMouseDown={onCancel}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="dialog-title">{title}</h2><p>{message}</p><div><button type="button" className="button button-secondary" onClick={onCancel}>Stay</button><button type="button" className="button button-danger" onClick={onConfirm}>{confirmLabel}</button></div></section></div> }

function Toast({ message, type = 'error', onClose }) {
  if (!message) return null
  return <div className={`game-toast toast-${type}`} role="alert"><span>{message}</span><button type="button" onClick={onClose} aria-label="Dismiss notification">×</button></div>
}

function HomePage({ name, setName, onCreate, onJoin, connected, busy }) {
  return <main className="home-page"><header className="home-header"><UnoLogo /><ConnectionBadge connected={connected} /></header><section className="home-main"><div className="home-art" aria-hidden="true"><div className="art-card art-red"><span>7</span></div><div className="art-card art-blue"><span>↻</span></div><div className="art-card art-yellow"><span>+2</span></div></div><div className="welcome-panel"><p className="kicker">FRIENDS &amp; FAMILY TABLE</p><h1>Let’s play UNO</h1><p className="welcome-copy">Match cards by color or number. Be first to empty your hand.</p><label htmlFor="player-name">Player name</label><input id="player-name" className="text-input" value={name} maxLength={16} onChange={(event) => setName(event.target.value)} placeholder="What should we call you?" /><button type="button" className="button button-primary" onClick={onCreate} disabled={!name.trim() || !connected || busy}><Plus size={19} />Create private room</button><button type="button" className="button button-secondary" onClick={onJoin} disabled={!name.trim() || !connected || busy}><DoorOpen size={19} />Join room</button></div></section><footer className="home-footer"><span>2–4 players</span><i /><span>Private rooms</span><i /><span>Classic rules</span></footer></main>
}

function JoinPage({ code, setCode, onBack, onJoin, busy }) {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  return <main className="utility-page"><header className="utility-header"><UnoLogo /><IconButton label="Back" onClick={onBack}><ArrowLeft /></IconButton></header><section className="join-panel"><div className="panel-symbol"><DoorOpen /></div><p className="kicker">ROOM INVITE</p><h1>Join a room</h1><p>Enter the six-character code shared by the host.</p><label htmlFor="room-code">Room code</label><input id="room-code" className="room-input" value={clean} onChange={(event) => setCode(event.target.value)} placeholder="A1B2C3" autoComplete="off" /><button type="button" className="button button-primary" disabled={clean.length !== 6 || busy} onClick={onJoin}>Join room</button></section></main>
}

function LobbyPage({ room, playerId, onStart, onLeave, busy }) {
  const [copied, setCopied] = useState(false)
  const players = room?.players || []
  const isHost = room?.hostId === playerId
  async function copyInvitation() {
    if (!room?.code) return
    try { await navigator.clipboard.writeText(room.code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { setCopied(false) }
  }
  const slots = [...players, ...Array(Math.max(0, 4 - players.length)).fill(null)]
  return <main className="lobby-page"><header className="utility-header"><UnoLogo /><IconButton label="Leave lobby" onClick={onLeave}><LogOut /></IconButton></header><section className="lobby-shell"><div className="lobby-title"><div><p className="kicker">PRIVATE ROOM</p><h1>Game lobby</h1></div><button type="button" className="room-code-box" onClick={copyInvitation}><span>ROOM CODE</span><strong>{room?.code || 'WAITING'}</strong><Copy size={18} /><em>{copied ? 'Copied' : 'Copy'}</em></button></div><div className="player-slots">{slots.map((player, index) => <article className={`player-slot ${player ? 'filled' : ''}`} key={player?.id || index}>{player ? <><Avatar name={player.name} size="lg" status={player.connected !== false} /><div className="slot-name"><h2>{player.name}</h2>{player.isHost && <span className="host-tag"><Crown size={12} />Host</span>}</div><span className="connection-status"><i />{player.connected === false ? 'Disconnected' : 'Connected'}</span></> : <><div className="add-slot"><Plus /></div><div className="slot-name"><h2>Open seat</h2><span className="waiting-tag">Waiting for player</span></div></>}</article>)}</div><div className="lobby-footer"><div className="player-count"><Users size={18} /><strong>{players.length}</strong><span>of 4 players</span></div><div className="waiting"><i />{players.length < 2 ? 'Waiting for players' : 'Ready to play'}</div>{isHost ? <button type="button" className="button button-primary start-button" onClick={onStart} disabled={busy || players.length < 2}><Play size={19} fill="currentColor" />Start game</button> : <button type="button" className="button button-secondary start-button" disabled>Waiting for host</button>}</div></section></main>
}

function OpponentSeat({ side, player, active, seatRef, skipped, reaction }) {
  if (!player) return <div className={`opponent-seat opponent-${side} empty-seat`}><div className="seat-dots">···</div></div>
  return <div ref={seatRef} className={`opponent-seat opponent-${side} ${active ? 'active-opponent' : ''} ${skipped ? 'skipped-opponent' : ''}`}><div className="opponent-avatar"><Avatar name={player.name} size="md" status={player.connected !== false} reaction={reaction} /><span>{player.cardCount}</span></div><div><strong>{player.name}</strong><small>{player.cardCount} cards</small>{active && <b className="active-seat-label">ACTIVE TURN</b>}{skipped && <b className="skipped-seat-label">SKIPPED</b>}</div></div>
}

function GamePage({ name, playerId, game, onLeave, onDraw, onPlay, busy, drawnCard, cardFlight, reactions, onReact }) {
  const [muted, setMuted] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [pendingWild, setPendingWild] = useState(null)
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false)
  const [flightRender, setFlightRender] = useState(null)
  const handScrollRef = useRef(null)
  const discardRef = useRef(null)
  const opponentSeatRefs = useRef({})
  const hand = game?.hand || []
  const opponents = (game?.players || []).filter((player) => player.id !== playerId)
  const seats = opponents.length === 1 ? ['top'] : opponents.length === 2 ? ['top', 'right'] : ['top', 'left', 'right']
  const opponentData = opponents.map((player, index) => ({ side: seats[index], player }))
  const currentPlayer = (game?.players || []).find((player) => player.id === game?.currentPlayerId)
  const isMyTurn = game?.currentPlayerId === playerId
  const playableCardIds = isMyTurn ? (game?.playableCardIds || []) : []
  const isDrawAvailable = isMyTurn && !busy && (!game?.pendingPenalty || game.pendingPenalty.targetPlayerId === playerId)

  useEffect(() => {
    if (!cardFlight?.card || !discardRef.current) return
    const source = cardFlight.playerId === playerId
      ? handScrollRef.current
      : opponentSeatRefs.current[cardFlight.playerId]
    if (!source) return

    const sourceRect = source.getBoundingClientRect()
    const destinationRect = discardRef.current.getBoundingClientRect()
    const isMobileCard = window.matchMedia('(max-width: 800px)').matches
    const cardWidth = isMobileCard ? 72 : 82
    const cardHeight = isMobileCard ? 102 : 116
    const startX = sourceRect.left + sourceRect.width / 2 - cardWidth / 2
    const startY = sourceRect.top + sourceRect.height / 2 - cardHeight / 2
    const endX = destinationRect.left + destinationRect.width / 2
    const endY = destinationRect.top + destinationRect.height / 2

    setFlightRender({
      actionId: cardFlight.actionId,
      card: cardFlight.card,
      left: startX,
      top: startY,
      tx: endX - (startX + cardWidth / 2),
      ty: endY - (startY + cardHeight / 2),
    })
    const timer = window.setTimeout(() => setFlightRender(null), 650)
    return () => window.clearTimeout(timer)
  }, [cardFlight, playerId])

  function playCard(card) {
    if (!isMyTurn || busy || !playableCardIds.includes(card.id)) return
    if (card.type === 'wild' || card.type === 'wild_draw_four' || card.color === 'wild') {
      setPendingWild(card)
    } else {
      onPlay(card.id)
    }
  }

  function chooseColor(color) {
    if (!pendingWild) return
    onPlay(pendingWild.id, color)
    setPendingWild(null)
  }

  return <main className="game-page"><header className="game-header"><UnoLogo /><div className="turn-status"><i />{isMyTurn ? 'YOUR TURN' : `${currentPlayer?.name || 'Waiting'}'s ACTIVE TURN`}</div><div className="game-header-actions"><IconButton label={muted ? 'Sound on' : 'Mute'} onClick={() => setMuted(!muted)}>{muted ? <VolumeX /> : <Volume2 />}</IconButton><IconButton label="Leave game" onClick={() => setConfirmLeave(true)}><LogOut /></IconButton></div></header><section className="game-content"><div className="play-table">{seats.map((side, index) => <OpponentSeat key={side} side={side} player={opponentData[index]?.player} active={opponentData[index]?.player?.id === game?.currentPlayerId} skipped={cardFlight?.skippedPlayerId === opponentData[index]?.player?.id} reaction={reactions?.[opponentData[index]?.player?.id]} seatRef={(node) => { const player = opponentData[index]?.player; if (player && node) opponentSeatRefs.current[player.id] = node }} />)}<div className="direction-button" aria-label="Turn direction"><RotateCcw size={16} className={game?.direction === -1 ? 'reverse-direction' : ''} /></div><div className="piles"><div ref={discardRef} className="pile discard-pile"><span>Discard</span>{game?.discardTop ? <GameCard value={game.discardTop.value} color={game.discardTop.color} size="sm" disabled /> : <div className="empty-pile"><i /></div>}</div><div className="pile draw-pile"><span>Draw</span><button type="button" className={`card-back ${isDrawAvailable ? 'draw-deck-active' : ''}`} onClick={onDraw} disabled={!isDrawAvailable} aria-label="Draw card"><span>UNO</span>{isDrawAvailable && <b className="draw-label">DRAW A CARD</b>}</button></div></div>{game?.pendingPenalty && <div key={`${game.pendingPenalty.amount}-${game.pendingPenalty.type}-${game.pendingPenalty.targetPlayerId}`} className={`penalty-indicator ${game.lastAction?.type === 'pass' ? 'penalty-transferred' : ''}`} role="status"><span>DRAW PENALTY</span><strong>+{game.pendingPenalty.amount} CARDS</strong>{game.pendingPenalty.history?.length > 1 && <small>{game.pendingPenalty.history.join(' → ')} = +{game.pendingPenalty.amount}</small>}<em>{game.pendingPenalty.targetPlayerId === playerId ? 'RESPOND NOW' : 'PENALTY ACTIVE'}</em></div>}{game?.currentColor && <div className="current-color"><i className={`current-dot dot-${game.currentColor}`} />{colorNames[game.currentColor]} active</div>}<div className="table-notice"><Wifi size={17} /><span>{game?.drawPileCount ?? 0} cards in draw pile</span></div>{drawnCard && <div className="drawn-card-flight"><GameCard value={drawnCard.value} color={drawnCard.color} size="sm" disabled /></div>}</div><section className="hand-zone"><div className={`self-player ${isMyTurn ? 'active-self' : ''}`}><Avatar name={name} reaction={reactions?.[playerId]} size="sm" status /><div><strong>{name}</strong><span>{hand.length} cards</span></div></div><div ref={handScrollRef} className="hand-scroll"><div className="player-hand">{hand.length ? hand.map((card) => <GameCard key={card.id} value={card.value} color={card.color} onClick={() => playCard(card)} disabled={!isMyTurn || busy || !playableCardIds.includes(card.id)} playable={playableCardIds.includes(card.id)} />) : <div className="empty-hand">Waiting for cards</div>}</div></div><div className="hand-actions"><div className="hand-count">{hand.length} cards</div><div className="reaction-control"><button type="button" className="reaction-button" onClick={() => setReactionPickerOpen((open) => !open)} aria-label="Send emoji reaction" aria-expanded={reactionPickerOpen}>☺</button>{reactionPickerOpen && <div className="reaction-picker" role="menu">{REACTION_EMOJIS.map((emoji) => <button type="button" role="menuitem" key={emoji} onClick={() => { onReact(emoji); setReactionPickerOpen(false) }} aria-label={`React ${emoji}`}>{emoji}</button>)}</div>}</div></div></section></section>{flightRender && <div key={flightRender.actionId} className="card-flight-overlay" style={{ left: flightRender.left, top: flightRender.top, '--flight-x': `${flightRender.tx}px`, '--flight-y': `${flightRender.ty}px` }}><GameCard value={flightRender.card.value} color={flightRender.card.color} size="sm" disabled /></div>}{pendingWild && <div className="dialog-backdrop" onMouseDown={() => setPendingWild(null)}><section className="color-picker" role="dialog" aria-modal="true" aria-labelledby="color-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="color-title">Choose a color</h2><div>{['red','blue','yellow','green'].map((color) => <button type="button" key={color} className={`color-choice color-${color}`} onClick={() => chooseColor(color)} aria-label={colorNames[color]} />)}</div></section></div>}{confirmLeave && <ConfirmDialog title="Leave this game?" message="This may remove you from the active room." confirmLabel="Leave game" onConfirm={() => { setConfirmLeave(false); onLeave() }} onCancel={() => setConfirmLeave(false)} />}</main>
}

function GameOverPage({ winner, onReplay, onLobby, isHost }) {
  return <main className="gameover-page"><header className="utility-header"><UnoLogo /></header><section className="winner-panel"><div className="trophy-mark"><Trophy /></div><p className="kicker">ROUND COMPLETE</p><h1>{winner?.name ? `${winner.name} wins!` : 'Game complete'}</h1><p>{winner?.name ? 'The final card has been played.' : 'The room has finished this game.'}</p>{isHost && <button type="button" className="button button-primary" onClick={onReplay}><RotateCcw size={18} />Play again</button>}<button type="button" className="button button-secondary" onClick={onLobby}>Return to lobby</button></section></main>
}

function App() {
  const [page, setPage] = useState('home')
  const [name, setName] = useState(import.meta.env.DEV ? 'Admin' : '')
  const [joinCode, setJoinCode] = useState('')
  const [room, setRoom] = useState(null)
  const [game, setGame] = useState(null)
  const [winner, setWinner] = useState(null)
  const [playerId, setPlayerId] = useState(null)
  const [connected, setConnected] = useState(socket.connected)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [drawnCard, setDrawnCard] = useState(null)
  const [cardFlight, setCardFlight] = useState(null)
  const seenCardActions = useRef(new Set())
  const seenReactionIds = useRef(new Set())
  const reactionTimers = useRef(new Map())
  const [reactions, setReactions] = useState({})

  function showError(payload) { setToast({ type: 'error', message: payload?.message || 'The server could not complete that action' }) }

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const reactionTimerMap = reactionTimers.current
    function onConnect() { setConnected(true); setToast(null) }
    function onDisconnect(reason) { setConnected(false); setToast({ type: 'error', message: reason === 'io server disconnect' ? 'Disconnected by server' : 'Server disconnected' }) }
    function onLobby(payload) { setRoom(payload) }
    function onGame(payload) { if (payload) { setGame(payload); setPage('game') } }
    function onReaction(payload) {
      if (!payload?.reactionId || !payload?.playerId || !REACTION_EMOJIS.includes(payload.emoji)) return
      if (seenReactionIds.current.has(payload.reactionId)) return
      seenReactionIds.current.add(payload.reactionId)
      if (seenReactionIds.current.size > 200) seenReactionIds.current.clear()

      const previousTimer = reactionTimers.current.get(payload.playerId)
      if (previousTimer) window.clearTimeout(previousTimer)
      setReactions((current) => ({ ...current, [payload.playerId]: payload }))
      const timer = window.setTimeout(() => {
        setReactions((current) => {
          const next = { ...current }
          delete next[payload.playerId]
          return next
        })
        reactionTimers.current.delete(payload.playerId)
      }, 2000)
      reactionTimers.current.set(payload.playerId, timer)
    }
    function onCardPlayed(payload) {
      if (!payload?.actionId || seenCardActions.current.has(payload.actionId)) return
      seenCardActions.current.add(payload.actionId)
      if (seenCardActions.current.size > 100) seenCardActions.current.clear()
      setCardFlight(payload)
      window.setTimeout(() => setCardFlight((current) => current?.actionId === payload.actionId ? null : current), 700)
      if (payload.actionType === 'reverse') setToast({ type: 'success', message: 'DIRECTION REVERSED' })
      if (payload.actionType === 'pass') setToast({ type: 'success', message: 'PENALTY TRANSFERRED' })
      if (payload.card?.value === 'draw2') setToast({ type: 'success', message: '+2 PENALTY' })
      if (payload.card?.value === 'draw3') setToast({ type: 'success', message: '+3 PENALTY' })
      if (payload.card?.value === 'draw4') setToast({ type: 'success', message: '+4 PENALTY' })
    }
    function onCardDrawn() {}
    function onGameStarted() { setWinner(null); setPage('game') }
    function onGameEnded(payload) { setWinner(payload?.winner || null); if (payload?.state) setGame(payload.state); setPage('gameover') }
    function onPlayerDisconnected() { setToast({ type: 'error', message: 'A player disconnected from the room' }) }
    function onError(payload) { showError(payload) }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('lobbyUpdate', onLobby)
    socket.on('room:update', onLobby)
    socket.on('gameState', onGame)
    socket.on('game:state', onGame)
    socket.on('cardPlayed', onCardPlayed)
    socket.on('reaction', onReaction)
    socket.on('reactionReceived', onReaction)
    socket.on('cardDrawn', onCardDrawn)
    socket.on('gameStarted', onGameStarted)
    socket.on('gameEnded', onGameEnded)
    socket.on('gameRestarted', onLobby)
    socket.on('playerDisconnected', onPlayerDisconnected)
    socket.on('error', onError)

    return () => {
      reactionTimerMap.forEach((timer) => window.clearTimeout(timer))
      reactionTimerMap.clear()
      socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('lobbyUpdate', onLobby); socket.off('room:update', onLobby); socket.off('gameState', onGame); socket.off('game:state', onGame); socket.off('cardPlayed', onCardPlayed); socket.off('reaction', onReaction); socket.off('reactionReceived', onReaction); socket.off('cardDrawn', onCardDrawn); socket.off('gameStarted', onGameStarted); socket.off('gameEnded', onGameEnded); socket.off('gameRestarted', onLobby); socket.off('playerDisconnected', onPlayerDisconnected); socket.off('error', onError)
    }
  }, [])

  async function createRoom() {
    setBusy(true)
    const response = await emitWithAck('createRoom', { name })
    setBusy(false)
    if (!response?.ok) return showError(response)
    setPlayerId(response.playerId); setRoom(response.lobby); setJoinCode(response.roomCode); setPage('lobby')
  }

  async function joinRoom() {
    setBusy(true)
    const response = await emitWithAck('joinRoom', { code: joinCode, name })
    setBusy(false)
    if (!response?.ok) return showError(response)
    setPlayerId(response.playerId); setRoom(response.lobby); setPage('lobby')
  }

  async function leaveRoom() {
    await emitWithAck('leaveRoom', { roomCode: room?.code })
    setRoom(null); setGame(null); setWinner(null); setPage('home')
  }

  async function startGame() {
    setBusy(true)
    const response = await emitWithAck('startGame', { roomCode: room?.code })
    setBusy(false)
    if (!response?.ok) showError(response)
  }

  async function drawCard() {
    setBusy(true)
    const response = await emitWithAck('drawCard', { roomCode: room?.code })
    setBusy(false)
    if (!response?.ok) showError(response)
    else if (response.drawnCard) {
      setDrawnCard(response.drawnCard)
      window.setTimeout(() => setDrawnCard(null), 600)
    }
  }

  async function playCard(cardId, chosenColor) {
    setBusy(true)
    const response = await emitWithAck(chosenColor ? 'chooseWildColor' : 'playCard', chosenColor ? { roomCode: room?.code, cardId, color: chosenColor } : { roomCode: room?.code, cardId, chosenColor })
    setBusy(false)
    if (!response?.ok) showError(response)
  }

  async function restartGame() {
    setBusy(true)
    const response = await emitWithAck('restartGame', { roomCode: room?.code })
    setBusy(false)
    if (!response?.ok) showError(response)
    else { setWinner(null); setGame(null); setRoom(response.lobby); setPage('lobby') }
  }

  async function sendReaction(emoji) {
    const response = await emitWithAck('reaction', {
      roomId: room?.code,
      playerId,
      emoji,
      reactionId: `${playerId || 'player'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    if (!response?.ok) showError(response)
  }

  async function returnToLobby() {
    setBusy(true)
    const response = await emitWithAck('returnToLobby', { roomCode: room?.code })
    setBusy(false)
    if (!response?.ok) showError(response)
    else { setWinner(null); setGame(null); setRoom(response.lobby); setPage('lobby') }
  }

  return <><Toast message={toast?.message} type={toast?.type} onClose={() => setToast(null)} />{page === 'home' && <HomePage name={name} setName={setName} onCreate={createRoom} onJoin={() => setPage('join')} connected={connected} busy={busy} />}{page === 'join' && <JoinPage code={joinCode} setCode={setJoinCode} onBack={() => setPage('home')} onJoin={joinRoom} busy={busy} />}{page === 'lobby' && <LobbyPage room={room} playerId={playerId} onStart={startGame} onLeave={leaveRoom} busy={busy} />}{page === 'game' && <GamePage name={name} playerId={playerId} game={game} onLeave={leaveRoom} onDraw={drawCard} onPlay={playCard} busy={busy} drawnCard={drawnCard} cardFlight={cardFlight} reactions={reactions} onReact={sendReaction} />}{page === 'gameover' && <GameOverPage winner={winner} onReplay={restartGame} onLobby={returnToLobby} isHost={room?.hostId === playerId} />}</>
}

export default App
