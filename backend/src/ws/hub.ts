import { WebSocketServer, WebSocket } from "ws";

const clients = new Set<WebSocket>();

export function attachWs(server: import("http").Server) {
  const wss = new WebSocketServer({ server, path: "/ws/live" });

  wss.on("connection", (ws) => {
    clients.add(ws);
    (ws as unknown as { alive: boolean }).alive = true;
    // Send current snapshot hint so dashboards can fetch REST immediately
    ws.send(JSON.stringify({ type: "hello", t: Date.now() }));
    ws.on("pong", () => {
      (ws as unknown as { alive: boolean }).alive = true;
    });
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  // Heartbeat every 20 s: drop dead connections, tell live clients server is up
  setInterval(() => {
    for (const ws of clients) {
      const sock = ws as unknown as { alive: boolean };
      if (sock.alive === false) {
        try { ws.terminate(); } catch { /* noop */ }
        clients.delete(ws);
        continue;
      }
      sock.alive = false;
      try {
        ws.ping();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "heartbeat", t: Date.now() }));
        }
      } catch {
        clients.delete(ws);
      }
    }
  }, 20_000);
}

export function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(data); } catch { /* noop */ }
    }
  }
}

export function clientCount() {
  return clients.size;
}
