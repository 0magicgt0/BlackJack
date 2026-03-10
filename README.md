# 🃏 BlackJack — MaloyCSer Edition

Multiplayer BlackJack с WebSocket сервером. Деплой на Render.com (бесплатно, 24/7).

---

## 🚀 Деплой на Render.com (шаг за шагом)

### 1. Загрузи на GitHub

```bash
# Инициализируй репозиторий (в папке blackjack-server)
git init
git add .
git commit -m "BlackJack multiplayer server"

# Создай репо на github.com и запушь:
git remote add origin https://github.com/ТВО_ИМЯ/blackjack.git
git push -u origin main
```

### 2. Зарегистрируйся на Render.com

- Зайди на https://render.com
- Нажми **"Get Started for Free"**
- Войди через GitHub аккаунт

### 3. Создай Web Service

1. Dashboard → **"New +"** → **"Web Service"**
2. Выбери свой репозиторий `blackjack`
3. Настройки:
   - **Name:** `blackjack-maloycser`
   - **Region:** `Frankfurt (EU Central)` (ближе всего к РФ)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
4. Нажми **"Create Web Service"**

### 4. Готово! 🎉

Через ~2 минуты твой сервер будет доступен по адресу:
```
https://blackjack-maloycser.onrender.com
```

> ⚠️ **Важно:** На бесплатном тарифе Render засыпает через 15 минут неактивности.
> Первый запрос после сна занимает ~30 секунд. Для 24/7 работы используй план Starter ($7/мес).

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
