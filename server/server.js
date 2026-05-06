const express = require('express');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto'); // crypto is not a global in Node.js <19
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Allow any origin so LAN devices (192.168.x.x, etc.) can connect alongside localhost.
// This is safe for a local quiz app — tighten to specific origins before any public deployment.
app.use(cors({ origin: true }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

// ── In-memory store ───────────────────────────────────────────────────────────
// rooms[roomCode] = { roomCode, hostSocketId, currentQuestion, buzzerOpen,
//                     buzzerOpenTime, roundNumber, mode, participants, buzzes, answers }
const rooms = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRoomCode() {
  // Exclude visually ambiguous chars (0, O, 1, I)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  } while (rooms[code]);
  return code;
}

// Returns the sanitised state object sent to all clients.
// participants is ordered by join time; buzzes/answers ordered by server arrival time.
// imageData is never included — images are sent directly to the host socket only.
function getRoomState(room) {
  return {
    roomCode: room.roomCode,
    currentQuestion: room.currentQuestion,
    buzzerOpen: room.buzzerOpen,
    roundNumber: room.roundNumber,
    mode: room.mode,
    participants: Object.values(room.participants).map(({ id, name, score, status, connected }) => ({
      id, name, score, status, connected
    })),
    buzzes: room.buzzes,
    answers: room.answers.map(({ participantId, name, timestamp, status, position }) => ({
      participantId, name, timestamp, status, position
    }))
  };
}

// Broadcast the full room state to every socket in the room.
function broadcastState(roomCode) {
  const room = rooms[roomCode];
  if (room) io.to(roomCode).emit('room:state', getRoomState(room));
}

// Build the payload sent to display clients.
// Resolves the imageData for the active submission from room.answers.
function buildDisplayPayload(room) {
  const payload = {
    mode: room.displayState.mode,
    latestCorrect: room.displayState.latestCorrect,
    submission: null,
  };
  if (room.displayState.mode === 'submission' && room.displayState.submission) {
    const sub = room.displayState.submission;
    const answer = room.answers.find((a) => a.participantId === sub.participantId);
    payload.submission = {
      participantId: sub.participantId,
      name: sub.name,
      type: sub.type,
      imageData: answer?.imageData || null,
    };
  }
  return payload;
}

// Deliver display state to all connected display sockets and the host.
function broadcastDisplayState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const payload = buildDisplayPayload(room);
  // Prune stale socket IDs then fan out to live display sockets
  room.displaySocketIds = room.displaySocketIds.filter((id) => io.sockets.sockets.has(id));
  room.displaySocketIds.forEach((id) => io.sockets.sockets.get(id)?.emit('display:state', payload));
  io.sockets.sockets.get(room.hostSocketId)?.emit('display:state', payload);
}

// ── Socket event handlers ─────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[connect]  ${socket.id}`);

  // ── HOST: create a new room ───────────────────────────────────────────────

  socket.on('room:create', () => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      roomCode,
      hostSocketId: socket.id,
      currentQuestion: '',
      buzzerOpen: false,
      buzzerOpenTime: null,
      roundNumber: 1,
      mode: 'buzzer', // 'buzzer' | 'blackboard' | 'tshirt'
      participants: {},
      buzzes: [],
      answers: [],
      displayState: {
        mode: 'join', // 'join' | 'question' | 'top3' | 'leaderboard' | 'correct' | 'submission'
        latestCorrect: null, // { name, points, totalScore }
        submission: null,    // { participantId, name, type: 'blackboard'|'tshirt' }
      },
      displaySocketIds: [], // sockets connected as display observers
    };

    socket.join(roomCode);
    // Send room code + initial state so the host page can hydrate immediately
    socket.emit('room:created', { roomCode, roomState: getRoomState(rooms[roomCode]) });
    console.log(`[room]     created ${roomCode} by ${socket.id}`);
  });

  // ── HOST: request current state (e.g. after page refresh) ────────────────

  socket.on('room:getState', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('room:error', { message: 'Room not found. It may have expired.' });
      return;
    }
    socket.emit('room:state', getRoomState(room));
  });

  // ── DISPLAY: read-only observer joins a room ─────────────────────────────

  socket.on('display:join', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('room:error', { message: 'Room not found.' });
      return;
    }
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.isDisplay = true;
    if (!room.displaySocketIds.includes(socket.id)) {
      room.displaySocketIds.push(socket.id);
    }
    socket.emit('room:state', getRoomState(room));
    socket.emit('display:state', buildDisplayPayload(room));
    console.log(`[display]  joined ${roomCode} (${socket.id})`);
  });

  // ── HOST: set what the public display shows ───────────────────────────────

  socket.on('display:set', ({ roomCode, mode, participantId, type }) => {
    const room = rooms[roomCode];
    if (!room || room.hostSocketId !== socket.id) return;
    const validModes = ['join', 'question', 'top3', 'leaderboard', 'correct', 'submission'];
    if (!validModes.includes(mode)) return;

    room.displayState.mode = mode;

    if (mode === 'submission' && participantId) {
      const answer = room.answers.find((a) => a.participantId === participantId);
      if (answer) {
        room.displayState.submission = {
          participantId,
          name: answer.name,
          type: type || 'blackboard',
        };
      }
    }

    broadcastDisplayState(roomCode);
    console.log(`[display]  ${roomCode} set to ${mode}${participantId ? ` (${participantId})` : ''}`);
  });

  // ── PARTICIPANT: join a room ──────────────────────────────────────────────

  socket.on('room:join', ({ roomCode, name }) => {
    // Log every join attempt so Railway live logs can confirm the event is arriving
    console.log(`[join?]    socket=${socket.id} code="${roomCode}" known=[${Object.keys(rooms).join(',')}]`);

    const room = rooms[roomCode];

    if (!room) {
      console.log(`[join!]    room "${roomCode}" not found`);
      socket.emit('room:error', { message: 'Room not found. Check the code and try again.' });
      return;
    }

    const trimmedName = (name || '').trim();
    if (!trimmedName || trimmedName.length > 30) {
      socket.emit('room:error', { message: 'Name must be between 1 and 30 characters.' });
      return;
    }

    // Rejoin: a participant with the same name already exists.
    // This covers both the graceful case (connected:false, timer running) and the
    // race condition where the server hasn't yet processed the old socket's disconnect.
    const existing = Object.values(room.participants).find(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (existing) {
      if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = null;
      }
      existing.socketId = socket.id;
      existing.connected = true;

      socket.data.roomCode = roomCode;
      socket.data.participantId = existing.id;
      socket.join(roomCode);

      socket.emit('room:joined', { participantId: existing.id, roomState: getRoomState(room) });
      broadcastState(roomCode);
      console.log(`[rejoin]   ${trimmedName} → ${roomCode}`);
      return;
    }

    // Soft cap — prevent accidental flooding
    if (Object.keys(room.participants).length >= 100) {
      socket.emit('room:error', { message: 'This room is full (max 100 players).' });
      return;
    }

    const participantId = randomUUID();
    room.participants[participantId] = {
      id: participantId,
      socketId: socket.id,
      name: trimmedName,
      score: 0,
      status: 'waiting',
      connected: true
    };

    // Store lookup data on the socket so disconnect can clean up without a scan
    socket.data.roomCode = roomCode;
    socket.data.participantId = participantId;
    socket.join(roomCode);

    socket.emit('room:joined', { participantId, roomState: getRoomState(room) });
    broadcastState(roomCode);
    console.log(`[join]     ${trimmedName} → ${roomCode}`);
  });

  // ── HOST: set / clear the current question ────────────────────────────────

  socket.on('question:set', ({ roomCode, question }) => {
    const room = rooms[roomCode];
    if (!room || room.hostSocketId !== socket.id) return;

    room.currentQuestion = (question || '').trim();
    broadcastState(roomCode);
  });

  // ── HOST: open buzzer ─────────────────────────────────────────────────────

  socket.on('buzzer:open', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.buzzerOpen) return; // already open

    room.buzzerOpen = true;
    room.buzzerOpenTime = Date.now(); // server-side reference timestamp

    // Emit a dedicated event so participants know the exact open time
    io.to(roomCode).emit('buzzer:opened', { timestamp: room.buzzerOpenTime });
    broadcastState(roomCode);
    console.log(`[buzzer]   opened in ${roomCode} at ${room.buzzerOpenTime}`);
  });

  // ── HOST: close buzzer ────────────────────────────────────────────────────

  socket.on('buzzer:close', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostSocketId !== socket.id) return;

    room.buzzerOpen = false;
    room.buzzerCloseTime = Date.now(); // grace window for in-flight auto-submits
    io.to(roomCode).emit('buzzer:closed', {});
    broadcastState(roomCode);
  });

  // ── HOST: switch between buzzer and blackboard mode ──────────────────────

  socket.on('mode:set', ({ roomCode, mode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostSocketId !== socket.id) return;
    if (!['buzzer', 'blackboard', 'tshirt'].includes(mode)) return;
    room.mode = mode;
    broadcastState(roomCode);
    console.log(`[mode]     ${roomCode} switched to ${mode}`);
  });

  // ── PARTICIPANT: buzz in ──────────────────────────────────────────────────

  socket.on('buzz:in', ({ roomCode, participantId }) => {
    const room = rooms[roomCode];
    if (!room || !room.buzzerOpen) return;

    const participant = room.participants[participantId];
    if (!participant) return;

    // One buzz per participant per round
    if (room.buzzes.some((b) => b.participantId === participantId)) return;

    // Server records the timestamp — client clock is irrelevant
    const buzzTime = Date.now();
    const reactionTimeMs = room.buzzerOpenTime ? buzzTime - room.buzzerOpenTime : 0;

    const buzz = {
      participantId,
      name: participant.name,
      timestamp: buzzTime,
      reactionTimeMs,
      status: 'pending'
    };

    room.buzzes.push(buzz);
    // Buzzes are naturally ordered by push order (server arrival time)
    participant.status = 'buzzed';

    socket.emit('buzz:recorded', {
      position: room.buzzes.length,
      reactionTimeMs
    });

    broadcastState(roomCode);
    console.log(`[buzz]     ${participant.name} in ${roomCode} — pos ${room.buzzes.length} (${reactionTimeMs}ms)`);
  });

  // ── HOST: mark a buzz as correct / incorrect / skipped ───────────────────

  socket.on('buzz:mark', ({ roomCode, participantId, result, pointsPerCorrect = 10 }) => {
    const room = rooms[roomCode];
    if (!room || room.hostSocketId !== socket.id) return;

    const participant = room.participants[participantId];
    const buzz = room.buzzes.find((b) => b.participantId === participantId);
    if (!participant || !buzz) return;

    const validResult = ['correct', 'incorrect', 'skipped'].includes(result) ? result : 'incorrect';
    buzz.status = validResult;
    participant.status = validResult;

    if (validResult === 'correct') {
      // Clamp points to a sane range to prevent accidents
      const pts = Math.max(1, Math.min(1000, parseInt(pointsPerCorrect, 10) || 10));
      participant.score += pts;
      room.displayState.latestCorrect = { name: participant.name, points: pts, totalScore: participant.score };
      broadcastDisplayState(roomCode);
    }

    broadcastState(roomCode);
  });

  // ── PARTICIPANT: submit a blackboard drawing ─────────────────────────────

  socket.on('answer:submit', ({ roomCode, participantId, imageData }) => {
    const room = rooms[roomCode];
    // Accept while open, or within 3 s of closing (auto-submit triggered by buzzer:closed)
    const inGrace = room?.buzzerCloseTime && (Date.now() - room.buzzerCloseTime) < 3000;
    if (!room || !['blackboard', 'tshirt'].includes(room.mode) || (!room.buzzerOpen && !inGrace)) return;

    const participant = room.participants[participantId];
    if (!participant) return;

    // One answer per participant per round
    if (room.answers.some((a) => a.participantId === participantId)) return;

    const timestamp = Date.now();
    const position = room.answers.length + 1;

    room.answers.push({ participantId, name: participant.name, timestamp, status: 'pending', position, imageData });
    participant.status = 'answered';

    // Confirm receipt to submitting participant
    socket.emit('answer:recorded', { position });

    // Send image directly to the host socket — never via broadcastState
    const hostSocket = io.sockets.sockets.get(room.hostSocketId);
    if (hostSocket) {
      hostSocket.emit('answer:submitted', { participantId, name: participant.name, position, imageData });
    }

    broadcastState(roomCode);
    console.log(`[answer]   ${participant.name} in ${roomCode} — pos ${position}`);
  });

  // ── HOST: mark an answer as correct / incorrect / skipped ────────────────

  socket.on('answer:mark', ({ roomCode, participantId, result, pointsPerCorrect = 10 }) => {
    const room = rooms[roomCode];
    if (!room || room.hostSocketId !== socket.id) return;

    const participant = room.participants[participantId];
    const answer = room.answers.find((a) => a.participantId === participantId);
    if (!participant || !answer) return;

    const validResult = ['correct', 'incorrect', 'skipped'].includes(result) ? result : 'incorrect';
    answer.status = validResult;
    participant.status = validResult;

    if (validResult === 'correct') {
      const pts = Math.max(1, Math.min(1000, parseInt(pointsPerCorrect, 10) || 10));
      participant.score += pts;
      room.displayState.latestCorrect = { name: participant.name, points: pts, totalScore: participant.score };
      broadcastDisplayState(roomCode);
    }

    broadcastState(roomCode);
  });

  // ── HOST: manually adjust a participant's score ───────────────────────────

  socket.on('score:adjust', ({ roomCode, participantId, delta }) => {
    const room = rooms[roomCode];
    if (!room || room.hostSocketId !== socket.id) return;

    const participant = room.participants[participantId];
    if (!participant) return;

    const d = parseInt(delta, 10);
    if (isNaN(d)) return;

    participant.score = Math.max(0, participant.score + d);
    broadcastState(roomCode);
  });

  // ── HOST: reset buzzer for the next question (scores persist) ────────────

  socket.on('round:reset', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostSocketId !== socket.id) return;

    room.buzzerOpen = false;
    room.buzzerOpenTime = null;
    room.buzzerCloseTime = null;
    room.buzzes = [];
    room.answers = [];
    room.roundNumber += 1;

    // Clear display content that references the now-deleted round data
    room.displayState.submission = null;
    room.displayState.latestCorrect = null;
    if (['submission', 'correct'].includes(room.displayState.mode)) {
      room.displayState.mode = 'join';
    }

    // Reset every participant's status back to waiting
    Object.values(room.participants).forEach((p) => {
      p.status = 'waiting';
    });

    io.to(roomCode).emit('round:reset', { roundNumber: room.roundNumber });
    broadcastState(roomCode);
    broadcastDisplayState(roomCode);
    console.log(`[round]    reset in ${roomCode} — now round ${room.roundNumber}`);
  });

  // ── Host rejoin (after a brief disconnect / Railway proxy timeout) ──────────
  // When the host's socket drops and reconnects, it gets a new socket ID.
  // HostRoom detects the reconnect and emits this event to reclaim ownership.
  socket.on('host:rejoin', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('room:error', { message: 'Room has expired. Please create a new room.', code: 'ROOM_EXPIRED' });
      return;
    }
    // Cancel the pending deletion timer started when the old socket disconnected
    if (room.closeTimer) {
      clearTimeout(room.closeTimer);
      room.closeTimer = null;
    }
    room.hostSocketId = socket.id;
    socket.join(roomCode);
    socket.emit('room:state', getRoomState(room));
    socket.emit('display:state', buildDisplayPayload(room));
    // Re-deliver any answer images the host may have missed while disconnected
    room.answers.forEach(({ participantId, name, position, imageData }) => {
      socket.emit('answer:submitted', { participantId, name, position, imageData });
    });
    console.log(`[host]     rejoined ${roomCode} with new socket ${socket.id}`);
  });

  // ── Disconnect handling ───────────────────────────────────────────────────

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);

    // Was this socket a display observer? Just remove it from the list.
    if (socket.data?.isDisplay) {
      const rc = socket.data.roomCode;
      if (rc && rooms[rc]) {
        rooms[rc].displaySocketIds = rooms[rc].displaySocketIds.filter((id) => id !== socket.id);
      }
      return;
    }

    // Was this socket a host?
    for (const [roomCode, room] of Object.entries(rooms)) {
      if (room.hostSocketId === socket.id) {
        // Grace period: wait 15 s before destroying the room in case the host
        // reconnects (common on Railway due to proxy-level connection resets).
        room.closeTimer = setTimeout(() => {
          io.to(roomCode).emit('host:disconnected', {
            message: 'The host has disconnected. The room has been closed.'
          });
          delete rooms[roomCode];
          console.log(`[room]     ${roomCode} closed — host did not rejoin in time`);
        }, 15000);
        console.log(`[host]     ${roomCode} host disconnected — 15 s grace period`);
        return;
      }
    }

    // Was this socket a participant?  Use the stored lookup first, fall back to scan.
    const roomCode = socket.data?.roomCode;
    const participantId = socket.data?.participantId;

    if (roomCode && participantId && rooms[roomCode]) {
      const room = rooms[roomCode];
      const participant = room.participants[participantId];
      // Only act if this is still the active socket for the participant.
      // If they already rejoined with a new socket, ignore this stale disconnect.
      if (participant && participant.socketId === socket.id) {
        participant.connected = false;
        broadcastState(roomCode);
        console.log(`[part]     ${participant.name} disconnected from ${roomCode} — 600 s grace`);

        // Grace period: keep the participant's score/status for 600 s so they can rejoin
        participant.disconnectTimer = setTimeout(() => {
          if (!participant.connected) {
            delete room.participants[participantId];
            room.buzzes = room.buzzes.filter((b) => b.participantId !== participantId);
            room.answers = room.answers.filter((a) => a.participantId !== participantId);
            io.to(roomCode).emit('participant:left', { name: participant.name });
            broadcastState(roomCode);
            console.log(`[leave]    ${participant.name} removed from ${roomCode} — did not rejoin`);
          }
        }, 600000);
      }
    }
  });
});

// ── Debug endpoint ────────────────────────────────────────────────────────────
// Visit /api/ping on the Railway URL to confirm the server is alive and see
// how many rooms exist.  Remove this before any public launch.
app.get('/api/ping', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    roomCount: Object.keys(rooms).length,
    roomCodes: Object.keys(rooms),
    nodeVersion: process.version,
    port: process.env.PORT || 3001
  });
});

// ── Serve built React client ──────────────────────────────────────────────────
// In production, Express serves the Vite build output from client/dist.
// In local dev both servers run separately (Vite on 5173, Express on 3001),
// so this middleware is only active when client/dist actually exists.
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
// Catch-all so React Router handles its own client-side routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── Start server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Quiz Buzzer server running on http://localhost:${PORT}`);
});
