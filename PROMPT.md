# Prompts de IA utilizados

## Prompt 1 · Web Chat sofisticado (Parte 5)

```
Actúa como desarrollador web senior. Tengo un chat en tiempo real con Node.js, Express y la
librería ws (servidor WebSocket) que ahora quiero mejorar. Crea una nueva versión con estas
condiciones:

1. Los mensajes recibidos se muestran alineados a la izquierda e incluyen el nombre del usuario
   que los envía; los mensajes enviados se alinean a la derecha (estilo WhatsApp) e incluyen la
   hora. Los mensajes viajan en formato JSON, por ejemplo
   { "type": "message", "username": "...", "text": "...", "ts": 1730000000000 }.
2. Usa CSS propio con una paleta definida mediante variables CSS (--color-fondo, --color-burbuja,
   --color-burbuja-propia, --color-texto, etc.).
3. Debe ser responsive: verse bien en computador y en smartphone (usa 100dvh, media queries).
4. Modo claro y oscuro con un botón; la elección se guarda en localStorage y se recuerda al
   volver a abrir el chat (sin parpadeo al cargar).
5. Los archivos HTML, CSS y JavaScript deben estar separados (index.html, style.css, app.js).
6. Indicador de estado de la conexión: Conectado / Desconectado / Reconectando, con
   reconexión automática.
7. Avisos "X se unió / salió" y un contador de usuarios en línea.
8. Indicador "X está escribiendo...".
9. Rechazar mensajes vacíos o demasiado largos (máx. 500 caracteres), validando en el cliente
   Y en el servidor.
10. Evita XSS: nunca insertes texto de usuarios con innerHTML.

Entrégame el código completo de index.js (servidor), public/index.html, public/style.css y
public/app.js.
```

## Prompt 2 · Oportunidades de mejora (+1 punto) y apariencia profesional

```
Convierte el chat en una plataforma profesional con apariencia de app de música moderna
(tema oscuro con acento verde, tipografía redonda, burbujas con avatares):

- Registro e inicio de sesión con contraseñas hasheadas (bcrypt) y autenticación con JWT.
  El WebSocket debe exigir el JWT; si es inválido, cerrar la conexión.
- Guardar usuarios, salas y mensajes en una base de datos (SQLite) y cargar el historial al
  entrar a una sala.
- Salas de chat, lista de usuarios en línea por sala, "escribiendo…" y avisos de entrada/salida.
- Aceptar conexiones WebSocket solo desde dominios permitidos (validar el header Origin).
- Leer toda la configuración desde un archivo .env (dotenv), con un .env.example.
- Límite de velocidad de mensajes y de intentos de login, cabeceras de seguridad (CSP) y
  protección contra XSS.
- Código modular (server/config, db, auth, ws), pruebas automáticas de integración y README.
```

## Prompt 3 · Estilo Frutiger Aero con fotos reales, imágenes y audios

```
Hazlo más Frutiger Aero y realista: usa fotografías reales con licencia libre (no SVG) como fondo
(día: cielo azul con nubes y colina verde; noche: costa en hora azul), paneles de cristal, botones
de gel brillante, burbujas y chispas animadas.

Además, permite enviar imágenes y subir audios en el chat (también grabar notas de voz con el
micrófono). Requisitos de seguridad: subida solo con sesión JWT, detectar el tipo real del archivo
por sus bytes, prohibir SVG, límites de tamaño, nombres aleatorios y guardar los adjuntos en la
base de datos junto al mensaje. Agrega pruebas automáticas.
```
