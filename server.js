const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const rooms = Object.create(null);

function genId() {
  return Math.random().toString(36).slice(2, 10);
}
function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
  s += '-';
  for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
const SUITS = ['♠','♥','♦','♣'];
const VALUES = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function buildDeck() { return SUITS.flatMap(s => VALUES.map(v => ({ s, v }))); }
function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
function cardVal(v) {
  if (v === 'A') return 11;
  if (['J','Q','K'].includes(v)) return 10;
  return +v;
}
function calcScore(hand) {
  let s = 0, ac = 0;
  for (const c of hand) {
    if (c.hidden) continue;
    s += cardVal(c.v);
    if (c.v === 'A') ac++;
  }
  while (s > 21 && ac > 0) { s -= 10; ac--; }
  return s;
}
function calcScoreFull(hand) {
  let s = 0, ac = 0;
  for (const c of hand) {
    s += cardVal(c.v);
    if (c.v === 'A') ac++;
  }
  while (s > 21 && ac > 0) { s -= 10; ac--; }
  return s;
}
function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    maxPlayers: room.maxPlayers,
    deckCount: room.deck.length,
    players: room.players.map(p => ({
      tabId: p.tabId,
      name: p.name,
      hand: p.hand,
      status: p.status,
      isDealer: p.isDealer,
      idx: p.idx,
      isBot: !!p.isBot,
      result: p.result || null,
    })),
    currentPlayerIdx: room.currentPlayerIdx,
    dealerScore: room.dealerScore,
  };
}
function findWsByTabId(tabId) {
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN && ws.clientTabId === tabId) return ws;
  }
  return null;
}
function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcastRoom(room, msg) {
  const full = { ...msg, room: msg.room || publicRoom(room) };
  for (const p of room.players) {
    if (p.isBot) continue;
    send(findWsByTabId(p.tabId), full);
  }
}
function broadcastTo(tabId, msg) {
  send(findWsByTabId(tabId), msg);
}
function sanitizeName(name, fallback) {
  const raw = String(name || '').trim();
  const cleaned = raw.replace(/^@+/, '').replace(/[^a-zA-Z0-9_]/g, '');
  return cleaned ? '@' + cleaned : fallback;
}

function advanceDealPhase(room) {
  if (room.phase !== 'dealing') return;

  if (room.players[0].hand.length === 0) {
    broadcastRoom(room, { type: 'DEAL_PROMPT', phase: 'dealer-first', msg: 'Возьми свою первую карту' });
    return;
  }
  if (room.wave1Idx <= room.players.length - 1) {
    const targetIdx = room.wave1Idx;
    const target = room.players[targetIdx];
    if (target.hand.length === 0) {
      broadcastRoom(room, { type: 'DEAL_PROMPT', phase: 'wave1', targetIdx, msg: `Дай карту: ${target.name}` });
      return;
    }
    room.wave1Idx++;
    return advanceDealPhase(room);
  }
  if (room.wave2Idx <= room.players.length - 1) {
    const targetIdx = room.wave2Idx;
    const target = room.players[targetIdx];
    if (target.hand.length === 1) {
      broadcastRoom(room, { type: 'DEAL_PROMPT', phase: 'wave2', targetIdx, msg: `Дай вторую карту: ${target.name}` });
      return;
    }
    room.wave2Idx++;
    return advanceDealPhase(room);
  }
  if (room.players[0].hand.length === 1) {
    const hidden = room.deck.pop();
    hidden.hidden = true;
    room.players[0].hand.push(hidden);
    broadcastRoom(room, { type: 'GAME_STATE' });
  }
  room.phase = 'player-turns';
  room.currentPlayerIdx = 1;
  broadcastRoom(room, { type: 'GAME_STATE' });
  startPlayerTurn(room);
}

function startPlayerTurn(room) {
  const idx = room.currentPlayerIdx;
  if (idx >= room.players.length) return startDealerTurn(room);
  const player = room.players[idx];
  if (!player || player.status !== 'playing') {
    room.currentPlayerIdx++;
    return startPlayerTurn(room);
  }
  if (player.isBot) {
    broadcastRoom(room, { type: 'PLAYER_TURN', playerIdx: idx, playerName: player.name, isBot: true });
    setTimeout(() => {
      const current = rooms[room.code];
      if (!current) return;
      const p = current.players[idx];
      if (!p) return;
      const score = calcScore(p.hand);
      if (score < 17) {
        const card = current.deck.pop();
        if (!card) return finishRound(current);
        p.hand.push(card);
        const newScore = calcScore(p.hand);
        if (newScore > 21) p.status = 'bust';
        broadcastRoom(current, { type: 'GAME_STATE', event: { type: 'bot-hit', playerIdx: idx } });
        setTimeout(() => {
          const fresh = rooms[room.code];
          if (!fresh) return;
          const p2 = fresh.players[idx];
          if (p2 && p2.status === 'playing') p2.status = 'stand';
          fresh.currentPlayerIdx++;
          broadcastRoom(fresh, { type: 'GAME_STATE' });
          startPlayerTurn(fresh);
        }, 900);
      } else {
        p.status = 'stand';
        broadcastRoom(current, { type: 'GAME_STATE' });
        current.currentPlayerIdx++;
        setTimeout(() => startPlayerTurn(current), 600);
      }
    }, 800 + Math.random() * 600);
  } else {
    broadcastRoom(room, { type: 'PLAYER_TURN', playerIdx: idx, playerName: player.name, isBot: false });
  }
}
function advancePlayerTurn(room) {
  room.currentPlayerIdx++;
  startPlayerTurn(room);
}
function startDealerTurn(room) {
  for (const c of room.players[0].hand) c.hidden = false;
  room.phase = 'dealer-turn';
  broadcastRoom(room, { type: 'DEALER_TURN' });
  const ds = calcScoreFull(room.players[0].hand);
  if (ds >= 17) finishRound(room);
  else broadcastRoom(room, { type: 'DEALER_HIT_PROMPT', score: ds });
}
function finishRound(room) {
  const ds = calcScoreFull(room.players[0].hand);
  const dbust = ds > 21;
  for (const p of room.players) {
    if (p.isDealer) continue;
    if (p.status === 'bust') { p.result = 'lose'; continue; }
    const ps = calcScore(p.hand);
    if (dbust || ps > ds) p.result = 'win';
    else if (ps === ds) p.result = 'draw';
    else p.result = 'lose';
    p.status = p.result;
  }
  room.phase = 'done';
  room.dealerScore = ds;
  broadcastRoom(room, { type: 'ROUND_END', dealerScore: ds, dealerBust: dbust });
}

function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const { type, code, payload = {}, from } = msg;
  ws.clientTabId = from || ws.clientTabId || genId();

  if (type === 'CREATE') {
    let roomCode = genCode();
    while (rooms[roomCode]) roomCode = genCode();
    const room = {
      code: roomCode,
      maxPlayers: Math.max(2, Math.min(8, Number(payload.maxPlayers) || 3)),
      dealerTabId: ws.clientTabId,
      phase: 'waiting',
      players: [{
        tabId: ws.clientTabId,
        name: sanitizeName(payload.name, '@dealer'),
        hand: [],
        status: 'playing',
        isDealer: true,
        idx: 0,
      }],
      deck: [],
      currentPlayerIdx: -1,
      wave1Idx: 1,
      wave2Idx: 1,
      dealerScore: 0,
    };
    rooms[roomCode] = room;
    ws.roomCode = roomCode;
    send(ws, { type: 'CREATED', code: roomCode, playerIdx: 0, room: publicRoom(room) });
    return;
  }

  const room = rooms[code || ws.roomCode];
  if (!room) {
    if (type !== 'PING') send(ws, { type: 'ERROR', msg: 'Лобби не найдено' });
    return;
  }
  ws.roomCode = room.code;

  if (type === 'JOIN') {
    if (room.phase !== 'waiting') return send(ws, { type: 'ERROR', msg: 'Игра уже идёт' });
    if (room.players.length >= room.maxPlayers) return send(ws, { type: 'ERROR', msg: 'Лобби заполнено' });
    if (room.players.find(p => p.tabId === ws.clientTabId)) return send(ws, { type: 'ERROR', msg: 'Вы уже в лобби' });
    const idx = room.players.length;
    room.players.push({
      tabId: ws.clientTabId,
      name: sanitizeName(payload.name, `@player${idx}`),
      hand: [],
      status: 'playing',
      isDealer: false,
      idx,
    });
    send(ws, { type: 'JOINED', code: room.code, playerIdx: idx, room: publicRoom(room) });
    broadcastRoom(room, { type: 'LOBBY_UPDATE' });
    return;
  }

  if (type === 'START') {
    if (room.dealerTabId !== ws.clientTabId) return send(ws, { type: 'ERROR', msg: 'Только дилер может начать' });
    const botNames = ['Алекс','Борис','Карина','Дима','Эмма','Фёдор','Гена','Ганс'];
    while (room.players.length < room.maxPlayers) {
      const idx = room.players.length;
      room.players.push({ tabId: 'bot-' + idx, name: botNames[idx - 1] || ('Бот' + idx), hand: [], status: 'playing', isDealer: false, idx, isBot: true });
    }
    room.deck = shuffle([...Array(6)].flatMap(buildDeck));
    room.phase = 'dealing';
    room.currentPlayerIdx = -1;
    room.wave1Idx = 1;
    room.wave2Idx = 1;
    room.dealerScore = 0;
    for (const p of room.players) {
      p.hand = [];
      p.status = 'playing';
      p.result = null;
    }
    broadcastRoom(room, { type: 'GAME_START' });
    setTimeout(() => advanceDealPhase(room), 50);
    return;
  }

  if (type === 'DEAL_CARD') {
    if (room.dealerTabId !== ws.clientTabId) return;
    const playerIdx = Number(payload.playerIdx);
    const player = room.players[playerIdx];
    const card = room.deck.pop();
    if (!player || !card) return;
    player.hand.push(card);
    if (room.phase === 'dealing') {
      broadcastRoom(room, { type: 'GAME_STATE' });
      return advanceDealPhase(room);
    }
    if (room.phase === 'player-turns' && playerIdx === room.currentPlayerIdx) {
      const score = calcScore(player.hand);
      if (score > 21) {
        player.status = 'bust';
        broadcastRoom(room, { type: 'GAME_STATE', event: { type: 'bust', playerIdx } });
        return setTimeout(() => advancePlayerTurn(room), 800);
      }
      broadcastRoom(room, { type: 'GAME_STATE' });
      broadcastRoom(room, { type: 'PLAYER_TURN', playerIdx, playerName: player.name, isBot: false });
      return;
    }
    if (room.phase === 'dealer-turn' && player.isDealer) {
      broadcastRoom(room, { type: 'GAME_STATE' });
      return;
    }
    return;
  }

  if (type === 'PLAYER_ACTION') {
    const playerIdx = Number(payload.playerIdx);
    const player = room.players[playerIdx];
    if (!player || player.tabId !== ws.clientTabId || room.currentPlayerIdx !== playerIdx) return;
    if (payload.action === 'hit') {
      broadcastRoom(room, { type: 'DEAL_PROMPT', phase: 'player-hit', targetIdx: playerIdx, msg: `Игрок ${player.name} просит карту` });
    } else if (payload.action === 'stand') {
      player.status = 'stand';
      broadcastRoom(room, { type: 'GAME_STATE', event: { type: 'stand', playerIdx } });
      setTimeout(() => advancePlayerTurn(room), 500);
    }
    return;
  }

  if (type === 'DEALER_STAND') {
    if (room.dealerTabId !== ws.clientTabId) return;
    return finishRound(room);
  }

  if (type === 'NEW_GAME') {
    if (room.dealerTabId !== ws.clientTabId) return;
    room.deck = shuffle([...Array(6)].flatMap(buildDeck));
    room.phase = 'dealing';
    room.wave1Idx = 1;
    room.wave2Idx = 1;
    room.currentPlayerIdx = -1;
    room.dealerScore = 0;
    for (const p of room.players) {
      p.hand = [];
      p.status = 'playing';
      p.result = null;
    }
    broadcastRoom(room, { type: 'GAME_START' });
    setTimeout(() => advanceDealPhase(room), 50);
    return;
  }
}

const server = http.createServer((req, res) => {
  const publicPath = path.join(__dirname, 'public');
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.normalize(path.join(publicPath, reqPath));
  if (!filePath.startsWith(publicPath)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml'
  };
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  ws.clientTabId = genId();
  ws.on('message', (raw) => handleMessage(ws, raw.toString()));
  ws.on('close', () => {
    const room = rooms[ws.roomCode];
    if (!room) return;
    const wasDealer = room.dealerTabId === ws.clientTabId;
    if (wasDealer) {
      broadcastRoom(room, { type: 'ERROR', msg: 'Дилер покинул лобби' });
      delete rooms[room.code];
      return;
    }
    room.players = room.players.filter(p => p.tabId !== ws.clientTabId);
    room.players.forEach((p, idx) => { p.idx = idx; });
    if (room.currentPlayerIdx >= room.players.length) room.currentPlayerIdx = room.players.length - 1;
    broadcastRoom(room, { type: 'LOBBY_UPDATE' });
  });
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`BlackJack server running on http://localhost:${PORT}`);
});
