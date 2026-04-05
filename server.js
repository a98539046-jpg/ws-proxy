'use strict';
// ═══════════════════════════════════════════════════════════════
//  Народный Терминал — WebSocket + REST Прокси
//  Решает проблему CORS для WS и REST запросов к BingX
// ═══════════════════════════════════════════════════════════════

const http  = require('http');
const https = require('https');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 8080;

// HTTP сервер — health check + REST прокси
const httpServer = http.createServer((req, res) => {
  // CORS заголовки для всех ответов
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if(req.method === 'OPTIONS'){
    res.writeHead(204); res.end(); return;
  }

  // Health check
  if(req.url === '/' || req.url === '/health'){
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Народный Терминал WS Proxy — OK');
    return;
  }

  // REST прокси: GET /api?url=https://open-api.bingx.com/...
  if(req.url.startsWith('/api?url=')){
    const targetUrl = decodeURIComponent(req.url.slice('/api?url='.length));
    // Разрешаем только BingX домены
    if(!targetUrl.startsWith('https://open-api.bingx.com') &&
       !targetUrl.startsWith('https://open-api-swap.bingx.com')){
      res.writeHead(403); res.end('Forbidden'); return;
    }
    console.log(`[REST] → ${targetUrl.slice(0,80)}`);
    const proxyReq = https.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NarodnyyTerminal/1.0)',
        'Accept': 'application/json',
      }
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {'Content-Type': 'application/json'});
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
      console.error('[REST] Ошибка:', e.message);
      res.writeHead(502); res.end(JSON.stringify({error: e.message}));
    });
    proxyReq.setTimeout(8000, () => {
      proxyReq.destroy();
      res.writeHead(504); res.end(JSON.stringify({error: 'timeout'}));
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
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


