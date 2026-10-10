// admin/js/app.js — admin bootstrap: auth gate, role-aware navigation, routing, alerts.
// Role checks here decide what is SHOWN. Every write is re-checked by RLS and trusted functions.
import { isConfigured, supabase } from '/shared/supabase.js';
import { t, getLang, setLang, onLangChange, applyI18n } from '/shared/i18n.js';
import { el, clear, brandMark, errorMessage, setStatus, setBusy, confirmAction } from '/shared/ui.js';
import * as api from './api.js';

const RANK = { staff: 1, manager: 2, owner: 3 };
const ROUTES = {
  overview: { min: 'staff', view: () => import('./views/overview.js') },
  products: { min: 'staff', view: () => import('./views/products.js') },
  orders: { min: 'staff', view: () => import('./views/orders.js') },
  stock: { min: 'staff', view: () => import('./views/stock.js') },
  audit: { min: 'manager', view: () => import('./views/audit.js') },
};
const POLL_MS = 45000;

const main = document.getElementById('admin-main');
const nav = document.getElementById('admin-nav');
const tabs = document.getElementById('admin-tabs');
const alertBar = document.getElementById('alert-bar');

const state = {
  user: null,
  role: null,
  dirty: false,
  currentRoute: null,
  lastPendingCount: null,
  pollTimer: null,
};

/** Passed to every view. */
export const ctx = {
  get role() { return state.role; },
  can: (min) => Boolean(state.role && RANK[state.role] >= RANK[min]),
  setDirty: (value) => { state.dirty = Boolean(value); },
  navigate: (hash) => { location.hash = hash; },
  refresh: () => renderRoute(),
};

async function boot() {
  document.getElementById('admin-brand').replaceChildren(brandMark({ href: '/admin/index.html' }));
  wireHeader();
  if (!isConfigured) {
    clear(main);
    main.append(el('div', { className: 'status', attrs: { role: 'alert' }, dataset: { kind: 'error' } }, t('state.not_configured')));
    return;
  }

  supabase.auth.onAuthStateChange(async (event) => {
    if (event === 'SIGNED_OUT') {
      stopPolling();
      state.user = null;
      state.role = null;
      await renderGate(t('admin.session_expired'));
    }
  });

  await refreshSession();
  window.addEventListener('hashchange', onHashChange);
  onLangChange(() => { renderHeader(); buildTabs(); renderRoute(); });
}

async function refreshSession() {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return renderGate();
    state.user = data.session.user;
    state.role = await api.getStaffRole(state.user.id);
    if (!state.role) {
      await api.signOutStaff().catch(() => {});
      return renderGate(t('admin.not_staff'));
    }
    showShell();
  } catch (err) {
    renderGate(errorMessage(err));
  }
}

function wireHeader() {
  const langBtn = document.getElementById('admin-lang');
  langBtn.addEventListener('click', () => setLang(getLang() === 'ar' ? 'en' : 'ar'));
  document.getElementById('admin-signout').addEventListener('click', async () => {
    if (state.dirty && !(await confirmAction(t('admin.unsaved')))) return;
    try {
      await api.signOutStaff();
    } catch (err) {
      setStatus(alertBar, errorMessage(err), 'error');
    }
  });
  renderHeader();
}

function renderHeader() {
  const langBtn = document.getElementById('admin-lang');
  const next = getLang() === 'ar' ? 'en' : 'ar';
  langBtn.textContent = t('lang.switch');
  langBtn.setAttribute('lang', next);
  langBtn.setAttribute('aria-label', next === 'ar' ? 'التبديل إلى العربية' : 'Switch to English');
  const who = document.getElementById('admin-who');
  who.textContent = state.user && state.role ? `${state.user.email} · ${t('admin.role', { r: state.role })}` : '';
  document.getElementById('admin-signout').hidden = !state.user;
  applyI18n(document);
}

function showShell() {
  renderHeader();
  buildTabs();
  nav.hidden = false;
  startPolling();
  onHashChange();
}

function buildTabs() {
  const current = currentRouteName();
  clear(tabs);
  for (const [name, route] of Object.entries(ROUTES)) {
    if (!ctx.can(route.min)) continue;
    tabs.append(el('li', {}, el('a', {
      attrs: { href: `#/${name}`, 'aria-current': current === name ? 'page' : null },
    }, t(`admin.nav.${name}`))));
  }
}

function currentRouteName() {
  return parseHash().name;
}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'overview', id: parts[1] || null, query: new URLSearchParams(location.hash.split('?')[1] || '') };
}

async function onHashChange() {
  if (!state.user) return;
  if (state.dirty) {
    const ok = await confirmAction(t('admin.unsaved'));
    if (!ok) {
      // Restore the previous route without triggering another navigation.
      if (state.currentRoute) history.replaceState(null, '', `#/${state.currentRoute}`);
      return;
    }
    state.dirty = false;
  }
  renderRoute();
}

async function renderRoute() {
  if (!state.user) return;
  const { name, id, query } = parseHash();
  const route = ROUTES[name];
  if (!route || !ctx.can(route.min)) {
    clear(main);
    main.append(el('div', { className: 'status', attrs: { role: 'alert' }, dataset: { kind: 'error' } }, t('err.forbidden')));
    return;
  }
  state.currentRoute = name;
  buildTabs();
  clear(main);
  main.append(el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
  try {
    const mod = await route.view();
    clear(main);
    await mod.render(main, { ...ctx, id, query });
    applyI18n(main);
    main.focus({ preventScroll: true });
  } catch (err) {
    clear(main);
    main.append(el('div', { className: 'status', attrs: { role: 'alert' }, dataset: { kind: 'error' } }, errorMessage(err)));
  }
}

/** Login screen: shown when there is no session or the account has no staff role. */
async function renderGate(message) {
  nav.hidden = true;
  renderHeader();
  clear(main);
  if (!isConfigured) return;
  const status = el('div', { className: 'status', attrs: { role: 'alert', hidden: message ? null : true }, dataset: { kind: 'error' } }, message || '');
  const form = el('form', { className: 'card form login-card', attrs: { novalidate: true, 'aria-labelledby': 'login-h' } },
    el('h1', { className: 'card-title', attrs: { id: 'login-h' } }, t('admin.sign_in')),
    el('div', { className: 'field' },
      el('label', { attrs: { for: 'admin-email' } }, t('account.email')),
      el('input', { className: 'input', attrs: { id: 'admin-email', name: 'email', type: 'email', autocomplete: 'username', required: 'required', maxlength: '254' } })),
    el('div', { className: 'field' },
      el('label', { attrs: { for: 'admin-password' } }, t('account.password')),
      el('input', { className: 'input', attrs: { id: 'admin-password', name: 'password', type: 'password', autocomplete: 'current-password', required: 'required', maxlength: '72' } })),
    el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.sign_in')),
    status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    setBusy(btn, true);
    status.hidden = true;
    try {
      await api.signInStaff(form.email.value.trim(), form.password.value);
      form.password.value = '';
      await refreshSession();
    } catch (err) {
      status.textContent = errorMessage(err);
      status.hidden = false;
    } finally {
      setBusy(btn, false);
    }
  });
  main.append(form);
  applyI18n(main);
}

// ---------- Alerts: new pending orders (polling fallback; no realtime dependency) ----------
function startPolling() {
  stopPolling();
  if (!ctx.can('staff')) return;
  checkNewOrders(true);
  state.pollTimer = setInterval(() => checkNewOrders(false), POLL_MS);
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  state.lastPendingCount = null;
  alertBar.replaceChildren();
}

async function checkNewOrders(initial) {
  if (!state.user) return;
  try {
    const count = await api.countPendingOrders();
    const previous = state.lastPendingCount;
    state.lastPendingCount = count;
    if (initial || previous === null || count <= previous) return;
    const newCount = count - previous;
    showAlert(t('admin.new_orders', { n: newCount }));
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      // Optional browser notification; the in-app banner above is always shown.
      new Notification('POWER TECH', { body: t('admin.new_orders', { n: newCount }) });
    }
  } catch {
    // Polling errors are silent by design; the next tick retries. No credentials are logged.
  }
}

function showAlert(text) {
  clear(alertBar);
  const actions = el('div', { className: 'row' },
    el('a', { className: 'btn btn-dark btn-small', attrs: { href: '#/orders?status=pending' }, on: { click: () => alertBar.replaceChildren() } }, t('admin.nav.orders')),
    typeof Notification !== 'undefined' && Notification.permission === 'default'
      ? el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button' }, on: { click: () => Notification.requestPermission() } }, t('admin.enable_alerts'))
      : null);
  alertBar.append(el('div', { className: 'alert-banner' }, el('span', {}, text), actions));
}

boot();
