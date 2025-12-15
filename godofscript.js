const StorageHelper = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },

  getJSON: (key) => {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  },

  setJSON: (key, obj) => {
    try {
      localStorage.setItem(key, JSON.stringify(obj));
    } catch {}
  },

  setWithExpiry: (key, value, durationMs) => {
    const now = Date.now();
    const data = { value, expiry: now + durationMs };
    StorageHelper.setJSON(key, data);
  },

  getWithExpiry: (key) => {
    const item = StorageHelper.getJSON(key);
    if (!item || Date.now() > item.expiry) {
      localStorage.removeItem(key);
      return null;
    }
    return item.value;
  },

  initVersion: ({ versionKey = 'version', currentVersion }) => {
    const savedVersion = localStorage.getItem(versionKey);
    if (savedVersion !== currentVersion) {
      localStorage.clear();
      localStorage.setItem(versionKey, currentVersion);
    }
  }
};

StorageHelper.initVersion({ currentVersion: '1.24' });

function isRuPage(pathname) {
  return pathname.startsWith('/ru/') || pathname === '/ru' || pathname === '/ru.html';
}

/**
 * Копирует текст в буфер обмена. Показывает визуальный отклик через showCopied.
 * @param {string|Element} source - Строка или DOM-узел, из которого берётся текст.
 * @param {Element} copyButton - Кнопка-источник для showCopied.
 */
function copyToClipboard(source, copyButton) {
  const text = typeof source === "string" ? source : (source?.textContent || "").trim();
  if (!text) return;

  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard
      .writeText(text)
      .then(() => showCopied(copyButton))
      .catch(() => {
        const tempInput = document.createElement("textarea");
        tempInput.value = text;
        tempInput.style.position = "fixed";
        tempInput.style.opacity = "0";
        document.body.appendChild(tempInput);
        tempInput.select();
        try { document.execCommand("copy"); } catch {}
        document.body.removeChild(tempInput);
        showCopied(copyButton);
      });
  } else {
    const tempInput = document.createElement("input");
    document.body.appendChild(tempInput);
    tempInput.value = text;
    tempInput.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(tempInput);
    showCopied(copyButton);
  }
}

function showCopied(copyButton) {
  const title = document.createElement("div");
  title.className = "copied-title";
  title.textContent = (typeof languageTag !== "undefined" && languageTag === "ru") ? "Скопировано" : "Copied";
  copyButton.appendChild(title);
  copyButton.classList.add("icon-changed");

  title.style.display = "none";
  $(title).fadeIn(150, function () {
    $(this).delay(400).fadeOut(150, function () {
      $(this).remove();
    });
  });

  setTimeout(() => copyButton.classList.remove("icon-changed"), 800);
}

(function () {
  function getTextFromTarget(btn) {
    const explicit = btn.getAttribute("data-copy-text");
    if (explicit) return explicit;

    const codeAttr = btn.getAttribute("code") || btn.getAttribute("data-code");
    if (codeAttr) return String(codeAttr);

    const targetSel = btn.getAttribute("data-copy-target");
    if (targetSel) {
      const el = document.querySelector(targetSel);
      if (el) {
        const val = "value" in el ? el.value : (el.textContent || "");
        const trimmed = (val ?? "").toString().trim();
        if (trimmed) return trimmed;
      }
    }

    const prev = btn.previousElementSibling;
    if (prev) {
      if (prev.tagName === "CODE") return prev.textContent.trim();
      if (prev.tagName === "PRE") {
        const innerCode = prev.querySelector("code");
        if (innerCode) return innerCode.textContent.trim();
      }
    }

    const siteCode = document.getElementById("site-code");
    if (siteCode) {
      const sc = (siteCode.value ?? siteCode.textContent ?? "").toString().trim();
      if (sc) return sc;
    }

    return "";
  }

  function onClick(e) {
    const btn = e.target.closest("[data-copy], .copy, .site-promo-copy");
    if (!btn) return;

    e.preventDefault();

    const text = getTextFromTarget(btn);
    if (!text) return;

    copyToClipboard(text, btn);
  }

  document.addEventListener("click", onClick, { passive: false });
})();

  $(document).ready(function() {
      $('.sitepros').click(function() {
          $(this).toggleClass("active");
  
          if ($(window).width() >= 1365) {
              var $methodlist = $(this).find('.methodlist');
              var methodlistHeight = $methodlist.outerHeight(true);
              var totalHeight = $(this).height() + methodlistHeight;
              var $parent = $(this).parent('.sitedetails');
              var $otherActiveSitepros = $(this).siblings('.sitepros.active');
              var currentHeight = parseInt($parent.css('height'));
  
              if ($(this).hasClass("active")) {
                  if (currentHeight < totalHeight) {
                      $parent.css('height', totalHeight + 'px');
                  }
              } else if ($otherActiveSitepros.length === 0) {
                  $parent.css('height', '');
              }
          }
      });
  
      $('.sitepros .methodlist').click(function(event) {
          event.stopPropagation();
      });
  });

const themeToggleBtn = document.getElementById('theme-toggle');
const themeIcon = themeToggleBtn.querySelector('i');
let currentTheme = (StorageHelper.getJSON('theme_settings') || {}).theme || getSystemPreferredTheme();

applyTheme(currentTheme, false);

window.addEventListener('DOMContentLoaded', () => {
  if (document.documentElement.classList.contains('transitions-disabled')) {
    replaceTransitionClass();
  }
});

function getSystemPreferredTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function replaceTransitionClass() {
  const html = document.documentElement;

  setTimeout(() => {
    html.classList.remove('transitions-disabled');
    html.classList.add('transitions-enabled');

    setTimeout(() => {
      html.classList.remove('transitions-enabled');
    }, 200);
  }, 100);
}

function temporarilyDisableTransitions() {
  const html = document.documentElement;

  html.classList.remove('transitions-enabled');
  html.classList.add('transitions-disabled');

  replaceTransitionClass();
}

function applyTheme(theme, withTransition = true) {
  if (withTransition) temporarilyDisableTransitions();

  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  StorageHelper.setJSON('theme_settings', { ...(StorageHelper.getJSON('theme_settings') || {}), theme });
  localStorage.setItem('theme', theme);

  const link = document.getElementById('theme-style');

  if (theme === 'light') {
    if (link) { link.href = '/style_light.css'; link.disabled = false; }
    themeIcon.classList.replace('lightbulb-off', 'lightbulb-on');
  } else {
    if (link) { link.disabled = true; link.href = ''; }
    themeIcon.classList.replace('lightbulb-on', 'lightbulb-off');
  }
}

themeToggleBtn.addEventListener('click', () => {
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme, true);
});

  const sitesList = document.querySelector('.boxes-holder');
  const reviewBox = document.querySelector('.box.main .content');
  const modsboxes = document.querySelector('.mods-main-box');
  const supportedLanguages = ["en", "es", "hi", "pt", "ru", "tr"];


  function extractLanguageTagFromHTML() {
    const htmlElement = document.querySelector('html');
    if (htmlElement) {
      const langAttribute = htmlElement.getAttribute('lang');
      if (langAttribute) {
        return langAttribute.split('-')[0];
      }
    }
    return null;
  }
  
  var languageTag = extractLanguageTagFromHTML();

  function updateURLs(parentElement) {
    if (!parentElement) {
      return;
    }
  
    const links = parentElement.querySelectorAll('a[href]');
  
    if (!languageTag || languageTag === 'en' || languageTag === 'pl') {
      return;
    }
  
    links.forEach(link => {
      if (link.closest('div.instruction') || link.closest('div.instruction-mirrors') || link.closest('div.site-attention')) {
        return;
      }
  
      if ((languageTag === 'tr' || languageTag === 'es') && link.classList.contains('mirror-redirect')) {
        return;
      }

      if (languageTag !== 'ru' && link.classList.contains('mirror-visit')) {
        return;
      }
  
      let href = link.getAttribute('href');

      if (/^(https?:|mailto:|tel:)/i.test(href)) return;

      if (href.includes('/topic') && languageTag !== 'ru') {
        return;
      }
  
      if (href === '/') {
        href = `/${languageTag}/`;
      } else {
        const pathSegments = href.split('/');
        
        if (pathSegments.length > 1 && pathSegments[1].length === 2) {
          return;
        }
        
        if (href.startsWith('/')) {
          href = `/${languageTag}${href}`;
        } else {
          href = `/${languageTag}/${href}`;
        }
      }
  
      if (!link.classList.contains('visit') && !link.classList.contains('notupdt')) {
        if (languageTag === 'pt' || languageTag === 'hi') {
          if (!link.classList.contains('review-button') && !link.classList.contains('boxtitle') && !link.closest('.box')) {
            link.setAttribute('href', href);
          }
        } else {
          link.setAttribute('href', href);
        }
      }
      
    });
  }

  const path = window.location.pathname;
  const excludePaths = [
      "/topic",
      "/reviews/",
      "/mirrors/",
      "/privacy-policy",
      "/terms-of-service",
      "/contact-us"
  ];
  
  const isExcluded = excludePaths.some(excludedPath => path.includes(excludedPath));
  const isErrorPage = document.getElementById('error-404');
  
  if (languageTag === 'ru' && !isExcluded && !isErrorPage) {
      updateURLs(sitesList);
  }
  
  if (
    !isErrorPage &&
    !window.location.pathname.includes("/mirrors/") &&
    !window.location.pathname.includes("/reviews/") &&
    !window.location.pathname.includes("/topic") &&
    !window.location.pathname.includes("/privacy-policy") &&
    !window.location.pathname.includes("/terms-of-service") &&
    !window.location.pathname.includes("/contact-us") &&
    window.location.pathname !== "/ru" &&
    window.location.pathname !== "/pt" &&
    window.location.pathname !== "/es" &&
    window.location.pathname !== "/tr" &&
    window.location.pathname !== "/hi" &&
    !window.location.pathname.endsWith("/ru.html") &&
    !window.location.pathname.endsWith("/pt.html") &&
    !window.location.pathname.endsWith("/es.html") &&
    !window.location.pathname.endsWith("/tr.html") &&
    !window.location.pathname.endsWith("/hi.html") &&
    !window.location.pathname.endsWith("/index.html") &&
    !window.location.pathname.endsWith("/")
  ) {
    var currentLanguage = languageTag;
    var langMenuDiv = document.querySelector(".lang-menu");
    
    function getLanguageName(lang) {
        switch (lang) {
            case "en": return "English";
            case "ru": return "Русский";
            case "pt": return "Português";
            case "es": return "Español";
            case "tr": return "Türkçe";
            case "hi": return "हिन्दी";
            default: return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
        }
    }

    function getLocalizedSwitchText(lang) {
      var languageName = getLanguageName(lang);
      switch (currentLanguage) {
          case "en": return "Switch language to " + languageName;
          case "ru": return "Сменить язык на " + languageName;
          case "pt": return "Mudar idioma para " + languageName;
          case "es": return "Cambiar idioma a " + languageName;
          case "tr": return "Dili değiştir " + languageName;
          case "hi": return "भाषा बदलें " + languageName;
          default: return "Switch language to " + languageName;
      }
  }
  
  function createLanguageListItem(lang, path) {
      var ariaLabelText = getLocalizedSwitchText(lang);
      return `
          <li>
              <a href="${path}" 
                 class="lang-switch lang-${lang}" 
                 data-lang="${lang}" 
                 aria-label="${ariaLabelText}">
                  <i class="flagbox"></i>
              </a>
          </li>`;
  }
    
    function checkAndAddLanguage(lang) {
        const path = lang === "en"
            ? window.location.pathname.replace(/^\/[a-z]{2}\//, "/")
            : "/" + lang + window.location.pathname.replace(/^\/[a-z]{2}\//, "/");

        fetch(path, { method: 'HEAD' }).then(response => {
            if (response.ok && currentLanguage !== lang) {
                langMenuDiv.querySelector("ul").innerHTML += createLanguageListItem(lang, path);
            }
        });
    }
    
    var newContent = `
        <div class="selected-lang">
            ${getLanguageName(currentLanguage.charAt(0).toUpperCase() + currentLanguage.slice(1).toLowerCase())}
        </div>
        <ul></ul>`;
    langMenuDiv.innerHTML = newContent;
    
    supportedLanguages.forEach(function(lang) {
        checkAndAddLanguage(lang);
    });
    
  }

  if (
    window.location.pathname.includes("/mirrors/") ||
    window.location.pathname.includes("/reviews/")
  ) {
    document.addEventListener("DOMContentLoaded", () => {
      const langMenuDiv = document.querySelector(".lang-menu");
      const basePath = "/code-parts/site-infos";
      const currentPath = window.location.pathname;
    
      if (!langMenuDiv) return;
    
      function getLanguageName(lang) {
        switch (lang) {
          case "en": return "English";
          case "ru": return "Русский";
          case "es": return "Español";
          case "tr": return "Türkçe";
          case "pl": return "Polski";
          default: return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
        }
      }
    
      function getLocalizedSwitchText(lang) {
        const languageName = getLanguageName(lang);
        switch (languageTag) {
          case "en": return "Switch language to " + languageName;
          case "ru": return "Сменить язык на " + languageName;
          case "es": return "Cambiar idioma a " + languageName;
          case "tr": return "Dili değiştir " + languageName;
          case "pl": return "Zmień język na " + languageName;
          default: return "Switch language to " + languageName;
        }
      }
    
      async function fetchSiteLanguages() {
        const siteKey = currentPath.split("/").pop().replace(".html", "") || "index";
        const jsonFilePath = `${basePath}/${siteKey}.json`;
    
        try {
          const response = await fetch(jsonFilePath);
          if (!response.ok) return [];
          const siteInfo = await response.json();
          let languages = siteInfo.languages
            ? siteInfo.languages.split(",").map((lang) => lang.trim())
            : [];
    
          if (currentPath.includes("/mirrors/")) {
            languages = languages.filter((lang) => ["ru", "en"].includes(lang));
          }
    
          return languages;
        } catch {
          return [];
        }
      }
    
      async function populateLangList() {
        const languages = await fetchSiteLanguages();
    
        if (languages.length === 0) return;
    
        const existingLangList = langMenuDiv.querySelector("ul");
        if (existingLangList) existingLangList.remove();
    
        const langList = document.createElement("ul");
        langMenuDiv.appendChild(langList);
    
        const languageOrder = ["en", "ru", "es", "tr", "pl"];
        const sortedLanguages = languages.sort((a, b) => {
          return languageOrder.indexOf(a) - languageOrder.indexOf(b);
        });
    
        sortedLanguages.forEach((lang) => {
          if (lang === languageTag) return;
    
          const listItem = document.createElement("li");
          const switchEl = document.createElement("a");
    
          switchEl.classList.add("lang-switch", `lang-${lang}`);
          switchEl.dataset.lang = lang;
    
          const path =
            lang === "en"
              ? currentPath.replace(/^\/[a-z]{2}\//, "/")
              : `/${lang}${currentPath.replace(/^\/[a-z]{2}\//, "/")}`;
    
          switchEl.href = path;
    
          switchEl.setAttribute("aria-label", getLocalizedSwitchText(lang));
    
          const flagBox = document.createElement("i");
          flagBox.classList.add("flagbox");
          switchEl.appendChild(flagBox);
    
          listItem.appendChild(switchEl);
          langList.appendChild(listItem);
        });
      }
    
      populateLangList();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const existingLangSwitches = document.querySelectorAll(".lang-switch");
  
    function getLanguageName(lang) {
      switch (lang) {
        case "en": return "English";
        case "ru": return "Русский";
        case "es": return "Español";
        case "tr": return "Türkçe";
        case "pt": return "Português";
        case "hi": return "हिन्दी";
        default: return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
      }
    }
  
    function getLocalizedSwitchText(lang) {
      const languageName = getLanguageName(lang);
      switch (languageTag) {
        case "en": return "Switch language to " + languageName;
        case "ru": return "Сменить язык на " + languageName;
        case "es": return "Cambiar idioma a " + languageName;
        case "tr": return "Dili değiştir " + languageName;
        case "pt": return "Mudar idioma para " + languageName;
        case "hi": return "भाषा बदलें " + languageName;
        default: return "Switch language to " + languageName;
      }
    }
  
    existingLangSwitches.forEach((switchEl) => {
      const lang = switchEl.dataset.lang;
  
      if (!lang || lang === languageTag) return;
  
      const ariaLabelText = getLocalizedSwitchText(lang);
      switchEl.setAttribute("aria-label", ariaLabelText);
    });
  });

  const fallbackLang = 'en';

$(document).ready(function(){
  $('.screentable .screens').slick({
    slidesToShow: 1,
    slidesToScroll: 1,
    autoplay: true,
    speed: 450,
    autoplaySpeed: 5500,
    pauseOnHover: true,
    pauseOnDotsHover: true,
    prevArrow: '<button aria-label="Prev Slide" class="prev-button"><i class="officon chevron left"></i></button>',
    nextArrow: '<button aria-label="Next Slide" class="next-button"><i class="officon chevron right"></i></button>',
    dots: true
  });
});
  
window.onload = function () {
  (function () {
    const pathname = window.location.pathname;
    const excludedPaths = [
      '/ru/reviews',
      '/ru/mirrors',
      '/ru/topic',
      '/privacy-policy',
      '/terms-of-service',
      '/contact-us'
    ];
    const isExcludedPath = excludedPaths.some(path => pathname.includes(path));

    let buttonsContainer = document.querySelector('.buttons-container-page');
    let parentElement = document.querySelector('.ssiodox');
    
    if (!buttonsContainer) {
      buttonsContainer = document.createElement('div');
      buttonsContainer.className = 'buttons-container-page';
    
      if (parentElement) {
        parentElement.appendChild(buttonsContainer);
      } else {
      }
    }
    
    if (isRuPage && !isExcludedPath && !document.querySelector('#button-route-filter')) {
      const routeButtonContainer = document.createElement('div');
      routeButtonContainer.className = 'settings-menu';
      routeButtonContainer.innerHTML =
        '<div class="settings-button" id="button-route-filter" data-title="Скрыть сайты с Ограниченным Доступом"><i id="globe-icon" class="officon route-shield"></i></div>';
    
      buttonsContainer.appendChild(routeButtonContainer);
    
      const routeIcon = document.getElementById('globe-icon');
    
      function toggleRouteBlocks() {
        const routeBlocks = document.querySelectorAll('.box');
        routeBlocks.forEach(block => {
          if (block.querySelector('.route')) {
            block.classList.toggle('hidden-route');
          }
        });
      }
    
      function initializeRouteState() {
        const buttonState = StorageHelper.get('routeButtonState');
        if (buttonState === 'hidden') {
          toggleRouteBlocks();
          routeIcon.classList.replace('route-shield', 'route-shield-slash');
        }
    
        const buttonTitle = StorageHelper.get('routeButtonTitle');
        if (buttonTitle) {
          document.getElementById('button-route-filter').dataset.title = buttonTitle;
        }
      }
    
      const observer = new MutationObserver(() => {
        const buttonState = StorageHelper.get('routeButtonState');
        if (buttonState === 'hidden') {
          const routeBlocks = document.querySelectorAll('.box');
          routeBlocks.forEach(block => {
            if (block.querySelector('.route')) {
              block.classList.add('hidden-route');
            }
          });
        }
      });
    
      observer.observe(document.body, { childList: true, subtree: true });
    
      document.getElementById('button-route-filter').addEventListener('click', function () {
        toggleRouteBlocks();
    
        const currentState = StorageHelper.get('routeButtonState') || 'visible';
        const newState = currentState === 'hidden' ? 'visible' : 'hidden';
        StorageHelper.set('routeButtonState', newState);
    
        routeIcon.classList.toggle('route-shield');
        routeIcon.classList.toggle('route-shield-slash');
    
        const button = document.getElementById('button-route-filter');
        button.dataset.title = routeIcon.classList.contains('route-shield') ?
          'Скрыть сайты с Ограниченным Доступом' : 'Показать сайты с Ограниченным Доступом';
    
        StorageHelper.set('routeButtonTitle', button.dataset.title);
      });
    
      initializeRouteState();
    }
    

    if (!document.querySelector('#back-to-top-btn')) {
      const backToTopButton = document.createElement('button');
      backToTopButton.id = 'back-to-top-btn';
      backToTopButton.setAttribute('aria-label', 'Back to Top Button');
      backToTopButton.className = 'officon chevron btnExit';
      buttonsContainer.appendChild(backToTopButton);

      window.addEventListener("scroll", scrollFunction);

      function scrollFunction() {
        if (window.pageYOffset > 300) {
          if (!backToTopButton.classList.contains("btnEntrance")) {
            backToTopButton.classList.remove("btnExit");
            backToTopButton.classList.add("btnEntrance");
          }
        } else {
          if (backToTopButton.classList.contains("btnEntrance")) {
            backToTopButton.classList.remove("btnEntrance");
            backToTopButton.classList.add("btnExit");
          }
        }
      }

      backToTopButton.addEventListener("click", smoothScrollBackToTop);

      function smoothScrollBackToTop() {
        const targetPosition = 0;
        const startPosition = window.pageYOffset;
        const distance = targetPosition - startPosition;
        const duration = 750;
        let start = null;

        window.requestAnimationFrame(step);

        function step(timestamp) {
          if (!start) start = timestamp;
          const progress = timestamp - start;
          window.scrollTo(0, easeInOutCubic(progress, startPosition, distance, duration));
          if (progress < duration) window.requestAnimationFrame(step);
        }
      }

      function easeInOutCubic(t, b, c, d) {
        t /= d / 2;
        if (t < 1) return c / 2 * t * t * t + b;
        t -= 2;
        return c / 2 * (t * t * t + 2) + b;
      }
    }
  })();
};

// file: /code-parts/search.js
(() => {
  'use strict';

  // ===== Config =====
  const CACHE_KEY = 'search_data';
  const CACHE_DURATION_MS = 1000 * 60 * 60;

  const Lang = (window.languageTag || 'en').toLowerCase();
  const PLACEHOLDER_EN = 'Sites, Modes, Bonuses or Keywords…';
  const PLACEHOLDER_RU = 'Сайты, Режимы, Бонусы или Ключевые Слова…';
  const PLACEHOLDER = Lang === 'ru' ? PLACEHOLDER_RU : PLACEHOLDER_EN;

  const Storage = window.StorageHelper || {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
  };

  let sites = [];
  let siteTranslations = {};
  let fuse = null;

  // Prefer page language (en/ru) over og for display
  function getPreferredLabel(t) {
    if (!t || typeof t !== 'object') return '';
    if (Lang === 'ru') return t.ru || t.en || t.og || '';
    return t.en || t.ru || t.og || '';
  }

  // ===== CSS =====
  function injectStyles() {
    if (document.getElementById('search-menu-ghost-css')) return;
    const css = `
      .menu-search-section .search-field { position: relative; }
      .menu-search-section .search-input {
        width: 100%;
        caret-color: currentColor;
        background: transparent;
        padding-right: 36px;
      }
      .menu-search-section .search-field .ghost {
        position: absolute; left: 3px; right: 44px; top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        transition: opacity .12s linear;
      }
      .menu-search-section .search-field .search-input.has-value + .ghost { opacity: 0; }

      .menu-search-section .search-field .close-button {
        position: absolute; right: 8px; top: 50%;
        transform: translateY(-50%);
        display: none; cursor: pointer; line-height: 0;
      }
      .menu-search-section .search-field .close-button.visible { display: flex; }
      .menu-search-section .search-field .close-button i { pointer-events: none; }

      .menu-search-list.hidden { display: none; }
      .menu-search-list.show { display: flex; }

      .menu-main-section.hidden { display: none; }
      .menu-main-parts { position: relative; }
      .menu-main-part { display: none; }
      .menu-main-part.active { display: flex; }
    `;
    document.head.insertAdjacentHTML('beforeend', `<style id="search-menu-ghost-css">${css}</style>`);
  }

  // ===== HTML-каркас =====
  function injectMenuHTML(rootEl) {
    rootEl.insertAdjacentHTML('afterbegin', `
      <div class="menu-holder" data-search-menu="1">
        <div class="menu-box">
          <div class="menu-search-section">
            <div class="search-field">
              <input id="search-input"
                     class="search-input"
                     type="text"
                     aria-label="Search"
                     autocomplete="off"
                     spellcheck="false"
                     placeholder=" ">
              <span class="ghost" aria-hidden="true">${PLACEHOLDER}</span>
              <div class="close-button" aria-label="Clear search"><i class="officon cross"></i></div>
            </div>
            <div id="site-list" class="menu-search-list hidden"></div>
          </div>
          <div class="menu-main-section">
            <div class="menu-nav-part"><!-- из JSON --></div>
            <div class="menu-main-parts"><!-- из JSON --></div>
          </div>
        </div>
      </div>
    `);
  }

  // ===== Search data =====
  function loadCombinedSearchData() {
    const cached = Storage.get(CACHE_KEY);
    const now = Date.now();

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.expiry && now < parsed.expiry) {
          return Promise.resolve({ configData: parsed.configData, translationData: parsed.translationData });
        }
      } catch (e) { console.warn('Cache parse error:', e); }
    }

    return Promise.all([
      fetch('/code-parts/search-config/config.json').then(r => r.json()),
      fetch('/code-parts/search-config/translations.json').then(r => r.json())
    ]).then(([configData, translationData]) => {
      Storage.set(CACHE_KEY, JSON.stringify({ configData, translationData, expiry: Date.now() + CACHE_DURATION_MS }));
      return { configData, translationData };
    });
  }

  function prepareFuseData() {
    const list = (sites || []).map(path => {
      const t = siteTranslations[path] || {};
      return {
        path,
        label: getPreferredLabel(t) || path,
        en: t.en || '',
        ru: t.ru || '',
        og: t.og || '',
        keywords: (t.keywords || []).join(' '),
        icon: t.icon || ''
      };
    });

    if (window.Fuse) {
      fuse = new Fuse(list, {
        keys: [
          { name: 'en', weight: 0.6 },
          { name: 'ru', weight: 0.6 },
          { name: 'label', weight: 0.5 },
          { name: 'keywords', weight: 0.3 },
          { name: 'og', weight: 0.2 }
        ],
        threshold: 0.4,
        minMatchCharLength: 2,
        ignoreLocation: true
      });
    } else {
      console.warn('Fuse.js not found. Fallback to basic filter.');
      fuse = {
        search(q, { limit = 50 } = {}) {
          const n = (q || '').toLowerCase();
          return list
            .filter(it =>
              (it.label || '').toLowerCase().includes(n) ||
              it.en.toLowerCase().includes(n) ||
              it.ru.toLowerCase().includes(n) ||
              it.og.toLowerCase().includes(n) ||
              it.keywords.toLowerCase().includes(n))
            .slice(0, limit)
            .map(item => ({ item }));
        }
      };
    }
  }

  // ===== Search rendering =====
  function getPathClass(path) {
    const p = (path || '').toLowerCase();
    if (/(trade-skins|sell-skins|trade-items|sell-items|buy-skins|buy-items|instant-sell|marketplaces)(\/|$)/.test(p)) return 'skins';
    if (/topic(\/|$)/.test(p)) return 'topic';
    if (p.includes('/steam/')) return 'steam';
    if (p.includes('/reviews/')) return 'review';
    if (/earning(\/|$)/.test(p)) return 'earning';
    return 'gambling';
  }

  function shouldPrefixPath(path, lang) {
    const isTopic = /\/topic(\/|$)/.test(path);
    const isMirrors = /\/mirrors\//.test(path);
    const isReviews = /\/reviews\//.test(path);
    if (isTopic || isMirrors) return lang === 'ru';
    if (isReviews) return ['ru', 'es', 'tr'].includes(lang);
    return ['ru', 'es', 'tr', 'pt', 'hi'].includes(lang);
  }

  function createSiteItem(path) {
    const t = siteTranslations[path] || {};
    const preferred = getPreferredLabel(t);
    const label = preferred || path; // keep final fallback
    const icon = t.icon;

    const el = document.createElement('div');
    el.className = `site-item show ${getPathClass(path)}`;

    const a = document.createElement('a');
    a.href = shouldPrefixPath(path, Lang) ? `/${Lang}${path}` : path;

    if (icon) {
      const img = document.createElement('img');
      img.src = icon; img.alt = ''; img.className = 'site-icon';
      a.appendChild(img);
    }
    a.appendChild(document.createTextNode(label));
    el.appendChild(a);
    return el;
  }

  // ===== Menu from JSON =====
  function tPick(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return (Lang in obj && obj[Lang]) ? obj[Lang] : (obj.en || obj.def || '');
  }

  function localizeHref(href) {
    const url = (href || '').trim();
    if (!url) return '#';
    if (Lang !== 'ru') return url;
    if (/^(https?:)?\/\//i.test(url) || /^mailto:|^tel:/i.test(url)) return url;
    if (/^\/ru(\/|$)/i.test(url)) return url;
    if (url.startsWith('/')) return '/ru' + url;
    return '/ru/' + url;
  }

  function buildNavAndParts(menuData, menuMainSection) {
    const navPart   = menuMainSection.querySelector('.menu-nav-part');
    const partsHost = menuMainSection.querySelector('.menu-main-parts');
    navPart.innerHTML = '';
    partsHost.innerHTML = '';

    const items = (menuData && Array.isArray(menuData.nav)) ? menuData.nav : [];
    items.forEach((item, idx) => {
      const nav = document.createElement('div');
      nav.className = `menu-nav-item${idx === 0 ? ' active' : ''}`;
      const iconName = (item && item.icon) ? String(item.icon) : 'cs2';
      const spanIcon = document.createElement('span');
      spanIcon.className = `singlemod-icon officon ${iconName}`;
      nav.appendChild(spanIcon);
      nav.appendChild(document.createTextNode(' ' + tPick(item?.title)));
      nav.dataset.index = String(idx);
      navPart.appendChild(nav);

      const part = document.createElement('div');
      part.className = `menu-main-part${idx === 0 ? ' active' : ''}`;
      part.dataset.index = String(idx);

      const groups = Array.isArray(item?.groups) ? item.groups : [];
      groups.forEach(group => {
        const sectionName = document.createElement('div');
        sectionName.className = 'menu-main-section-name menu-main-section-mame';
        const span = document.createElement('span');
        span.textContent = tPick(group?.name) || '';
        sectionName.appendChild(span);
        part.appendChild(sectionName);

        const reviewsWrap = document.createElement('div');
        reviewsWrap.className = 'menu-main-reviews';

        const ruArr = group?.['reviews-ru'];
        const enArr = group?.reviews;
        const reviewsData =
          (Lang === 'ru' && Array.isArray(ruArr) && ruArr.length) ? ruArr :
          (Array.isArray(enArr) ? enArr : []);

        reviewsData.forEach(rv => {
          const a = document.createElement('a');
          a.className = 'menu-main-reviews-item';
          a.href = rv?.href || '#';

          const logo = document.createElement('div');
          logo.className = 'logobg';
          const img = document.createElement('img');
          img.src = rv?.img || '';
          img.setAttribute('draggable','false');
          img.alt = rv?.alt || '';
          logo.appendChild(img);

          const content = document.createElement('div');
          content.className = 'content';

          a.appendChild(logo);
          a.appendChild(content);
          reviewsWrap.appendChild(a);
        });

        part.appendChild(reviewsWrap);
      });

      const solidList = document.createElement('div');
      solidList.className = 'menu-main-solid-list';
      (Array.isArray(item?.solid) ? item.solid : []).forEach(si => {
        const a = document.createElement('a');
        a.className = 'menu-main-solid-item';
        a.href = localizeHref(si?.href || '#');
        a.textContent = tPick(si?.text) || '';
        solidList.appendChild(a);
      });
      part.appendChild(solidList);

      partsHost.appendChild(part);
    });

    navPart.addEventListener('click', (e) => {
      const el = e.target.closest('.menu-nav-item');
      if (!el) return;
      const idx = el.dataset.index;
      navPart.querySelectorAll('.menu-nav-item').forEach(n => n.classList.toggle('active', n.dataset.index === idx));
      partsHost.querySelectorAll('.menu-main-part').forEach(p => p.classList.toggle('active', p.dataset.index === idx));
    });
  }

  // ===== Pages visibility =====
  function setPagesSearchHidden(flag) {
    const nodes = document.querySelectorAll('.pages');
    nodes.forEach(n => {
      n.classList.toggle('search_hidden', !!flag);
    });
  }

  // ===== Main =====
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('.ssiodox');
    if (!root) { console.warn('Container .ssiodox not found'); return; }

    injectStyles();
    if (!root.querySelector('.menu-holder[data-search-menu="1"]')) injectMenuHTML(root);

    const menuHolder      = root.querySelector('.menu-holder[data-search-menu="1"]');
    const menuBox         = menuHolder.querySelector('.menu-box');
    const menuMainSection = menuHolder.querySelector('.menu-main-section');
    const navPart         = menuMainSection.querySelector('.menu-nav-part');
    const partsHost       = menuMainSection.querySelector('.menu-main-parts');

    const searchInput  = menuHolder.querySelector('#search-input');
    const closeButton  = menuHolder.querySelector('.search-field .close-button');
    const siteList     = menuHolder.querySelector('#site-list');
    const searchEnabler= document.querySelector('.search-enabler');

    function showSiteList(show) {
      siteList.classList.toggle('hidden', !show);
      siteList.classList.toggle('show', !!show);
    }
    function syncGhost() {
      const has = !!searchInput.value.trim();
      searchInput.classList.toggle('has-value', has);
      closeButton.classList.toggle('visible', has);
      if (menuMainSection) menuMainSection.classList.toggle('hidden', has);
    }
    function resetSearchUI() {
      searchInput.value = '';
      searchInput.classList.remove('has-value');
      closeButton.classList.remove('visible');
      showSiteList(false);
      siteList.innerHTML = '';
      if (menuMainSection) menuMainSection.classList.remove('hidden');
      const firstNav  = navPart.querySelector('.menu-nav-item[data-index="0"]');
      const firstPart = partsHost.querySelector('.menu-main-part[data-index="0"]');
      if (firstNav && firstPart) {
        navPart.querySelectorAll('.menu-nav-item').forEach(n => n.classList.toggle('active', n === firstNav));
        partsHost.querySelectorAll('.menu-main-part').forEach(p => p.classList.toggle('active', p === firstPart));
      }
    }
    function renderResults(term) {
      siteList.innerHTML = '';
      if (!term) { showSiteList(false); return; }
      const results = fuse ? fuse.search(term, { limit: 50 }) : [];
      if (!results.length) { showSiteList(false); return; }
      const frag = document.createDocumentFragment();
      results.forEach(({ item }) => frag.appendChild(createSiteItem(item.path)));
      siteList.appendChild(frag);
      showSiteList(true);
    }

    function openSearch() {
      menuHolder.classList.add('active');
      setPagesSearchHidden(true);
      searchInput.focus();
      const len = searchInput.value.length;
      try { searchInput.setSelectionRange(len, len); } catch {}
      syncGhost();
      if (searchInput.value) renderResults(searchInput.value.trim());
    }
    function closeSearch() {
      menuHolder.classList.remove('active');
      setPagesSearchHidden(false);
      resetSearchUI();
    }

    if (searchEnabler) {
      searchEnabler.addEventListener('click', () => {
        if (menuHolder.classList.contains('active')) {
          closeSearch();
        } else {
          openSearch();
        }
      });
    }

    menuHolder.addEventListener('click', (e) => {
      if (!menuBox.contains(e.target)) closeSearch();
    });
    menuBox.addEventListener('click', (e) => e.stopPropagation());

    closeButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetSearchUI();
      searchInput.focus();
    });

    searchInput.addEventListener('input', () => { syncGhost(); renderResults(searchInput.value.trim()); });
    searchInput.addEventListener('focus', () => { syncGhost(); showSiteList(!!searchInput.value.trim()); });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSearch();
    });

    Promise.all([
      loadCombinedSearchData(),
      fetch('/code-parts/search-config/menu-build.json').then(r => r.json()).catch(() => ({ nav: [] }))
    ]).then(([{ configData, translationData }, menuData]) => {
      sites = configData?.sites || [];
      siteTranslations = translationData || {};
      prepareFuseData();

      buildNavAndParts(menuData || { nav: [] }, menuMainSection);

      const q = new URLSearchParams(window.location.search).get('s');
      if (q) {
        openSearch();
        searchInput.value = q;
        syncGhost();
        renderResults(q.trim());
        searchInput.focus();
        try { searchInput.setSelectionRange(q.length, q.length); } catch {}
      } else {
        syncGhost();
      }
    });
  });
})();

const btnfaq = document.getElementById("btnfaq");

if (btnfaq) {
  btnfaq.onclick = function () {
    const targetDiv = document.getElementById("FAQ");

    if (targetDiv) {
      const targetDivComputedStyle = window.getComputedStyle(targetDiv);
      const targetDivPaddingTop = parseFloat(targetDivComputedStyle.paddingTop);
      const targetDivPaddingBottom = parseFloat(targetDivComputedStyle.paddingBottom);
      const targetDivHeight = targetDiv.scrollHeight + targetDivPaddingTop + targetDivPaddingBottom;

      const currentHeight = parseFloat(targetDiv.style.height) || 0;

      if (currentHeight === 0) {
        targetDiv.style.height = targetDivHeight * 2 + "px";
        btnfaq.classList.add("active");
        targetDiv.classList.add("active");
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        targetDiv.style.height = "0px";
        btnfaq.classList.remove("active");
        targetDiv.classList.remove("active");
      }
    }
  };
}

const href = window.location.href;

const isExcludedPage = [
  "newest",
  "newest.html",
  "/reviews/",
  "/mirrors/",
  "/privacy-policy",
  "/topic",
  "/terms-of-service",
  "/contact-us"
].some(exclusion => path.endsWith(exclusion) || href.includes(exclusion));

if (!isExcludedPage) {
  function createElement(tag, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  }

  const lang = typeof languageTag !== 'undefined' ? languageTag : 'en';
  const cacheKey = 'newest_boxes_json';
  const cacheDuration = 12 * 60 * 60 * 1000; // 12h

  const titles = {
    ru: 'Недавно Добавленные',
    tr: 'Yeni Eklenenler',
    pt: 'Recentemente Adicionados',
    es: 'Recientemente Añadidos',
    hi: 'हाल ही में जोड़ा गया',
  };

  const moreText = lang === 'ru' ? 'Больше' : 'More';
  const moreHref = lang === 'ru' ? '/ru/newest' : '/newest';

  const buildBox = (entry) => {
  const reviewHref = lang === 'ru' ? `/ru${entry.reviewHref}` : entry.reviewHref;
  const visitHref = entry.visitHref;
  const bonus = lang === 'ru' ? entry.bonus_ru : entry.bonus;
  const alt = lang === 'ru' ? `Логотип ${entry.site}` : `${entry.site} logo`;
  const labelReview = lang === 'ru' ? `Читать Обзор ${entry.site}` : `Read Review ${entry.site}`;
  const labelVisit = lang === 'ru' ? `Перейти на ${entry.site}` : `Visit ${entry.site}`;

  const box = document.createElement('div');
  box.className = 'box';
  box.id = entry.site;

  const bonusHTML = bonus ? `<div class="best">${bonus}</div>` : '';

  box.innerHTML = `
    <div class="logobg">
      <a href="${reviewHref}"><img src="${entry.logoSrc}" loading="lazy" draggable="false" alt="${alt}"></a>
      ${bonusHTML}
    </div>
    <div class="content">
      <a href="${reviewHref}" class="review-button" aria-label="${labelReview}"><span>Read Review</span></a>
      <a href="${visitHref}" aria-label="${labelVisit}" target="_blank" rel="noopener" class="review-button visit"><span>Visit</span></a>
    </div>
  `;

  return box;
  };



  const applyBoxes = (json) => {
    const newestBoxesDiv = createElement('div', 'newest-boxes');
    if (lang === 'ru') newestBoxesDiv.classList.add('lang-ru');
    const newestBoxesTitleDiv = createElement('div', 'newest-boxes-title');
    const newestBoxesIconDiv = createElement('div', 'singlemod-icon officon newest');
    const newestBoxesTitleBoxDiv = createElement('div', 'newest-boxes-title-box');

    const titleSpan = document.createElement('span');
    titleSpan.textContent = titles[lang] || 'Recently Added';

    const newestBoxesMoreLink = createElement('a', 'newest-boxes-more');
    newestBoxesMoreLink.href = moreHref;
    newestBoxesMoreLink.textContent = moreText;

    newestBoxesTitleBoxDiv.append(newestBoxesIconDiv, titleSpan);
    newestBoxesTitleDiv.appendChild(newestBoxesTitleBoxDiv);
    newestBoxesTitleDiv.appendChild(newestBoxesMoreLink);
    newestBoxesDiv.appendChild(newestBoxesTitleDiv);

    json.forEach(entry => {
      newestBoxesDiv.appendChild(buildBox(entry));
    });

    const sliderContainer = document.querySelector('.slider-container');
    const insertBeforeElement = sliderContainer ? sliderContainer.nextSibling : document.querySelector('footer');
    insertBeforeElement.parentNode.insertBefore(newestBoxesDiv, insertBeforeElement);
  };

  const cached = StorageHelper.getWithExpiry(cacheKey);
  if (cached) {
    applyBoxes(cached);
  } else {
    const jsonPath = '/code-parts/newest-boxes.json';

    fetch(jsonPath)
      .then((res) => res.json())
      .then((json) => {
        StorageHelper.setWithExpiry(cacheKey, json, cacheDuration);
        applyBoxes(json);
      })
      .catch(console.error);
  }
}

$(document).ready(function() {

  var excludedPages = ['/terms-of-service', '/privacy-policy', '/contact-us'];
  var path = window.location.pathname;
  var excluded = false;
  excludedPages.forEach(function(excludedPage) {
    if (path.endsWith(excludedPage) || path.endsWith(excludedPage + '.html')) {
      excluded = true;
    }
  });
  if (excluded) {
    return;
  }

  var sliderItems = [
    { href: '/', src: '/img/best-gambling-sites-slide-2024.webp', label: 'Best Gambling Sites' },
    { href: '/rust', src: '/img/best-rust-sites-slide-2024.webp', label: 'Best Rust Sites' },
    { href: '/earning/offerwalls', src: '/img/earn-skins-slider-2024.webp', label: 'Best Offerwall Sites' }
  ];

  if (languageTag === 'ru') {
    sliderItems = [
      { href: '/ru', src: '/img/best-gambling-sites-slide-2024-ru.webp', label: 'Лучшие Гемблинг Сайты CS2' },
      { href: '/ru/rust', src: '/img/best-rust-sites-slide-2024-ru.webp', label: 'Лучшие Сайты Rust' },
      { href: '/ru/earning/offerwalls', src: '/img/earn-skins-slider-2024-ru.webp', label: 'Лучшие Сайты с Заданиями' }
    ];
  }

  var sliderContainer = $('<div class="slider-container"></div>');
  sliderItems.forEach(function(item) {
    sliderContainer.append(createSliderItem(item.href, item.src, item.label));
  });

  if ($('.boxes-holder').length > 0) {
    var mainInfobox = $('.main-infobox');
    sliderContainer.insertAfter(mainInfobox);
  } else if ($('.main-infobox').length > 0) {
    var mainInfobox = $('.main-infobox');
    sliderContainer.insertBefore(mainInfobox);
} else if (path.includes('/reviews/') || path.includes('/mirrors/')) {
    var boxReview = $('.boxreview');
    boxReview.append(sliderContainer);
}  else if (path.includes('/topic/') && $('.topicpage').length > 0) {
    var boxTopic = $('.topicpage');
    boxTopic.append(sliderContainer);
} else if ($('.newest-boxes').length > 0) {
    var newestBoxes = $('.newest-boxes');
    sliderContainer.insertBefore(newestBoxes);
} else {
    var footer = $('footer');
    sliderContainer.insertBefore(footer);
}


  sliderContainer.slick({
    slidesToShow: 1,
    slidesToScroll: 1,
    autoplay: true,
    speed: 450,
    autoplaySpeed: 6000,
    pauseOnHover: true,
    pauseOnDotsHover: true,
    prevArrow: '<button aria-label="Prev Slide" class="prev-button"><i class="officon chevron left"></i></button>',
    nextArrow: '<button aria-label="Next Slide" class="next-button"><i class="officon chevron right"></i></button>',
    dots: true,
    customPaging: function(slider, i) {
      return '<button class="slider-dot">' + (i + 1) + '</button>';
    },
  });

  function createSliderItem(href, src, label) {
    return '<a href="' + href + '" class="slider-banner" aria-label="Visit ' + label + '"><img src="' + src + '" alt="' + label + '" draggable="false"></a>';
  }
  const sliderlinks = document.querySelector('.slider-container');
  if (!languageTag === 'pl') { 
    updateURLs(sliderlinks);
  }
});

$(document).ready(function() {
  $(window).on('scroll resize', function() {
      var $pages = $('.pages');
      if ($pages.length && $(window).width() <= 1365) {
          if ($(window).scrollTop() >= 100) {
              $pages.addClass('hidden');
          } else {
              $pages.removeClass('hidden');
          }
      }
  });

  $(window).trigger('scroll');
});

/* eslint-disable */
(function(){
  const path = window.location.pathname;

  // REVIEW PAGE: навешиваем клики на уже сгенерированный оффлайн-блок
  if (path.includes('/reviews/')) {
    function highlight(targetEl){
      if (!targetEl) return;
      targetEl.classList.remove('navmark');
      void targetEl.offsetWidth;
      targetEl.classList.add('navmark');
      targetEl.addEventListener('animationend', function h(){ targetEl.classList.remove('navmark'); targetEl.removeEventListener('animationend', h); });
    }
    function scrollToEl(el, offset){
      const rect = el.getBoundingClientRect();
      const top = window.scrollY + rect.top - (offset||150);
      window.scrollTo({ top, behavior:'smooth' });
    }

    // rating click → прокрутка к .ratingsumm (без cursor: pointer)
    (function bindRating(){
      const ratingTrigger = document.querySelector('.box.main .rating');
      const ratingTarget  = document.querySelector('.ratingsumm');
      if (!ratingTrigger || !ratingTarget) return;
      ratingTrigger.addEventListener('click', ()=>{ scrollToEl(ratingTarget, 200); highlight(ratingTarget); });
    })();

    // nav-review clicks
    const nav = document.querySelector('.box-extra-links .nav-review');
    if (nav){
      const lis = Array.from(nav.querySelectorAll('li'));
      lis.forEach(li=>{
        li.addEventListener('click', ()=>{
          const sel = li.getAttribute('data-target');
          const el  = sel ? document.querySelector(sel) : null;
          if (el){ scrollToEl(el, 150); }
          if (sel==='.smallreview') highlight(document.querySelector('.smallreview'));
          else if (sel==='.instruction') highlight(document.querySelector('.instruction'));
          else if (el) highlight(el);

          if (sel==='.sitedetails'){
            document.querySelectorAll('.sitedetails .sitepros').forEach(sp=>sp.classList.toggle('active'));
            if (window.innerWidth >= 1365){
              const parent = document.querySelector('.sitedetails');
              if (parent){
                let max=0;
                parent.querySelectorAll('.sitepros .methodlist').forEach(m=>{ max = Math.max(max, m.offsetHeight || 0); });
                const one = parent.querySelector('.sitepros');
                const total = (one ? one.offsetHeight : 0) + max;
                const cur = parseInt(window.getComputedStyle(parent).height) || 0;
                if (parent.querySelectorAll('.sitepros.active').length){ if (cur < total) parent.style.height = total+'px'; }
                else { parent.style.height = ''; }
              }
            }
          }
        });
      });

      // подсветка активного пункта при скролле
      function highlightCurrent(){
        const threshold = 300;
        let current = -1;
        lis.forEach((li, idx)=>{
          const sel = li.getAttribute('data-target');
          const el  = sel ? document.querySelector(sel) : null;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          if (rect.top - threshold <= 0) current = idx;
        });
        if (current === -1) current = 0;
        lis.forEach((li,i)=> li.classList.toggle('current', i===current));
      }
      highlightCurrent();
      window.addEventListener('scroll', highlightCurrent);
      window.addEventListener('resize', highlightCurrent);
    }

  // TOPIC PAGE: оставляем кликабельность как была
  } else if (path.includes('/topic/')) {
    const navReview = document.querySelector('.nav-review.blog');
    if (!navReview) return;

    const navItems = navReview.querySelectorAll('li');
    const textColInfos = document.querySelectorAll('.text-col-info');
    if (navItems.length !== textColInfos.length) return;

    const threshold = 220;
    navItems.forEach((li, index) => {
      const targetElement = textColInfos[index];
      li.addEventListener('click', () => {
        const rect = targetElement.getBoundingClientRect();
        const offsetTop = window.scrollY + rect.top - 150;
        window.scrollTo({ top: offsetTop, behavior: 'smooth' });
        targetElement.classList.remove('navmark'); void targetElement.offsetWidth;
        targetElement.classList.add('navmark');
        targetElement.addEventListener('animationend', function handler() {
          targetElement.classList.remove('navmark');
          targetElement.removeEventListener('animationend', handler);
        });
      });
    });

    function highlightTopicSection() {
      let currentIndex = -1;
      textColInfos.forEach((section, index) => {
        const rect = section.getBoundingClientRect();
        if (rect.top - threshold <= 0) currentIndex = index;
      });
      if (currentIndex === -1) currentIndex = 0;
      navItems.forEach((li, index) => { li.classList.toggle('current', index === currentIndex); });
    }
    highlightTopicSection();
    window.addEventListener('scroll', highlightTopicSection);
    window.addEventListener('resize', highlightTopicSection);
  }
})();

const boxes = Array.from(document.querySelectorAll('.box:not(.main)'));

boxes.forEach((box) => {
  const logoLink = box.querySelector('.logobg a[href]');
  if (!logoLink) return;

  const href = logoLink.getAttribute('href');
  const h4 = box.querySelector('.content h4:first-child');
  if (!h4) return;

  // Если в h4 уже есть ссылка — выходим, чтобы не делать вложенные <a>
  if (h4.querySelector('a')) return;

  const a = document.createElement('a');
  a.href = href;
  a.classList.add('boxtitle');

  // Переносим ВСЁ текущее содержимое h4 внутрь ссылки (сохраняет разметку/иконки и т.п.)
  while (h4.firstChild) {
    a.appendChild(h4.firstChild);
  }

  h4.appendChild(a);
});


const categorySelector = document.querySelector('.category-selector');
const categoryContentURL = '/code-parts/category-import/category-contents.json';
const builderURL = '/code-parts/category-import/category-builder.json';
let cachedCategoryContent = null;
let pendingCategories = [];

function loadAndApplyTranslations(languageTag) {
  const cacheKey = `category_translations`;
  const cachedTranslations = JSON.parse(StorageHelper.get(cacheKey));

  if (cachedTranslations) {
    const translations = cachedTranslations[languageTag];
    applyTranslations(document.body, languageTag, translations);
    updateURLs(categorySelector);
  } else {
    fetch(`/code-parts/category-import/category-translations.json`)
      .then(res => res.json())
      .then(allTranslations => {
        StorageHelper.set(cacheKey, JSON.stringify(allTranslations));
        const translations = allTranslations[languageTag];
        applyTranslations(document.body, languageTag, translations);
        updateURLs(categorySelector);
      });
  }
}

function applyTranslations(element, languageTag, translations) {
  translateElements(element, languageTag, translations);

  new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          translateElements(node, languageTag, translations);
        }
      });
    });
  }).observe(element, { childList: true, subtree: true });
}

function translateElements(element, languageTag, translations) {
  if (!translations) return;

  element.querySelectorAll('.category-box-content span, .category .submenu li a, .category .submenu li .nonredir').forEach(el => {
    const text = el.textContent.trim();
    if (el.classList.contains('translated')) return;

    if (languageTag === 'tr') {
      const key = text.toLocaleLowerCase('tr-TR');
      el.innerHTML = translations[key] || translations[text] || text;
    } else if (languageTag !== 'en' && languageTag !== 'pl' && translations[text]) {
      el.innerHTML = translations[text];
    }
    el.classList.add('translated');
  });
}

function loadCategoryContent(category) {
  const link = category.querySelector('.category-box');
  const href = link?.getAttribute('href');
  if (!href) return;

  const categoryKey = href.replace(/^\/+/, '').split('/')[0];

  const insertCategoryContent = (data) => {
    const catData = data.categories?.[categoryKey];
    if (!catData?.items) return;
    category.insertAdjacentHTML('beforeend', generateCategoryHTML(catData.items));
    loadAndApplyTranslations(languageTag);
  };

  if (cachedCategoryContent) {
    insertCategoryContent(cachedCategoryContent);
  } else {
    pendingCategories.push({ insertCategoryContent });

    if (pendingCategories.length === 1) {
      fetch(categoryContentURL)
        .then(res => res.json())
        .then(data => {
          cachedCategoryContent = data;
          pendingCategories.forEach(({ insertCategoryContent }) => insertCategoryContent(data));
          pendingCategories = [];
        })
        .catch(err => {
          console.error('Failed to load category content:', err);
          pendingCategories = [];
        });
    }
  }
}

function generateCategoryHTML(items) {
  return `
    <ul class="submenu">
      ${items.map(item => `
        <li class="big-category">
          <a href="${item.url}">${item.title}</a>
          ${item.children ? `
            <ul class="submenu2">
              ${item.children.map(child => `<li><a href="${child.url}">${child.title}</a></li>`).join('')}
            </ul>
          ` : ''}
        </li>
      `).join('')}
    </ul>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.category').forEach(loadCategoryContent);
  loadAndApplyTranslations(languageTag);
});


document.addEventListener("DOMContentLoaded", function () {
  if (
    !window.location.pathname.includes("/skins/") &&
    !window.location.pathname.includes("/items/") &&
    !window.location.pathname.includes("/cases/") &&
    !window.location.pathname.includes("/charms/") &&
    !window.location.pathname.includes("/stickers/") &&
    !window.location.pathname.includes("/collections/") &&
    !window.location.pathname.includes("/guides/") &&
    !window.location.pathname.includes("/sticker-crafts/") &&
    !window.location.pathname.includes("/reviews") &&
    !window.location.pathname.includes("/mirrors") &&
    !window.location.pathname.includes("/privacy-policy") &&
    !window.location.pathname.includes("/terms-of-service") &&
    !window.location.pathname.includes("/contact-us") &&
    !isErrorPage
    
  ) {
    const boxContainer = document.querySelector(".category-selector");
    const pages = document.querySelector(".pages");
    const SpaceboxContainer = document.querySelector(".spaceblock");
    const buttonsContainer = document.createElement("div");
    const prevButtonContainer = document.createElement("button");
    const nextButtonContainer = document.createElement("button");
    const boxes = boxContainer.querySelectorAll(".category-box");
    const boxWidth = boxes[0].offsetWidth + 2 * 9;
    const containerWidth = boxWidth * 4;
    let scrollPosition = 0;
    let buttonScrollPosition = 0;

    buttonsContainer.classList.add("buttons-container");
    prevButtonContainer.classList.add("controls-button");
    prevButtonContainer.setAttribute("aria-label", "Prev Category");
    prevButtonContainer.innerHTML = '<i class="officon chevron left"></i>';
    nextButtonContainer.classList.add("controls-button");
    nextButtonContainer.setAttribute("aria-label", "Next Category");
    nextButtonContainer.innerHTML = '<i class="officon chevron right"></i>';

    buttonsContainer.appendChild(prevButtonContainer);
    buttonsContainer.appendChild(nextButtonContainer);

    boxContainer.parentNode.insertBefore(buttonsContainer, SpaceboxContainer);

    boxContainer.style.width = `${containerWidth}px`;

    prevButtonContainer.addEventListener("click", () => {
      scrollPosition -= boxWidth;
      scrollPosition = Math.max(scrollPosition, 0);
      boxContainer.scroll({ left: scrollPosition, behavior: "smooth" });
      buttonScrollPosition = scrollPosition;
    });

    nextButtonContainer.addEventListener("click", () => {
      scrollPosition += boxWidth;
      scrollPosition = Math.min(
        scrollPosition,
        boxContainer.scrollWidth - containerWidth
      );
      boxContainer.scroll({ left: scrollPosition, behavior: "smooth" });
      buttonScrollPosition = scrollPosition;
    });

    let isMouseDown = false;
    let startX = 0;
    let scrollLeft = 0;

    boxContainer.addEventListener("click", (e) => {
      const targetBox = e.target.closest(".category-box");
      const bigCategoryLink = e.target.closest(".big-category a");
      const submenu2 = e.target.closest(".submenu2");

      if (submenu2) {
          return;
      }

      if (targetBox) {
          const parentListItem = targetBox.closest(".category");
          const submenu = parentListItem.querySelector(".submenu");

          const isTargetBoxNewest = targetBox.classList.contains("newest");

          if (!isTargetBoxNewest && window.innerWidth <= 1365) {
              e.preventDefault();
          }

          const allTargetBoxes = document.querySelectorAll(".category-box");
          allTargetBoxes.forEach((box) => {
              if (box !== targetBox) {
                  box.classList.remove("current");
                  const parentListItem = box.closest(".category");
                  const siblingSubmenu = parentListItem.querySelector(".submenu");
                  if (siblingSubmenu) {
                      siblingSubmenu.classList.remove("current");
                  }
              }
          });
          boxContainer.classList.remove("current");

          targetBox.classList.toggle("current");

          const isActive = Array.from(allTargetBoxes).some((box) =>
              box.classList.contains("current")
          );

          if (isActive) {
              boxContainer.classList.add("current");
              pages.classList.add("hardplaced");
          }

          if (submenu && window.innerWidth <= 1365) {
              submenu.classList.toggle("current");
              centerSubmenu(submenu);
          }
      }

      if (bigCategoryLink) {
        const bigCategory = bigCategoryLink.closest(".big-category");
        const hasSubmenu2 = bigCategory.querySelector(".submenu2");
    
        if (hasSubmenu2 && window.innerWidth <= 1365) {
            e.preventDefault();
        }
    
        const isActive = bigCategory.classList.contains("active");
    
        const bigCategories = document.querySelectorAll(".big-category.active");
        bigCategories.forEach((item) => {
            item.classList.remove("active");
            const submenu2 = item.querySelector(".submenu2");
            if (submenu2) {
                submenu2.classList.remove("current");
            }
        });
    
        if (!isActive) {
            bigCategory.classList.add("active");
            const submenu2 = bigCategory.querySelector(".submenu2");
            if (submenu2) {
                submenu2.classList.add("current");
            }
        }
    }
    

      if (e.target.closest(".submenu2 a")) {
          return;
      }
  });
  
  var categorySelector = document.querySelector('.category-selector');
    categorySelector.addEventListener('click', function(event) {
        if (event.target === categorySelector) {
            const boxescurrent = boxContainer.querySelectorAll('.category-box.current');
            const submenucurrent = boxContainer.querySelectorAll('.submenu.current');
            boxContainer.classList.remove('current');
            pages.classList.remove("hardplaced");

            boxescurrent.forEach(function(box) {
                box.classList.remove('current');
            });

            submenucurrent.forEach(function(submenu) {
                submenu.classList.remove('current');
            });

            const activeBigCategories = document.querySelectorAll('.big-category.active');
            activeBigCategories.forEach((item) => {
                item.classList.remove('active');
                const submenu2 = item.querySelector(".submenu2");
                if (submenu2) {
                    submenu2.classList.remove('current');
                }
            });
        }
    });
  
    boxContainer.addEventListener("scroll", () => {
      if (boxContainer.scrollLeft === 0) {
        prevButtonContainer.classList.add("disabled");
      } else {
        prevButtonContainer.classList.remove("disabled");
      }

      const maxScrollLeft =
        boxContainer.scrollWidth - boxContainer.clientWidth;
      if (boxContainer.scrollLeft >= maxScrollLeft - 1) {
        nextButtonContainer.classList.add("disabled");
      } else {
        nextButtonContainer.classList.remove("disabled");
      }
    });

    if (boxContainer.scrollLeft === 0) {
      prevButtonContainer.classList.add("disabled");
    }
    const maxScrollLeft = boxContainer.scrollWidth - boxContainer.clientWidth;
    if (boxContainer.scrollLeft >= maxScrollLeft - 1) {
      nextButtonContainer.classList.add("disabled");
    }

    boxContainer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      isMouseDown = true;
      startX = e.pageX - boxContainer.offsetLeft;
      scrollLeft = boxContainer.scrollLeft;
    });

    boxContainer.addEventListener("mousemove", (e) => {
      if (!isMouseDown) return;
      e.preventDefault();
      const x = e.pageX - boxContainer.offsetLeft;
      const walk = (x - startX) * 0.6;
      const newScrollLeft = scrollLeft - walk;
      boxContainer.scrollLeft = newScrollLeft;
      buttonScrollPosition = newScrollLeft;
    });

    boxContainer.addEventListener("mouseup", () => {
      isMouseDown = false;
    });

    boxContainer.addEventListener("mouseleave", () => {
      isMouseDown = false;
    });

    boxContainer.addEventListener("touchstart", (e) => {
      const touch = e.touches[0];
      isMouseDown = true;
      startX = touch.pageX - boxContainer.offsetLeft;
      scrollLeft = boxContainer.scrollLeft;
      startY = touch.pageY;
  });
  
  boxContainer.addEventListener("touchmove", (e) => {
      if (!isMouseDown) return;
  
      const touch = e.touches[0];
      const x = touch.pageX - boxContainer.offsetLeft;
      const y = touch.pageY;
  
      const horizontalMove = Math.abs(x - startX);
      const verticalMove = Math.abs(y - startY);
  
      if (horizontalMove > verticalMove) {
          const walk = (x - startX) * 1.2;
          const newScrollLeft = scrollLeft - walk;
          boxContainer.scrollLeft = newScrollLeft;
          buttonScrollPosition = newScrollLeft;
      }
  });
  
  boxContainer.addEventListener("touchend", () => {
      isMouseDown = false;
  });
  

  var categorySelector = document.querySelector("div.category-selector");
  var categoryElements = Array.from(
    categorySelector.querySelectorAll("div.category-selector > div.category")
  );
  
  categoryElements.sort(function (a, b) {
    var aCategoryBox = a.querySelector("a.category-box, div.category-box");
    var bCategoryBox = b.querySelector("a.category-box, div.category-box");
  
    var aWeight = (aCategoryBox.classList.contains("active") || aCategoryBox.classList.contains("locked") ? -2 : 0) +
    (aCategoryBox.classList.contains("last") ? 1 : 0);
    var bWeight = (bCategoryBox.classList.contains("active") || bCategoryBox.classList.contains("locked") ? -2 : 0) +
    (bCategoryBox.classList.contains("last") ? 1 : 0);

    if (aWeight !== bWeight) {
      return aWeight - bWeight;
    }
  
    return Math.random() - 0.5;
  });
  
  categorySelector.innerHTML = "";
  
  categoryElements.forEach(function (element) {
    categorySelector.appendChild(element);
  });
  
  

    buttonsContainer.scrollLeft = buttonScrollPosition;

    function centerSubmenu(submenu) {
      const screenWidth = window.innerWidth;
      const submenuWidth = submenu.offsetWidth;
      const scrollLeft = boxContainer.scrollLeft;

      const offsetX = (screenWidth - submenuWidth) / 2 + scrollLeft;
      submenu.style.left = `${offsetX}px`;
    }
  }
});

// /assets/js/main-mode-insert.js
$(function () {
  // Общие настройки для всех слайдеров
  const mainSliderOptions = {
    slidesToShow: 4,
    slidesToScroll: 1,
    autoplay: true,
    infinite: true,
    speed: 450,
    autoplaySpeed: 5500,
    pauseOnHover: true,
    prevArrow:
      '<button aria-label="Prev Slide" class="prev-button controls-button"><i class="officon chevron left"></i></button>',
    nextArrow:
      '<button aria-label="Next Slide" class="next-button controls-button"><i class="officon chevron right"></i></button>',
    dots: false,
    responsive: [
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 3
        }
      },
      {
        breakpoint: 600,
        settings: {
          slidesToShow: 2
        }
      }
    ]
  };

  function initModesSlider($el) {
    if (!$el.length || $el.hasClass('slick-initialized')) return;

    $el.slick(mainSliderOptions);

    const sliderEl = $el.get(0);
    if (typeof updateURLs === 'function' && sliderEl) {
      updateURLs(sliderEl);
    }
  }

  // 1) Главный слайдер вверху страницы
  initModesSlider($('.main-mode-selection'));

  // 2) Вставка селекшна после 12-го видимого бокса и инициализация slick
  $('.boxes-holder').each(function () {
    const $boxesHolder = $(this);
    const $allBoxes = $boxesHolder.children('.box');
    const $visibleBoxes = $allBoxes.filter(':not(.hidden):not(.hidden-route)');

    if (!$boxesHolder.closest('.main-page').length && $visibleBoxes.length >= 12) {
      const importPath =
        typeof languageTag !== 'undefined' && languageTag === 'ru'
          ? '/code-parts/micro-parts/main-mode-import-ru.html'
          : '/code-parts/micro-parts/main-mode-import.html';

      $.get(importPath, function (html) {
        const $importedContent = $(html);
        const $anchor = $visibleBoxes.eq(11);

        if ($anchor.length) {
          $anchor.after($importedContent);
        } else {
          $boxesHolder.append($importedContent);
        }

        // Если внутри импортированного блока есть .main-mode-selection — инициализируем её
        const $slider = $importedContent.filter('.main-mode-selection').length
          ? $importedContent.filter('.main-mode-selection')
          : $importedContent.find('.main-mode-selection');

        initModesSlider($slider);
      });
    }
  });
});


window.initPayments = function () {
  const basePath = "/code-parts/site-infos";
  const boxesHolder = document.querySelector(".boxes-holder");
  const paymentsButton = document.querySelector(".payments-button");

  if (!paymentsButton || !boxesHolder) return;

  const boxes = Array.from(boxesHolder.querySelectorAll(".box"));

  let depositList, withdrawalList, depositInput, withdrawalInput;
  let paymentContainersLoaded = false;

  const originalOrder = boxes.slice();

  function loadPaymentMethods(filePath) {
    return fetch(filePath).then(res => res.json());
  }

  function transformLinkToDiv(htmlString) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlString.trim();
    const link = tempDiv.querySelector("a");
    if (!link) return htmlString;

    const aria = link.getAttribute("aria-label") || "";
    const className = link.className || "";
    const div = document.createElement("div");
    div.className = `payment-method ${className}`;
    div.textContent = aria;
    return div.outerHTML;
  }

  function addMethodWithoutDuplicates(arr, set, html) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html.trim();
    const link = tempDiv.querySelector("a");
    if (!link) return;

    const label = link.getAttribute("aria-label") || "";
    if (!set.has(label)) {
      arr.push(html);
      set.add(label);
    }
  }

  function populatePaymentList(container, list) {
    container.innerHTML = "";
    list.forEach(html => container.insertAdjacentHTML("beforeend", transformLinkToDiv(html)));
  }

  function reorderBoxesToFront() {
    const visible = boxes.filter(box => !box.classList.contains("hidden-deposit") && !box.classList.contains("hidden-withdrawal"));
    const sortedVisible = originalOrder.filter(b => visible.includes(b));
    const hidden = originalOrder.filter(b => !visible.includes(b));
    [...sortedVisible, ...hidden].forEach(box => boxesHolder.appendChild(box));
  }

  function restoreOriginalBoxOrder() {
    originalOrder.forEach(box => boxesHolder.appendChild(box));
  }

  function allFiltersCleared() {
    return boxes.every(box => !box.classList.contains("hidden-deposit") && !box.classList.contains("hidden-withdrawal"));
  }

  function animateBoxesSequentially(visibleBoxes) {
    visibleBoxes.forEach((box, index) => {
      const delay = (index + 1) * 0.15;
      box.style.animationDelay = `${delay}s`;
      box.classList.add("animate-in");
      box.addEventListener("animationend", () => {
        box.classList.remove("animate-in");
        box.style.animationDelay = "";
        box.classList.remove("was-hidden");
      }, { once: true });
    });
  }

  function clearFilter(input, hiddenClass) {
    input.value = "";
    const visibleBoxes = [];
    boxes.forEach(box => {
      if (box.classList.contains(hiddenClass)) {
        box.classList.remove(hiddenClass);
        if (!box.classList.contains("hidden-deposit") && !box.classList.contains("hidden-withdrawal")) {
          box.classList.add("was-hidden");
          visibleBoxes.push(box);
        }
      }
    });
    animateBoxesSequentially(visibleBoxes);
    if (allFiltersCleared()) restoreOriginalBoxOrder();
    else reorderBoxesToFront();
    const closeButton = input.closest("form").querySelector(".payment-close-button");
    checkCloseButtonVisibility(closeButton, input, hiddenClass);
    input.closest("form").querySelector(".selected")?.classList.remove("selected");
  }

  function filterBoxesByMethod(method, type) {
    const methodLC = method.toLowerCase();
    const hiddenClass = type === "deposit" ? "hidden-deposit" : "hidden-withdrawal";

    const promises = boxes.map(box => {
      const link = box.querySelector(".logobg a");
      if (!link) return Promise.resolve();
      const path = link.getAttribute("href").split("/").pop();
      const filePath = `${basePath}/${path}.json`;
      return fetch(filePath)
        .then(res => res.json())
        .then(data => {
          const methods = (type === "deposit" ? data.firstMethodContent : data.secondMethodContent) || [];
          const hasMethod = methods.some(html => {
            const temp = document.createElement("div");
            temp.innerHTML = html.trim();
            const a = temp.querySelector("a");
            return a && a.getAttribute("aria-label").toLowerCase() === methodLC;
          });
          if (hasMethod) {
            box.classList.remove(hiddenClass);
            if (!box.classList.contains("hidden-deposit") && !box.classList.contains("hidden-withdrawal")) {
              box.classList.add("was-hidden");
            }
          } else {
            box.classList.add(hiddenClass);
          }
        });
    });

    Promise.all(promises).then(() => {
      const reveal = boxes.filter(b => b.classList.contains("was-hidden") && !b.classList.contains("hidden-deposit") && !b.classList.contains("hidden-withdrawal"));
      animateBoxesSequentially(reveal);
      if (allFiltersCleared()) restoreOriginalBoxOrder();
      else reorderBoxesToFront();
    });
  }

  function checkCloseButtonVisibility(btn, input, hiddenClass) {
    const hasFilter = input.value !== "" || Array.from(boxes).some(b => b.classList.contains(hiddenClass));
    btn.classList.toggle("visible", hasFilter);
  }

  const paymentsBlock = document.createElement("div");
  paymentsBlock.className = "payments-block";

  const block1 = document.createElement("div");
  block1.className = "payments-block-separate";
  block1.appendChild(paymentsButton);

  const block2 = document.createElement("div");
  block2.className = "payments-block-separate";
  paymentsBlock.append(block1, block2);
  boxesHolder.insertBefore(paymentsBlock, boxesHolder.firstChild);

  const depositContainer = document.createElement("div");
  depositContainer.className = "payment-container";
  depositContainer.innerHTML = `
    <form id="payment-form">
      <input type="text" id="filter-input" autocomplete="off" readonly>
      <div class="methodlist payment-list"></div>
      <div class="payment-close-button"><i class="officon cross"></i></div>
    </form>`;

  const withdrawalContainer = document.createElement("div");
  withdrawalContainer.className = "payment-container";
  withdrawalContainer.innerHTML = `
    <form id="withdrawal-form">
      <input type="text" id="withdrawal-filter-input" autocomplete="off" readonly>
      <div class="methodlist payment-list" id="withdrawal-payment-list"></div>
      <div class="payment-close-button"><i class="officon cross"></i></div>
    </form>`;

  block2.append(depositContainer, withdrawalContainer);

  depositList = depositContainer.querySelector(".payment-list");
  depositInput = depositContainer.querySelector("#filter-input");
  withdrawalList = withdrawalContainer.querySelector(".payment-list");
  withdrawalInput = withdrawalContainer.querySelector("#withdrawal-filter-input");

  const translations = {
    deposit: { en: "Deposit", ru: "Пополнение" },
    withdraw: { en: "Withdraw", ru: "Вывод" }
  };

  function getTranslation(key) {
    return translations[key][languageTag] || translations[key].en;
  }

  function applyTranslations() {
    depositInput.setAttribute("placeholder", getTranslation("deposit"));
    withdrawalInput.setAttribute("placeholder", getTranslation("withdraw"));
  }

  applyTranslations();

  paymentsButton.addEventListener("click", () => {
    paymentsBlock.classList.toggle("visible");
    if (!paymentContainersLoaded) {
      setupInputClickEvents();
      setupCloseButtons();
      loadPaymentMethodsOnDemand(depositList, withdrawalList);
      paymentContainersLoaded = true;
    }
  });

  function setupInputClickEvents() {
    depositInput.addEventListener("click", e => {
      e.stopPropagation();
      hideAllPaymentLists();
      depositList.classList.toggle("visible");
      depositInput.classList.toggle("active");
    });
    withdrawalInput.addEventListener("click", e => {
      e.stopPropagation();
      hideAllPaymentLists();
      withdrawalList.classList.toggle("visible");
      withdrawalInput.classList.toggle("active");
    });
  }

  function hideAllPaymentLists() {
    depositList.classList.remove("visible");
    withdrawalList.classList.remove("visible");
    depositInput.classList.remove("active");
    withdrawalInput.classList.remove("active");
  }

  function setupCloseButtons() {
    document.querySelector("#payment-form .payment-close-button")?.addEventListener("click", () => clearFilter(depositInput, "hidden-deposit"));
    document.querySelector("#withdrawal-form .payment-close-button")?.addEventListener("click", () => clearFilter(withdrawalInput, "hidden-withdrawal"));
  }

  function loadPaymentMethodsOnDemand(depositList, withdrawalList) {
    let depArr = [], withArr = [], depSet = new Set(), withSet = new Set();

    boxes.forEach(box => {
      const link = box.querySelector(".logobg a");
      if (!link) return;

      const path = link.getAttribute("href").split("/").pop();
      const filePath = `${basePath}/${path}.json`;

      loadPaymentMethods(filePath).then(data => {
        (data.firstMethodContent || []).forEach(html => addMethodWithoutDuplicates(depArr, depSet, html));
        (data.secondMethodContent || []).forEach(html => addMethodWithoutDuplicates(withArr, withSet, html));

        populatePaymentList(depositList, depArr);
        populatePaymentList(withdrawalList, withArr);
      });
    });
  }

  document.addEventListener("click", e => {
    if (e.target.classList.contains("payment-method")) {
      const method = e.target.textContent;
      const form = e.target.closest("form");
      const input = form.querySelector("input");
      input.value = method;
      form.querySelector(".payment-list").classList.remove("visible");
      form.querySelector(".selected")?.classList.remove("selected");
      e.target.classList.add("selected");

      const type = input.id.includes("withdrawal") ? "withdrawal" : "deposit";
      filterBoxesByMethod(method, type);
      const btn = form.querySelector(".payment-close-button");
      checkCloseButtonVisibility(btn, input, type === "withdrawal" ? "hidden-withdrawal" : "hidden-deposit");
    } else {
      hideAllPaymentLists();
    }
  });
};

if (typeof window.initPayments === "function") {
  window.initPayments();
}

(() => {
  const PARTICLE_COUNT = 45;
  const FRAME_INTERVAL = 1900 / 60;
  const BACKGROUNDS = [
    "url(/img/icons/main-modes/rust-logo.png)",
    "url(/img/icons/main-modes/cs2-logo.png)",
    "url(/img/icons/main-modes/dota2-logo.png)",
    "url(/img/icons/main-modes/freebies.png)",
    "url(/img/icons/main-modes/steam.png)"
  ];

  let particleflakes = [];
  let previousTime = performance.now();
  let resetPosition = false;
  let enableAnimations = false;

  const reduceMotionQuery = matchMedia("(prefers-reduced-motion)");
  let particles = StorageHelper.get("particles") !== "false";
  StorageHelper.set("particles", particles);

  const particleflakeContainer = document.querySelector("#particleflakeContainer");

  class Particleflake {
    constructor(element, speed, xPos, yPos) {
      this.element = element;
      this.speed = speed;
      this.xPos = xPos;
      this.yPos = yPos;
      this.scale = 1;
      this.counter = 0;
      this.sign = Math.random() < 0.5 ? 1 : -1;

      this.element.style.opacity = (0.1 + Math.random()) / 3;
    }

    update(delta, width, height) {
      this.counter += (this.speed / 5000) * delta;
      this.xPos += (this.sign * delta * this.speed * Math.cos(this.counter)) / 40;
      this.yPos += Math.sin(this.counter) / 40 + (this.speed * delta) / 30;
      this.scale = 0.5 + Math.abs((10 * Math.cos(this.counter)) / 20);

      this.element.style.transform = `translate3d(${Math.round(this.xPos)}px, ${Math.round(this.yPos)}px, 0) scale(${this.scale})`;

      if (this.yPos > height) {
        this.yPos = -50;
      }
    }
  }

  function init() {
    updateToggleIcon();
    setAccessibilityState();
    reduceMotionQuery.addListener(setAccessibilityState);

    document.querySelector("#particles-toggle").addEventListener("click", toggleParticles);

    if (enableAnimations && window.innerWidth > 1365) {
      window.addEventListener("DOMContentLoaded", generateParticleflakes);
      window.addEventListener("resize", handleResize);
    }
  }

  function setAccessibilityState() {
    enableAnimations = !reduceMotionQuery.matches && particles;
  }

  function getRandomPosition(offset, size) {
    return Math.round(-offset + Math.random() * (size + offset * 2));
  }

  function generateParticleflakes() {
    const template = document.querySelector(".particleflake");
    if (!template) return;

    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;

    particleflakeContainer.style.display = "block";

    // Remove existing
    particleflakes.forEach(p => p.element.remove());
    particleflakes = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const clone = template.cloneNode(true);
      clone.style.backgroundImage = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
      particleflakeContainer.appendChild(clone);

      const x = getRandomPosition(50, width);
      const y = getRandomPosition(50, height);
      const speed = 5 + Math.random() * 40;

      particleflakes.push(new Particleflake(clone, speed, x, y));
    }

    template.remove();
    requestAnimationFrame(animate);
  }

  function animate(currentTime) {
    const delta = (currentTime - previousTime) / FRAME_INTERVAL;
    previousTime = currentTime;

    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;

    if (enableAnimations) {
      for (const particle of particleflakes) {
        if (resetPosition) {
          particle.xPos = getRandomPosition(50, width);
          particle.yPos = getRandomPosition(50, height);
        } else {
          particle.update(delta, width, height);
        }
      }
    }

    resetPosition = false;
    requestAnimationFrame(animate);
  }

  function handleResize() {
    if (window.innerWidth <= 1365) {
      resetPosition = true;
    } else if (particles) {
      resetPosition = false;
    }
  }

  function toggleParticles() {
    particles = !particles;
    StorageHelper.set("particles", particles);
    updateToggleIcon();

    if (particles) {
      setAccessibilityState();

      if (!document.querySelector(".particleflake")) {
        const el = document.createElement("div");
        el.className = "particleflake";
        particleflakeContainer.appendChild(el);
      }

      if (enableAnimations) {
        generateParticleflakes();
        window.addEventListener("resize", handleResize);
      }
    } else {
      particleflakes.forEach(p => p.element.remove());
      particleflakes = [];
      window.removeEventListener("resize", handleResize);
    }
  }

  function updateToggleIcon() {
    const icon = document.querySelector("#particles-toggle .officon");
    icon.classList.toggle("effect-on", particles);
    icon.classList.toggle("effect-off", !particles);
  }

  init();
})();

function loadCachedData(key) {
  return StorageHelper.getJSON(key);
}

function saveToCache(key, data) {
  StorageHelper.setJSON(key, data);
}

// path: /assets/js/header-hide.js
(() => {
  const header = document.querySelector('header');
  if (!header) return;

  const cfg = {
    upVelocityReveal: 0.6,   // px/ms — "резкость" апа (≈600 px/s)
    upDeltaReveal: 80,       // px — альт. порог рывка вверх
    ignoreDelta: 2,          // px — игнор шума
    minLockMs: 400,          // ms — защита от мгновенного скрытия
    hideAfter: () => headerH + 12,
    scrollHiddenAfter: 100   // px — когда включать "долгую" скрытность
  };

  let headerH = header.offsetHeight;
  let lastY = Math.max(0, window.scrollY || 0);
  let lastT = performance.now();
  let ticking = false;
  let lockUntil = 0;

  let hidden = false;        // состояние is-hidden
  let scrollHidden = false;  // состояние scroll-hidden

  const hide = () => {
    if (!hidden) { header.classList.add('is-hidden'); hidden = true; }
  };

  const show = (lock = false) => {
    if (hidden) { header.classList.remove('is-hidden'); hidden = false; }
    if (lock) lockUntil = performance.now() + cfg.minLockMs; // почему: не прячем сразу после резкого апа
  };

  const setScrollHidden = () => {
    if (!scrollHidden) { header.classList.add('scroll-hidden'); scrollHidden = true; }
  };

  const clearScrollHidden = () => {
    if (scrollHidden) { header.classList.remove('scroll-hidden'); scrollHidden = false; }
  };

  const update = () => {
    ticking = false;

    const now = performance.now();
    const y = Math.max(0, window.scrollY || 0); // почему: iOS bounce
    const dy = y - lastY;
    const dt = Math.max(16, now - lastT);
    const v = dy / dt;

    headerH = header.offsetHeight;

    // В самом верху всегда полностью показываем и сбрасываем "долгую" скрытность
    if (y <= 0) {
      show(false);
      clearScrollHidden();
      lastY = y; lastT = now;
      return;
    }

    // Микроподвижки игнорируем
    if (Math.abs(dy) <= cfg.ignoreDelta) {
      lastY = y; lastT = now;
      return;
    }

    // --- Логика is-hidden (как была) ---
    const fastUp = dy < 0 && ((-v) >= cfg.upVelocityReveal || (-dy) >= cfg.upDeltaReveal);

    if (fastUp) {
      show(true);
    } else if (dy > 0 && y > cfg.hideAfter() && now >= lockUntil) {
      hide();
    } else if (dy < 0) {
      show(false);
    }

    // --- Логика scroll-hidden (новая) ---
    // Включаем при движении вниз после условных 100px и больше не трогаем,
    // чтобы не "возвращался" при апе. Снимется только в блоке y <= 0.
    if (!scrollHidden && dy > 0 && y >= cfg.scrollHiddenAfter) {
      setScrollHidden();
    }

    lastY = y;
    lastT = now;
  };

  const onScroll = () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { headerH = header.offsetHeight; }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    // почему: при возврате на вкладку устраняем "рывок" из-за устаревших lastY/lastT
    lastY = Math.max(0, window.scrollY || 0);
    lastT = performance.now();
  });

  update();
})();
