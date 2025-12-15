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
