import { useEffect, useRef, useState } from 'react';
import { ServerMessage, ClientMessage } from './types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const WS_URL = import.meta.env.VITE_WS_URL as string;

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

export function useWebSocket(
  room: string,
  role: 'host' | 'player',
  name: string,
  onMessage: (msg: ServerMessage) => void,
) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1000);       // current reconnect delay in ms
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountedRef = useRef(false);    // prevents reconnecting after unmount
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;      // always points to latest callback

  useEffect(() => {
    unmountedRef.current = false;

    function connect() {
      const url = `${WS_URL}?room=${room}&role=${role}&name=${encodeURIComponent(name)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        setStatus('connected');
        backoffRef.current = 1000; // reset backoff on successful connection

        // Ask the server for current room state
        ws.send(JSON.stringify({ type: 'room.check' }));

        // Send a ping every 30s to keep the connection alive.
        // API Gateway closes idle connections after 10 minutes.
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          onMessageRef.current(msg);
        } catch {
          console.error('Failed to parse WebSocket message', event.data);
        }
      };

      ws.onclose = () => {
        setStatus('disconnected');

        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
        }

        if (unmountedRef.current) return; // component unmounted — do not reconnect

        // Reconnect with exponential backoff, capped at 30s
        setTimeout(() => {
          if (!unmountedRef.current) {
            backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
            connect();
          }
        }, backoffRef.current);
      };
    }

    connect();

    // Cleanup: close the connection when the component unmounts
    return () => {
      unmountedRef.current = true;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      wsRef.current?.close();
    };
  }, [room, role, name]); // reconnect if any of these change

  function send(msg: ClientMessage) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }

  return { status, send };
}
