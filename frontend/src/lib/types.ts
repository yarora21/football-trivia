// Server → client messages

export interface RoomReadyMessage {
  type: 'room.ready';
  question_count: number;
}

export interface QuestionShowMessage {
  type: 'question.show';
  index: number;
  prompt: string;
  choices: string[];
  deadline_ms: number;
}

export interface AnswerReceivedMessage {
  type: 'answer.received';
  is_correct: boolean;
  points: number;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
}

export interface LeaderboardUpdateMessage {
  type: 'leaderboard.update';
  top: LeaderboardEntry[];
}

export interface QuestionRevealMessage {
  type: 'question.reveal';
  index: number;
  correct_index: number;
  stats: Record<string, number>;
}

export interface GameOverMessage {
  type: 'game.over';
  final_leaderboard: LeaderboardEntry[];
}

export interface RoomStateMessage {
  type: 'room.state';
  status: 'lobby' | 'playing' | 'finished';
  current_question_index: number;
  question?: Pick<QuestionShowMessage, 'prompt' | 'choices' | 'deadline_ms'>;
  leaderboard: LeaderboardEntry[];
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export type ServerMessage =
  | RoomReadyMessage
  | QuestionShowMessage
  | AnswerReceivedMessage
  | LeaderboardUpdateMessage
  | QuestionRevealMessage
  | GameOverMessage
  | RoomStateMessage
  | ErrorMessage;

// Client → server messages

export interface HostStartMessage {
  type: 'host.start';
}

export interface HostNextMessage {
  type: 'host.next';
}

export interface PlayerAnswerMessage {
  type: 'player.answer';
  question_index: number;
  choice_index: number;
}

export type ClientMessage = HostStartMessage | HostNextMessage | PlayerAnswerMessage;
