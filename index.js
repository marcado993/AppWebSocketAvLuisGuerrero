// WaveChat - servidor principal (HTTP + WebSocket)
const path = require('path');
const express = require('express');
const config = require('./server/config');
const auth = require('./server/auth');
const uploads = require('./server/uploads');
const { attachWebSocket } = require('./server/ws');

const app = express();
app.disable('x-powered-by');

// Cabeceras de seguridad básicas
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'"
  );
  next();
});

app.use('/api', uploads.router);
app.use('/api', auth.router);

// Archivos subidos: nombres aleatorios e impredecibles; nunca se ejecutan ni se interpretan como página
app.use('/uploads', express.static(config.UPLOAD_DIR, {
  index: false,
  dotfiles: 'deny',
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(config.PORT, () => {
  console.log(`🚀 WaveChat en http://localhost:${config.PORT}  (${config.NODE_ENV})`);
  console.log(`🔒 Orígenes permitidos: ${config.allowedOrigins.join(', ')}`);
});

attachWebSocket(server);

function shutdown() {
  console.log('Cerrando servidor...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
