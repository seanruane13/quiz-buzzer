import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
import { QRCodeSVG } from 'qrcode.react';
import TShirtPreview from '../components/TShirtPreview';
import socket from '../socket';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export default function HostRoom() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Hydrate from navigation state so the page renders before any socket event
  const [roomState, setRoomState] = useState(location.state?.roomState || null);
  const [question, setQuestion] = useState(location.state?.roomState?.currentQuestion || '');
  const [pointsPerCorrect, setPointsPerCorrect] = useState(10);
  const [copied, setCopied] = useState(false);
  const [notification, setNotification] = useState('');
  const [answerImages, setAnswerImages] = useState({}); // { [participantId]: imageDataUrl }
  const [displayState, setDisplayState] = useState({ mode: 'join', latestCorrect: null, submission: null });
  const [slideUploading, setSlideUploading] = useState(false);
  const [slideError, setSlideError] = useState('');
  const slideFileInputRef = useRef(null);
  const slideGotoRef = useRef(null);
  const notifTimer = useRef(null);

  const showNotification = useCallback((msg) => {
    setNotification(msg);
    clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => setNotification(''), 3500);
  }, []);

  useEffect(() => {
    // Guard: if the socket is not connected the user navigated here directly
    // (e.g. refreshed the page). Redirect home because the room state is gone.
    if (!socket.connected) {
      navigate('/', { replace: true });
      return;
    }

    socket.on('room:state', (state) => {
      setRoomState(state);
    });

    socket.on('answer:submitted', ({ participantId, imageData }) => {
      setAnswerImages((prev) => ({ ...prev, [participantId]: imageData }));
    });

    socket.on('round:reset', () => {
      setAnswerImages({});
    });

    socket.on('display:state', setDisplayState);

    socket.on('participant:left', ({ name }) => {
      showNotification(`${name} left the room`);
    });

    socket.on('room:error', ({ message, code }) => {
      if (code === 'ROOM_EXPIRED') {
        // Room was not reclaimed in time after a reconnect — go home
        navigate('/', { replace: true });
      } else {
        showNotification(`Error: ${message}`);
      }
    });

    // When the socket drops and reconnects (e.g. Railway proxy reset), reclaim
    // host ownership before the server's 15-second grace period expires.
    socket.on('reconnect', () => {
      console.log('Host socket reconnected — reclaiming room', roomCode);
      socket.emit('host:rejoin', { roomCode });
    });

    return () => {
      socket.off('room:state');
      socket.off('answer:submitted');
      socket.off('round:reset');
      socket.off('participant:left');
      socket.off('room:error');
      socket.off('reconnect');
      socket.off('display:state');
      // Do NOT call socket.disconnect() here.
      // React 18 StrictMode runs cleanup then remounts in development, which would
      // disconnect the socket, trigger the server's disconnect handler, and delete
      // the room before the component gets a chance to remount. The socket will
      // disconnect naturally when the browser tab is closed.
    };
  }, [navigate, showNotification]);

  // ── Host actions ────────────────────────────────────────────────────────────

  const setCurrentQuestion = () => {
    socket.emit('question:set', { roomCode, question });
  };

  const clearQuestion = () => {
    setQuestion('');
    socket.emit('question:set', { roomCode, question: '' });
  };

  const openBuzzer = () => socket.emit('buzzer:open', { roomCode });
  const closeBuzzer = () => socket.emit('buzzer:close', { roomCode });

  const resetRound = () => {
    socket.emit('round:reset', { roomCode });
    // Keep the question text so the host doesn't have to retype for re-reads
  };

  const setMode = (mode) => socket.emit('mode:set', { roomCode, mode });

  const markBuzz = (participantId, result) => {
    socket.emit('buzz:mark', { roomCode, participantId, result, pointsPerCorrect });
  };

  const markAnswer = (participantId, result) => {
    socket.emit('answer:mark', { roomCode, participantId, result, pointsPerCorrect });
  };

  const adjustScore = (participantId, delta) => {
    socket.emit('score:adjust', { roomCode, participantId, delta });
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const setDisplayMode = (mode) => socket.emit('display:set', { roomCode, mode });

  const showSubmissionOnDisplay = (participantId, type) => {
    socket.emit('display:set', { roomCode, mode: 'submission', participantId, type });
  };

  const openDisplay = () => window.open(`/display/${roomCode}`, '_blank');

  const slideshowNavigate = (direction) =>
    socket.emit('slideshow:navigate', { roomCode, direction });

  const slideshowGoTo = (n) => {
    const slide = parseInt(n, 10);
    if (!isNaN(slide)) socket.emit('slideshow:goto', { roomCode, slide });
  };

  const slideshowRemove = () => {
    if (window.confirm('Remove the current slideshow?')) {
      socket.emit('slideshow:remove', { roomCode });
    }
  };

  const handleSlideshowUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // reset so the same file can be re-selected
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setSlideError('Please select a PDF file.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setSlideError('PDF must be under 50 MB.');
      return;
    }

    setSlideError('');
    setSlideUploading(true);

    try {
      // Count pages client-side so the server knows totalSlides without a PDF library
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      const totalSlides = pdf.numPages;

      const formData = new FormData();
      formData.append('pdf', file);
      formData.append('totalSlides', String(totalSlides));

      // Use relative URL — Vite proxy forwards /api/* to localhost:3001 in dev
      const res = await fetch(`/api/rooms/${roomCode}/slideshow`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }
      // Server broadcasts room:state with updated slideshow — no manual state update needed
    } catch (err) {
      setSlideError(err.message || 'Upload failed.');
    } finally {
      setSlideUploading(false);
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────────

  if (!roomState) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Connecting to room…</p>
      </div>
    );
  }

  // Scoreboard sorted highest score first
  const sortedParticipants = [...roomState.participants].sort((a, b) => b.score - a.score);

  const joinUrl = `${window.location.origin}/join/${roomCode}`;

  return (
    <div className="host-room">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="host-header">
        <div className="header-left">
          <h1>Quiz Buzzer</h1>
          <span className="round-badge">Round {roomState.roundNumber}</span>
        </div>
        <div className="room-code-display">
          <span className="room-code-label">Room Code</span>
          <span className="room-code-value">{roomCode}</span>
          <button className="btn btn-ghost btn-small" onClick={copyRoomCode}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </header>

      {notification && <div className="notification">{notification}</div>}

      <div className="host-layout">
        {/* ── Left column: controls ─────────────────────────────────────── */}
        <div className="host-controls">

          {/* Join QR code */}
          <section className="card qr-card">
            <h2>Join via QR Code</h2>
            <div className="qr-body">
              <QRCodeSVG value={joinUrl} size={160} bgColor="transparent" fgColor="currentColor" />
              <div className="qr-info">
                <p className="qr-instruction">Scan to join — or share the link:</p>
                <a className="qr-url" href={joinUrl} target="_blank" rel="noreferrer">{joinUrl}</a>
              </div>
            </div>
          </section>

          {/* Public Display Controls */}
          <section className="card">
            <h2>Public Display</h2>
            <div className="display-open-row">
              <button className="btn btn-secondary" onClick={openDisplay}>
                Open Display in New Tab ↗
              </button>
            </div>
            <div className="display-mode-label">Show on display:</div>
            <div className="display-mode-grid">
              {[
                { mode: 'join',        label: 'Join Screen' },
                { mode: 'question',    label: 'Question' },
                { mode: 'top3',        label: 'Top 3' },
                { mode: 'leaderboard', label: 'Leaderboard' },
                { mode: 'correct',     label: 'Correct Answer', disabled: !displayState.latestCorrect },
                { mode: 'slideshow',   label: 'Slideshow',      disabled: !roomState.slideshow?.fileUrl },
              ].map(({ mode, label, disabled }) => (
                <button
                  key={mode}
                  className={`btn btn-secondary display-mode-btn ${displayState.mode === mode ? 'display-mode-btn-active' : ''}`}
                  onClick={() => setDisplayMode(mode)}
                  disabled={disabled}
                >
                  {label}
                </button>
              ))}
            </div>
            {displayState.latestCorrect && (
              <div className="display-latest-correct">
                Latest correct: <strong>{displayState.latestCorrect.name}</strong>
                {' '}+{displayState.latestCorrect.points} pts
                {' '}(total: {displayState.latestCorrect.totalScore})
              </div>
            )}
          </section>

          {/* Slideshow Controls */}
          <section className="card">
            <h2>Slideshow</h2>

            {/* Hidden file input */}
            <input
              type="file"
              accept="application/pdf"
              ref={slideFileInputRef}
              style={{ display: 'none' }}
              onChange={handleSlideshowUpload}
            />

            {!roomState.slideshow?.fileUrl ? (
              /* ── No slideshow uploaded ── */
              <div>
                <p className="slide-upload-hint">
                  Upload a PDF to show slides on the Public Display.
                </p>
                <button
                  className="btn btn-primary btn-small"
                  onClick={() => slideFileInputRef.current?.click()}
                  disabled={slideUploading}
                >
                  {slideUploading ? 'Uploading…' : '⬆ Upload PDF'}
                </button>
                {slideError && <div className="error-message slide-error">{slideError}</div>}
              </div>
            ) : (
              /* ── Slideshow loaded ── */
              <div>
                <div className="slide-file-info">
                  <span className="slide-file-name" title={roomState.slideshow.fileName}>
                    📄 {roomState.slideshow.fileName}
                  </span>
                  <span className="slide-file-pages">
                    {roomState.slideshow.totalSlides} slides
                  </span>
                </div>

                {/* Prev / counter / Next */}
                <div className="slide-nav">
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={() => slideshowNavigate('prev')}
                    disabled={roomState.slideshow.currentSlide <= 1}
                  >
                    ← Prev
                  </button>
                  <span className="slide-counter">
                    {roomState.slideshow.currentSlide} / {roomState.slideshow.totalSlides}
                  </span>
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={() => slideshowNavigate('next')}
                    disabled={roomState.slideshow.currentSlide >= roomState.slideshow.totalSlides}
                  >
                    Next →
                  </button>
                </div>

                {/* Go to slide */}
                <div className="slide-goto">
                  <span className="slide-goto-label">Go to:</span>
                  <input
                    type="number"
                    className="points-input"
                    min={1}
                    max={roomState.slideshow.totalSlides}
                    defaultValue={1}
                    ref={slideGotoRef}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') slideshowGoTo(slideGotoRef.current?.value);
                    }}
                  />
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={() => slideshowGoTo(slideGotoRef.current?.value)}
                  >
                    Go
                  </button>
                </div>

                {/* Show / Replace / Remove */}
                <div className="card-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    className={`btn btn-primary btn-small ${displayState.mode === 'slideshow' ? 'display-mode-btn-active' : ''}`}
                    onClick={() => setDisplayMode('slideshow')}
                  >
                    Show on Display
                  </button>
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={() => slideFileInputRef.current?.click()}
                    disabled={slideUploading}
                  >
                    {slideUploading ? 'Uploading…' : '⬆ Replace'}
                  </button>
                  <button className="btn btn-danger btn-small" onClick={slideshowRemove}>
                    Remove
                  </button>
                </div>

                {slideError && <div className="error-message slide-error">{slideError}</div>}
              </div>
            )}
          </section>

          {/* Question */}
          <section className="card">
            <h2>Current Question</h2>
            <textarea
              className="question-input"
              placeholder="Type your question here…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
            />
            <div className="card-actions">
              <button className="btn btn-primary" onClick={setCurrentQuestion}>
                Set Question
              </button>
              <button className="btn btn-ghost btn-small" onClick={clearQuestion}>
                Clear
              </button>
            </div>
            {roomState.currentQuestion && (
              <div className="live-question-preview">
                <span className="live-label">LIVE</span>
                {roomState.currentQuestion}
              </div>
            )}
          </section>

          {/* Controls */}
          <section className="card">
            <h2>Controls</h2>

            {/* Mode toggle */}
            <div className="mode-toggle-row">
              <span className="mode-toggle-label">Mode:</span>
              <div className="mode-toggle">
                <button
                  className={`mode-btn ${roomState.mode === 'buzzer' ? 'mode-btn-active' : ''}`}
                  onClick={() => setMode('buzzer')}
                >
                  🔔 Buzzer
                </button>
                <button
                  className={`mode-btn ${roomState.mode === 'blackboard' ? 'mode-btn-active' : ''}`}
                  onClick={() => setMode('blackboard')}
                >
                  ✏️ Blackboard
                </button>
                <button
                  className={`mode-btn ${roomState.mode === 'tshirt' ? 'mode-btn-active' : ''}`}
                  onClick={() => setMode('tshirt')}
                >
                  👕 T-Shirt
                </button>
              </div>
            </div>

            <div className="buzzer-status-row">
              Status:{' '}
              <span className={roomState.buzzerOpen ? 'status-open' : 'status-closed'}>
                {roomState.buzzerOpen ? 'OPEN' : 'CLOSED'}
              </span>
            </div>
            <div className="buzzer-buttons">
              <button
                className="btn btn-success"
                onClick={openBuzzer}
                disabled={roomState.buzzerOpen}
              >
                {{ buzzer: 'Open Buzzer', blackboard: 'Open Blackboard', tshirt: 'Open for Designs' }[roomState.mode]}
              </button>
              <button
                className="btn btn-danger"
                onClick={closeBuzzer}
                disabled={!roomState.buzzerOpen}
              >
                {{ buzzer: 'Close Buzzer', blackboard: 'Close Blackboard', tshirt: 'Close Designs' }[roomState.mode]}
              </button>
              <button className="btn btn-warning" onClick={resetRound}>
                Reset Round
              </button>
            </div>
            <div className="points-config">
              <label htmlFor="pts">Points per correct answer:</label>
              <input
                id="pts"
                type="number"
                className="points-input"
                value={pointsPerCorrect}
                onChange={(e) => setPointsPerCorrect(parseInt(e.target.value, 10) || 10)}
                min={1}
                max={1000}
              />
            </div>
          </section>

          {/* Buzz queue (buzzer mode) */}
          {roomState.mode === 'buzzer' && (
          <section className="card">
            <h2>
              Buzz Queue
              {roomState.buzzes.length > 0 && (
                <span className="section-count">{roomState.buzzes.length}</span>
              )}
            </h2>

            {roomState.buzzes.length === 0 ? (
              <p className="empty-state">No buzzes yet. Open the buzzer to start.</p>
            ) : (
              <div className="buzz-list">
                {roomState.buzzes.map((buzz, index) => (
                  <div
                    key={buzz.participantId}
                    className={`buzz-item buzz-status-${buzz.status} ${index === 0 && buzz.status === 'pending' ? 'buzz-item-first' : ''}`}
                  >
                    <div className="buzz-rank">#{index + 1}</div>

                    <div className="buzz-info">
                      <div className="buzz-name">{buzz.name}</div>
                      <div className="buzz-time">{buzz.reactionTimeMs.toLocaleString()}ms reaction</div>
                    </div>

                    <div className="buzz-badge-wrap">
                      {buzz.status === 'pending' && <span className="badge badge-pending">Pending</span>}
                      {buzz.status === 'correct' && <span className="badge badge-correct">✓ Correct</span>}
                      {buzz.status === 'incorrect' && <span className="badge badge-incorrect">✗ Incorrect</span>}
                      {buzz.status === 'skipped' && <span className="badge badge-skipped">Skipped</span>}
                    </div>

                    {buzz.status === 'pending' && (
                      <div className="buzz-actions">
                        <button className="btn btn-success btn-small" onClick={() => markBuzz(buzz.participantId, 'correct')}>✓ Correct</button>
                        <button className="btn btn-danger btn-small" onClick={() => markBuzz(buzz.participantId, 'incorrect')}>✗ Wrong</button>
                        <button className="btn btn-ghost btn-small" onClick={() => markBuzz(buzz.participantId, 'skipped')}>Skip</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
          )}

          {/* Answer queue (blackboard + tshirt modes) */}
          {(roomState.mode === 'blackboard' || roomState.mode === 'tshirt') && (
          <section className="card">
            <h2>
              Answer Queue
              {roomState.answers.length > 0 && (
                <span className="section-count">{roomState.answers.length}</span>
              )}
            </h2>

            {roomState.answers.length === 0 ? (
              <p className="empty-state">
                {roomState.mode === 'tshirt' ? 'No designs yet. Open for designs to start.' : 'No answers yet. Open the blackboard to start.'}
              </p>
            ) : (
              <div className="answer-list">
                {roomState.answers.map((answer) => (
                  <div
                    key={answer.participantId}
                    className={`answer-item answer-status-${answer.status}`}
                  >
                    <div className="answer-header">
                      <div className="answer-rank">#{answer.position}</div>
                      <div className="answer-name">{answer.name}</div>
                      <div className="answer-badge-wrap">
                        {answer.status === 'pending' && <span className="badge badge-pending">Pending</span>}
                        {answer.status === 'correct' && <span className="badge badge-correct">✓ Correct</span>}
                        {answer.status === 'incorrect' && <span className="badge badge-incorrect">✗ Incorrect</span>}
                        {answer.status === 'skipped' && <span className="badge badge-skipped">Skipped</span>}
                      </div>
                    </div>

                    {roomState.mode === 'tshirt' ? (
                      <TShirtPreview
                        id={answer.participantId}
                        imageData={answerImages[answer.participantId]}
                        name={answer.name}
                        status={answer.status}
                      />
                    ) : answerImages[answer.participantId] ? (
                      <img
                        className="answer-image"
                        src={answerImages[answer.participantId]}
                        alt={`${answer.name}'s answer`}
                      />
                    ) : (
                      <div className="answer-image-placeholder">Image loading…</div>
                    )}

                    <div className="buzz-actions">
                      {answerImages[answer.participantId] && (
                        <button
                          className={`btn btn-ghost btn-small ${displayState.mode === 'submission' && displayState.submission?.participantId === answer.participantId ? 'display-mode-btn-active' : ''}`}
                          onClick={() => showSubmissionOnDisplay(answer.participantId, roomState.mode)}
                          title="Show this submission on the public display"
                        >
                          Show on Display
                        </button>
                      )}
                      {answer.status === 'pending' && (
                        <>
                          <button className="btn btn-success btn-small" onClick={() => markAnswer(answer.participantId, 'correct')}>✓ Correct</button>
                          <button className="btn btn-danger btn-small" onClick={() => markAnswer(answer.participantId, 'incorrect')}>✗ Wrong</button>
                          <button className="btn btn-ghost btn-small" onClick={() => markAnswer(answer.participantId, 'skipped')}>Skip</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}
        </div>

        {/* ── Right column: scoreboard ──────────────────────────────────── */}
        <div className="host-sidebar">
          <section className="card scoreboard-card">
            <h2>
              Scoreboard
              {roomState.participants.length > 0 && (
                <span className="section-count">{roomState.participants.length}</span>
              )}
            </h2>

            {roomState.participants.length === 0 ? (
              <p className="empty-state">Waiting for players to join…</p>
            ) : (
              <table className="scoreboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th className="col-score">Score</th>
                    <th className="col-adjust">Adjust</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedParticipants.map((p, index) => (
                    <tr key={p.id}>
                      <td className="rank-cell">{index + 1}</td>
                      <td>
                        <div className="participant-name">
                          {p.name}
                          {!p.connected && <span className="disconnected-badge" title="Disconnected">●</span>}
                        </div>
                        <div className={`status-pill status-${p.status}`}>{p.status}</div>
                      </td>
                      <td className="score-cell">{p.score}</td>
                      <td>
                        <div className="score-adjust">
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => adjustScore(p.id, -1)}
                            title="−1 point"
                          >
                            −1
                          </button>
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => adjustScore(p.id, 1)}
                            title="+1 point"
                          >
                            +1
                          </button>
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => adjustScore(p.id, 10)}
                            title="+10 points"
                          >
                            +10
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
