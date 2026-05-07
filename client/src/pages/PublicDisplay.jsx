import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
import { QRCodeSVG } from 'qrcode.react';
import TShirtPreview from '../components/TShirtPreview';
import socket from '../socket';

// Use unpkg CDN for the pdfjs worker — no local bundling complexity
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export default function PublicDisplay() {
  const { roomCode } = useParams();
  const [roomState, setRoomState] = useState(null);
  const [displayState, setDisplayState] = useState(null);
  const [interrupt, setInterrupt] = useState(null); // temporary correct-answer overlay
  const [error, setError] = useState('');
  const [hostLeft, setHostLeft] = useState(false);
  const interruptTimer = useRef(null);

  useEffect(() => {
    const doJoin = () => socket.emit('display:join', { roomCode });

    socket.on('room:state', setRoomState);
    socket.on('display:state', setDisplayState);
    socket.on('host:disconnected', () => setHostLeft(true));
    socket.on('room:error', ({ message }) => setError(message));
    socket.on('connect', doJoin);

    // Correct-answer interrupt — show overlay for durationMs, then auto-dismiss
    socket.on('display:interrupt', (data) => {
      setInterrupt(data);
      clearTimeout(interruptTimer.current);
      interruptTimer.current = setTimeout(() => setInterrupt(null), data.durationMs ?? 5000);
    });

    if (socket.connected) {
      doJoin();
    } else {
      socket.connect();
    }

    return () => {
      socket.off('room:state');
      socket.off('display:state');
      socket.off('host:disconnected');
      socket.off('room:error');
      socket.off('connect', doJoin);
      socket.off('display:interrupt');
      clearTimeout(interruptTimer.current);
    };
  }, [roomCode]);

  if (error) {
    return (
      <div className="display-error">
        <h1>Room Not Found</h1>
        <p>{error}</p>
        <p className="display-error-code">{roomCode}</p>
      </div>
    );
  }

  if (hostLeft) {
    return (
      <div className="display-error">
        <h1>Quiz Ended</h1>
        <p>The host has disconnected.</p>
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

  const mode = displayState?.mode || 'join';
  const joinUrl = `${window.location.origin}/join/${roomCode}`;
  const sorted = [...roomState.participants].sort((a, b) => b.score - a.score);

  return (
    <div className="public-display">
      {/* Persistent top bar */}
      <header className="display-topbar">
        <span className="display-app-name">Quiz Buzzer</span>
        <span className="display-topbar-code">{roomCode}</span>
      </header>

      {/* Main content */}
      <div className="display-body">
        {mode === 'join'        && <JoinScreen joinUrl={joinUrl} roomCode={roomCode} participants={roomState.participants} />}
        {mode === 'question'    && <QuestionScreen question={roomState.currentQuestion} />}
        {mode === 'top3'        && <Top3Screen players={sorted.slice(0, 3)} />}
        {mode === 'leaderboard' && <LeaderboardScreen players={sorted} />}
        {mode === 'correct'     && <CorrectScreen correct={displayState?.latestCorrect} />}
        {mode === 'submission'  && <SubmissionScreen submission={displayState?.submission} />}
        {mode === 'slideshow'   && <SlideshowScreen slideshow={roomState.slideshow} />}
      </div>

      {/* Correct-answer interrupt overlay — temporary, auto-dismisses */}
      {interrupt && <InterruptOverlay data={interrupt} />}
    </div>
  );
}

// ── Interrupt overlay ────────────────────────────────────────────────────────

function InterruptOverlay({ data }) {
  return (
    <div className="display-interrupt-overlay">
      <div className="display-interrupt-content">
        <div className="display-interrupt-correct">Correct!</div>
        <div className="display-interrupt-name">{data.participantName}</div>
        <div className="display-interrupt-points">+{data.pointsAwarded} points</div>
        <div className="display-interrupt-total">Total: {data.newTotal} pts</div>
      </div>
    </div>
  );
}

// ── Screen components ────────────────────────────────────────────────────────

function JoinScreen({ joinUrl, roomCode, participants }) {
  return (
    <div className="display-join">
      <div className="display-join-qr">
        <QRCodeSVG value={joinUrl} size={240} bgColor="transparent" fgColor="#f1f5f9" />
      </div>
      <div className="display-join-info">
        <div className="display-join-heading">Join the Quiz</div>
        <div className="display-join-code">{roomCode}</div>
        <div className="display-join-or">or visit</div>
        <div className="display-join-url">{joinUrl}</div>
        <div className="display-join-count">
          {participants.length} player{participants.length !== 1 ? 's' : ''} connected
        </div>
      </div>
    </div>
  );
}

function QuestionScreen({ question }) {
  return (
    <div className="display-question">
      {question
        ? <div className="display-question-text">{question}</div>
        : <div className="display-question-placeholder">Waiting for a question…</div>
      }
    </div>
  );
}

function Top3Screen({ players }) {
  const medals = ['🥇', '🥈', '🥉'];
  // Visual podium order: 2nd, 1st, 3rd
  const order = players.length >= 3 ? [players[1], players[0], players[2]] : players;
  const rankOf  = players.length >= 3 ? [1, 0, 2] : players.map((_, i) => i);

  return (
    <div className="display-top3">
      <h2 className="display-section-title">Top 3</h2>
      {players.length === 0 ? (
        <p className="display-empty">No players yet</p>
      ) : (
        <div className="display-podium">
          {order.map((p, vi) => {
            const rank = rankOf[vi];
            return (
              <div key={p.id} className={`display-podium-slot display-podium-rank-${rank + 1}`}>
                <div className="display-podium-medal">{medals[rank]}</div>
                <div className="display-podium-name">{p.name}</div>
                <div className="display-podium-score">{p.score}</div>
                <div className="display-podium-pts">pts</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeaderboardScreen({ players }) {
  return (
    <div className="display-leaderboard">
      <h2 className="display-section-title">Leaderboard</h2>
      {players.length === 0 ? (
        <p className="display-empty">No players yet</p>
      ) : (
        <div className="display-lb-list">
          {players.map((p, i) => (
            <div key={p.id} className={`display-lb-row ${i === 0 ? 'display-lb-first' : ''}`}>
              <span className="display-lb-rank">#{i + 1}</span>
              <span className="display-lb-name">{p.name}</span>
              <span className="display-lb-score">{p.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CorrectScreen({ correct }) {
  if (!correct) {
    return (
      <div className="display-correct">
        <p className="display-empty">No correct answer yet</p>
      </div>
    );
  }
  return (
    <div className="display-correct">
      <div className="display-correct-label">Correct!</div>
      <div className="display-correct-name">{correct.name}</div>
      <div className="display-correct-points">+{correct.points} points</div>
      <div className="display-correct-total">Total: {correct.totalScore} pts</div>
    </div>
  );
}

function SubmissionScreen({ submission }) {
  if (!submission) {
    return (
      <div className="display-submission">
        <p className="display-empty">No submission selected</p>
      </div>
    );
  }
  return (
    <div className="display-submission">
      <div className="display-submission-label">
        {submission.type === 'tshirt' ? 'T-Shirt Design' : 'Blackboard Answer'}
      </div>
      <div className="display-submission-name">{submission.name}</div>
      {submission.type === 'tshirt' ? (
        <div className="display-tshirt-wrap">
          <TShirtPreview
            id={submission.participantId}
            imageData={submission.imageData}
            name={submission.name}
            status="pending"
          />
        </div>
      ) : (
        <div className="display-blackboard-wrap">
          {submission.imageData ? (
            <img
              className="display-blackboard-image"
              src={submission.imageData}
              alt={`${submission.name}'s answer`}
            />
          ) : (
            <p className="display-empty">Image loading…</p>
          )}
        </div>
      )}
    </div>
  );
}

function SlideshowScreen({ slideshow }) {
  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');

  // Load / reload PDF when the file URL changes
  useEffect(() => {
    if (!slideshow?.fileUrl) return;

    let cancelled = false;
    setPdfLoaded(false);
    setLoadError('');
    pdfRef.current = null;

    pdfjsLib.getDocument({ url: slideshow.fileUrl }).promise
      .then((pdf) => {
        if (!cancelled) {
          pdfRef.current = pdf;
          setPdfLoaded(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('PDF load failed:', err);
          setLoadError('Could not load PDF. Check the server is running.');
        }
      });

    return () => { cancelled = true; };
  }, [slideshow?.fileUrl]);

  // Re-render whenever the loaded flag or current slide changes
  useEffect(() => {
    if (!pdfLoaded || !slideshow?.currentSlide || !canvasRef.current) return;

    const pdf = pdfRef.current;
    if (!pdf) return;

    pdf.getPage(slideshow.currentSlide).then((page) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const container = canvas.parentElement;
      if (!container) return;

      const maxW = container.clientWidth  - 32;
      const maxH = container.clientHeight - 48;
      const vp0  = page.getViewport({ scale: 1 });
      const scale = Math.min(maxW / vp0.width, maxH / vp0.height, 3);
      const vp   = page.getViewport({ scale: Math.max(0.1, scale) });

      const dpr = window.devicePixelRatio || 1;
      canvas.width  = Math.round(vp.width  * dpr);
      canvas.height = Math.round(vp.height * dpr);
      canvas.style.width  = `${Math.round(vp.width)}px`;
      canvas.style.height = `${Math.round(vp.height)}px`;

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      page.render({ canvasContext: ctx, viewport: vp }).promise
        .catch((err) => {
          if (err?.name !== 'RenderingCancelledException') console.error('Render error:', err);
        });
    }).catch(console.error);
  }, [pdfLoaded, slideshow?.currentSlide]);

  if (!slideshow?.fileUrl) {
    return (
      <div className="display-slideshow display-slideshow-empty">
        <p className="display-empty">No slideshow uploaded</p>
        <p className="display-slideshow-hint">Upload a PDF from the host dashboard</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="display-slideshow display-slideshow-empty">
        <p className="display-empty">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="display-slideshow">
      <div className="display-slide-wrap">
        <canvas ref={canvasRef} className="display-slide-canvas" />
      </div>
      {slideshow.totalSlides > 0 && (
        <div className="display-slide-counter">
          {slideshow.currentSlide} / {slideshow.totalSlides}
        </div>
      )}
    </div>
  );
}
