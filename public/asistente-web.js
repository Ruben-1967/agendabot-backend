/*
 * Asistente 24/7 de Multidigital — widget de chat para sitios web.
 * Se instala con una línea antes de </body>:
 *   <script src="https://agendabot-backend-bbw5.onrender.com/chat-web/widget.js" data-clave="CLAVE" defer></script>
 * Opcional: data-posicion="izquierda" (por defecto, abajo a la derecha) y data-icono="https://..."
 * (imagen propia para el botón, por ejemplo el logo del negocio).
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || window.__asistenteWebCargado) return;
  window.__asistenteWebCargado = true;

  var clave = script.getAttribute('data-clave') || '';
  var api = (script.getAttribute('data-api') || new URL(script.src).origin) + '/chat-web';
  var izquierda = script.getAttribute('data-posicion') === 'izquierda';
  // Opcional: imagen propia para el botón (logo o avatar del negocio), solo https.
  var icono = script.getAttribute('data-icono') || '';
  if (!/^https:\/\/[^\s"'<>]+$/.test(icono)) icono = '';
  if (!clave) return;

  // Almacenamiento tolerante a fallos (modo incógnito, bloqueos de cookies).
  function leer(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function guardar(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* sin persistencia */ } }
  function leerSesion(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function guardarSesion(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* sin persistencia */ } }

  function idAleatorio() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var bytes = new Uint8Array(32);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += chars[bytes[i] % chars.length];
    return s;
  }

  var claveSesion = 'asistenteWeb:' + clave + ':sesion';
  var claveHistorial = 'asistenteWeb:' + clave + ':historial';
  var claveFecha = 'asistenteWeb:' + clave + ':desde';
  var sesion = leer(claveSesion);
  var desde = Number(leer(claveFecha)) || 0;
  // Una sesión dura 7 días: quien vuelve después parte con una conversación nueva.
  if (!sesion || !/^[A-Za-z0-9_-]{16,64}$/.test(sesion) || Date.now() - desde > 7 * 86400000) {
    sesion = idAleatorio(); guardar(claveSesion, sesion); guardar(claveFecha, String(Date.now()));
  }

  function escapar(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Texto del asistente -> HTML seguro: escapa todo y luego solo agrega negrita y enlaces https.
  function formatear(t) {
    var h = escapar(t);
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
    h = h.replace(/(https:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return h.replace(/\n/g, '<br>');
  }

  fetch(api + '/config?clave=' + encodeURIComponent(clave))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (config) { if (config) montar(config); })
    .catch(function () { /* sin asistente si no hay conexión */ });

  function montar(config) {
    var color = /^#[0-9a-fA-F]{3,8}$/.test(config.color || '') ? config.color : '#1D4ED8';
    // WhatsApp del negocio siempre a mano dentro del chat (cabecera + botón bajo el saludo):
    // en los sitios con asistente reemplaza al botón flotante de WhatsApp.
    var ICONO_WA = '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2z"/></svg>';
    function linkWhatsApp() {
      return 'https://wa.me/' + encodeURIComponent(config.whatsapp || '') + '?text=' + encodeURIComponent('Hola, vengo del sitio web');
    }
    var host = document.createElement('div');
    host.setAttribute('data-asistente-web', '');
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var lado = izquierda ? 'left' : 'right';

    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}' +
      '.btn{position:fixed;' + lado + ':20px;bottom:20px;z-index:2147483000;width:64px;height:64px;border-radius:50%;border:3px solid #fff;background:linear-gradient(135deg,' + color + ' 0%,#7C3AED 100%);color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;transition:transform .15s;padding:0;overflow:visible}' +
      '.btn:hover{transform:scale(1.07)}.btn svg{width:34px;height:34px}' +
      '.btn img{width:100%;height:100%;border-radius:50%;object-fit:cover}' +
      '.btn .en-linea{position:absolute;top:1px;right:1px;width:15px;height:15px;border-radius:50%;background:#22C55E;border:2.5px solid #fff}' +
      '.btn .ia{position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);background:#fff;color:' + color + ';font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 7px;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.2)}' +
      '.btn.pulso::before{content:"";position:absolute;inset:-3px;border-radius:50%;border:3px solid ' + color + ';animation:pulso 1.8s ease-out 4}' +
      '@keyframes pulso{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.6);opacity:0}}' +
      '@media (prefers-reduced-motion:reduce){.btn.pulso::before{animation:none}}' +
      '.teaser{position:fixed;' + lado + ':90px;bottom:30px;z-index:2147483000;max-width:240px;background:#fff;color:#0B1D3A;padding:10px 14px;border-radius:14px;box-shadow:0 6px 20px rgba(0,0,0,.18);font-size:14px;line-height:1.4;cursor:pointer}' +
      '.panel{position:fixed;' + lado + ':20px;bottom:92px;z-index:2147483001;width:370px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;box-shadow:0 16px 48px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}' +
      '.panel.abierto{display:flex}' +
      '.cab{background:' + color + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}' +
      '.cab .t{font-weight:700;font-size:15px}.cab .s{font-size:12px;opacity:.85}.cab .acc{margin-left:auto;display:flex;gap:8px;align-items:center}.cab .x{background:rgba(255,255,255,.18);border:0;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;line-height:1}' +
      '.cab .wa-cab{width:32px;height:32px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center}.cab .wa-cab svg{width:18px;height:18px}' +
      '.chip-wa{align-self:flex-start;border:1.5px solid #25D366;color:#128C4A;background:#fff;padding:7px 13px;border-radius:999px;font-weight:700;font-size:13px;text-decoration:none}.chip-wa:hover{background:#ECFDF3}' +
      '.msgs{flex:1;overflow-y:auto;padding:14px;background:#F4F6FA;display:flex;flex-direction:column;gap:8px}' +
      '.m{max-width:85%;padding:9px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:normal;word-wrap:break-word}' +
      '.m.bot{background:#fff;color:#0B1D3A;align-self:flex-start;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.06)}' +
      '.m.yo{background:' + color + ';color:#fff;align-self:flex-end;border-bottom-right-radius:4px}' +
      '.m a{color:inherit;text-decoration:underline;word-break:break-all}' +
      '.esc{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:#fff;border-radius:14px}.esc i{width:7px;height:7px;border-radius:50%;background:#9AA3B2;animation:p 1s infinite}.esc i:nth-child(2){animation-delay:.15s}.esc i:nth-child(3){animation-delay:.3s}' +
      '@keyframes p{0%,80%,100%{opacity:.3}40%{opacity:1}}' +
      '.wa{align-self:flex-start;background:#25D366;color:#fff;text-decoration:none;padding:9px 14px;border-radius:999px;font-weight:700;font-size:14px}' +
      '.pie{display:flex;gap:8px;padding:10px;border-top:1px solid #E5E8EF;background:#fff}' +
      '.pie textarea{flex:1;resize:none;border:1px solid #D5DAE3;border-radius:12px;padding:9px 12px;font-size:14px;height:42px;max-height:100px;outline:none;color:#0B1D3A}' +
      '.pie textarea:focus{border-color:' + color + '}' +
      '.pie button{border:0;background:' + color + ';color:#fff;border-radius:12px;width:44px;cursor:pointer}.pie button:disabled{opacity:.5;cursor:default}' +
      '.marca{font-size:11px;color:#8A93A3;text-align:center;padding:0 0 8px;background:#fff}' +
      '@media (max-width:480px){.panel{' + lado + ':0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}}' +
      '</style>' +
      '<div class="teaser" hidden></div>' +
      '<button class="btn pulso" aria-label="Abrir chat con ' + escapar(config.titulo) + '">' +
      (icono
        ? '<img src="' + escapar(icono) + '" alt="">'
        // Globo de chat con chispas de IA.
        : '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#fff" d="M16 4C9.4 4 4 8.6 4 14.3c0 2.9 1.4 5.5 3.7 7.4L6.5 27l5.3-2.6c1.3.4 2.7.6 4.2.6 6.6 0 12-4.6 12-10.3S22.6 4 16 4z"/>' +
          '<path fill="' + color + '" d="M15 8.5l1.3 3.6 3.6 1.3-3.6 1.3-1.3 3.6-1.3-3.6-3.6-1.3 3.6-1.3z"/>' +
          '<path fill="#7C3AED" d="M20.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>') +
      '<span class="en-linea" aria-hidden="true"></span><span class="ia" aria-hidden="true">IA</span></button>' +
      '<section class="panel" role="dialog" aria-label="' + escapar(config.titulo) + '">' +
      '<div class="cab"><div><div class="t">' + escapar(config.titulo) + '</div><div class="s">Responde al instante · 24/7</div></div><div class="acc">' + (config.whatsapp ? '<a class="wa-cab" href="' + linkWhatsApp() + '" target="_blank" rel="noopener noreferrer" aria-label="Escribir por WhatsApp" title="Escribir por WhatsApp">' + ICONO_WA + '</a>' : '') + '<button class="x" aria-label="Cerrar chat">×</button></div></div>' +
      '<div class="msgs" aria-live="polite"></div>' +
      '<div class="pie"><textarea rows="1" placeholder="Escribe tu mensaje…" aria-label="Escribe tu mensaje" maxlength="800"></textarea><button aria-label="Enviar"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg></button></div>' +
      '<div class="marca">Asistente con IA · puede cometer errores</div>' +
      '</section>';

    var btn = root.querySelector('.btn');
    var panel = root.querySelector('.panel');
    var teaser = root.querySelector('.teaser');
    var msgs = root.querySelector('.msgs');
    var input = root.querySelector('textarea');
    var enviar = root.querySelector('.pie button');
    var historial = [];
    try { historial = JSON.parse(leerSesion(claveHistorial) || '[]') || []; } catch (e) { historial = []; }
    var esperando = false;

    function pintar(rol, texto) {
      var d = document.createElement('div');
      d.className = 'm ' + (rol === 'yo' ? 'yo' : 'bot');
      d.innerHTML = rol === 'yo' ? escapar(texto).replace(/\n/g, '<br>') : formatear(texto);
      msgs.appendChild(d);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function botonWhatsApp() {
      if (!config.whatsapp || root.querySelector('.wa')) return;
      var a = document.createElement('a');
      a.className = 'wa'; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.href = linkWhatsApp();
      a.textContent = 'Escribir por WhatsApp';
      msgs.appendChild(a);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function agregar(rol, texto) {
      historial.push({ r: rol, t: texto });
      if (historial.length > 60) historial = historial.slice(-60);
      guardarSesion(claveHistorial, JSON.stringify(historial));
      pintar(rol, texto);
    }

    pintar('bot', config.saludo);
    if (config.whatsapp) {
      var chip = document.createElement('a');
      // Mismo botón verde que aparece al derivar (clase .wa): así tampoco se duplica después.
      chip.className = 'wa'; chip.target = '_blank'; chip.rel = 'noopener noreferrer';
      chip.href = linkWhatsApp();
      chip.textContent = 'Escribir por WhatsApp';
      msgs.appendChild(chip);
    }
    historial.forEach(function (m) { pintar(m.r, m.t); });

    function abrir() {
      panel.classList.add('abierto'); teaser.hidden = true; guardar('asistenteWeb:' + clave + ':visto', '1');
      setTimeout(function () { input.focus(); }, 50);
    }
    function cerrar() { panel.classList.remove('abierto'); }
    btn.addEventListener('click', function () { panel.classList.contains('abierto') ? cerrar() : abrir(); });
    teaser.addEventListener('click', abrir);
    root.querySelector('.x').addEventListener('click', cerrar);

    // Invitación la primera vez, a los 6 segundos.
    if (!leer('asistenteWeb:' + clave + ':visto')) {
      setTimeout(function () {
        if (!panel.classList.contains('abierto')) { teaser.textContent = config.saludo; teaser.hidden = false; }
      }, 6000);
    }

    function mandar() {
      var texto = input.value.trim();
      if (!texto || esperando) return;
      input.value = '';
      agregar('yo', texto);
      esperando = true; enviar.disabled = true;
      var esc = document.createElement('div');
      esc.className = 'esc'; esc.innerHTML = '<i></i><i></i><i></i>';
      msgs.appendChild(esc); msgs.scrollTop = msgs.scrollHeight;
      fetch(api + '/mensaje', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave: clave, sesion: sesion, texto: texto }),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          esc.remove();
          agregar('bot', d.respuesta || d.error || 'No pude responder ahora. Intenta de nuevo en un momento.');
          if (d.derivado || d.limite) botonWhatsApp();
        })
        .catch(function () {
          esc.remove();
          agregar('bot', 'Parece que no hay conexión. Intenta de nuevo en un momento.');
        })
        .then(function () { esperando = false; enviar.disabled = false; input.focus(); });
    }
    enviar.addEventListener('click', mandar);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar(); }
    });
  }
})();
