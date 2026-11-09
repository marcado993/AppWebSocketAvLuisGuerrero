// Servidor WebSocket: autenticación por JWT, salas, presencia, "escribiendo" e historial persistente
const WebSocket = require('ws');
const config = require('./config');
const db = require('./db');
const { verifyToken } = require('./auth');
const { validateMedia } = require('./uploads');

const AUTH_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 30000;
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 6;
const DEFAULT_ROOM = 'general';

function attachWebSocket(server) {
  const wss = new WebSocket.Server({
    server,
    path: '/ws',
    maxPayload: 4 * 1024,
    // Solo se aceptan conexiones de dominios (orígenes) permitidos
    verifyClient: (info, done) => {
      const ok = config.isOriginAllowed(info.origin);
      if (!ok) console.warn(`⛔ Conexión rechazada, origen no permitido: ${info.origin || '(sin origen)'}`);
      done(ok, 403, 'Origin not allowed');
    }
  });

  // ws -> { user, room, typing, alive, stamps }
  const sessions = new Map();
  const authed = () => [...sessions.entries()].filter(([, s]) => s.user);

  const send = (ws, payload) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const toRoom = (roomId, payload, except) => {
    const data = JSON.stringify(payload);
    authed().forEach(([ws, s]) => {
      if (s.room === roomId && ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  };

  const usersIn = (roomId) => {
    const map = new Map();
    authed().forEach(([, s]) => { if (s.room === roomId) map.set(s.user.id, s.user.username); });
    return [...map.entries()].map(([id, username]) => ({ id, username })).sort((a, b) => a.username.localeCompare(b.username));
  };

  const hasOtherTab = (ws, roomId) =>
    authed().some(([other, s]) => other !== ws && s.room === roomId && s.user.id === sessions.get(ws).user.id);

  const sendPresence = (roomId) => {
    const users = usersIn(roomId);
    toRoom(roomId, { type: 'presence', room: roomId, users, count: users.length });
  };

  const sendCounts = () => {
    const counts = {};
    db.listRooms().forEach((r) => { counts[r.id] = usersIn(r.id).length; });
    authed().forEach(([ws]) => send(ws, { type: 'rooms', counts }));
  };

  // A cada usuario se le dice quién más está escribiendo en su sala
  const sendTyping = (roomId) => {
    authed().forEach(([ws, s]) => {
      if (s.room !== roomId) return;
      const names = new Set();
      authed().forEach(([, o]) => {
        if (o.room === roomId && o.typing && o.user.id !== s.user.id) names.add(o.user.username);
      });
      send(ws, { type: 'typing', room: roomId, users: [...names] });
    });
  };

  const system = (roomId, event, username) =>
    toRoom(roomId, {
      type: 'system', room: roomId, event, username,
      text: `${username} ${event === 'join' ? 'se unió a' : 'salió de'} la sala`,
      ts: Date.now()
    });

  function leaveRoom(ws) {
    const s = sessions.get(ws);
    if (!s || !s.room) return;
    const old = s.room;
    const lastTab = !hasOtherTab(ws, old);
    s.room = null;
    s.typing = false;
    if (lastTab) system(old, 'leave', s.user.username);
    sendPresence(old);
    sendTyping(old);
  }

  function joinRoom(ws, roomId) {
    const s = sessions.get(ws);
    if (!db.roomExists(roomId)) return send(ws, { type: 'error', text: 'La sala no existe.' });
    if (s.room !== roomId) {
      leaveRoom(ws);
      const alreadyIn = hasOtherTab(ws, roomId);
      s.room = roomId;
      if (!alreadyIn) system(roomId, 'join', s.user.username);
    }
    send(ws, { type: 'history', room: roomId, messages: db.getHistory(roomId) });
    sendPresence(roomId);
    sendTyping(roomId);
    sendCounts();
  }

  function authenticate(ws, msg) {
    const s = sessions.get(ws);
    const user = verifyToken(msg.token);
    if (!user) {
      send(ws, { type: 'auth_error', text: 'Sesión inválida o expirada.' });
      return ws.close(4401, 'unauthorized');
    }
    clearTimeout(s.authTimer);
    s.user = { id: Number(user.id), username: user.username };
    send(ws, { type: 'ready', user: s.user, rooms: db.listRooms() });
    joinRoom(ws, db.roomExists(msg.room) ? msg.room : DEFAULT_ROOM);
  }

  function chat(ws, msg) {
    const s = sessions.get(ws);
    if (!s.room) return send(ws, { type: 'error', text: 'Únete a una sala primero.' });
    if (msg.text !== undefined && typeof msg.text !== 'string') return send(ws, { type: 'error', text: 'El mensaje debe ser texto.' });
    const text = (msg.text || '').trim();
    let media = null;
    if (msg.media) {
      media = validateMedia(msg.media);
      if (!media) return send(ws, { type: 'error', text: 'El archivo adjunto no es válido.' });
    }
    if (!text && !media) return send(ws, { type: 'error', text: 'No se permiten mensajes vacíos.' });
    if (text.length > config.MAX_MESSAGE_LENGTH) {
      return send(ws, { type: 'error', text: `El mensaje supera los ${config.MAX_MESSAGE_LENGTH} caracteres.` });
    }
    const now = Date.now();
    s.stamps = s.stamps.filter((t) => now - t < RATE_WINDOW_MS);
    if (s.stamps.length >= RATE_MAX) return send(ws, { type: 'error', text: 'Estás enviando mensajes muy rápido.' });
    s.stamps.push(now);

    const saved = db.addMessage(s.room, s.user, text, media);
    s.typing = false;
    toRoom(s.room, { type: 'message', ...saved });
    sendTyping(s.room);
  }

  wss.on('connection', (ws) => {
    const s = { user: null, room: null, typing: false, alive: true, stamps: [] };
    s.authTimer = setTimeout(() => ws.close(4401, 'auth timeout'), AUTH_TIMEOUT_MS);
    sessions.set(ws, s);

    ws.on('pong', () => { s.alive = true; });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return send(ws, { type: 'error', text: 'Formato inválido.' }); }
      if (!msg || typeof msg.type !== 'string') return send(ws, { type: 'error', text: 'Formato inválido.' });

      if (!s.user) {
        if (msg.type === 'auth') return authenticate(ws, msg);
        return ws.close(4401, 'unauthorized');
      }

      switch (msg.type) {
        case 'join_room': return joinRoom(ws, String(msg.room));
        case 'message': return chat(ws, msg);
        case 'typing': {
          const typing = Boolean(msg.typing);
          if (s.room && typing !== s.typing) { s.typing = typing; sendTyping(s.room); }
          return undefined;
        }
        default: return send(ws, { type: 'error', text: 'Tipo de mensaje desconocido.' });
      }
    });

    const cleanup = () => {
      clearTimeout(s.authTimer);
      if (!sessions.has(ws)) return;
      if (s.user) leaveRoom(ws);
      sessions.delete(ws);
      if (s.user) sendCounts();
    };
    ws.on('close', cleanup);
    ws.on('error', (e) => { console.error('Error WebSocket:', e.message); cleanup(); });
  });

  // Heartbeat: elimina conexiones muertas
  const beat = setInterval(() => {
    sessions.forEach((s, ws) => {
      if (!s.alive) return ws.terminate();
      s.alive = false;
      ws.ping();
      return undefined;
    });
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(beat));

  return wss;
}

module.exports = { attachWebSocket };
