# WaveChat · LabWebAv-WebSocketChat

Plataforma de chat en tiempo real con **Node.js + Express + WebSocket (`ws`)**.
Incluye el laboratorio completo (Partes 1-5) y **todas las mejoras opcionales (+1 punto)**.

| Mejora opcional | Cómo se resolvió |
|---|---|
| Login con autenticación | Registro + login propio (`/api/register`, `/api/login`), contraseñas con **bcrypt** |
| JWT | Token firmado (HS256, expira en 12 h). El WebSocket exige el JWT en su primer mensaje; sin él se cierra la conexión (código 4401) |
| Chats en base de datos | **SQLite** (`node:sqlite`): usuarios, salas y mensajes. Al entrar a una sala se carga el historial |
| Solo un dominio específico | Validación del `Origin` en el handshake WebSocket (`ALLOWED_ORIGINS`) → 403 si no coincide |
| Variables de entorno `.env` | `dotenv`: puerto, secreto JWT, orígenes, base de datos, límites |

**Diseño Frutiger Aero:** fotografías reales de fondo (`public/img`, licencia Unsplash, créditos en `CREDITS.txt`) con gradación de color aqua, destellos de lente, paneles de cristal con `backdrop-filter`, botones de gel brillante, avatares tipo orbe, burbujas flotantes y chispas animadas (respeta `prefers-reduced-motion`). Modo claro = "día aero" (cielo y colina), modo oscuro = "noche aero" (costa en hora azul).

**Imágenes y audios:** botón 📎 (o pegar con Ctrl+V / arrastrar y soltar) para enviar imágenes PNG, JPG, GIF o WebP (máx. 5 MB) y audios MP3, WAV, OGG, M4A o WebM (máx. 10 MB); botón 🎤 para grabar notas de voz (hasta 2 min; requiere `localhost` o HTTPS). Las imágenes se amplían al hacer clic. Seguridad: JWT obligatorio, el tipo real se detecta por los bytes del archivo (no por la extensión), SVG prohibido, nombres aleatorios generados por el servidor y CSP `sandbox` al servir los archivos. Se guardan en `data/uploads` (`UPLOAD_DIR`).

Extras de nivel profesional: salas (General, Tecnología, Música, Estudio), usuarios en línea por sala, "escribiendo…", avisos "se unió / salió", agrupación de mensajes y separadores de día, límite de velocidad de mensajes y de intentos de login, cabeceras de seguridad con CSP, protección XSS (`textContent`), heartbeat para limpiar conexiones muertas, tema claro/oscuro recordado y diseño responsive (menú lateral en móvil).

## Requisitos
- Node.js **22.13 o superior** (usa el módulo nativo `node:sqlite`; sin compilar nada).

## Puesta en marcha
```bash
npm install
copy .env.example .env     # (Linux/Mac: cp .env.example .env) y cambia JWT_SECRET
npm run dev                # desarrollo con reinicio automático
npm start                  # producción
npm test                   # 37 pruebas de integración (auth, origen, salas, historial, subidas...)
```
Abrir <http://localhost:3000> → crear cuenta → chatear. Con otro navegador (u otra cuenta) se ve el tiempo real.

**Generar un JWT_SECRET seguro:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Prueba entre 2 equipos (Parte 4, punto 8)
En desarrollo el servidor agrega solo las IP de tu red local a los orígenes permitidos. Desde el otro equipo: `http://<IP-del-servidor>:3000`. En producción define `ALLOWED_ORIGINS` con tu dominio.

### Chat básico del laboratorio (Partes 1-3)
```bash
npm run basico             # http://localhost:3100
```

## Estructura
```
index.js            Punto de entrada (HTTP, cabeceras de seguridad, WebSocket)
server/config.js    Lectura de .env y validación de origen
server/db.js        SQLite: usuarios, salas, mensajes
server/auth.js      Registro, login y verificación de JWT
server/ws.js        WebSocket: auth, salas, presencia, typing, historial
server/uploads.js   Subida segura de imágenes y audios (POST /api/upload)
public/             login.html + auth.js · index.html + app.js · style.css · theme.js
lab-basico/         Chat básico de la guía (Partes 1-3)
test/smoke.js       Pruebas de integración
PROMPT.md           Prompts de IA usados
```

## Protocolo WebSocket (JSON)
Cliente → servidor: `auth {token, room}` · `join_room {room}` · `message {text}` · `typing {typing}`
Servidor → cliente: `ready` · `history {messages}` · `message {id,userId,username,text,ts}` · `system` · `presence {users,count}` · `rooms {counts}` · `typing {users}` · `error` · `auth_error`

## Notas de seguridad
- El JWT se guarda en `localStorage`; la CSP (`script-src 'self'`) y el uso de `textContent` reducen el riesgo de XSS. Para mayor robustez se podría migrar a cookie `HttpOnly`.
- `.env` y `data/` están en `.gitignore`: nunca se suben.
- En producción usar HTTPS (`wss://`) detrás de un proxy como Nginx.
