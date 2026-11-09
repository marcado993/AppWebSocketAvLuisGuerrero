// Prueba de integración: levanta el servidor con una BD temporal y simula clientes reales.
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');
const WebSocket = require('ws');

const PORT = 3999;
const ORIGIN = `http://localhost:${PORT}`;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wavechat-')), 'test.db');

const server = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    JWT_SECRET: 'secreto-de-pruebas-1234567890',
    ALLOWED_ORIGINS: ORIGIN,
    DB_PATH: DB,
    UPLOAD_DIR: path.join(path.dirname(DB), 'uploads'),
    AUTH_RATE_LIMIT: '1000',
    UPLOAD_RATE_LIMIT: '1000'
  },
  stdio: 'ignore'
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p, body, headers = {}) =>
  fetch(`${ORIGIN}/api/${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });

function connect(origin = ORIGIN) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`, { origin });
    ws.inbox = [];
    ws.on('message', (d) => ws.inbox.push(JSON.parse(d)));
    ws.on('open', () => resolve(ws));
    ws.on('unexpected-response', (_req, res) => reject(new Error('HTTP ' + res.statusCode)));
    ws.on('error', reject);
  });
}
const j = (ws, o) => ws.send(JSON.stringify(o));
const last = (ws, type) => [...ws.inbox].reverse().find((m) => m.type === type);
const all = (ws, type) => ws.inbox.filter((m) => m.type === type);
let passed = 0;
const ok = (cond, name) => { assert(cond, name); passed += 1; console.log('  ✔', name); };

async function run() {
  for (let i = 0; i < 30; i++) { try { await fetch(ORIGIN); break; } catch (e) { await sleep(200); } }

  console.log('REST / autenticación');
  let r = await api('register', { username: 'ab', password: 'password123' });
  ok(r.status === 400, 'rechaza usuario corto');
  r = await api('register', { username: 'ana', password: 'corta' });
  ok(r.status === 400, 'rechaza contraseña corta');
  r = await api('register', { username: 'ana', password: 'password123' });
  const ana = await r.json();
  ok(r.status === 201 && ana.token, 'registro de Ana devuelve JWT');
  r = await api('register', { username: 'ANA', password: 'password123' });
  ok(r.status === 409, 'usuario duplicado (sin distinguir mayúsculas)');
  r = await api('register', { username: 'beto', password: 'password123' });
  const beto = await r.json();
  r = await api('login', { username: 'ana', password: 'mala-clave' });
  ok(r.status === 401, 'login con clave incorrecta = 401');
  r = await api('login', { username: 'ana', password: 'password123' });
  ok(r.status === 200, 'login correcto');
  r = await api('me', null, { Authorization: 'Bearer ' + ana.token });
  ok((await r.json()).user.username === 'ana', '/api/me con token válido');
  r = await api('me', null, { Authorization: 'Bearer token.falso.xyz' });
  ok(r.status === 401, '/api/me con token falso = 401');

  console.log('WebSocket / seguridad');
  let blocked = false;
  try { await connect('http://sitio-malicioso.com'); } catch (e) { blocked = /403/.test(e.message); }
  ok(blocked, 'origen no permitido es rechazado (403)');

  const waitFor = async (cond, ms = 3000) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await sleep(25); };

  const bad = await connect();
  j(bad, { type: 'auth', token: 'falso' });
  await waitFor(() => bad.readyState === WebSocket.CLOSED);
  ok(last(bad, 'auth_error') && bad.readyState !== WebSocket.OPEN, 'JWT inválido cierra la conexión');

  const noAuth = await connect();
  j(noAuth, { type: 'message', text: 'hola sin login' });
  await waitFor(() => noAuth.readyState === WebSocket.CLOSED);
  ok(noAuth.readyState !== WebSocket.OPEN, 'mensaje sin autenticar cierra la conexión');

  console.log('Chat / salas');
  const a = await connect();
  const b = await connect();
  j(a, { type: 'auth', token: ana.token, room: 'general' });
  await sleep(150);
  j(b, { type: 'auth', token: beto.token, room: 'general' });
  await sleep(250);
  ok(last(a, 'ready').rooms.length === 4, 'el servidor entrega 4 salas');
  ok(a.inbox.some((m) => m.type === 'system' && m.text.includes('beto se unió')), 'aviso "se unió"');
  ok(last(a, 'presence').count === 2, 'contador de usuarios = 2');

  j(a, { type: 'message', text: 'Hola Beto 👋' });
  await sleep(150);
  const got = last(b, 'message');
  ok(got.username === 'ana' && got.text === 'Hola Beto 👋' && got.userId === ana.user.id && got.ts, 'mensaje JSON con autor y hora');

  j(a, { type: 'message', text: '   ' });
  j(a, { type: 'message', text: 'x'.repeat(501) });
  await sleep(150);
  ok(all(a, 'error').length === 2, 'rechaza mensajes vacíos y demasiado largos');
  ok(all(b, 'message').length === 1, 'los inválidos no se reenvían');

  j(a, { type: 'typing', typing: true });
  await sleep(100);
  ok(last(b, 'typing').users.join() === 'ana', 'indicador "escribiendo"');
  ok(last(a, 'typing').users.length === 0, 'no te muestra a ti mismo');

  j(b, { type: 'join_room', room: 'musica' });
  await sleep(200);
  ok(last(b, 'history').room === 'musica' && last(b, 'history').messages.length === 0, 'cambio de sala');
  j(a, { type: 'message', text: 'esto es solo para general' });
  await sleep(150);
  ok(!b.inbox.some((m) => m.text === 'esto es solo para general'), 'aislamiento entre salas');
  ok(a.inbox.some((m) => m.type === 'system' && m.text.includes('beto salió')), 'aviso "salió"');

  console.log('Imágenes y audios');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(24)]);
  const up = (body, type, token = ana.token) =>
    fetch(`${ORIGIN}/api/upload`, { method: 'POST', headers: { 'Content-Type': type, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body });

  r = await up(PNG, 'image/png', null);
  ok(r.status === 401, 'subir sin sesión = 401');
  r = await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml');
  ok(r.status === 415, 'SVG rechazado (415)');
  r = await up(Buffer.from('MZ esto es un ejecutable disfrazado de png........'), 'image/png');
  ok(r.status === 415, 'archivo falso con Content-Type de imagen rechazado');
  r = await up(PNG, 'audio/mpeg');
  ok(r.status === 415, 'tipo declarado distinto al contenido real rechazado');
  r = await up(Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), 'image/png');
  ok(r.status === 413, 'imagen mayor a 5 MB rechazada (413)');

  r = await up(PNG, 'image/png');
  const img = await r.json();
  ok(r.status === 201 && /^\/uploads\/[a-f0-9]{32}\.png$/.test(img.url) && img.kind === 'image', 'imagen PNG subida con nombre aleatorio');
  r = await up(WAV, 'audio/wav');
  const aud = await r.json();
  ok(r.status === 201 && aud.kind === 'audio' && aud.url.endsWith('.wav'), 'audio WAV subido');
  r = await fetch(ORIGIN + img.url);
  ok(r.status === 200 && r.headers.get('content-type') === 'image/png' && /sandbox/.test(r.headers.get('content-security-policy')), 'el archivo se sirve con tipo correcto y CSP sandbox');
  r = await fetch(ORIGIN + '/uploads/../.env');
  ok(r.status === 404, 'no se puede salir de la carpeta de subidas');

  j(a, { type: 'message', text: 'mira esta foto', media: img });
  j(a, { type: 'message', text: '', media: aud });
  await sleep(200);
  const withMedia = all(b, 'message').filter((m) => m.media);
  ok(withMedia.length === 0, 'Beto (en otra sala) no recibe adjuntos de General');
  j(b, { type: 'join_room', room: 'general' });
  await sleep(250);
  const histM = last(b, 'history').messages.filter((m) => m.media);
  ok(histM.length === 2 && histM[0].media.kind === 'image' && histM[1].media.kind === 'audio', 'adjuntos (imagen y audio) guardados en el historial');
  ok(histM[1].text === '', 'audio sin texto permitido');

  j(a, { type: 'message', text: 'x', media: { url: '/uploads/../../etc/passwd', kind: 'image' } });
  j(a, { type: 'message', text: 'x', media: { url: '/uploads/' + 'a'.repeat(32) + '.png', kind: 'image' } });
  await sleep(200);
  ok(all(a, 'error').filter((m) => /adjunto/.test(m.text)).length === 2, 'adjuntos inventados o con ruta maliciosa rechazados');

  console.log('Persistencia');
  const c = await connect();
  j(c, { type: 'auth', token: beto.token, room: 'general' });
  await sleep(250);
  const histAll = last(c, 'history').messages;
  const hist = histAll.map((m) => m.text);
  ok(hist.includes('Hola Beto 👋') && hist.includes('esto es solo para general'), 'el historial se guarda en la base de datos');
  ok(!histAll.some((m) => (m.text.trim() === '' && !m.media) || m.text.length > 500), 'no se guardaron mensajes vacíos ni demasiado largos');

  [a, b, c, bad, noAuth].forEach((w) => w.close());
  console.log(`\n✅ ${passed} pruebas pasaron`);
}

run()
  .catch((e) => { console.error('\n❌', e.message); process.exitCode = 1; })
  .finally(() => { server.kill(); setTimeout(() => process.exit(), 300); });
