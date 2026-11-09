// Persistencia con SQLite (módulo nativo de Node: node:sqlite, Node >= 22.13)
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
const db = new DatabaseSync(config.DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    icon        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id    TEXT NOT NULL REFERENCES rooms(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    username   TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    media_url  TEXT,
    media_kind TEXT,
    media_mime TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id);
`);

// Migración para bases de datos creadas antes de los adjuntos
const msgCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
if (!msgCols.includes('media_url')) {
  db.exec('ALTER TABLE messages ADD COLUMN media_url TEXT; ALTER TABLE messages ADD COLUMN media_kind TEXT; ALTER TABLE messages ADD COLUMN media_mime TEXT;');
}

const insertRoom = db.prepare('INSERT OR IGNORE INTO rooms (id, name, description, icon) VALUES (?, ?, ?, ?)');
[
  ['general', 'General', 'Conversación abierta para todos', '💬'],
  ['tecnologia', 'Tecnología', 'Programación, web y herramientas', '💻'],
  ['musica', 'Música', 'Comparte lo que estás escuchando', '🎧'],
  ['estudio', 'Estudio', 'Tareas, laboratorios y exámenes', '📚']
].forEach((r) => insertRoom.run(...r));

const q = {
  insertUser: db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'),
  userByName: db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username FROM users WHERE id = ?'),
  rooms: db.prepare('SELECT id, name, description, icon FROM rooms ORDER BY rowid'),
  roomById: db.prepare('SELECT id FROM rooms WHERE id = ?'),
  insertMessage: db.prepare('INSERT INTO messages (room_id, user_id, username, text, created_at, media_url, media_kind, media_mime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  history: db.prepare(`
    SELECT id, user_id AS userId, username, text, created_at AS ts, media_url, media_kind, media_mime
    FROM (SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?)
    ORDER BY id ASC`)
};

const toMedia = (url, kind, mime) => (url ? { url, kind, mime } : null);

module.exports = {
  /** Devuelve el usuario creado o null si el nombre ya existe. */
  createUser(username, passwordHash) {
    try {
      const r = q.insertUser.run(username, passwordHash, Date.now());
      return { id: Number(r.lastInsertRowid), username };
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return null;
      throw e;
    }
  },
  getUserByName: (username) => q.userByName.get(username),
  getUserById: (id) => q.userById.get(id),
  listRooms: () => q.rooms.all(),
  roomExists: (id) => Boolean(q.roomById.get(id)),
  addMessage(roomId, user, text, media = null) {
    const ts = Date.now();
    const r = q.insertMessage.run(roomId, user.id, user.username, text, ts, media ? media.url : null, media ? media.kind : null, media ? media.mime : null);
    return { id: Number(r.lastInsertRowid), room: roomId, userId: user.id, username: user.username, text, ts, media };
  },
  getHistory: (roomId, limit = config.HISTORY_LIMIT) =>
    q.history.all(roomId, limit).map((m) => ({
      id: Number(m.id),
      userId: Number(m.userId),
      username: m.username,
      text: m.text,
      ts: Number(m.ts),
      media: toMedia(m.media_url, m.media_kind, m.media_mime)
    })),
  close: () => db.close()
};
