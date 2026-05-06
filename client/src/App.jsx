import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import HostRoom from './pages/HostRoom';
import ParticipantRoom from './pages/ParticipantRoom';
import JoinRoom from './pages/JoinRoom';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host/:roomCode" element={<HostRoom />} />
        <Route path="/play/:roomCode" element={<ParticipantRoom />} />
        <Route path="/join/:roomCode" element={<JoinRoom />} />
        {/* Catch-all: send unknown URLs back to home */}
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
