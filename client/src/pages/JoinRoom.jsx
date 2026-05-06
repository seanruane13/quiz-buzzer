import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../socket';

export default function JoinRoom() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      socket.off('room:joined');
      socket.off('room:error');
      socket.off('connect_error');
      socket.off('reconnect_failed');
      socket.off('connect');
    };
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    const playerName = name.trim();
    if (!playerName) {
      setError('Please enter your name.');
      return;
    }

    setLoading(true);
    setError('');

    let timer;

    const doJoin = () => {
      socket.emit('room:join', { roomCode: roomCode.toUpperCase(), name: playerName });
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('room:joined');
      socket.off('room:error');
      socket.off('connect_error');
      socket.off('reconnect_failed');
      socket.off('connect', doJoin);
    };

    const fail = (msg) => {
      cleanup();
      setLoading(false);
      setError(msg);
      socket.disconnect();
    };

    timer = setTimeout(() => {
      fail('Connection timed out. Please try again.');
    }, 10000);

    socket.once('room:joined', ({ participantId, roomState }) => {
      cleanup();
      setLoading(false);
      navigate(`/play/${roomCode.toUpperCase()}`, { state: { participantId, playerName, roomState } });
    });

    socket.once('room:error', ({ message }) => fail(message));
    socket.once('connect_error', () => fail('Could not connect to server. Make sure the server is running.'));
    socket.once('reconnect_failed', () => fail('Could not reach server after multiple attempts. Please try again.'));

    if (socket.connected) {
      doJoin();
    } else {
      socket.once('connect', doJoin);
      socket.connect();
    }
  };

  return (
    <div className="home-container">
      <div className="home-card">
        <h1 className="home-title">Quiz Buzzer</h1>
        <p className="home-subtitle">Joining room <strong>{roomCode?.toUpperCase()}</strong></p>

        <form className="join-form" onSubmit={handleSubmit} noValidate>
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
              autoFocus
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/')} disabled={loading}>
              Back
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Joining...' : 'Join Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
