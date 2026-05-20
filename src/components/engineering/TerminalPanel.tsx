"use client";
import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

const WS_BASE =
  process.env.NEXT_PUBLIC_JORDAN_WS_URL ?? "wss://jordan.srv1518417.hstgr.cloud";

async function fetchTerminalToken(): Promise<string> {
  const res = await fetch("/api/terminal/token", { method: "POST" });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error ?? `HTTP ${res.status}`);
  }
  const { token } = await res.json();
  return token;
}

export default function TerminalPanel() {
  const termRef = useRef<HTMLDivElement>(null);
  const [launched, setLaunched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const connect = useCallback(async () => {
    if (!termRef.current) return;
    setError(null);
    setConnecting(true);

    let token: string;
    try {
      token = await fetchTerminalToken();
    } catch (e) {
      setError((e as Error).message);
      setConnecting(false);
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: "#0f172a",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
        selectionBackground: "#334155",
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(termRef.current);
    fitAddon.fit();

    const ws = new WebSocket(
      `${WS_BASE}/ws/terminal?token=${encodeURIComponent(token)}`
    );

    ws.onopen = () => {
      setConnecting(false);
      term.writeln("\x1b[32mConnected to Rosably VPS\x1b[0m\r\n");
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "output") term.write(msg.data);
        if (msg.type === "error")
          term.writeln(`\r\n\x1b[31mError: ${msg.data}\x1b[0m`);
      } catch {
        term.write(e.data);
      }
    };

    ws.onclose = (e) => {
      term.writeln(`\r\n\x1b[33mDisconnected (${e.code}).\x1b[0m`);
      setConnecting(false);
    };

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31mWebSocket error.\x1b[0m");
      setConnecting(false);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })
        );
      }
    };
    window.addEventListener("resize", handleResize);

    cleanupRef.current = () => {
      window.removeEventListener("resize", handleResize);
      ws.close();
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (!launched) return;
    connect();
    return () => cleanupRef.current?.();
  }, [launched, connect]);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
      {/* Traffic-light header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 bg-slate-800">
        <span className="h-3 w-3 rounded-full bg-red-500 flex-shrink-0" />
        <span className="h-3 w-3 rounded-full bg-yellow-500 flex-shrink-0" />
        <span className="h-3 w-3 rounded-full bg-green-500 flex-shrink-0" />
        <span className="ml-2 text-xs text-slate-400 font-mono flex-1">
          jordan@rosably-vps
        </span>
        {connecting && (
          <span className="text-[10px] text-slate-500 animate-pulse">connecting…</span>
        )}
        {launched && (
          <button
            onClick={() => { cleanupRef.current?.(); connect(); }}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors ml-2"
            title="Reconnect"
          >
            ↺ reconnect
          </button>
        )}
      </div>

      {!launched ? (
        <div className="flex flex-col items-center justify-center h-[480px] gap-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5"/>
              <line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
            <p className="text-sm text-slate-400 font-mono">Secure shell — Jordan VPS</p>
            <p className="text-xs text-slate-600">Session not started</p>
          </div>
          <button
            onClick={() => setLaunched(true)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-md transition-colors font-mono"
          >
            Launch Terminal
          </button>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-[480px] gap-3">
          <p className="text-red-400 text-sm font-mono">{error}</p>
          <button
            onClick={() => { cleanupRef.current?.(); connect(); }}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="p-2">
          <div ref={termRef} className="h-[480px] w-full" />
        </div>
      )}
    </div>
  );
}
