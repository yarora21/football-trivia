import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom } from '../lib/api';
import RetroLogo from '../components/RetroLogo';
import ScatteredLogos from '../components/ScatteredLogos';
import ThrowingBall from '../components/ThrowingBall';

export default function Home() {
  const navigate = useNavigate();
  const [view, setView] = useState<'home' | 'host' | 'join'>('home');
  const [topic, setTopic] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleHost(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;
    setLoading(true);
    setError('');
    try {
      const roomCode = await createRoom(topic.trim());
      navigate(`/host/${roomCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setLoading(false);
    }
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim() && name.trim()) {
      navigate(`/play/${code.trim().toUpperCase()}?name=${encodeURIComponent(name.trim())}`);
    }
  }

  if (view === 'host') {
    return (
      <div>
        <h1>Host a game</h1>
        <form onSubmit={handleHost}>
          <input
            placeholder="Topic (e.g. Super Bowl winners)"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            autoFocus
            disabled={loading}
          />
          <button type="submit" disabled={loading || !topic.trim()}>
            {loading ? 'Creating...' : 'Create room'}
          </button>
          <button type="button" onClick={() => setView('home')} disabled={loading}>
            Back
          </button>
        </form>
        {error && <p>{error}</p>}
      </div>
    );
  }

  if (view === 'join') {
    return (
      <div>
        <h1>Join a game</h1>
        <form onSubmit={handleJoin}>
          <input
            placeholder="Room code"
            value={code}
            onChange={e => setCode(e.target.value)}
            autoFocus
          />
          <input
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <button type="submit" disabled={!code.trim() || !name.trim()}>Join</button>
          <button type="button" onClick={() => setView('home')}>Back</button>
        </form>
      </div>
    );
  }

  return (
    <div className="container">
      <ScatteredLogos />
      <RetroLogo />
      <h1>NFL Trivia</h1>
      <div style={{ marginTop: '1.5rem' }}>
        <button onClick={() => setView('host')}>Host a game</button>
        <button onClick={() => setView('join')}>Join a game</button>
      </div>
      <ThrowingBall />
    </div>
  );
}
