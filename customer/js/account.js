// customer/js/account.js — sign in/up, password reset, profile, own orders.
// Access control is enforced by Supabase Auth + RLS (orders are visible only to their owner).
// The UI never treats "signed in" as authorization for anything beyond the customer's own rows.
import { mountLayout, onLayoutLanguageChange } from './layout.js';
import { applyI18n, t, getLang } from '/shared/i18n.js';
import { el, clear, errorMessage, setStatus, setBusy } from '/shared/ui.js';
import { formatMoney, formatDateTime } from '/shared/format.js';
import { isEmail, isPhone, isStrongEnoughPassword } from '/shared/validators.js';
import { isConfigured, supabase } from '/shared/supabase.js';
import {
  getSession, signIn, signUp, signOut, requestPasswordReset, updatePassword,
  getProfile, saveProfile, listMyOrders, listOrderItems,
} from './api.js';
import { loadingBlock, errorBlock } from './cards.js';

const main = document.getElementById('app');
const params = new URLSearchParams(location.search);
let mode = params.get('mode') === 'reset' ? 'reset' : 'auth'; // auth | forgot | reset
let authTab = 'login'; // login | signup
let session = null;
let redirected = false;

async function init() {
  document.title = `${t('account.title')} · POWER TECH`;
  await mountLayout({ active: 'account' });
  if (!isConfigured) {
    clear(main);
    main.append(errorBlock(t('state.not_configured')));
    return;
  }
  // Password recovery links open this page with a recovery session.
  supabase.auth.onAuthStateChange(async (event, newSession) => {
    if (event === 'PASSWORD_RECOVERY') mode = 'reset';
    if (event === 'SIGNED_IN' && newSession && mode !== 'reset') {
      session = newSession;
      if (params.get('next') === 'checkout' && !redirected) {
        redirected = true;
        location.href = '/customer/checkout.html';
        return;
      }
    }
    if (event === 'SIGNED_OUT') session = null;
    if (['SIGNED_IN', 'SIGNED_OUT', 'PASSWORD_RECOVERY', 'USER_UPDATED'].includes(event)) await render();
  });
  session = await getSession().catch(() => null);
  await render();
  onLayoutLanguageChange(render);
}

async function render() {
  clear(main);
  main.append(el('h1', { attrs: { 'data-i18n': 'account.title' } }, t('account.title')));
  if (mode === 'reset') {
    main.append(resetForm());
  } else if (mode === 'forgot') {
    main.append(forgotForm());
  } else if (!session) {
    main.append(authPanel());
  } else {
    main.append(loadingBlock());
    await renderSignedIn();
  }
  applyI18n(main);
}

function authPanel() {
  const status = el('div', { className: 'status', attrs: { role: 'status' }, hidden: true });
  const tabs = el('div', { className: 'row', attrs: { role: 'tablist', 'aria-label': t('account.title') } },
    tabButton('login', t('account.login')), tabButton('signup', t('account.signup')));
  const form = authTab === 'login' ? loginForm(status) : signupForm(status);
  return el('div', { className: 'card', style: 'max-width:520px' }, tabs, el('div', { style: 'margin-top:1rem' }, form), status);
}

function tabButton(id, label) {
  const selected = authTab === id;
  return el('button', {
    className: selected ? 'btn btn-dark btn-small' : 'btn btn-ghost btn-small',
    attrs: { type: 'button', role: 'tab', 'aria-selected': String(selected) },
    on: { click: () => { authTab = id; render(); } },
  }, label);
}

function loginForm(status) {
  const form = el('form', { className: 'form', attrs: { novalidate: true } },
    field('email', t('account.email'), 'email', 'email'),
    field('password', t('account.password'), 'password', 'current-password'),
    el('div', { className: 'row' },
      el('button', { className: 'btn btn-primary', attrs: { type: 'submit' } }, t('account.login')),
      el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button' }, on: { click: () => { mode = 'forgot'; render(); } } }, t('account.forgot'))));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!isEmail(email) || !password) return setStatus(status, t('val.email'), 'error');
    const btn = form.querySelector('button[type="submit"]');
    setBusy(btn, true);
    try {
      await signIn(email, password);
      // onAuthStateChange re-renders.
    } catch (err) {
      setStatus(status, errorMessage(err), 'error');
      status.hidden = false;
    } finally {
      setBusy(btn, false);
    }
  });
  return form;
}

function signupForm(status) {
  const form = el('form', { className: 'form', attrs: { novalidate: true } },
    field('full_name', t('account.full_name'), 'text', 'name'),
    field('email', t('account.email'), 'email', 'email'),
    field('phone', t('account.phone'), 'tel', 'tel'),
    field('password', t('account.password'), 'password', 'new-password', t('account.password_min')),
    el('button', { className: 'btn btn-primary', attrs: { type: 'submit' } }, t('account.signup')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = form.full_name.value.trim();
    const email = form.email.value.trim();
    const phone = form.phone.value.trim();
    const password = form.password.value;
    if (fullName.length < 2) return setStatus(status, t('val.name'), 'error');
    if (!isEmail(email)) return setStatus(status, t('val.email'), 'error');
    if (phone && !isPhone(phone)) return setStatus(status, t('val.phone'), 'error');
    if (!isStrongEnoughPassword(password)) return setStatus(status, t('account.password_min'), 'error');
    const btn = form.querySelector('button[type="submit"]');
    setBusy(btn, true);
    try {
      const result = await signUp({ email, password, fullName });
      // Phone is saved to the profile only when a session exists (RLS: own row only).
      setStatus(status, t('account.signup_done'), 'success');
      status.hidden = false;
      if (result.session && phone) await saveProfile(result.session.user.id, { fullName, phone }).catch(() => {});
    } catch (err) {
      setStatus(status, errorMessage(err), 'error');
      status.hidden = false;
    } finally {
      setBusy(btn, false);
    }
  });
  return form;
}

function forgotForm() {
  const status = el('div', { className: 'status', attrs: { role: 'status' }, hidden: true });
  const form = el('form', { className: 'form card', style: 'max-width:520px', attrs: { novalidate: true } },
    field('email', t('account.email'), 'email', 'email'),
    el('div', { className: 'row' },
      el('button', { className: 'btn btn-primary', attrs: { type: 'submit' } }, t('account.forgot')),
      el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button' }, on: { click: () => { mode = 'auth'; render(); } } }, t('admin.cancel'))),
    status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!isEmail(email)) return setStatus(status, t('val.email'), 'error');
    const btn = form.querySelector('button[type="submit"]');
    setBusy(btn, true);
    try {
      await requestPasswordReset(email);
      // Same message whether or not the account exists (prevents account enumeration).
      setStatus(status, t('account.reset_sent'), 'success');
    } catch (err) {
      setStatus(status, errorMessage(err), 'error');
    } finally {
      setBusy(btn, false);
      status.hidden = false;
    }
  });
  return form;
}

function resetForm() {
  const status = el('div', { className: 'status', attrs: { role: 'status' }, hidden: true });
  const form = el('form', { className: 'form card', style: 'max-width:520px', attrs: { novalidate: true } },
    el('p', {}, t('account.reset_mode')),
    field('password', t('account.new_password'), 'password', 'new-password', t('account.password_min')),
    el('button', { className: 'btn btn-primary', attrs: { type: 'submit' } }, t('account.set_password')),
    status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = form.password.value;
    if (!isStrongEnoughPassword(password)) return setStatus(status, t('account.password_min'), 'error');
    const btn = form.querySelector('button[type="submit"]');
    setBusy(btn, true);
    try {
      await updatePassword(password);
      mode = 'auth';
      setStatus(status, t('account.password_updated'), 'success');
    } catch (err) {
      setStatus(status, errorMessage(err), 'error');
    } finally {
      setBusy(btn, false);
      status.hidden = false;
    }
  });
  return form;
}

function field(name, label, type, autocomplete, hint) {
  const id = `a-${name}`;
  return el('div', { className: 'field' },
    el('label', { attrs: { for: id } }, label),
    el('input', { className: 'input', attrs: { id, name, type, autocomplete, required: 'required', maxlength: name === 'password' ? '72' : '254' } }),
    hint ? el('p', { className: 'hint' }, hint) : null);
}

async function renderSignedIn() {
  const lang = getLang();
  const box = main.lastElementChild;
  try {
    const [profile, orders] = await Promise.all([getProfile(session.user.id), listMyOrders()]);
    const items = await listOrderItems(orders.map((o) => o.id));
    const profileStatus = el('div', { className: 'status', attrs: { role: 'status' }, hidden: true });
    const profileForm = el('form', { className: 'card form', attrs: { novalidate: true } },
      el('h2', { style: 'font-size:1.1rem', attrs: { 'data-i18n': 'account.profile' } }, t('account.profile')),
      el('p', { className: 'hint' }, session.user.email || ''),
      el('div', { className: 'field' },
        el('label', { attrs: { for: 'p-name' } }, t('account.full_name')),
        el('input', { className: 'input', attrs: { id: 'p-name', name: 'full_name', maxlength: '120', value: profile?.full_name || '', autocomplete: 'name' } })),
      el('div', { className: 'field' },
        el('label', { attrs: { for: 'p-phone' } }, t('account.phone')),
        el('input', { className: 'input', attrs: { id: 'p-phone', name: 'phone', maxlength: '20', value: profile?.phone || '', autocomplete: 'tel', inputmode: 'tel' } })),
      el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('account.save')),
      profileStatus);
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = profileForm.full_name.value.trim();
      const phone = profileForm.phone.value.trim();
      if (fullName.length < 2) return setStatus(profileStatus, t('val.name'), 'error');
      if (phone && !isPhone(phone)) return setStatus(profileStatus, t('val.phone'), 'error');
      try {
        await saveProfile(session.user.id, { fullName, phone });
        setStatus(profileStatus, t('account.saved'), 'success');
      } catch (err) {
        setStatus(profileStatus, errorMessage(err), 'error');
      }
    });

    const signOutBtn = el('button', {
      className: 'btn btn-ghost', attrs: { type: 'button' },
      on: { click: async (e) => {
        setBusy(e.currentTarget, true);
        try { await signOut(); } catch (err) { setStatus(profileStatus, errorMessage(err), 'error'); }
      } },
    }, t('account.logout'));

    const byOrder = new Map();
    for (const it of items) {
      if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
      byOrder.get(it.order_id).push(it);
    }
    const orderList = orders.length
      ? el('ul', { className: 'stack', style: 'list-style:none;padding:0;margin:0' }, orders.map((o) => el('li', { className: 'card' },
        el('div', { className: 'row' },
          el('strong', { className: 'ltr' }, o.reference),
          el('span', { className: 'badge', attrs: { 'data-i18n': `status.${o.status}` } }, t(`status.${o.status}`)),
          el('span', { className: 'muted' }, formatDateTime(o.created_at, lang))),
        el('p', { style: 'margin:.5rem 0 0' }, `${t('checkout.total')}: ${formatMoney(o.total, o.currency, lang)} · ${t(`fulfillment.${o.fulfillment}`)}`),
        el('ul', { className: 'hint', style: 'margin:.4rem 0 0;padding-inline-start:1.1rem' },
          (byOrder.get(o.id) || []).map((it) => el('li', {}, `${(lang === 'ar' && it.title_ar_snapshot) || it.title_snapshot} × ${it.quantity}`))))))
      : el('p', { className: 'muted' }, t('account.no_orders'));

    clear(box);
    box.append(el('div', { className: 'checkout-layout' },
      el('section', { className: 'stack' },
        el('h2', { attrs: { 'data-i18n': 'account.orders' } }, t('account.orders')),
        orderList),
      el('aside', { className: 'stack' }, profileForm, signOutBtn)));
  } catch (err) {
    clear(box);
    const message = /JWT|expired|token/i.test(String(err?.message)) ? t('account.session_expired') : errorMessage(err);
    box.append(errorBlock(message, renderSignedIn));
  }
}

init();
