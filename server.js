const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const rooms = {};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  s += '-';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream';
}

function safeJoin(base, target) {
  const filePath = path.normalize(path.join(base, target));
  if (!filePath.startsWith(base)) return null;
  return filePath;
}

function roomPublic(room) {
  return {
    code: room.code,
    maxPlayers: room.maxPlayers,
    phase: room.phase,
    players: room.players.map(p => ({ idx: p.idx, name: p.name, isDealer: p.isDealer, tabId: p.tabId }))
  };
}

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoom(code, payload, exclude = null) {
  const room = rooms[code];
  if (!room) return;
  room.players.forEach(player => {
    if (player.ws !== exclude) send(player.ws, payload);
  });
}

function removePlayerFromRoom(ws) {
  const code = ws.roomCode;
  if (!code || !rooms[code]) return;
  const room = rooms[code];
  const leaving = room.players.find(p => p.ws === ws);
  room.players = room.players.filter(p => p.ws !== ws);

  if (leaving && leaving.isDealer) {
    broadcastRoom(code, { type: 'ROOM_CLOSED', msg: 'Дилер покинул лобби' }, ws);
    delete rooms[code];
    return;
  }

  if (room.players.length === 0) {
    delete rooms[code];
    return;
  }

  room.players.forEach((p, index) => { p.idx = index; });
  broadcastRoom(code, { type: 'LOBBY_UPDATE', room: roomPublic(room) });
}

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', rooms: Object.keys(rooms).length }));
    return;
  }

  const filePath = safeJoin(PUBLIC_DIR, decodeURIComponent(url.split('?')[0]));
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': getMime(filePath) });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.tabId = null;
  ws.isDealer = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const type = String(msg.type || '').toUpperCase();
    ws.tabId = msg.from || ws.tabId;

    if (type === 'CREATE') {
      let code = genCode();
      while (rooms[code]) code = genCode();
      const room = {
        code,
        phase: 'waiting',
        maxPlayers: Number(msg.payload?.maxPlayers) || 3,
        players: [{ ws, tabId: msg.from, name: msg.payload?.name || '@dealer', isDealer: true, idx: 0 }]
      };
      rooms[code] = room;
      ws.roomCode = code;
      ws.isDealer = true;
      send(ws, { type: 'CREATED', code, playerIdx: 0, room: roomPublic(room) });
      return;
    }

    if (type === 'JOIN') {
      const code = String(msg.code || '').toUpperCase();
      const room = rooms[code];
      if (!room) return send(ws, { type: 'ERROR', msg: 'Лобби не найдено' });
      if (room.phase !== 'waiting') return send(ws, { type: 'ERROR', msg: 'Игра уже началась' });
      if (room.players.length >= room.maxPlayers) return send(ws, { type: 'ERROR', msg: 'Лобби заполнено' });
      if (room.players.some(p => p.tabId === msg.from)) return send(ws, { type: 'ERROR', msg: 'Вы уже в лобби' });

      const idx = room.players.length;
      room.players.push({ ws, tabId: msg.from, name: msg.payload?.name || `@player${idx}`, isDealer: false, idx });
      ws.roomCode = code;
      ws.isDealer = false;
      send(ws, { type: 'JOINED', code, playerIdx: idx, room: roomPublic(room) });
      broadcastRoom(code, { type: 'LOBBY_UPDATE', room: roomPublic(room) });
      return;
    }

    const code = ws.roomCode || msg.code || msg._roomCode;
    const room = rooms[code];
    if (!room) return;

    if (type === 'START') room.phase = 'playing';
    if (msg._to) {
      const target = room.players.find(p => p.tabId === msg._to);
      return send(target?.ws, msg);
    }

    broadcastRoom(code, msg, ws);
  });

  ws.on('close', () => removePlayerFromRoom(ws));
  ws.on('error', () => removePlayerFromRoom(ws));
});

server.listen(PORT, () => {
  console.log(`BlackJack server running on port ${PORT}`);
});
