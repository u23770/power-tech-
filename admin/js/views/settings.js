// admin/js/views/settings.js — guided forms for common storefront settings.
import { t, applyI18n } from '/shared/i18n.js';
import { el, clear, setStatus, setBusy, errorMessage } from '/shared/ui.js';
import * as api from '../api.js';

const SUPPORTED = {
  store_name: { en: 'POWER TECH', ar: 'POWER TECH' },
  checkout_options: { delivery: true, pickup: false, cod: true, pay_at_store: false },
  delivery_fee: { amount: 0 },
  max_qty_per_line: 10,
  currency: { code: 'EGP' },
  guest_checkout: { enabled: true },
  contact: {},
  content_hero: { en: { title: '', subtitle: '', cta: '' }, ar: { title: '', subtitle: '', cta: '' } },
  content_why: { en: [], ar: [] },
};
const SETTINGS_ORDER = [
  'store_name', 'content_hero', 'content_why', 'contact',
  'checkout_options', 'delivery_fee', 'max_qty_per_line', 'currency', 'guest_checkout',
];

function field(id, label, value, attrs = {}) {
  const input = el('input', { className: 'input', attrs: { id, name: id, value: value ?? '', ...attrs } });
  return { input, field: el('div', { className: 'field' }, el('label', { attrs: { for: id } }, label), input) };
}
function textarea(id, label, value, rows = 3) {
  const input = el('textarea', { className: 'textarea', attrs: { id, name: id, rows } }, value ?? '');
  return { input, field: el('div', { className: 'field' }, el('label', { attrs: { for: id } }, label), input) };
}
function checkbox(id, label, checked) {
  const input = el('input', { attrs: { id, name: id, type: 'checkbox', checked: checked ? 'checked' : null } });
  return { input, field: el('label', { className: 'checkbox-row', attrs: { for: id } }, input, label) };
}
function localeValue(value, lang) {
  if (value && typeof value === 'object') return String(value[lang] ?? (lang === 'ar' ? value.en : value.ar) ?? '');
  return String(value ?? '');
}
function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function languageGroup(language, children) {
  return el('fieldset', { className: 'card form' },
    el('legend', {}, t(language === 'ar' ? 'admin.settings.arabic' : 'admin.settings.english')),
    ...children);
}

export async function render(main, ctx) {
  const msg = el('div', { className: 'status', attrs: { role: 'status', 'aria-live': 'polite', hidden: true } });
  const host = el('div', { className: 'stack' });
  main.append(
    el('div', { className: 'page-title' }, el('h1', { className: 'card-title' }, t('admin.nav.settings'))),
    el('p', { className: 'muted' }, t('admin.settings.intro')),
    el('p', { className: 'hint' }, t('admin.settings.quick_help')),
    msg,
    host,
  );

  async function reload() {
    clear(host);
    host.append(el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
    try {
      const rows = await api.listStoreSettingsAdmin();
      rows.sort((a, b) => {
        const ai = SETTINGS_ORDER.indexOf(a.key);
        const bi = SETTINGS_ORDER.indexOf(b.key);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
      });
      clear(host);
      host.append(buildAddForm(rows));
      if (!rows.length) host.append(el('p', { className: 'muted' }, t('admin.settings.empty')));
      for (const row of rows) host.append(buildSettingCard(row));
      applyI18n(host);
    } catch (err) {
      clear(host);
      host.append(el('div', { className: 'status', attrs: { role: 'alert' }, dataset: { kind: 'error' } }, errorMessage(err)));
    }
  }

  function buildAddForm(rows) {
    const availableKeys = SETTINGS_ORDER.filter((key) => !rows.some((row) => row.key === key));
    if (!availableKeys.length) return el('section', { className: 'card' },
      el('h2', {}, t('admin.settings.add')),
      el('p', { className: 'muted' }, t('admin.settings.all_added')));
    const select = el('select', { className: 'select', attrs: { id: 'setting-new-key', name: 'key' } },
      ...availableKeys.map((key) => el('option', { attrs: { value: key } }, t(`admin.settings.key.${key}`))));
    const publicCheck = checkbox('setting-new-public', t('admin.settings.public'), true);
    const button = el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.settings.add_button'));
    const formNode = el('form', { className: 'card form' },
      el('h2', {}, t('admin.settings.add')),
      el('div', { className: 'form-grid two' },
        el('div', { className: 'field' }, el('label', { attrs: { for: 'setting-new-key' } }, t('admin.settings.key')), select),
        publicCheck.field),
      el('p', { className: 'hint' }, t('admin.settings.add_hint')),
      el('div', { className: 'form-actions' }, button));
    formNode.addEventListener('submit', async (event) => {
      event.preventDefault();
      const key = select.value;
      if (!SUPPORTED[key]) return;
      if (rows.some((row) => row.key === key)) return setStatus(msg, t('admin.settings.exists'), 'error');
      setBusy(button, true);
      try {
        await api.saveStoreSettingAdmin(key, SUPPORTED[key], publicCheck.input.checked);
        setStatus(msg, t('admin.saved'), 'success');
        await reload();
      } catch (err) {
        setStatus(msg, errorMessage(err), 'error');
      } finally {
        setBusy(button, false);
      }
    });
    return formNode;
  }

  function buildSettingCard(row) {
    const value = row.value ?? SUPPORTED[row.key] ?? {};
    const editor = buildSettingFields(row.key, value);
    const publicCheck = checkbox(`setting-${row.key}-public`, t('admin.settings.public'), row.is_public);
    const save = el('button', { className: 'btn btn-dark', attrs: { type: 'button' } }, t('admin.settings.save'));
    save.addEventListener('click', async () => {
      const validation = editor.validate?.();
      if (validation) return setStatus(msg, t(validation), 'error');
      let nextValue;
      try {
        nextValue = editor.readValue();
      } catch {
        return setStatus(msg, t('admin.settings.invalid_value'), 'error');
      }
      setBusy(save, true);
      try {
        await api.saveStoreSettingAdmin(row.key, nextValue, publicCheck.input.checked);
        setStatus(msg, t('admin.saved'), 'success');
        await reload();
      } catch (err) {
        setStatus(msg, errorMessage(err), 'error');
      } finally {
        setBusy(save, false);
      }
    });

    const helpKey = `admin.settings.help.${row.key}`;
    const description = t(helpKey) === helpKey ? null : el('p', { className: 'muted' }, t(helpKey));
    return el('section', { className: 'card form' },
      el('div', { className: 'toolbar-admin' },
        el('h2', { className: 'card-title' }, t(`admin.settings.key.${row.key}`)),
        el('span', { className: 'muted code' }, row.key)),
      description,
      editor.node,
      publicCheck.field,
      el('div', { className: 'form-actions' }, save));
  }

  function buildSettingFields(key, source) {
    const wrap = el('div', { className: 'stack' });
    const unsupported = () => ({
      node: el('p', { className: 'hint' }, t('admin.settings.unsupported')),
      readValue: () => source,
      validate: () => 'admin.settings.unsupported',
    });

    if (key === 'checkout_options') {
      const fields = [
        ['delivery', 'admin.settings.delivery'],
        ['pickup', 'admin.settings.pickup'],
        ['cod', 'admin.settings.cash_on_delivery'],
        ['pay_at_store', 'admin.settings.pay_at_store'],
      ].map(([fieldKey, labelKey]) => ({ key: fieldKey, ...checkbox(`setting-checkout-${fieldKey}`, t(labelKey), source?.[fieldKey]) }));
      wrap.append(el('div', { className: 'form-grid two' }, ...fields.map((item) => item.field)));
      return {
        node: wrap,
        readValue: () => ({ ...source, ...Object.fromEntries(fields.map((item) => [item.key, item.input.checked])) }),
      };
    }

    if (key === 'delivery_fee') {
      const amount = field('setting-delivery-fee', t('admin.settings.fee_amount'), numberValue(source?.amount), {
        type: 'number', min: '0', max: '100000', step: '0.01', required: 'required', inputmode: 'decimal',
      });
      wrap.append(amount.field);
      return {
        node: wrap,
        readValue: () => ({ ...source, amount: Number(amount.input.value) }),
        validate: () => (!amount.input.value || !Number.isFinite(Number(amount.input.value))
          || Number(amount.input.value) < 0 || Number(amount.input.value) > 100000)
          ? 'admin.settings.invalid_fee' : null,
      };
    }

    if (key === 'max_qty_per_line') {
      const amount = field('setting-max-qty', t('admin.settings.max_quantity'), numberValue(source, 10), {
        type: 'number', min: '1', max: '50', step: '1', required: 'required',
      });
      wrap.append(amount.field);
      return {
        node: wrap,
        readValue: () => Number(amount.input.value),
        validate: () => (!Number.isInteger(Number(amount.input.value))
          || Number(amount.input.value) < 1 || Number(amount.input.value) > 50)
          ? 'admin.settings.invalid_quantity' : null,
      };
    }

    if (key === 'currency') {
      const code = field('setting-currency', t('admin.settings.currency_code'), String(source?.code || 'EGP'), {
        maxlength: '3', minlength: '3', pattern: '[A-Za-z]{3}', required: 'required', autocomplete: 'off',
      });
      code.input.addEventListener('input', () => { code.input.value = code.input.value.toUpperCase().slice(0, 3); });
      wrap.append(code.field);
      return {
        node: wrap,
        readValue: () => ({ ...source, code: code.input.value.trim().toUpperCase() }),
        validate: () => /^[A-Z]{3}$/.test(code.input.value.trim().toUpperCase()) ? null : 'admin.settings.invalid_currency',
      };
    }

    if (key === 'guest_checkout') {
      const enabled = checkbox('setting-guest-checkout', t('admin.settings.guest_enabled'), source?.enabled);
      wrap.append(enabled.field);
      return { node: wrap, readValue: () => ({ ...source, enabled: enabled.input.checked }) };
    }

    if (key === 'store_name') {
      const english = field('setting-store-name-en', t('admin.settings.name_en'), localeValue(source, 'en'), { maxlength: '80' });
      const arabic = field('setting-store-name-ar', t('admin.settings.name_ar'), localeValue(source, 'ar'), { maxlength: '80', dir: 'rtl' });
      wrap.append(el('div', { className: 'form-grid two' }, english.field, arabic.field));
      return {
        node: wrap,
        readValue: () => ({ ...source, en: english.input.value.trim(), ar: arabic.input.value.trim() }),
      };
    }

    if (key === 'content_hero') {
      const fields = {};
      for (const lang of ['en', 'ar']) {
        const current = source?.[lang] || {};
        const title = field(`setting-hero-${lang}-title`, t('admin.settings.hero_title'), current.title || '', { maxlength: '160', dir: lang === 'ar' ? 'rtl' : 'ltr' });
        const subtitle = textarea(`setting-hero-${lang}-subtitle`, t('admin.settings.hero_subtitle'), current.subtitle || '', 3);
        const cta = field(`setting-hero-${lang}-cta`, t('admin.settings.hero_button'), current.cta || '', { maxlength: '80', dir: lang === 'ar' ? 'rtl' : 'ltr' });
        fields[lang] = { title, subtitle, cta };
        wrap.append(languageGroup(lang, [title.field, subtitle.field, cta.field]));
      }
      return {
        node: wrap,
        readValue: () => Object.fromEntries(['en', 'ar'].map((lang) => [lang, {
          title: fields[lang].title.input.value.trim(),
          subtitle: fields[lang].subtitle.input.value.trim(),
          cta: fields[lang].cta.input.value.trim(),
        }])),
      };
    }

    if (key === 'content_why') {
      const list = el('div', { className: 'stack' });
      const addBtn = el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button' } }, t('admin.settings.add_benefit'));
      const initialEn = Array.isArray(source?.en) ? source.en : [];
      const initialAr = Array.isArray(source?.ar) ? source.ar : [];
      const count = Math.min(6, Math.max(initialEn.length, initialAr.length));
      let serial = 0;
      const items = [];
      function drawItems() {
        clear(list);
        for (const item of items) list.append(item.node);
        addBtn.disabled = items.length >= 6;
      }
      function addItem(en = {}, ar = {}) {
        if (items.length >= 6) return;
        const id = ++serial;
        const enTitle = field(`setting-benefit-${id}-en-title`, t('admin.settings.benefit_title'), en.title || '', { maxlength: '100' });
        const enText = textarea(`setting-benefit-${id}-en-text`, t('admin.settings.benefit_text'), en.text || '', 2);
        const arTitle = field(`setting-benefit-${id}-ar-title`, t('admin.settings.benefit_title'), ar.title || '', { maxlength: '100', dir: 'rtl' });
        const arText = textarea(`setting-benefit-${id}-ar-text`, t('admin.settings.benefit_text'), ar.text || '', 2);
        const item = { enTitle, enText, arTitle, arText, node: null };
        const remove = el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button' }, on: { click: () => {
          const index = items.indexOf(item);
          if (index >= 0) items.splice(index, 1);
          drawItems();
        } } }, t('admin.remove'));
        item.node = el('section', { className: 'card form' },
          el('div', { className: 'toolbar-admin' }, el('h3', {}, t('admin.settings.benefit_heading', { n: items.length + 1 })), remove),
          languageGroup('en', [enTitle.field, enText.field]),
          languageGroup('ar', [arTitle.field, arText.field]));
        items.push(item);
        drawItems();
      }
      for (let i = 0; i < count; i += 1) addItem(initialEn[i] || {}, initialAr[i] || {});
      addBtn.addEventListener('click', () => addItem());
      wrap.append(el('p', { className: 'muted' }, t('admin.settings.benefits_help')), list, addBtn);
      return {
        node: wrap,
        readValue: () => ({
          en: items.map((item) => ({ title: item.enTitle.input.value.trim(), text: item.enText.input.value.trim() }))
            .filter((item) => item.title || item.text).slice(0, 6),
          ar: items.map((item) => ({ title: item.arTitle.input.value.trim(), text: item.arText.input.value.trim() }))
            .filter((item) => item.title || item.text).slice(0, 6),
        }),
      };
    }

    if (key === 'contact') {
      const regular = [
        ['phone', 'admin.settings.contact.phone', 'tel'],
        ['email', 'admin.settings.contact.email', 'email'],
        ['whatsapp_url', 'admin.settings.contact.whatsapp', 'url'],
        ['map_url', 'admin.settings.contact.map', 'url'],
        ['facebook_url', 'admin.settings.contact.facebook', 'url'],
        ['instagram_url', 'admin.settings.contact.instagram', 'url'],
        ['tiktok_url', 'admin.settings.contact.tiktok', 'url'],
        ['youtube_url', 'admin.settings.contact.youtube', 'url'],
      ];
      const controls = {};
      wrap.append(el('div', { className: 'form-grid two' }, ...regular.map(([fieldKey, labelKey, type]) => {
        const attr = { maxlength: type === 'url' ? '500' : '254' };
        if (type === 'url') attr.placeholder = 'https://…';
        controls[fieldKey] = field(`setting-contact-${fieldKey}`, t(labelKey), source?.[fieldKey] || '', { type: type === 'tel' ? 'text' : type, ...attr });
        return controls[fieldKey].field;
      })));
      for (const keyName of ['address', 'hours']) {
        const langFields = {};
        for (const lang of ['en', 'ar']) {
          langFields[lang] = textarea(`setting-contact-${keyName}-${lang}`,
            t(`admin.settings.contact.${keyName}_${lang}`), localeValue(source?.[keyName], lang), 2);
        }
        controls[keyName] = langFields;
        wrap.append(languageGroup('en', [langFields.en.field]), languageGroup('ar', [langFields.ar.field]));
      }
      return {
        node: wrap,
        readValue: () => {
          const next = { ...source };
          for (const [fieldKey] of regular) next[fieldKey] = controls[fieldKey].input.value.trim();
          for (const keyName of ['address', 'hours']) {
            next[keyName] = {
              en: controls[keyName].en.input.value.trim(),
              ar: controls[keyName].ar.input.value.trim(),
            };
          }
          return next;
        },
        validate: () => {
          for (const [fieldKey] of regular) {
            const valueText = controls[fieldKey].input.value.trim();
            if (fieldKey.endsWith('_url') && valueText && !/^https:\/\/[^\s]+$/i.test(valueText)) return 'admin.settings.invalid_url';
          }
          const emailText = controls.email.input.value.trim();
          if (emailText && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailText)) return 'admin.settings.invalid_email';
          return null;
        },
      };
    }

    return unsupported();
  }

  await reload();
  applyI18n(main);
}
