// Configuración centralizada: todo se lee desde variables de entorno (.env)
const os = require('os');
const path = require('path');
require('dotenv').config({ quiet: true });

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT) || 3000;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error('❌ Falta JWT_SECRET (mínimo 16 caracteres). Copia .env.example a .env y define un valor seguro.');
  process.exit(1);
}

// Dominios (orígenes) desde los que se aceptan conexiones. "*" permite todos.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || `http://localhost:${PORT},http://127.0.0.1:${PORT}`)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// En desarrollo se agregan automáticamente las IP de la red local (útil para probar entre 2 equipos)
if (NODE_ENV !== 'production') {
  Object.values(os.networkInterfaces()).flat().forEach((i) => {
    if (i && i.family === 'IPv4' && !i.internal) allowedOrigins.push(`http://${i.address}:${PORT}`);
  });
}

function isOriginAllowed(origin) {
  if (allowedOrigins.includes('*')) return true;
  return Boolean(origin) && allowedOrigins.includes(origin);
}

module.exports = {
  NODE_ENV,
  PORT,
  JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',
  DB_PATH: path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'chat.db')),
  UPLOAD_DIR: path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads')),
  MAX_UPLOAD_MB: Number(process.env.MAX_UPLOAD_MB) || 10,
  MAX_MESSAGE_LENGTH:Number(process.env.MAX_MESSAGE_LENGTH) || 500,
  HISTORY_LIMIT: Number(process.env.HISTORY_LIMIT) || 50,
  allowedOrigins,
  isOriginAllowed
};
