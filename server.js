'use strict';
// ═══════════════════════════════════════════════════════════════
//  Народный Терминал — WebSocket Прокси
//  Пробрасывает WS-соединения от браузера к BingX
//  Решает проблему CORS для WebSocket
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 8080;

// HTTP сервер — отвечает на health check от Railway
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
  });
  res.end('Народный Терминал WS Proxy — OK');
});

// WS сервер поверх HTTP
const wss = new WebSocketServer({ server: httpServer });

console.log(`[Proxy] Запуск на порту ${PORT}...`);

wss.on('connection', (clientWs, req) => {
  // Определяем к какому BingX WS подключаться
  // Клиент передаёт тип через query: ?market=spot или ?market=swap
  const url  = new URL(req.url, `http://localhost`);
  const market = url.searchParams.get('market') || 'swap';

  const bingxUrl = market === 'spot'
    ? 'wss://open-api-ws.bingx.com/market'
    : 'wss://open-api-swap.bingx.com/swap';

  console.log(`[Proxy] Новое подключение → ${bingxUrl}`);

  // Подключаемся к BingX от имени сервера (без CORS ограничений)
  const bingxWs = new WebSocket(bingxUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NarodnyyTerminal/1.0)',
    },
  });

  let alive = true;

  // BingX → Клиент
  bingxWs.on('open', () => {
    console.log(`[Proxy] BingX подключён (${market})`);
  });

  bingxWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });

  bingxWs.on('close', (code, reason) => {
    console.log(`[Proxy] BingX закрыл соединение: ${code}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1001, 'BingX disconnected');
    }
    alive = false;
  });

  bingxWs.on('error', (err) => {
    console.error(`[Proxy] BingX ошибка: ${err.message}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'BingX error');
    }
    alive = false;
  });

  // Клиент → BingX (подписки, ping/pong)
  clientWs.on('message', (data) => {
    if (bingxWs.readyState === WebSocket.OPEN) {
      bingxWs.send(data);
    }
  });

  clientWs.on('close', () => {
    console.log('[Proxy] Клиент отключился');
    if (alive && bingxWs.readyState === WebSocket.OPEN) {
      bingxWs.close();
    }
    alive = false;
  });

  clientWs.on('error', (err) => {
    console.error(`[Proxy] Клиент ошибка: ${err.message}`);
    if (alive && bingxWs.readyState === WebSocket.OPEN) {
      bingxWs.close();
    }
    alive = false;
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Proxy] ✅ Работает на порту ${PORT}`);
  console.log(`[Proxy] Health: http://localhost:${PORT}`);
});
