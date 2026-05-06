import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';

export default function Home() {
  const navigate = useNavigate();
  const [view, setView] = useState('home'); // 'home' | 'join'
  const [roomCode, setRoomCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Remove any listeners that were set up if the component unmounts mid-flow
  useEffect(() => {
    return () => {
      socket.off('room:created');
      socket.off('room:joined');
      socket.off('room:error');
      socket.off('connect_error');
      socket.off('reconnect_failed');
    };
  }, []);

  // ── Host flow ───────────────────────────────────────────────────────────────
  const handleHostQuiz = () => {
    setLoading(true);
    setError('');

    // Use once() everywhere so listeners auto-remove and never bleed into later flows
    socket.once('room:created', ({ roomCode: code, roomState }) => {
      socket.off('connect_error');
      setLoading(false);
      navigate(`/host/${code}`, { state: { roomState } });
    });

    socket.once('connect_error', () => {
      socket.off('room:created');
      setLoading(false);
      setError('Could not connect to server. Make sure the server is running.');
      socket.disconnect();
    });

    socket.connect();
    socket.emit('room:create');
  };

  // ── Participant flow ────────────────────────────────────────────────────────
  const handleJoinSubmit = (e) => {
    e.preventDefault();
    const code = roomCode.trim().toUpperCase();
    const playerName = name.trim();

    if (!code || code.length !== 6) {
      setError('Please enter a valid 6-character room code.');
      return;
    }
    if (!playerName) {
      setError('Please enter your name.');
      return;
    }

    setLoading(true);
    setError('');

    // All three cleanup helpers reference each other, so use let
    let timer;

    const doJoin = () => {
      socket.emit('room:join', { roomCode: code, name: playerName });
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('room:joined');
      socket.off('room:error');
      socket.off('connect_error');
      socket.off('reconnect_failed');
      socket.off('connect', doJoin); // in case we queued doJoin on 'connect'
    };

    const fail = (msg) => {
      cleanup();
      setLoading(false);
      setError(msg);
      socket.disconnect();
    };

    // 10-second hard deadline — prevents infinite "Joining..." if server never responds
    timer = setTimeout(() => {
      fail('Connection timed out. Please try again.');
    }, 10000);

    socket.once('room:joined', ({ participantId, roomState }) => {
      cleanup();
      setLoading(false);
      navigate(`/play/${code}`, { state: { participantId, playerName, roomState } });
    });

    socket.once('room:error', ({ message }) => fail(message));

    socket.once('connect_error', () =>
      fail('Could not connect to server. Make sure the server is running.')
    );

    socket.once('reconnect_failed', () =>
      fail('Could not reach server after multiple attempts. Please try again.')
    );

    // Only emit room:join once the socket is confirmed connected.
    // If already connected (e.g. host creating then joining in same session), go immediately.
    // Otherwise connect first, then emit inside the 'connect' callback.
    if (socket.connected) {
      doJoin();
    } else {
      socket.once('connect', doJoin);
      socket.connect();
    }
  };

  const goBack = () => {
    setView('home');
    setError('');
    setRoomCode('');
    setName('');
  };

  return (
    <div className="home-container">
      <div className="home-card">
        <h1 className="home-title">Quiz Buzzer</h1>
        <p className="home-subtitle">Real-time buzzer for live quizzes</p>

        {view === 'home' && (
          <div className="home-actions">
            <button
              className="btn btn-primary btn-large"
              onClick={handleHostQuiz}
              disabled={loading}
            >
              {loading ? 'Creating room...' : 'Host a Quiz'}
            </button>
            <button
              className="btn btn-secondary btn-large"
              onClick={() => setView('join')}
              disabled={loading}
            >
              Join a Quiz
            </button>
            {error && <div className="error-message">{error}</div>}
          </div>
        )}

        {view === 'join' && (
          <form className="join-form" onSubmit={handleJoinSubmit} noValidate>
            <h2>Join a Quiz</h2>

            <div className="form-group">
              <label htmlFor="roomCode">Room Code</label>
              <input
                id="roomCode"
                type="text"
                placeholder="e.g. ABCD12"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                maxLength={6}
                autoComplete="off"
                autoFocus
                spellCheck={false}
              />
            </div>

            <div className="form-group">
              <label htmlFor="playerName">Your Name</label>
              <input
                id="playerName"
                type="text"
                placeholder="Enter your display name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                autoComplete="off"
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={goBack} disabled={loading}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Joining...' : 'Join Room'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
