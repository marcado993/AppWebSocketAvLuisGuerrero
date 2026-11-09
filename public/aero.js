// Burbujas flotantes y chispas del fondo (Frutiger Aero). Usa la API CSSOM, compatible con la CSP.
(function () {
  var host = document.getElementById('aeroBg');
  if (!host || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var small = window.innerWidth < 700;
  var rnd = function (min, max) { return min + Math.random() * (max - min); };

  // Burbujas de cristal que suben
  var bubbles = small ? 10 : 20;
  for (var i = 0; i < bubbles; i++) {
    var b = document.createElement('span');
    b.className = 'bubble';
    var duration = rnd(16, 38);
    b.style.setProperty('--s', rnd(22, 150).toFixed(0) + 'px');
    b.style.setProperty('--x', rnd(0, 96).toFixed(1) + '%');
    b.style.setProperty('--d', duration.toFixed(1) + 's');
    b.style.setProperty('--delay', (-Math.random() * duration).toFixed(1) + 's'); // arrancan repartidas
    host.appendChild(b);
  }

  // Chispas que parpadean
  var sparks = small ? 6 : 14;
  for (var j = 0; j < sparks; j++) {
    var s = document.createElement('span');
    s.className = 'spark';
    var d = rnd(3, 7);
    s.style.setProperty('--s', rnd(14, 34).toFixed(0) + 'px');
    s.style.setProperty('--x', rnd(2, 96).toFixed(1) + '%');
    s.style.setProperty('--y', rnd(2, 80).toFixed(1) + '%');
    s.style.setProperty('--d', d.toFixed(1) + 's');
    s.style.setProperty('--delay', (-Math.random() * d).toFixed(1) + 's');
    host.appendChild(s);
  }
})();
