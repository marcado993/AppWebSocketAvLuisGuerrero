// Subida de imágenes y audios. Seguridad:
//  - requiere JWT válido antes de leer el cuerpo
//  - se detecta el tipo real por los primeros bytes (no se confía en el nombre ni en el Content-Type)
//  - solo formatos permitidos (sin SVG, que puede contener scripts)
//  - el nombre del archivo lo genera el servidor (aleatorio), nunca el del cliente
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { verifyToken } = require('./auth');

fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const TYPES = {
  png: { mime: 'image/png', kind: 'image' },
  jpg: { mime: 'image/jpeg', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  mp3: { mime: 'audio/mpeg', kind: 'audio' },
  wav: { mime: 'audio/wav', kind: 'audio' },
  ogg: { mime: 'audio/ogg', kind: 'audio' },
  m4a: { mime: 'audio/mp4', kind: 'audio' },
  weba: { mime: 'audio/webm', kind: 'audio' },
  aac: { mime: 'audio/aac', kind: 'audio' }
};
const URL_RE = new RegExp(`^/uploads/[a-f0-9]{32}\\.(${Object.keys(TYPES).join('|')})$`);
const NOT_AUDIO_BRANDS = ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'avif', 'avis'];

/** Detecta el formato real a partir de los primeros bytes. Devuelve la extensión o null. */
function sniff(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  const s = (from, to) => b.toString('latin1', from, to);
  if (b[0] === 0x89 && s(1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (s(0, 4) === 'GIF8') return 'gif';
  if (s(0, 4) === 'RIFF') {
    if (s(8, 12) === 'WEBP') return 'webp';
    if (s(8, 12) === 'WAVE') return 'wav';
    return null;
  }
  if (s(0, 4) === 'OggS') return 'ogg';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'weba';
  if (s(4, 8) === 'ftyp') return NOT_AUDIO_BRANDS.includes(s(8, 12)) ? null : 'm4a';
  if (s(0, 3) === 'ID3') return 'mp3';
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'aac';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}

/** Valida el adjunto que llega por WebSocket. Devuelve {url, kind, mime} o null. */
function validateMedia(media) {
  if (!media || typeof media.url !== 'string' || !URL_RE.test(media.url)) return null;
  const ext = media.url.split('.').pop();
  const file = path.join(config.UPLOAD_DIR, path.basename(media.url));
  if (!fs.existsSync(file)) return null;
  return { url: media.url, kind: TYPES[ext].kind, mime: TYPES[ext].mime };
}

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.UPLOAD_RATE_LIMIT) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas subidas. Espera un momento.' }
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const user = verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!user) return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  req.user = user;
  return next();
}

router.post(
  '/upload',
  limiter,
  requireAuth,
  express.raw({ type: ['image/*', 'audio/*'], limit: `${config.MAX_UPLOAD_MB}mb` }),
  async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(415).json({ error: 'Envía una imagen o un audio.' });
      }
      const ext = sniff(req.body);
      if (!ext) return res.status(415).json({ error: 'Formato no permitido. Usa PNG, JPG, GIF, WebP o audio (MP3, WAV, OGG, M4A, WebM).' });

      const { kind, mime } = TYPES[ext];
      const declared = String(req.headers['content-type'] || '');
      if (!declared.startsWith(kind + '/')) return res.status(415).json({ error: 'El tipo del archivo no coincide con su contenido.' });
      if (kind === 'image' && req.body.length > MAX_IMAGE_BYTES) {
        return res.status(413).json({ error: 'La imagen supera los 5 MB.' });
      }

      const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
      await fs.promises.writeFile(path.join(config.UPLOAD_DIR, name), req.body, { flag: 'wx' });
      return res.status(201).json({ url: `/uploads/${name}`, kind, mime, size: req.body.length });
    } catch (e) {
      return next(e);
    }
  }
);

// Errores del módulo (archivo demasiado grande, etc.) siempre en JSON
router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.status === 413) return res.status(413).json({ error: `El archivo supera los ${config.MAX_UPLOAD_MB} MB.` });
  console.error('Error en subida:', err && err.message);
  return res.status(500).json({ error: 'No se pudo guardar el archivo.' });
});

module.exports = { router, validateMedia };
