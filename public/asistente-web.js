/*
 * Asistente 24/7 de Multidigital — widget de chat para sitios web.
 * Se instala con una línea antes de </body>:
 *   <script src="https://agendabot-backend-bbw5.onrender.com/chat-web/widget.js" data-clave="CLAVE" defer></script>
 * Opcional: data-posicion="izquierda" (por defecto, abajo a la derecha).
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || window.__asistenteWebCargado) return;
  window.__asistenteWebCargado = true;

  var clave = script.getAttribute('data-clave') || '';
  var api = (script.getAttribute('data-api') || new URL(script.src).origin) + '/chat-web';
  var izquierda = script.getAttribute('data-posicion') === 'izquierda';
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
    var host = document.createElement('div');
    host.setAttribute('data-asistente-web', '');
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var lado = izquierda ? 'left' : 'right';

    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}' +
      '.btn{position:fixed;' + lado + ':20px;bottom:20px;z-index:2147483000;width:60px;height:60px;border-radius:50%;border:0;background:' + color + ';color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:transform .15s}' +
      '.btn:hover{transform:scale(1.06)}.btn svg{width:28px;height:28px}' +
      '.teaser{position:fixed;' + lado + ':90px;bottom:30px;z-index:2147483000;max-width:240px;background:#fff;color:#0B1D3A;padding:10px 14px;border-radius:14px;box-shadow:0 6px 20px rgba(0,0,0,.18);font-size:14px;line-height:1.4;cursor:pointer}' +
      '.panel{position:fixed;' + lado + ':20px;bottom:92px;z-index:2147483001;width:370px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;box-shadow:0 16px 48px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}' +
      '.panel.abierto{display:flex}' +
      '.cab{background:' + color + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}' +
      '.cab .t{font-weight:700;font-size:15px}.cab .s{font-size:12px;opacity:.85}.cab .x{margin-left:auto;background:rgba(255,255,255,.18);border:0;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;line-height:1}' +
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
      '<button class="btn" aria-label="Abrir chat con ' + escapar(config.titulo) + '"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.4 1.1 4.6 3 6.2L4 22l4.4-2.2c1.1.3 2.3.5 3.6.5 5.5 0 10-3.9 10-8.6S17.5 3 12 3z"/></svg></button>' +
      '<section class="panel" role="dialog" aria-label="' + escapar(config.titulo) + '">' +
      '<div class="cab"><div><div class="t">' + escapar(config.titulo) + '</div><div class="s">Responde al instante · 24/7</div></div><button class="x" aria-label="Cerrar chat">×</button></div>' +
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
      a.href = 'https://wa.me/' + encodeURIComponent(config.whatsapp);
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
