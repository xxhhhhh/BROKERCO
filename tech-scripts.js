// path: public/seo-rewrite.js
(function () {
  try {
    // --- ТОГГЛЕР ДОМЕНОВ ----------------------------------------------------
    /**
     * Введи индексы доменов (через запятую или пробел), которые надо ВЫКЛЮЧИТЬ.
     * 1: csgobroker.co, 2: csgobroker.me, 3: csgobroker.co
     * По умолчанию отключён "2" (csgobroker.me), как просили.
     */
    var DISABLE_IDX = '2'; // ← меняй здесь: '' (ничего), '2', '1 3', '1,2,3', ...

    var DOMAINS = ['csgobroker.co', 'csgobroker.me', 'csgobroker.co'];
    var TOKENS = {
      'csgobroker.co': 'a11687be24f7402dbdc337d5094ad450',
      'csgobroker.me': '5dbdc03b9e994810983628ea14b2de20',
      'csgobroker.co': 'a11687be24f7402dbdc337d5094ad450'
    };
    var SITE_NAMES = {
      'csgobroker.co': 'CSGOBROKER',
      'csgobroker.me': 'CSGOBROKER',
      'csgobroker.co': 'CSGOBROKER'
    };

    // Разбор строки индексов -> Set отключённых
    var DISABLED = (function (s) {
      var out = new Set();
      if (typeof s !== 'string') return out;
      s.split(/[,\s]+/).forEach(function (x) {
        if (!x) return;
        var n = parseInt(x, 10);
        if (n >= 1 && n <= DOMAINS.length) out.add(String(n));
      });
      return out;
    })(DISABLE_IDX);

    function isEnabledHost(h) {
      if (!h) return false;
      var idx = DOMAINS.indexOf(h.toLowerCase().replace(/^www\./i, ''));
      if (idx === -1) return false;
      return !DISABLED.has(String(idx + 1));
    }

    // --- ОСНОВНЫЕ ПЕРЕМЕННЫЕ -------------------------------------------------
    var loc = window.location;
    var host = (loc.hostname || '').replace(/^www\./i, '');
    var origin = loc.protocol + '//' + loc.host; // важно: сохраняем порт
    var path = loc.pathname || '/';
    if (path.length > 1) path = path.replace(/\/+$/, '');
    var pageUrl = origin + path + (loc.search || '');
    var ua = (navigator.userAgent || '');
    var isGooglebot = /Googlebot/i.test(ua);
    var isCc = host.toLowerCase() === 'csgobroker.co';

    // Если текущий домен отключён — выходим полностью.
    if (!isEnabledHost(host)) {
      return; // важно: полностью гасим скрипт на выключенных доменах
    }

    // --- УТИЛИТЫ -------------------------------------------------------------
    function ensureMeta(nameOrProp, value, isProp) {
      var selector = isProp ? 'meta[property="' + nameOrProp + '"]'
                            : 'meta[name="' + nameOrProp + '"]';
      var el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(isProp ? 'property' : 'name', nameOrProp);
        document.head.appendChild(el);
      }
      el.setAttribute('content', value);
    }

    function ensureCanonical(url) {
      var el = document.querySelector('link[rel="canonical"]');
      if (!el) {
        el = document.createElement('link');
        el.setAttribute('rel', 'canonical');
        document.head.appendChild(el);
      }
      el.setAttribute('href', url);
    }

    function isLikelyUrl(str) {
      if (typeof str !== 'string' || !str) return false;
      if (/^(data:|mailto:|tel:|javascript:)/i.test(str)) return false;
      return /^(https?:)?\/\//i.test(str) || str.startsWith('/');
    }

    // Построить whitelist/мапы только из включённых доменов
    var WHITELIST = DOMAINS.filter(function (d) { return isEnabledHost(d); });
    var CLOUDFLARE_TOKENS = {};
    var SITE_NAMES_ENABLED = {};
    WHITELIST.forEach(function (d) {
      CLOUDFLARE_TOKENS[d] = TOKENS[d];
      SITE_NAMES_ENABLED[d] = SITE_NAMES[d];
    });

    function shouldRewrite(urlHost) {
      if (!urlHost) return false;
      var h = String(urlHost).replace(/^www\./i, '').toLowerCase();
      return WHITELIST.indexOf(h) !== -1 && h !== host.toLowerCase();
    }

    function rewriteUrlPreservePath(urlStr) {
      if (typeof urlStr !== 'string') return urlStr;

      // Абсолютный URL
      if (/^https?:\/\//i.test(urlStr)) {
        try {
          var u = new URL(urlStr);
          var uHost = u.hostname.replace(/^www\./i, '');
          if (shouldRewrite(uHost)) {
            return origin + u.pathname + u.search + u.hash;
          }
          return urlStr;
        } catch (_) { /* noop */ }
      }

      // Протокол-относительный
      var protoRelMatch = urlStr.match(/^\/\/([^/]+)(\/.*|)$/);
      if (protoRelMatch) {
        var prHost = protoRelMatch[1].replace(/^www\./i, '');
        if (shouldRewrite(prHost)) {
          return origin + (protoRelMatch[2] || '');
        }
        return urlStr;
      }

      // Fallback: заменить whitelisted хосты (только включённые)
      if (WHITELIST.length) {
        var re = new RegExp(
          'https?:\\/\\/(?:www\\.)?(?:' +
          WHITELIST.map(function (d) { return d.replace(/\./g, '\\.'); }).join('|') +
          ')','ig'
        );
        var replaced = urlStr.replace(re, origin);
        if (replaced !== urlStr) return replaced;
      }
      return urlStr;
    }

    // --- РАННИЕ ВЫХОДЫ ДЛЯ .CC ----------------------------------------------
    if (isCc && !isGooglebot) {
      return; // для живых пользователей на .cc ничего не выполняем
    }
    if (isCc && isGooglebot) {
      // для Googlebot на .cc — запрет индексации и выходим
      ensureMeta('googlebot', 'noindex, nofollow', false);
      return;
    }

    // --- CANONICAL / OG / TWITTER -------------------------------------------
    ensureCanonical(pageUrl);
    ensureMeta('og:url', pageUrl, true);
    ensureMeta('twitter:url', pageUrl, false);

    (function setOgSiteName() {
      var desired = SITE_NAMES_ENABLED[host.toLowerCase()];
      if (!desired) return;
      ensureMeta('og:site_name', desired, true);
    })();

    // --- МАССОВАЯ ЗАМЕНА В <head> -------------------------------------------
    var head = document.head || document.getElementsByTagName('head')[0];
    if (head) {
      var ATTRS = ['href', 'src', 'content'];
      var nodes = head.querySelectorAll('*');
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        for (var j = 0; j < ATTRS.length; j++) {
          var attr = ATTRS[j];
          if (!node.hasAttribute(attr)) continue;
          var val = node.getAttribute(attr);
          if (!isLikelyUrl(val)) continue;
          var newVal = rewriteUrlPreservePath(val);
          if (newVal !== val) node.setAttribute(attr, newVal);
        }
      }

      // JSON-LD: глубокая перепись URL
      var ldScripts = head.querySelectorAll('script[type*="ld+json"]');
      ldScripts.forEach(function (s) {
        var txt = s.textContent || '';
        if (!txt) return;

        function deepRewrite(obj) {
          if (obj && typeof obj === 'object') {
            if (Array.isArray(obj)) {
              for (var k = 0; k < obj.length; k++) obj[k] = deepRewrite(obj[k]);
            } else {
              Object.keys(obj).forEach(function (key) { obj[key] = deepRewrite(obj[key]); });
            }
            return obj;
          }
          if (typeof obj === 'string' && isLikelyUrl(obj)) {
            return rewriteUrlPreservePath(obj);
          }
          return obj;
        }

        try {
          var json = JSON.parse(txt);
          var rewrittenJson = deepRewrite(json);
          var out = JSON.stringify(rewrittenJson, null, 2);
          if (out !== txt) s.textContent = out;
        } catch (e) {
          // Fallback: заменяем только включённые домены
          if (WHITELIST.length) {
            var re2 = new RegExp(
              '(https?:\\/\\/|\\/\\/)(?:www\\.)?(?:' +
              WHITELIST.map(function (d) { return d.replace(/\./g, '\\.'); }).join('|') +
              ')','ig'
            );
            var out2 = txt.replace(re2, origin);
            if (out2 !== txt) s.textContent = out2;
          }
        }
      });
    }

    // --- Яндекс: noindex для включённых, кроме .cc ---------------------------
    (function setYandexNoindex() {
      var blockHosts = DOMAINS.filter(function (d) {
        return d !== 'csgobroker.co' && isEnabledHost(d);
      });
      if (blockHosts.indexOf(host.toLowerCase()) === -1) return;
      var yandexMeta = document.querySelector('meta[name="yandex"]');
      if (!yandexMeta) {
        yandexMeta = document.createElement('meta');
        yandexMeta.setAttribute('name', 'yandex');
        document.head.appendChild(yandexMeta);
      }
      yandexMeta.setAttribute('content', 'noindex, nofollow');
    })();

    // --- Cloudflare Insights: токен по включённым доменам --------------------
    (function configureCfBeacon() {
      var desiredToken = CLOUDFLARE_TOKENS[host.toLowerCase()];
      if (!desiredToken) return; // не ставим токен на выключенных

      var sel = 'script[src*="static.cloudflareinsights.com/beacon.min.js"]';
      var beacon = document.querySelector(sel);

      function setToken(el) {
        var raw = el.getAttribute('data-cf-beacon');
        var cfg = {};
        if (raw) {
          try { cfg = JSON.parse(raw); } catch (_) { cfg = {}; }
        }
        if (cfg.token !== desiredToken) {
          cfg.token = desiredToken;
          el.setAttribute('data-cf-beacon', JSON.stringify(cfg));
        }
        if (!el.defer) el.setAttribute('defer', ''); // чтобы не мешал
      }

      if (beacon) {
        setToken(beacon);
      } else {
        var s = document.createElement('script');
        s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
        s.defer = true;
        s.setAttribute('data-cf-beacon', JSON.stringify({ token: desiredToken }));
        document.head.appendChild(s);
      }
    })();

  } catch (e) {
    if (window.console && console.warn) console.warn('SEO script error', e);
  }
})();


document.addEventListener('DOMContentLoaded', function () {
  var userChoice = getCookie('languageChoice');

  function handleLanguageRedirect() {
      if (userChoice && userChoice !== 'en') {
          const parts = window.location.pathname.split('/');

          const isHomePage = (parts.length === 2 && (parts[1] === '' || parts[1] === 'index.html'));
          const isLocalizedFile = parts.length === 2 && supportedLanguages.includes(parts[1].replace('.html', ''));

          if (isHomePage) {
              if (window.location.hostname === "localhost") {
                  window.location.pathname = `/${userChoice}.html`;
              } else {
                  window.location.pathname = `/${userChoice}`;
              }
              return;
          }

          if (isLocalizedFile && parts[1].replace('.html', '') === userChoice) {
              return;
          }

          if (isLocalizedFile && parts[1].replace('.html', '') !== userChoice) {
              if (window.location.hostname === "localhost") {
                  window.location.pathname = `/${userChoice}.html`;
              } else {
                  window.location.pathname = `/${userChoice}`;
              }
              return;
          }

          if (parts.length > 1 && isLanguageTag(parts[1])) {
              if (parts[1] !== userChoice) {
                  parts[1] = userChoice;
                  window.location.pathname = parts.join('/');
              }
          } else {
              parts.splice(1, 0, userChoice);
              window.location.pathname = parts.join('/');
          }
      }
  }

  const supportedLanguages = ['ru', 'hi', 'pt', 'es', 'tr'];
  function isLanguageTag(tag) {
      return tag.length === 2 && supportedLanguages.includes(tag);
  }

  document.addEventListener('click', function (event) {
      if (event.target.classList.contains('lang-switch')) {
          var selectedLang = event.target.dataset.lang;
          setCookie('languageChoice', selectedLang, 365);

          if (selectedLang !== userChoice) {
              location.reload();
          } else {
              var currentPath = window.location.pathname;
              var newPath = '/' + selectedLang + currentPath.slice(3);
              window.location.pathname = newPath;
          }
      }
  });

  function setCookie(name, value, days) {
      var expires = '';
      if (days) {
          var date = new Date();
          date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
          expires = '; expires=' + date.toUTCString();
      }
      document.cookie = name + '=' + value + expires + '; path=/; SameSite=None; Secure';
  }

  function getCookie(name) {
      var nameEQ = name + '=';
      var ca = document.cookie.split(';');
      for (var i = 0; i < ca.length; i++) {
          var c = ca[i];
          while (c.charAt(0) === ' ') {
              c = c.substring(1, c.length);
          }
          if (c.indexOf(nameEQ) === 0) {
              return c.substring(nameEQ.length, c.length);
          }
      }
      return null;
  }

  if (
      userChoice === 'ru' ||
      (
          ![
              "/topic",
              "/reviews/",
              "/mirrors/",
              "/privacy-policy",
              "/terms-of-service",
              "/contact-us",
          ].some((path) => window.location.pathname.includes(path)) &&
          !document.getElementById("error-404")
      )
  ) {
      handleLanguageRedirect();
  }
});
