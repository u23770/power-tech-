(function () {
  'use strict';
  const root = document.documentElement;
  const form = document.getElementById('access-form');
  const input = document.getElementById('access-code');
  const submit = document.getElementById('access-submit');
  const status = document.getElementById('access-status');
  const languageButton = document.getElementById('lang-toggle');

  const strings = {
    en: {
      kicker: 'PRIVATE ADMIN AREA',
      title: 'Admin access',
      intro: 'Enter the private access code to open the admin dashboard.',
      label: 'Access code',
      help: 'The access code securely opens the admin dashboard.',
      submit: 'Open dashboard',
      store: 'Back to store',
      note: 'Protected access · Session expires after 6 hours',
      switch: 'العربية',
      invalid: 'That access code is not correct. Try again.',
      limit: 'Too many attempts. Please wait before trying again.',
      unavailable: 'Admin access is temporarily unavailable. Please contact the site owner.',
      busy: 'Checking…',
      network: 'Could not contact the server. Check your connection and try again.',
    },
    ar: {
      kicker: 'منطقة إدارة خاصة',
      title: 'دخول لوحة الإدارة',
      intro: 'أدخل كود الوصول الخاص لفتح لوحة الإدارة مباشرة.',
      label: 'كود الوصول',
      help: 'كود الوصول يفتح لوحة الإدارة مباشرة.',
      submit: 'فتح لوحة الإدارة',
      store: 'العودة للمتجر',
      note: 'دخول محمي · تنتهي الجلسة بعد ٦ ساعات',
      switch: 'English',
      invalid: 'كود الوصول غير صحيح. حاول مرة أخرى.',
      limit: 'محاولات كثيرة. انتظر قليلًا قبل إعادة المحاولة.',
      unavailable: 'الدخول إلى الإدارة غير متاح مؤقتًا. تواصل مع مسؤول الموقع.',
      busy: 'جارٍ التحقق…',
      network: 'تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.',
    },
  };

  function language() {
    return root.lang === 'ar' ? 'ar' : 'en';
  }

  function applyLanguage(lang) {
    const s = strings[lang];
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.getElementById('access-kicker').textContent = s.kicker;
    document.getElementById('access-title').textContent = s.title;
    document.getElementById('access-intro').textContent = s.intro;
    document.getElementById('access-label').textContent = s.label;
    document.getElementById('access-help').textContent = s.help;
    submit.textContent = s.submit;
    document.getElementById('store-link').textContent = s.store;
    document.getElementById('security-note').textContent = s.note;
    languageButton.textContent = s.switch;
    input.setAttribute('aria-label', s.label);
    try { localStorage.setItem('pt_lang', lang); } catch (_) { /* optional preference */ }
    if (!status.hidden) status.textContent = messageFor(status.dataset.error || '', lang);
  }

  function messageFor(code, lang) {
    const s = strings[lang];
    if (code === 'invalid_code' || code === 'access_required') return s.invalid;
    if (code === 'too_many_attempts') return s.limit;
    if (code === 'not_configured') return s.unavailable;
    return s.network;
  }

  function returnPath() {
    const requested = new URLSearchParams(window.location.search).get('next') || '';
    if (requested.startsWith('/admin') && !requested.startsWith('/admin/access')) return requested;
    return '/admin';
  }

  async function checkExistingAccess() {
    try {
      const response = await fetch('/api/admin-access', { credentials: 'same-origin', cache: 'no-store' });
      if (response.ok) window.location.replace(returnPath());
    } catch (_) {
      // A failed status check does not block manual code entry.
    }
  }

  languageButton.addEventListener('click', () => applyLanguage(language() === 'ar' ? 'en' : 'ar'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.hidden = true;
    const s = strings[language()];
    submit.disabled = true;
    submit.textContent = s.busy;
    try {
      const response = await fetch('/api/admin-access', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: input.value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok === true) {
        window.location.replace(returnPath());
        return;
      }
      status.dataset.error = payload.error || 'network';
      status.textContent = messageFor(status.dataset.error, language());
      status.hidden = false;
    } catch (_) {
      status.dataset.error = 'network';
      status.textContent = messageFor('network', language());
      status.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = strings[language()].submit;
    }
  });

  applyLanguage(language());
  checkExistingAccess();
  input.focus({ preventScroll: true });
})();
