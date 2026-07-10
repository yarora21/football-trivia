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
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;      // always points to latest callback

  useEffect(() => {
    // Per-effect-instance state. Using locals (not refs) is important: React
    // StrictMode mounts → unmounts → remounts in dev, so two effect instances
    // briefly overlap. Shared refs would let the throwaway instance clobber the
    // real one's heartbeat/timer.
    let closed = false;                                          // this effect instance was torn down
    let heartbeat: ReturnType<typeof setInterval> | null = null; // this socket's keepalive
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const url = `${WS_URL}?room=${room}&role=${role}&name=${encodeURIComponent(name)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        // If this effect was already torn down while the socket was still
        // handshaking (StrictMode's mount→unmount→mount, or a fast route
        // change), the socket opens too late. Close it immediately — otherwise
        // it registers a $connect on the server and starts a heartbeat that
        // nothing clears, leaving a live "ghost" connection forever.
        if (closed) {
          ws.close();
          return;
        }

        setStatus('connected');
        backoffRef.current = 1000; // reset backoff on successful connection

        // Ask the server for current room state
        ws.send(JSON.stringify({ type: 'room.check' }));

        // Send a ping every 30s to keep the connection alive.
        // API Gateway closes idle connections after 10 minutes.
        heartbeat = setInterval(() => {
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
        // Always stop this socket's heartbeat so it can never outlive the socket.
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }

        if (closed) return; // torn down — do not reconnect

        setStatus('disconnected');

        // Reconnect with exponential backoff, capped at 30s
        reconnectTimer = setTimeout(() => {
          if (!closed) {
            backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
            connect();
          }
        }, backoffRef.current);
      };
    }

    connect();

    // Cleanup: fully tear down when the component unmounts or deps change.
    return () => {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (reconnectTimer) clearTimeout(reconnectTimer);
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
