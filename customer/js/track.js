// customer/js/track.js — guest order lookup: order reference + tracking code (never sequential ids).
// The tracking code is typed by the customer and is never placed in the URL.
import { mountLayout, onLayoutLanguageChange } from './layout.js';
import { applyI18n, t, getLang } from '/shared/i18n.js';
import { el, clear, errorMessage, setStatus, setBusy } from '/shared/ui.js';
import { formatMoney, formatDateTime } from '/shared/format.js';
import { isConfigured } from '/shared/supabase.js';
import { trackOrder } from './api.js';
import { errorBlock } from './cards.js';

const main = document.getElementById('app');
const initialRef = (new URLSearchParams(location.search).get('ref') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
let lastResult = null;

async function init() {
  document.title = `${t('track.title')} · POWER TECH`;
  await mountLayout({ active: 'track' });
  if (!isConfigured) {
    clear(main);
    main.append(errorBlock(t('state.not_configured')));
    return;
  }
  render();
  onLayoutLanguageChange(render);
}

function render() {
  clear(main);
  const status = el('div', { className: 'status', attrs: { role: 'status' }, hidden: true });
  const form = el('form', { className: 'card form', style: 'max-width:520px', attrs: { novalidate: true, id: 'track-form' } },
    el('h1', { style: 'font-size:1.5rem', attrs: { 'data-i18n': 'track.title' } }, t('track.title')),
    el('p', { className: 'muted', attrs: { 'data-i18n': 'track.intro' } }, t('track.intro')),
    field('ref', 'track.reference', initialRef, 'characters'),
    field('token', 'track.token', '', 'off'),
    el('button', { className: 'btn btn-primary', attrs: { type: 'submit', 'data-i18n': 'track.lookup' } }, t('track.lookup')),
    status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reference = form.ref.value.trim().toUpperCase();
    const token = form.token.value.trim();
    if (!/^PT-[0-9]{6}-[A-Z0-9]{6}$/.test(reference) || !/^[a-f0-9]{64}$/i.test(token)) {
      setStatus(status, t('track.not_found'), 'error');
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    setBusy(btn, true);
    try {
      lastResult = await trackOrder(reference, token);
      setStatus(status, '', 'info');
      renderResult();
    } catch (err) {
      lastResult = null;
      setStatus(status, errorMessage(err), 'error');
    } finally {
      setBusy(btn, false);
    }
  });
  main.append(form, el('div', { attrs: { id: 'track-result' } }));
  if (lastResult) renderResult();
  applyI18n(main);
}

function field(name, labelKey, value, autocomplete) {
  const id = `tr-${name}`;
  return el('div', { className: 'field' },
    el('label', { attrs: { for: id }, dataset: {} }, t(labelKey)),
    el('input', { className: 'input', attrs: { id, name, value, autocomplete, required: 'required', maxlength: name === 'token' ? '64' : '20', spellcheck: 'false' } }));
}

function renderResult() {
  const box = document.getElementById('track-result');
  if (!box || !lastResult) return;
  const lang = getLang();
  const r = lastResult;
  clear(box);
  box.append(el('section', { className: 'card receipt', style: 'margin-top:1rem', attrs: { 'aria-labelledby': 'track-h' } },
    el('h2', { attrs: { id: 'track-h' } }, el('span', { className: 'ltr' }, r.reference)),
    el('p', {}, `${t('track.status')}: `, el('span', { className: 'badge', attrs: { 'data-i18n': `status.${r.status}` } }, t(`status.${r.status}`))),
    el('p', {}, `${t('track.placed')}: ${formatDateTime(r.created_at, lang)}`),
    el('p', {}, `${t('checkout.total')}: ${formatMoney(r.total, r.currency, lang)} · ${t(`fulfillment.${r.fulfillment}`)}`),
    el('h3', { attrs: { 'data-i18n': 'track.items' } }, t('track.items')),
    el('ul', { className: 'hint' }, (r.items || []).map((i) => el('li', {}, `${i.title} × ${i.quantity}`))),
    el('h3', { attrs: { 'data-i18n': 'track.timeline' } }, t('track.timeline')),
    el('ol', { className: 'timeline' }, (r.timeline || []).map((h) => el('li', {},
      el('strong', { attrs: { 'data-i18n': `status.${h.to}` } }, t(`status.${h.to}`)),
      el('div', { className: 'hint' }, formatDateTime(h.at, lang)))))));
  applyI18n(box);
}

init();
