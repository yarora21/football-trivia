import { useCallback, useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useWebSocket } from '../lib/ws';
import {
  ServerMessage,
  QuestionShowMessage,
  QuestionRevealMessage,
  LeaderboardEntry,
} from '../lib/types';

type Phase = 'lobby' | 'question' | 'answered' | 'reveal' | 'gameover';

export default function PlayRoom() {
  const { code } = useParams<{ code: string }>();
  const [searchParams] = useSearchParams();
  const name = searchParams.get('name') ?? 'Anonymous';

  const [phase, setPhase] = useState<Phase>('lobby');
  const [question, setQuestion] = useState<QuestionShowMessage | null>(null);
  const [reveal, setReveal] = useState<QuestionRevealMessage | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [answerResult, setAnswerResult] = useState<{ is_correct: boolean; points: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [finalLeaderboard, setFinalLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);

  const deadlineRef = useRef(0);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'question.show':
        setQuestion(msg);
        setReveal(null);
        setSelectedChoice(null);
        setAnswerResult(null);
        deadlineRef.current = msg.deadline_ms;
        setPhase('question');
        break;
      case 'answer.received':
        setAnswerResult({ is_correct: msg.is_correct, points: msg.points });
        setPhase('answered');
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

  const { status, send } = useWebSocket(code!, 'player', name, handleMessage);

  // Countdown timer
  useEffect(() => {
    if (phase !== 'question') return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 200);

    return () => clearInterval(interval);
  }, [phase]);

  function handleAnswer(choiceIndex: number) {
    if (phase !== 'question' || !question) return;
    setSelectedChoice(choiceIndex);
    send({
      type: 'player.answer',
      question_index: question.index,
      choice_index: choiceIndex,
    });
  }

  if (status !== 'connected') {
    return (
      <div className="container">
        <p className="status-text">Connecting...</p>
      </div>
    );
  }

  if (phase === 'lobby') {
    return (
      <div className="container">
        <h1>Room {code}</h1>
        <p className="status-text">Playing as <strong>{name}</strong></p>
        <p className="hint">Waiting for the host to start the game...</p>
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

  // question, answered, or reveal phase
  return (
    <div className="container">
      <div className="question-header">
        <span className="question-number">Question {(question?.index ?? 0) + 1}</span>
        {phase === 'question' && <span className="timer">{timeLeft}s</span>}
      </div>

      {question && (
        <div className="question-card">
          <h2 className="question-prompt">{question.prompt}</h2>
          <div className="choices-grid">
            {question.choices.map((choice, i) => {
              let className = 'choice-btn';
              if (phase === 'reveal' && reveal) {
                if (i === reveal.correct_index) className += ' correct';
                else if (i === selectedChoice) className += ' wrong';
                else className += ' dimmed';
              } else if (selectedChoice === i) {
                className += ' selected';
              }
              return (
                <button
                  key={i}
                  className={className}
                  onClick={() => handleAnswer(i)}
                  disabled={phase !== 'question' || selectedChoice !== null}
                >
                  {choice}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'answered' && answerResult && (
        <div className={`answer-feedback ${answerResult.is_correct ? 'correct' : 'wrong'}`}>
          {answerResult.is_correct
            ? `Correct! +${answerResult.points} points`
            : 'Wrong answer!'}
        </div>
      )}

      {phase === 'reveal' && (
        <div className="reveal-section">
          <Leaderboard entries={leaderboard} title="Leaderboard" />
          <p className="hint">Next question coming up...</p>
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
