(function () {
  'use strict';

  const MAX_TEXT = 500;
  const GROUP_MS = 5 * 60 * 1000; // mensajes seguidos del mismo autor se agrupan

  const $ = (id) => document.getElementById(id);
  const el = {
    shell: $('shell'), messages: $('messages'), form: $('composer'), input: $('messageInput'),
    sendBtn: $('sendBtn'), counter: $('counter'), status: $('status'), statusText: $('statusText'),
    typing: $('typing'), error: $('error'), themeBtn: $('themeBtn'), roomList: $('roomList'),
    userList: $('userList'), onlineCount: $('onlineCount'), roomTitle: $('roomTitle'),
    roomDesc: $('roomDesc'), meName: $('meName'), meAvatar: $('meAvatar'), logoutBtn: $('logoutBtn'),
    menuBtn: $('menuBtn'), scrim: $('scrim'),
    attachBtn: $('attachBtn'), micBtn: $('micBtn'), fileInput: $('fileInput'),
    attachBar: $('attachBar'), attachPreview: $('attachPreview'), attachClear: $('attachClear'),
    recBar: $('recBar'), recTime: $('recTime'), recStop: $('recStop'), recCancel: $('recCancel'),
    lightbox: $('lightbox'), lightboxImg: $('lightboxImg'), main: document.querySelector('.main')
  };
  const MAX_IMAGE = 5 * 1024 * 1024;
  const MAX_AUDIO = 10 * 1024 * 1024;
  const MAX_REC_SECONDS = 120;
  const MEDIA_URL_RE = /^\/uploads\/[a-f0-9]{32}\.[a-z0-9]{3,4}$/;

  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function set(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* ignorar */ } }
  function del(key) { try { localStorage.removeItem(key); } catch (e) { /* ignorar */ } }

  // ----- Sesión: sin token no hay chat -----
  const token = get('wave-token');
  if (!token) { location.replace('login.html'); return; }

  // ----- Estado -----
  let ws = null;
  let me = null;
  let rooms = [];
  let counts = {};
  let currentRoom = get('wave-room') || 'general';
  let attempts = 0;
  let ready = false;
  let reconnectTimer = null;
  let typingTimer = null;
  let isTyping = false;
  let errorTimer = null;
  let pending = null;   // adjunto listo para enviar: { file, kind, url }
  let uploading = false;
  let recorder = null, recStream = null, recChunks = [], recTimer = null, recStart = 0, recCancelled = false;
  let last = null;      // { userId, ts } del último mensaje renderizado (para agrupar)
  let lastDay = '';     // último separador de día renderizado

  // ===== Tema =====
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    el.themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
  }
  applyTheme(document.documentElement.getAttribute('data-theme'));
  el.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    set('wave-theme', next);
  });

  // ===== Menú lateral (móvil) =====
  const toggleMenu = (open) => el.shell.classList.toggle('open', open);
  el.menuBtn.addEventListener('click', () => toggleMenu(!el.shell.classList.contains('open')));
  el.scrim.addEventListener('click', () => toggleMenu(false));

  // ===== Estado de conexión =====
  const LABELS = { connected: 'Conectado', disconnected: 'Desconectado', reconnecting: 'Reconectando...' };
  function setStatus(state) {
    el.status.className = 'status status--' + state;
    el.statusText.textContent = LABELS[state];
    ready = state === 'connected';
    el.input.disabled = !ready;
    el.sendBtn.disabled = !ready || uploading;
    el.attachBtn.disabled = !ready;
    el.micBtn.disabled = !ready;
    if (ready) el.input.focus();
  }

  function logout() {
    del('wave-token');
    del('wave-room');
    clearTimeout(reconnectTimer);
    if (ws) { ws.onclose = null; ws.close(); }
    location.replace('login.html');
  }
  el.logoutBtn.addEventListener('click', logout);

  // ===== WebSocket =====
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
      attempts = 0;
      // El servidor exige autenticarse con el JWT en el primer mensaje
      send({ type: 'auth', token, room: currentRoom });
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      handle(msg);
    };

    ws.onclose = (e) => {
      ready = false;
      if (e.code === 4401) return logout();
      setStatus('disconnected');
      el.typing.textContent = '';
      isTyping = false;
      attempts += 1;
      const delay = Math.min(attempts * 1000, 10000);
      reconnectTimer = setTimeout(() => { setStatus('reconnecting'); connect(); }, delay);
      return undefined;
    };

    ws.onerror = () => { /* onclose se encarga de reconectar */ };
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(payload)); return true; }
    return false;
  }

  function handle(msg) {
    switch (msg.type) {
      case 'ready':
        me = msg.user;
        rooms = msg.rooms;
        el.meName.textContent = me.username;
        paintAvatar(el.meAvatar, me.username);
        renderRooms();
        setStatus('connected');
        break;
      case 'history':
        currentRoom = msg.room;
        set('wave-room', currentRoom);
        showRoomHeader();
        renderRooms();
        el.messages.textContent = '';
        last = null; lastDay = '';
        msg.messages.forEach(addMessage);
        if (msg.messages.length === 0) addEmpty();
        el.typing.textContent = '';
        break;
      case 'message':
        if (msg.room === currentRoom) { removeEmpty(); addMessage(msg); }
        break;
      case 'system':
        if (msg.room === currentRoom) addSystem(msg.text);
        break;
      case 'presence':
        if (msg.room === currentRoom) renderUsers(msg.users);
        break;
      case 'rooms':
        counts = msg.counts; renderRooms();
        break;
      case 'typing':
        if (msg.room === currentRoom) showTyping(msg.users);
        break;
      case 'error':
        showError(msg.text);
        break;
      case 'auth_error':
        logout();
        break;
    }
  }

  // ===== Avatares =====
  const COLORS = ['#1ed760', '#f573a0', '#509bf5', '#ffc864', '#af2896', '#e8115b', '#27856a', '#ff6437'];
  function avatarColor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length];
  }
  function paintAvatar(node, name) {
    node.textContent = (name[0] || '?').toUpperCase();
    node.style.background = avatarColor(name);
  }
  function makeAvatar(name, cls) {
    const a = document.createElement('span');
    a.className = 'avatar' + (cls ? ' ' + cls : '');
    paintAvatar(a, name);
    return a;
  }

  // ===== Barra lateral =====
  function renderRooms() {
    el.roomList.textContent = '';
    rooms.forEach((r) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'room' + (r.id === currentRoom ? ' active' : '');
      const icon = document.createElement('span'); icon.className = 'room-icon'; icon.textContent = r.icon;
      const name = document.createElement('span'); name.className = 'room-name'; name.textContent = r.name;
      const n = document.createElement('span'); n.className = 'pill'; n.textContent = counts[r.id] || 0;
      btn.append(icon, name, n);
      btn.addEventListener('click', () => {
        toggleMenu(false);
        if (r.id !== currentRoom) { stopTyping(); send({ type: 'join_room', room: r.id }); }
      });
      li.appendChild(btn);
      el.roomList.appendChild(li);
    });
  }

  function renderUsers(users) {
    el.onlineCount.textContent = users.length;
    el.userList.textContent = '';
    users.forEach((u) => {
      const li = document.createElement('li');
      li.className = 'user';
      const name = document.createElement('span');
      name.textContent = u.username + (me && u.id === me.id ? ' (tú)' : '');
      const dot = document.createElement('span'); dot.className = 'online-dot';
      li.append(makeAvatar(u.username), name, dot);
      el.userList.appendChild(li);
    });
  }

  function showRoomHeader() {
    const r = rooms.find((x) => x.id === currentRoom);
    if (!r) return;
    el.roomTitle.textContent = `${r.icon} ${r.name}`;
    el.roomDesc.textContent = r.description;
    el.input.placeholder = `Escribe en ${r.name}...`;
  }

  // ===== Mensajes =====
  const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Hoy';
    if (d.toDateString() === yest.toDateString()) return 'Ayer';
    return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function scrollDown() { el.messages.scrollTop = el.messages.scrollHeight; }

  function addDivider(ts) {
    const label = dayLabel(ts);
    if (label === lastDay) return;
    lastDay = label;
    const d = document.createElement('div');
    d.className = 'day';
    d.textContent = label;
    el.messages.appendChild(d);
    last = null;
  }

  function addMessage(m) {
    addDivider(m.ts);
    const mine = me && m.userId === me.id;
    const grouped = last && last.userId === m.userId && m.ts - last.ts < GROUP_MS;
    const row = document.createElement('div');
    row.className = 'row ' + (mine ? 'row--mine' : 'row--other') + (grouped ? ' grouped' : '');

    if (!mine) {
      const av = makeAvatar(m.username);
      if (grouped) av.classList.add('avatar--hidden');
      row.appendChild(av);
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg ' + (mine ? 'msg--mine' : 'msg--other');
    // Siempre textContent: evita inyección de HTML (XSS)
    if (!mine && !grouped) {
      const author = document.createElement('span');
      author.className = 'author';
      author.textContent = m.username;
      bubble.appendChild(author);
    }
    // Adjuntos: la URL se valida antes de usarla
    if (m.media && MEDIA_URL_RE.test(m.media.url)) {
      if (m.media.kind === 'image') {
        const img = document.createElement('img');
        img.className = 'media-img';
        img.alt = 'Imagen enviada por ' + m.username;
        img.loading = 'lazy';
        img.src = m.media.url;
        img.addEventListener('load', scrollDown);
        img.addEventListener('click', () => openLightbox(m.media.url));
        bubble.appendChild(img);
      } else if (m.media.kind === 'audio') {
        const audio = document.createElement('audio');
        audio.className = 'media-audio';
        audio.controls = true;
        audio.preload = 'metadata';
        audio.src = m.media.url;
        bubble.appendChild(audio);
      }
    }
    if (m.text) {
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = m.text;
      bubble.appendChild(text);
    }
    const t = document.createElement('span');
    t.className = 'time';
    t.textContent = time(m.ts);
    bubble.appendChild(t);

    row.appendChild(bubble);
    el.messages.appendChild(row);
    last = { userId: m.userId, ts: m.ts };
    scrollDown();
  }

  function addSystem(text) {
    addDivider(Date.now());
    const d = document.createElement('div');
    d.className = 'sys';
    d.textContent = text;
    el.messages.appendChild(d);
    last = null;
    scrollDown();
  }

  function addEmpty() {
    const d = document.createElement('div');
    d.className = 'empty';
    d.id = 'emptyState';
    d.textContent = 'Aún no hay mensajes. ¡Escribe el primero!';
    el.messages.appendChild(d);
  }
  function removeEmpty() { const e = $('emptyState'); if (e) e.remove(); }

  function showTyping(users) {
    if (users.length === 0) el.typing.textContent = '';
    // Los puntos suspensivos animados los añade el CSS (.typing::after)
    else if (users.length === 1) el.typing.textContent = `${users[0]} está escribiendo`;
    else if (users.length === 2) el.typing.textContent = `${users[0]} y ${users[1]} están escribiendo`;
    else el.typing.textContent = 'Varios usuarios están escribiendo';
  }

  function showError(text) {
    el.error.textContent = text;
    el.error.hidden = false;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => { el.error.hidden = true; }, 3500);
  }

  // ===== "Escribiendo..." =====
  function notifyTyping() {
    if (!isTyping) { isTyping = true; send({ type: 'typing', typing: true }); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 1500);
  }
  function stopTyping() {
    clearTimeout(typingTimer);
    if (isTyping) { isTyping = false; send({ type: 'typing', typing: false }); }
  }

  // ===== Envío y validación =====
  function updateCounter() {
    const n = el.input.value.length;
    el.counter.textContent = `${n}/${MAX_TEXT}`;
    el.counter.classList.toggle('over', n > MAX_TEXT);
  }

  el.input.addEventListener('input', () => {
    updateCounter();
    if (el.input.value.trim()) notifyTyping(); else stopTyping();
  });

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (uploading) return;
    const text = el.input.value.trim();
    if (!text && !pending) { showError('No se pueden enviar mensajes vacíos.'); el.input.focus(); return; }
    if (text.length > MAX_TEXT) { showError(`El mensaje es demasiado largo (máx. ${MAX_TEXT} caracteres).`); return; }
    if (!ready) { showError('No hay conexión con el servidor.'); return; }

    let media = null;
    if (pending) {
      uploading = true;
      el.sendBtn.disabled = true;
      el.sendBtn.textContent = 'Subiendo...';
      try {
        media = await uploadFile(pending.file);
      } catch (err) {
        showError(err.message);
        return;
      } finally {
        uploading = false;
        el.sendBtn.textContent = 'Enviar';
        el.sendBtn.disabled = !ready;
      }
    }

    stopTyping();
    send({ type: 'message', text, media });
    el.input.value = '';
    clearAttachment();
    updateCounter();
    el.input.focus();
  });

  // ===== Adjuntar imágenes y audios =====
  async function uploadFile(file) {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': file.type },
      body: file
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(); throw new Error('Sesión expirada.'); }
    if (!res.ok) throw new Error(data.error || 'No se pudo subir el archivo.');
    return { url: data.url, kind: data.kind, mime: data.mime };
  }

  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function clearAttachment() {
    if (pending) URL.revokeObjectURL(pending.url);
    pending = null;
    el.attachPreview.textContent = '';
    el.attachBar.hidden = true;
    el.fileInput.value = '';
  }

  function setAttachment(file) {
    const type = (file.type || '').split(';')[0];
    const isImage = /^image\/(png|jpeg|gif|webp)$/.test(type);
    const isAudio = /^audio\//.test(type);
    if (!isImage && !isAudio) { showError('Solo imágenes (PNG, JPG, GIF, WebP) o audios.'); return; }
    if (isImage && file.size > MAX_IMAGE) { showError('La imagen supera los 5 MB.'); return; }
    if (isAudio && file.size > MAX_AUDIO) { showError('El audio supera los 10 MB.'); return; }

    clearAttachment();
    pending = { file, kind: isImage ? 'image' : 'audio', url: URL.createObjectURL(file) };

    el.attachPreview.textContent = '';
    if (isImage) {
      const img = document.createElement('img');
      img.src = pending.url;
      img.alt = 'Vista previa';
      el.attachPreview.appendChild(img);
    } else {
      const audio = document.createElement('audio');
      audio.src = pending.url;
      audio.controls = true;
      el.attachPreview.appendChild(audio);
    }
    const info = document.createElement('span');
    info.className = 'attach-info';
    info.textContent = `${file.name || 'nota de voz'} · ${fmtSize(file.size)}`;
    el.attachPreview.appendChild(info);
    el.attachBar.hidden = false;
    el.input.focus();
  }

  el.attachBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => { if (el.fileInput.files[0]) setAttachment(el.fileInput.files[0]); });
  el.attachClear.addEventListener('click', clearAttachment);

  // Pegar una imagen desde el portapapeles
  el.input.addEventListener('paste', (e) => {
    const f = e.clipboardData && e.clipboardData.files[0];
    if (f) { e.preventDefault(); setAttachment(f); }
  });
  // Arrastrar y soltar archivos sobre el chat
  el.main.addEventListener('dragover', (e) => { e.preventDefault(); });
  el.main.addEventListener('drop', (e) => {
    e.preventDefault();
    if (ready && e.dataTransfer.files[0]) setAttachment(e.dataTransfer.files[0]);
  });

  // ===== Grabar notas de voz =====
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  async function startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      showError('Tu navegador no permite grabar audio (o la página no usa HTTPS/localhost).');
      return;
    }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      showError('No se pudo usar el micrófono. Revisa el permiso del navegador.');
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find((m) => MediaRecorder.isTypeSupported(m));
    recorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
    recChunks = [];
    recCancelled = false;
    recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) recChunks.push(ev.data); };
    recorder.onstop = () => {
      recStream.getTracks().forEach((t) => t.stop());
      clearInterval(recTimer);
      el.recBar.hidden = true;
      el.micBtn.classList.remove('recording');
      if (recCancelled || recChunks.length === 0) return;
      const type = recorder.mimeType || 'audio/webm';
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
      setAttachment(new File(recChunks, `nota-de-voz.${ext}`, { type }));
    };
    recorder.start();
    recStart = Date.now();
    el.recTime.textContent = '0:00';
    el.recBar.hidden = false;
    el.micBtn.classList.add('recording');
    recTimer = setInterval(() => {
      const secs = (Date.now() - recStart) / 1000;
      el.recTime.textContent = fmtTime(secs);
      if (secs >= MAX_REC_SECONDS) stopRecording(false);
    }, 250);
  }

  function stopRecording(cancel) {
    recCancelled = cancel;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  el.micBtn.addEventListener('click', () => {
    if (recorder && recorder.state === 'recording') stopRecording(false); else startRecording();
  });
  el.recStop.addEventListener('click', () => stopRecording(false));
  el.recCancel.addEventListener('click', () => stopRecording(true));

  // ===== Visor de imágenes =====
  function openLightbox(url) {
    el.lightboxImg.src = url;
    el.lightbox.hidden = false;
  }
  function closeLightbox() { el.lightbox.hidden = true; el.lightboxImg.removeAttribute('src'); }
  el.lightbox.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

  // ===== Inicio =====
  updateCounter();
  setStatus('reconnecting');
  connect();
})();
