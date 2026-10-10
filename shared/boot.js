// shared/boot.js — classic script loaded synchronously in <head>. Sets language and direction before first paint.
// External file (not inline) so the Content-Security-Policy can keep script-src 'self' without unsafe-inline.
(function () {
  var lang = 'en';
  try { if (localStorage.getItem('pt_lang') === 'ar') lang = 'ar'; } catch (e) { /* storage blocked: English */ }
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
})();
