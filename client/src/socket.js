import { io } from 'socket.io-client';

// URL strategy:
//  - Local dev / LAN: Vite runs on an explicit port (5173), server on 3001.
//    window.location.port will be a non-empty string, so point at port 3001.
//  - Production (Railway): served on standard HTTPS with no explicit port.
//    window.location.port is "", so use the same origin (server + client on one URL).
//  - Override both with VITE_SERVER_URL if client and server are on different domains.
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (window.location.port
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : window.location.origin);

const socket = io(SERVER_URL, {
  autoConnect: false,
  // Force WebSocket transport and skip HTTP long-polling entirely.
  // Railway's (and most PaaS) reverse proxies don't handle long-polling well —
  // poll requests hang indefinitely, causing "joining..." to never resolve.
  // WebSocket connections go straight through without this issue.
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10
});

export default socket;
