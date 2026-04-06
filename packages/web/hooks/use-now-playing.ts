"use client";

import { useEffect, useRef, useState } from "react";

export interface NowPlayingData {
  state: "playing" | "paused" | "stopped";
  track?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  duration?: number;
  position?: number;
}

export function useNowPlaying() {
  const [data, setData] = useState<NowPlayingData>({ state: "stopped" });
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(1000);

  useEffect(() => {
    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws/now-playing`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectDelay.current = 1000;
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "now-playing") {
            setData(msg.data);
          }
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, 30000);
        setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { ...data, connected };
}
