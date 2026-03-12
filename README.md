# 🃏 BlackJack — MaloyCSer Edition

Multiplayer BlackJack с WebSocket сервером.

---

## 📁 Структура проекта

```
blackjack-server/
├── server.js          # Node.js + WebSocket сервер
├── package.json       # Зависимости (только ws)
├── README.md          # Это файл
└── public/
    └── index.html     # Игра (вся в одном файле)
```

---

## 🔌 WebSocket API

Сервер работает на том же порту что и HTTP (Render требует это).

### Сообщения клиент → сервер:

| type | payload | описание |
|------|---------|----------|
| `create` | `{playerCount, name}` | Дилер создаёт лобби |
| `join` | `{code, name}` | Игрок входит в лобби |
| `start` | — | Дилер запускает игру |
| `game_action` | `{action, payload}` | Любое игровое действие |
| `ping` | — | Keepalive |

### Сообщения сервер → клиент:

| type | описание |
|------|----------|
| `created` | Лобби создано, `{code}` |
| `joined` | Успешно вошёл, `{playerIdx}` |
| `player_joined` | Новый игрок подключился |
| `player_left` | Игрок отключился |
| `game_start` | Игра началась |
| `game_action` | Relay игровых действий |
| `room_closed` | Дилер ушёл, комната закрыта |
| `error` | Ошибка, `{msg}` |

---

## 🛠 Локальный запуск

```bash
npm install
npm start
# Открой http://localhost:3000
```
