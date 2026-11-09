// Aplica el tema guardado antes de pintar la página (evita parpadeo).
// Por defecto: "día aero" (claro). El modo oscuro es la "noche aero".
(function () {
  var theme = 'light';
  try { theme = localStorage.getItem('wave-theme') || 'light'; } catch (e) { /* sin almacenamiento */ }
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
})();
