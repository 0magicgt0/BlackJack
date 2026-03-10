const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ── HTTP Server (serves the HTML game) ──
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const file = path.join(__dirname, 'public', 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: Object.keys(rooms).length }));
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

// ── WebSocket Server ──
const wss = new WebSocket.Server({ server });

// rooms: { CODE: { dealer, players: [], playerCount, phase, started } }
const rooms = {};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  s += '-';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function broadcast(room, msg, excludeWs = null) {
  const r = rooms[room];
  if (!r) return;
  const data = JSON.stringify(msg);
  const all = [r.dealer, ...r.players].filter(Boolean);
  all.forEach(ws => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function getRoomInfo(code) {
  const r = rooms[code];
  if (!r) return null;
  return {
    code,
    playerCount: r.playerCount,
    connected: r.players.length + (r.dealer ? 1 : 0),
    started: r.started,
    phase: r.phase,
  };
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.role = null; // 'dealer' | 'player'
  ws.playerName = null;
  ws.playerIdx = -1;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // Dealer creates a lobby
      case 'create': {
        let code = genCode();
        while (rooms[code]) code = genCode();
        rooms[code] = {
          dealer: ws,
          players: [],
          playerCount: msg.playerCount || 3,
          phase: 'lobby',
          started: false,
          gameState: null,
        };
        ws.roomCode = code;
        ws.role = 'dealer';
        ws.playerIdx = 0;
        ws.playerName = msg.name || 'Дилер';
        send(ws, { type: 'created', code, playerCount: rooms[code].playerCount });
        console.log(`[CREATE] Room ${code} by ${ws.playerName}`);
        break;
      }

      // Player joins a lobby
      case 'join': {
        const code = msg.code?.toUpperCase();
        const r = rooms[code];
        if (!r) { send(ws, { type: 'error', msg: 'Лобби не найдено' }); return; }
        if (r.started) { send(ws, { type: 'error', msg: 'Игра уже началась' }); return; }
        if (r.players.length >= r.playerCount - 1) { send(ws, { type: 'error', msg: 'Лобби заполнено' }); return; }

        const idx = r.players.length + 1;
        ws.roomCode = code;
        ws.role = 'player';
        ws.playerIdx = idx;
        ws.playerName = msg.name || `Игрок ${idx}`;
        r.players.push(ws);

        send(ws, { type: 'joined', code, playerIdx: idx, playerCount: r.playerCount });
        broadcast(code, { type: 'player_joined', playerIdx: idx, name: ws.playerName, connected: r.players.length + 1, playerCount: r.playerCount });
        console.log(`[JOIN] ${ws.playerName} joined room ${code} (${r.players.length}/${r.playerCount - 1} players)`);
        break;
      }

      // Dealer starts the game
      case 'start': {
        const r = rooms[ws.roomCode];
        if (!r || ws.role !== 'dealer') return;
        r.started = true;
        r.phase = 'deal-self';
        broadcast(ws.roomCode, { type: 'game_start', phase: r.phase, playerCount: r.playerCount });
        console.log(`[START] Room ${ws.roomCode}`);
        break;
      }

      // Generic game action relay (card deal, hit, stand, etc.)
      case 'game_action': {
        const r = rooms[ws.roomCode];
        if (!r) return;
        // Relay to everyone else
        broadcast(ws.roomCode, {
          type: 'game_action',
          action: msg.action,
          payload: msg.payload,
          from: ws.playerIdx,
        }, ws);
        break;
      }

      // Ping/pong keepalive
      case 'ping': {
        send(ws, { type: 'pong' });
        break;
      }
    }
  });

  ws.on('close', () => {
    const code = ws.roomCode;
    if (!code || !rooms[code]) return;
    const r = rooms[code];
    console.log(`[DISCONNECT] ${ws.playerName || '?'} left room ${code}`);

    if (ws.role === 'dealer') {
      // Dealer left — close the room
      broadcast(code, { type: 'room_closed', reason: 'Дилер покинул игру' });
      delete rooms[code];
    } else {
      // Player left
      r.players = r.players.filter(p => p !== ws);
      broadcast(code, {
        type: 'player_left',
        playerIdx: ws.playerIdx,
        name: ws.playerName,
        connected: r.players.length + 1,
      });
    }
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
});

// Cleanup empty/stale rooms every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    const r = rooms[code];
    const all = [r.dealer, ...r.players].filter(ws => ws && ws.readyState === WebSocket.OPEN);
    if (all.length === 0) {
      delete rooms[code];
      console.log(`[CLEANUP] Removed empty room ${code}`);
    }
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`🃏 BlackJack server running on port ${PORT}`);
  console.log(`   http://localhost:${PORT}`);
});
