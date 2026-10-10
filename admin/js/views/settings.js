// admin/js/views/settings.js — edit validated, JSON-backed store settings.
import { t, applyI18n } from '/shared/i18n.js';
import { el, clear, setStatus, setBusy, errorMessage } from '/shared/ui.js';
import * as api from '../api.js';

const SUPPORTED = {
  checkout_options: { delivery: true, pickup: false, cod: true, pay_at_store: false },
  delivery_fee: { amount: 0 },
  max_qty_per_line: 10,
  currency: { code: 'EGP' },
  guest_checkout: { enabled: true },
  contact: {},
};

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

export async function render(main, ctx) {
  const msg = el('div', { className: 'status', attrs: { role: 'status', 'aria-live': 'polite', hidden: true } });
  const host = el('div', { className: 'stack' });
  const title = el('h1', { className: 'card-title' }, t('admin.nav.settings'));
  main.append(el('div', { className: 'page-title' }, title), el('p', { className: 'muted' }, t('admin.settings.intro')), msg, host);

  async function reload() {
    clear(host);
    host.append(el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
    try {
      const rows = await api.listStoreSettingsAdmin();
      clear(host);
      const addForm = buildAddForm(rows);
      host.append(addForm);
      if (!rows.length) host.append(el('p', { className: 'muted' }, t('admin.settings.empty')));
      for (const row of rows) host.append(buildSettingCard(row));
      applyI18n(host);
    } catch (err) {
      clear(host);
      host.append(el('div', { className: 'status', attrs: { role: 'alert' }, dataset: { kind: 'error' } }, errorMessage(err)));
    }
  }

  function buildAddForm(rows) {
    const availableKeys = Object.keys(SUPPORTED).filter((key) => !rows.some((r) => r.key === key));
    if (!availableKeys.length) return el('section', { className: 'card' }, el('h2', {}, t('admin.settings.add')), el('p', { className: 'muted' }, t('admin.settings.all_added')));
    const select = el('select', { className: 'select', attrs: { id: 'setting-new-key', name: 'key' } },
      ...availableKeys.map((key) => el('option', { attrs: { value: key } }, t(`admin.settings.key.${key}`))));
    const isPublic = el('input', { attrs: { type: 'checkbox', checked: 'checked', id: 'setting-new-public' } });
    const form = el('form', { className: 'card form' },
      el('h2', {}, t('admin.settings.add')),
      el('div', { className: 'form-grid two' },
        el('div', { className: 'field' }, el('label', { attrs: { for: 'setting-new-key' } }, t('admin.settings.key')), select),
        el('label', { className: 'checkbox-row', attrs: { for: 'setting-new-public' } }, isPublic, t('admin.settings.public'))),
      el('p', { className: 'hint' }, t('admin.settings.add_hint')),
      el('div', { className: 'form-actions' }, el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.settings.add_button'))));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const key = select.value;
      if (rows.some((r) => r.key === key)) return setStatus(msg, t('admin.settings.exists'), 'error');
      const button = form.querySelector('button[type="submit"]');
      setBusy(button, true);
      try {
        await api.saveStoreSettingAdmin(key, SUPPORTED[key], isPublic.checked);
        setStatus(msg, t('admin.saved'), 'success');
        await reload();
      } catch (err) { setStatus(msg, errorMessage(err), 'error'); }
      finally { setBusy(button, false); }
    });
    return form;
  }

  function buildSettingCard(row) {
    const id = `setting-${row.key}`;
    const textarea = el('textarea', { className: 'textarea code', attrs: { id, name: 'value', rows: 5, spellcheck: 'false', 'aria-label': t('admin.settings.json_value') } }, pretty(row.value));
    const publicCheck = el('input', { attrs: { type: 'checkbox', checked: row.is_public ? 'checked' : null, id: `${id}-public` } });
    const save = el('button', { className: 'btn btn-dark', attrs: { type: 'button' }, on: { click: async () => {
      let value;
      try { value = JSON.parse(textarea.value); }
      catch { return setStatus(msg, t('admin.settings.invalid_json'), 'error'); }
      setBusy(save, true);
      try {
        await api.saveStoreSettingAdmin(row.key, value, publicCheck.checked);
        setStatus(msg, t('admin.saved'), 'success');
        await reload();
      } catch (err) { setStatus(msg, errorMessage(err), 'error'); }
      finally { setBusy(save, false); }
    } } }, t('admin.save'));
    return el('section', { className: 'card form' },
      el('div', { className: 'toolbar-admin' },
        el('h2', {}, t(`admin.settings.key.${row.key}`)),
        el('span', { className: 'muted code' }, row.key)),
      el('label', { className: 'field', attrs: { for: id } }, el('span', { className: 'label' }, t('admin.settings.json_value')), textarea),
      el('label', { className: 'checkbox-row', attrs: { for: `${id}-public` } }, publicCheck, t('admin.settings.public')),
      el('p', { className: 'hint' }, t('admin.settings.validated')),
      el('div', { className: 'form-actions' }, save));
  }

  await reload();
  applyI18n(main);
}
