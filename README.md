# Quiz Buzzer

A real-time quiz buzzer web app built with React, Node.js/Express, and Socket.IO.

---

## Quick Start

### 1. Install dependencies

```bash
# Server
cd server
npm install

# Client (in a second terminal)
cd client
npm install
```

### 2. Start the server

```bash
cd server
npm run dev      # uses nodemon (auto-restarts on changes)
# or
npm start        # production start
```

The server runs on **http://localhost:3001**

### 3. Start the client

```bash
cd client
npm run dev
```

The client runs on **http://localhost:5173**

### 4. Use the app

- Open **http://localhost:5173** in one browser tab — click **Host a Quiz** to create a room.
- Open **http://localhost:5173** in other tabs/devices — click **Join a Quiz** and enter the room code.

---

## File Structure

```
quiz-buzzer/
├── server/
│   ├── package.json        # Express + Socket.IO dependencies
│   └── server.js           # All server logic and socket event handlers
│
├── client/
│   ├── package.json        # React + Vite dependencies
│   ├── vite.config.js      # Vite configuration
│   ├── index.html          # HTML entry point
│   └── src/
│       ├── main.jsx        # React DOM root
│       ├── App.jsx         # Router setup (3 routes)
│       ├── socket.js       # Socket.IO client singleton
│       ├── index.css       # Full stylesheet (dark theme)
│       └── pages/
│           ├── Home.jsx            # Landing page: host or join
│           ├── HostRoom.jsx        # Host control panel
│           └── ParticipantRoom.jsx # Participant buzzer view
│
└── README.md
```

---

## How Socket.IO Events Work

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `room:create` | — | Host creates a new room |
| `room:join` | `{ roomCode, name }` | Participant joins a room |
| `room:getState` | `{ roomCode }` | Request current room state |
| `question:set` | `{ roomCode, question }` | Host updates the question text |
| `buzzer:open` | `{ roomCode }` | Host opens the buzzer |
| `buzzer:close` | `{ roomCode }` | Host closes the buzzer |
| `buzz:in` | `{ roomCode, participantId }` | Participant presses buzzer |
| `buzz:mark` | `{ roomCode, participantId, result, pointsPerCorrect }` | Host marks a buzz correct/incorrect/skipped |
| `score:adjust` | `{ roomCode, participantId, delta }` | Host manually adjusts a score |
| `round:reset` | `{ roomCode }` | Host resets buzzers for next question |

### Server → Client (broadcast to room)

| Event | Payload | Description |
|---|---|---|
| `room:state` | Full room state object | Sent after any state change |
| `buzzer:opened` | `{ timestamp }` | Buzzer just opened (includes server timestamp) |
| `buzzer:closed` | — | Buzzer just closed |
| `round:reset` | `{ roundNumber }` | Round was reset |
| `participant:left` | `{ name }` | A player disconnected |
| `host:disconnected` | `{ message }` | Host left, room is gone |

### Server → specific client only

| Event | Payload | Description |
|---|---|---|
| `room:created` | `{ roomCode, roomState }` | Room successfully created |
| `room:joined` | `{ participantId, roomState }` | Participant successfully joined |
| `room:error` | `{ message }` | Join/create failure |
| `buzz:recorded` | `{ position, reactionTimeMs }` | Confirms a participant's buzz |

---

## How Buzzer Ranking Works

1. When the host clicks **Open Buzzer**, the server records `room.buzzerOpenTime = Date.now()`.
2. This timestamp is broadcast to all participants via `buzzer:opened`.
3. When a participant clicks their buzzer button, the client emits `buzz:in` immediately.
4. **The server records `Date.now()` the instant it receives the event** — client-side timing is never used.
5. Reaction time = `serverReceiveTime - buzzerOpenTime`.
6. Buzzes are stored in an array in arrival order (the order Socket.IO delivered them to the server).
7. This ordering is fair because it uses server receive time, not the client's clock.
8. Each participant can only buzz once per round (duplicate buzzes are silently dropped).

---

## Host Workflow

1. **Create room** → share the 6-character room code on screen.
2. **Set a question** → type in the box, click "Set Question".
3. **Open Buzzer** → all participant buzzers activate simultaneously.
4. Watch the **Buzz Queue** update in real time as players buzz in.
5. Call on player #1 for their answer.
6. Click **✓ Correct** to award points, or **✗ Wrong** to pass to the next player.
7. Click **Reset Round** to clear all buzzes and prepare for the next question.
8. Use **±1 / +10** buttons in the scoreboard to manually adjust scores if needed.

---

## What Could Be Improved (v2+)

### Authentication & Security
- Host password / PIN to prevent room takeover if the host socket reconnects with a different ID.
- Rate limiting on buzz events to prevent spam.
- HTTPS for production (currently plain HTTP/WS).

### Anti-cheat
- Measure the difference between when `buzzer:opened` was sent and when `buzz:in` was received to detect pre-buzzing bots.
- Reject buzzes that arrive before the buzzer open timestamp (negative reaction time).
- Add a short random delay (50–200ms) to the `buzzer:opened` broadcast to prevent network-advantage cheating.

### Persistence
- Store rooms and scores in a database (e.g. PostgreSQL, MongoDB) so sessions survive a server restart.
- Allow hosts to resume a room after reconnecting.
- Save completed quiz results for review.

### UX Improvements
- Question bank: pre-enter multiple questions and step through them.
- Timer: countdown visible to all players after the buzzer opens.
- Confetti / sound effects on correct answer.
- Leaderboard animation.
- QR code for the room join URL.

### Deployment
- Containerise with Docker.
- Deploy server on Fly.io / Railway / Render.
- Deploy client on Vercel / Netlify (update `VITE_SERVER_URL` env var).
- Use Socket.IO with Redis adapter for horizontal scaling across multiple server processes.
