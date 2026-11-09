(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('authForm');
  const errorEl = $('authError');
  const submitBtn = $('submitBtn');
  const confirmWrap = $('confirmWrap');
  const tabLogin = $('tabLogin');
  const tabRegister = $('tabRegister');
  const themeBtn = $('themeBtn');
  let mode = 'login';

  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function set(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* ignorar */ } }

  // ----- Tema -----
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
  }
  applyTheme(document.documentElement.getAttribute('data-theme'));
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    set('wave-theme', next);
  });

  // ----- Si ya hay una sesión válida, ir directo al chat -----
  const saved = get('wave-token');
  if (saved) {
    fetch('/api/me', { headers: { Authorization: 'Bearer ' + saved } })
      .then((r) => { if (r.ok) location.replace('index.html'); })
      .catch(() => { /* sin conexión: mostrar login */ });
  }

  // ----- Pestañas login / registro -----
  function setMode(next) {
    mode = next;
    const reg = mode === 'register';
    tabLogin.classList.toggle('active', !reg);
    tabRegister.classList.toggle('active', reg);
    tabLogin.setAttribute('aria-selected', String(!reg));
    tabRegister.setAttribute('aria-selected', String(reg));
    confirmWrap.hidden = !reg;
    $('password').autocomplete = reg ? 'new-password' : 'current-password';
    submitBtn.textContent = reg ? 'Crear cuenta' : 'Entrar';
    showError('');
  }
  tabLogin.addEventListener('click', () => setMode('login'));
  tabRegister.addEventListener('click', () => setMode('register'));

  function showError(text) {
    errorEl.textContent = text;
    errorEl.hidden = !text;
  }

  // ----- Envío -----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('username').value.trim();
    const password = $('password').value;

    if (!username || !password) return showError('Completa usuario y contraseña.');
    if (mode === 'register') {
      if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) return showError('Usuario: 3-20 caracteres (letras, números, _ . -).');
      if (password.length < 8) return showError('La contraseña debe tener al menos 8 caracteres.');
      if (password !== $('confirm').value) return showError('Las contraseñas no coinciden.');
    }

    submitBtn.disabled = true;
    showError('');
    try {
      const res = await fetch('/api/' + mode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return showError(data.error || 'No se pudo completar la solicitud.');
      set('wave-token', data.token);
      location.replace('index.html');
    } catch (err) {
      showError('No se pudo conectar con el servidor.');
    } finally {
      submitBtn.disabled = false;
    }
  });

  $('username').focus();
})();
