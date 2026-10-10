// shared/ui.js — safe DOM helpers. Text is always set with textContent (never innerHTML with data).
import { t } from '/shared/i18n.js';
import { CONFIG } from '/shared/config.js';

/** Create an element. props: className, attrs (object), on (event map), dataset (object). Children: strings or nodes. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  for (const [k, v] of Object.entries(props.attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const [k, v] of Object.entries(props.dataset || {})) node.dataset[k] = String(v);
  for (const [evt, fn] of Object.entries(props.on || {})) node.addEventListener(evt, fn);
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
}

/** Show a status message in a live region. kind: info | success | error. Empty text hides it. */
export function setStatus(node, text, kind = 'info') {
  if (!node) return;
  node.textContent = text || '';
  node.dataset.kind = kind;
  node.hidden = !text;
}

export function setBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.dataset.label || button.textContent;
    button.textContent = busyLabel || t('state.loading');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

/** Map an error from Supabase/PostgREST to a translated message. Postgres RAISE messages are our codes. */
export function errorMessage(err) {
  if (!err) return t('err.unknown');
  if (err.code === 'not_configured') return t('err.not_configured');
  const msg = String(err.message || '');
  const code = msg.match(/^[a-z_]{3,60}/)?.[0];
  if (code && t(`err.${code}`) !== `err.${code}`) return t(`err.${code}`);
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return t('state.network');
  if (/invalid login credentials/i.test(msg)) return t('auth.invalid_credentials');
  if (/rate limit|too many/i.test(msg)) return t('auth.rate_limited');
  if (/email not confirmed/i.test(msg)) return t('auth.email_not_confirmed');
  if (/already (registered|exists)/i.test(msg)) return t('auth.user_exists');
  if (/password/i.test(msg) && /weak|short|least|pwned|common/i.test(msg)) return t('auth.weak_password');
  if (err.code === '42501') return t('err.forbidden');
  if (err.code === '23503') return t('err.foreign_key');
  if (err.code === '23505') return t('err.duplicate_sku');
  return t('err.unknown');
}

/** Store logo with a graceful text fallback. The logo file is supplied by the owner (see shared/assets/README.md). */
export function brandMark({ asLink = true, href = '/customer/index.html' } = {}) {
  const img = el('img', {
    attrs: { src: CONFIG.LOGO_PATH, alt: 'POWER TECH', width: 44, height: 44, loading: 'eager', decoding: 'async' },
    dataset: { logo: '1' },
  });
  const words = el('span', { className: 'brand-words' },
    el('strong', {}, 'POWER TECH'),
    el('small', { attrs: { 'data-i18n': 'app.tagline' } }, t('app.tagline')));
  const inner = [img, words];
  return asLink ? el('a', { className: 'brand', attrs: { href } }, ...inner) : el('div', { className: 'brand' }, ...inner);
}

// If the logo file is missing, hide the broken image; the wordmark text remains visible.
document.addEventListener('error', (event) => {
  const target = event.target;
  if (target instanceof HTMLImageElement && target.dataset.logo) target.hidden = true;
}, true);

/** Simple accessible modal confirmation using a native <dialog>. Resolves true/false. */
export function confirmAction(message) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { className: 'dialog' },
      el('p', {}, message),
      el('div', { className: 'dialog-actions' },
        el('button', { className: 'btn btn-ghost', attrs: { type: 'button' }, on: { click: () => close(false) } }, t('admin.cancel')),
        el('button', { className: 'btn btn-primary', attrs: { type: 'button' }, on: { click: () => close(true) } }, 'OK')));
    function close(v) {
      dialog.close();
      dialog.remove();
      resolve(v);
    }
    dialog.addEventListener('cancel', () => close(false));
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('.btn-primary').focus();
  });
}

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
