// Autenticación: registro, login y verificación de JWT
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const db = require('./db');

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const MIN_PASSWORD = 8;
// Hash falso para que el tiempo de respuesta sea similar si el usuario no existe
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });
}

/** Devuelve el usuario {id, username} si el token es válido y el usuario existe; si no, null. */
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    return db.getUserById(Number(payload.sub)) || null;
  } catch (e) {
    return null;
  }
}

const router = express.Router();
router.use(express.json({ limit: '2kb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }
});

router.post('/register', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
    return res.status(400).json({ error: 'El usuario debe tener 3-20 caracteres (letras, números, _ . -).' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 72) {
    return res.status(400).json({ error: `La contraseña debe tener entre ${MIN_PASSWORD} y 72 caracteres.` });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = db.createUser(username.trim(), hash);
  if (!user) return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
  }
  const row = db.getUserByName(username.trim());
  const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  const user = { id: Number(row.id), username: row.username };
  res.json({ token: signToken(user), user });
});

router.get('/me', (req, res) => {
  const header = req.headers.authorization || '';
  const user = verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!user) return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  res.json({ user: { id: Number(user.id), username: user.username } });
});

module.exports = { router, verifyToken };
