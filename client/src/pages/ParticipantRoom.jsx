import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import socket from '../socket';
import DrawingCanvas from '../components/DrawingCanvas';
import TShirtCanvas from '../components/TShirtCanvas';

export default function ParticipantRoom() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { participantId: initialParticipantId, playerName, roomState: initialRoomState } = location.state || {};

  const [participantId, setParticipantId] = useState(initialParticipantId || null);
  const [roomState, setRoomState] = useState(initialRoomState || null);
  // buzzInfo is local-only: position and reaction time returned by the server
  // after a successful buzz. Cleared on round reset.
  const [buzzInfo, setBuzzInfo] = useState(null);
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [hostLeft, setHostLeft] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  // Prevent double-sends during the brief window before server confirms the buzz
  const buzzing = useRef(false);
  // Keep participantId accessible in event handlers without stale closure
  const participantIdRef = useRef(initialParticipantId);
  useEffect(() => { participantIdRef.current = participantId; }, [participantId]);

  useEffect(() => {
    // Guard: if there's no participant identity, the user navigated here directly
    if (!initialParticipantId || !socket.connected) {
      navigate('/', { replace: true });
      return;
    }

    socket.on('room:state', setRoomState);

    // Server confirms our buzz with position and reaction time
    socket.on('buzz:recorded', ({ position, reactionTimeMs }) => {
      buzzing.current = false;
      setBuzzInfo({ position, reactionTimeMs });
    });

    // Host closed the room
    socket.on('host:disconnected', () => {
      setHostLeft(true);
    });

    // Round was reset — clear local buzz info so the button reactivates
    socket.on('round:reset', () => {
      setBuzzInfo(null);
      buzzing.current = false;
      setAnswerSubmitted(false);
    });

    // Server confirmed blackboard answer receipt
    socket.on('answer:recorded', () => {
      setAnswerSubmitted(true);
    });

    // Socket dropped — show reconnecting banner
    socket.on('disconnect', () => {
      setReconnecting(true);
    });

    // Socket reconnected — re-join with same name to restore session.
    // 'connect' fires on every successful connection including reconnects,
    // and is more reliable than the Manager-level 'reconnect' event.
    socket.on('connect', () => {
      if (playerName) {
        socket.emit('room:join', { roomCode, name: playerName });
      }
    });

    // Server confirmed rejoin — update participantId (may be same or restored)
    socket.on('room:joined', ({ participantId: pid, roomState: state }) => {
      setParticipantId(pid);
      participantIdRef.current = pid;
      setRoomState(state);
      setReconnecting(false);
    });

    return () => {
      socket.off('room:state');
      socket.off('buzz:recorded');
      socket.off('host:disconnected');
      socket.off('round:reset');
      socket.off('answer:recorded');
      socket.off('disconnect');
      socket.off('connect');
      socket.off('room:joined');
      // Same as HostRoom: don't disconnect here or React StrictMode will break
      // the session during its development-mode double-invoke of effects.
    };
  }, [initialParticipantId, navigate, roomCode, playerName]);

  const handleBuzz = () => {
    if (!roomState?.buzzerOpen) return;
    if (buzzing.current) return; // already sent, waiting for confirmation

    const pid = participantIdRef.current;
    const me = roomState.participants.find((p) => p.id === pid);
    if (!me || me.status !== 'waiting') return;

    buzzing.current = true;
    socket.emit('buzz:in', { roomCode, participantId: pid });
  };

  const handleAnswerSubmit = (imageData) => {
    socket.emit('answer:submit', { roomCode, participantId: participantIdRef.current, imageData });
  };

  // ── Derived state ───────────────────────────────────────────────────────────

  if (hostLeft) {
    return (
      <div className="disconnected-screen">
        <h2>Room Closed</h2>
        <p>The host disconnected. The quiz has ended.</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          Return Home
        </button>
      </div>
    );
  }

  if (!roomState) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Connecting…</p>
      </div>
    );
  }

  const me = roomState.participants.find((p) => p.id === participantIdRef.current);
  const myStatus = me?.status || 'waiting';
  const myScore = me?.score ?? 0;
  const canBuzz = roomState.buzzerOpen && myStatus === 'waiting' && !buzzing.current;

  // Determine button appearance and label based on the current state
  const getBuzzerClass = () => {
    if (myStatus === 'correct') return 'buzzer-button buzzer-correct';
    if (myStatus === 'incorrect') return 'buzzer-button buzzer-incorrect';
    if (myStatus === 'skipped') return 'buzzer-button buzzer-skipped';
    if (myStatus === 'buzzed' || buzzing.current) return 'buzzer-button buzzer-buzzed';
    if (canBuzz) return 'buzzer-button buzzer-active';
    return 'buzzer-button buzzer-disabled';
  };

  const getBuzzerLabel = () => {
    if (myStatus === 'correct') return '✓ Correct!';
    if (myStatus === 'incorrect') return '✗ Incorrect';
    if (myStatus === 'skipped') return 'Skipped';
    if (myStatus === 'buzzed') return buzzInfo ? `#${buzzInfo.position}` : 'Buzzed!';
    if (buzzing.current) return '…';
    if (roomState.buzzerOpen) return 'BUZZ!';
    return 'Waiting';
  };

  return (
    <div className="participant-room">
      {reconnecting && (
        <div className="reconnecting-banner">
          Reconnecting… your score is saved
        </div>
      )}
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="participant-header">
        <div className="participant-info">
          <span className="participant-name-display">{playerName}</span>
          <span className="room-code-badge">Room: {roomCode}</span>
        </div>
        <div className="participant-score">
          <span className="score-value">{myScore}</span>
          <span className="score-label">pts</span>
        </div>
      </header>

      {/* ── Question ─────────────────────────────────────────────────────── */}
      <div className="question-section">
        {roomState.currentQuestion ? (
          <div className="question-text">{roomState.currentQuestion}</div>
        ) : (
          <div className="question-placeholder">Waiting for the host to set a question…</div>
        )}
      </div>

      {/* ── Buzzer / Blackboard area ──────────────────────────────────────── */}
      <div className={`buzzer-area${roomState.mode !== 'buzzer' ? ' blackboard-mode' : ''}`}>
        {roomState.mode === 'blackboard' || roomState.mode === 'tshirt' ? (
          <>
            {!roomState.buzzerOpen && myStatus === 'waiting' ? (
              <p className="buzzer-hint">
                {roomState.mode === 'tshirt'
                  ? 'Waiting for the host to open the design round…'
                  : 'Waiting for the host to open the blackboard…'}
              </p>
            ) : myStatus === 'correct' ? (
              <div className="result-message result-correct">Great answer! Points awarded.</div>
            ) : myStatus === 'incorrect' ? (
              <div className="result-message result-incorrect">Not quite — moving on.</div>
            ) : myStatus === 'skipped' ? (
              <div className="result-message result-skipped">Skipped. Wait for the next question.</div>
            ) : roomState.mode === 'tshirt' ? (
              <TShirtCanvas onSubmit={handleAnswerSubmit} submitted={answerSubmitted} />
            ) : (
              <DrawingCanvas onSubmit={handleAnswerSubmit} submitted={answerSubmitted} />
            )}
          </>
        ) : (
          <>
            <button
              className={getBuzzerClass()}
              onClick={handleBuzz}
              disabled={!canBuzz}
              aria-label="Buzzer"
            >
              {getBuzzerLabel()}
            </button>

            {myStatus === 'buzzed' && buzzInfo && (
              <div className="buzz-confirmation">
                <p>You buzzed in <strong>#{buzzInfo.position}</strong></p>
                <p>Reaction time: <strong>{buzzInfo.reactionTimeMs.toLocaleString()}ms</strong></p>
              </div>
            )}

            {myStatus === 'correct' && (
              <div className="result-message result-correct">Great answer! Points awarded.</div>
            )}
            {myStatus === 'incorrect' && (
              <div className="result-message result-incorrect">
                Not quite — the host will move on to the next player.
              </div>
            )}
            {myStatus === 'skipped' && (
              <div className="result-message result-skipped">Skipped. Wait for the next question.</div>
            )}

            {!roomState.buzzerOpen && myStatus === 'waiting' && (
              <p className="buzzer-hint">Buzzer is closed — wait for the host to open it.</p>
            )}
          </>
        )}
      </div>

      {/* ── Footer status bar ─────────────────────────────────────────────── */}
      <footer className="status-footer">
        <div className="buzzer-lamp-row">
          <span className={`buzzer-lamp ${roomState.buzzerOpen ? 'lamp-on' : 'lamp-off'}`} />
          <span>
            {{ buzzer: roomState.buzzerOpen ? 'Buzzer Open' : 'Buzzer Closed',
               blackboard: roomState.buzzerOpen ? 'Blackboard Open' : 'Blackboard Closed',
               tshirt: roomState.buzzerOpen ? 'Design Round Open' : 'Design Round Closed',
            }[roomState.mode]}
          </span>
        </div>
        <div className="player-count">
          {roomState.participants.length} player
          {roomState.participants.length !== 1 ? 's' : ''} connected
        </div>
      </footer>
    </div>
  );
}
