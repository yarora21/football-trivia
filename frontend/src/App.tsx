import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './routes/Home';
import HostRoom from './routes/HostRoom';
import PlayRoom from './routes/PlayRoom';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host/:code" element={<HostRoom />} />
        <Route path="/play/:code" element={<PlayRoom />} />
      </Routes>
    </BrowserRouter>
  );
}
