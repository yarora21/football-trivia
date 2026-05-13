import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useWebSocket } from '../lib/ws';
import {
  ServerMessage,
  QuestionShowMessage,
  QuestionRevealMessage,
  LeaderboardEntry,
} from '../lib/types';

type Phase = 'waiting' | 'lobby' | 'question' | 'reveal' | 'gameover';

export default function HostRoom() {
  const { code } = useParams<{ code: string }>();

  const [phase, setPhase] = useState<Phase>('waiting');
  const [question, setQuestion] = useState<QuestionShowMessage | null>(null);
  const [reveal, setReveal] = useState<QuestionRevealMessage | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [finalLeaderboard, setFinalLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [questionCount, setQuestionCount] = useState(0);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'room.ready':
        setQuestionCount(msg.question_count);
        setPhase('lobby');
        break;
      case 'question.show':
        setQuestion(msg);
        setReveal(null);
        setPhase('question');
        break;
      case 'question.reveal':
        setReveal(msg);
        setPhase('reveal');
        break;
      case 'leaderboard.update':
        setLeaderboard(msg.top);
        break;
      case 'game.over':
        setFinalLeaderboard(msg.final_leaderboard);
        setPhase('gameover');
        break;
    }
  }, []);

  const { status, send } = useWebSocket(code!, 'host', 'Host', handleMessage);

  if (status !== 'connected') {
    return (
      <div className="container">
        <p className="status-text">Connecting...</p>
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <div className="container">
        <h1>Room {code}</h1>
        <p className="status-text">Generating questions...</p>
        <p className="hint">Share this code with players so they can join</p>
      </div>
    );
  }

  if (phase === 'lobby') {
    return (
      <div className="container">
        <h1>Room {code}</h1>
        <p className="status-text">{questionCount} questions ready</p>
        <p className="hint">Share this code with players, then start when ready</p>
        <button className="btn btn-primary btn-large" onClick={() => send({ type: 'host.start' })}>
          Start Game
        </button>
      </div>
    );
  }

  if (phase === 'gameover') {
    return (
      <div className="container">
        <h1>Game Over!</h1>
        <Leaderboard entries={finalLeaderboard} title="Final Standings" />
      </div>
    );
  }

  // question or reveal phase
  return (
    <div className="container">
      <div className="question-header">
        <span className="question-number">
          Question {(question?.index ?? 0) + 1} of {questionCount}
        </span>
      </div>

      {question && (
        <div className="question-card">
          <h2 className="question-prompt">{question.prompt}</h2>
          <div className="choices-grid">
            {question.choices.map((choice, i) => {
              let className = 'choice-btn';
              if (reveal) {
                className += i === reveal.correct_index ? ' correct' : ' dimmed';
              }
              return (
                <div key={i} className={className}>
                  {choice}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'reveal' && (
        <div className="reveal-section">
          <Leaderboard entries={leaderboard} title="Leaderboard" />
          <button className="btn btn-primary" onClick={() => send({ type: 'host.next' })}>
            Next Question
          </button>
        </div>
      )}
    </div>
  );
}

function Leaderboard({ entries, title }: { entries: LeaderboardEntry[]; title: string }) {
  if (entries.length === 0) {
    return (
      <div className="leaderboard">
        <h3>{title}</h3>
        <p className="hint">No scores yet</p>
      </div>
    );
  }

  return (
    <div className="leaderboard">
      <h3>{title}</h3>
      <ol className="leaderboard-list">
        {entries.map((entry, i) => (
          <li key={i} className="leaderboard-item">
            <span className="leaderboard-name">{entry.name}</span>
            <span className="leaderboard-score">{entry.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
