import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import TShirtPreview from '../components/TShirtPreview';
import socket from '../socket';

export default function PublicDisplay() {
  const { roomCode } = useParams();
  const [roomState, setRoomState] = useState(null);
  const [displayState, setDisplayState] = useState(null);
  const [error, setError] = useState('');
  const [hostLeft, setHostLeft] = useState(false);

  useEffect(() => {
    const doJoin = () => socket.emit('display:join', { roomCode });

    socket.on('room:state', setRoomState);
    socket.on('display:state', setDisplayState);
    socket.on('host:disconnected', () => setHostLeft(true));
    socket.on('room:error', ({ message }) => setError(message));
    // Re-join after socket reconnect
    socket.on('connect', doJoin);

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

      {/* Main content area */}
      <div className="display-body">
        {mode === 'join'        && <JoinScreen joinUrl={joinUrl} roomCode={roomCode} participants={roomState.participants} />}
        {mode === 'question'    && <QuestionScreen question={roomState.currentQuestion} />}
        {mode === 'top3'        && <Top3Screen players={sorted.slice(0, 3)} />}
        {mode === 'leaderboard' && <LeaderboardScreen players={sorted} />}
        {mode === 'correct'     && <CorrectScreen correct={displayState?.latestCorrect} />}
        {mode === 'submission'  && <SubmissionScreen submission={displayState?.submission} />}
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
  // Reorder visually: 2nd, 1st, 3rd (podium style)
  const podiumOrder = players.length >= 3
    ? [players[1], players[0], players[2]]
    : players;
  const podiumIndexes = players.length >= 3 ? [1, 0, 2] : players.map((_, i) => i);

  return (
    <div className="display-top3">
      <h2 className="display-section-title">Top 3</h2>
      {players.length === 0 ? (
        <p className="display-empty">No players yet</p>
      ) : (
        <div className="display-podium">
          {podiumOrder.map((p, visualIdx) => {
            const rank = podiumIndexes[visualIdx];
            return (
              <div
                key={p.id}
                className={`display-podium-slot display-podium-rank-${rank + 1} display-podium-pos-${visualIdx + 1}`}
              >
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
