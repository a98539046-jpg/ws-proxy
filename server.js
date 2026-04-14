'use strict';
const http = require('http');
const https = require('https');
const { WebSocketServer, WebSocket } = require('ws');
const PORT = process.env.PORT || 8080;

const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS'){ res.writeHead(204); res.end(); return; }
  if(req.url === '/' || req.url === '/health'){
    res.writeHead(200,{'Content-Type':'text/plain'});
    res.end('OK'); return;
  }
  if(req.url.startsWith('/api?url=')){
    const targetUrl = decodeURIComponent(req.url.slice(9));
    if(!targetUrl.startsWith('https://open-api.bingx.com') &&
       !targetUrl.startsWith('https://open-api-swap.bingx.com')){
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const proxyReq = https.get(targetUrl, {
      headers: {
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':'application/json',
        'Origin':'https://bingx.com',
        'Referer':'https://bingx.com/',
      }
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type':'application/json',
        'Access-Control-Allow-Origin':'*'
      });
      proxyRes.pipe(res);
    });
    proxyReq.on('error',(e)=>{ res.writeHead(502); res.end('{}'); });
    proxyReq.setTimeout(8000,()=>{ proxyReq.destroy(); res.writeHead(504); res.end('{}'); });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (clientWs, req) => {
  const url = new URL(req.url, 'http://localhost');
  const market = url.searchParams.get('market') || 'swap';
  const bingxUrl = market === 'spot'
    ? 'wss://open-api-ws.bingx.com/market'
    : 'wss://open-api-swap.bingx.com/swap-market';

  let bingxWs = null;
  let reconnectTimer = null;
  let dead = false;

  function connect() {
    if (dead) return;
    bingxWs = new WebSocket(bingxUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://bingx.com',
        'Host': market === 'spot' ? 'open-api-ws.bingx.com' : 'open-api-swap.bingx.com',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
      }
    });
    bingxWs.on('open', () => console.log(`[Proxy] подключён (${market})`));
    bingxWs.on('message', (data) => { if(clientWs.readyState===1) clientWs.send(data); });
    bingxWs.on('close', (code) => {
      console.log(`[Proxy] BingX закрыл: ${code} — переподключение через 2с`);
      if (!dead) reconnectTimer = setTimeout(connect, 2000);
    });
    bingxWs.on('error', (err) => {
      console.error(`[Proxy] ошибка: ${err.message}`);
      bingxWs.terminate();
      if (!dead) reconnectTimer = setTimeout(connect, 2000);
    });
  }

  connect();

  clientWs.on('message', (data) => { if(bingxWs && bingxWs.readyState===1) bingxWs.send(data); });
  clientWs.on('close', () => {
    dead = true;
    clearTimeout(reconnectTimer);
    if(bingxWs) bingxWs.terminate();
  });
  clientWs.on('error', () => {
    dead = true;
    clearTimeout(reconnectTimer);
    if(bingxWs) bingxWs.terminate();
  });
});

httpServer.listen(PORT, () => console.log(`[Proxy] ✅ порт ${PORT}`));
