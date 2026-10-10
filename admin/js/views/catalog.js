// admin/js/views/catalog.js — manage active categories and product brands.
import { t, getLang, applyI18n } from '/shared/i18n.js';
import { el, clear, setStatus, setBusy, confirmAction, errorMessage } from '/shared/ui.js';
import * as api from '../api.js';

function inputField(id, label, value, attrs = {}) {
  const input = el('input', { className: 'input', attrs: { id, name: id, value: value ?? '', ...attrs } });
  return { input, field: el('div', { className: 'field' }, el('label', { attrs: { for: id } }, label), input) };
}

function slugFromName(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export async function render(main, ctx) {
  const host = el('div', {});
  const msg = el('div', { className: 'status', attrs: { role: 'status', 'aria-live': 'polite', hidden: true } });
  main.append(
    el('div', { className: 'page-title' }, el('h1', { className: 'card-title' }, t('admin.nav.catalog'))),
    el('p', { className: 'muted' }, t('admin.catalog.intro')),
    msg,
    host
  );

  async function reload() {
    clear(host);
    host.append(el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
    try {
      const [categories, brands] = await Promise.all([api.listCategoriesAdmin(), api.listBrandsAdmin()]);
      clear(host);
      renderCategories(categories);
      renderBrands(brands);
      applyI18n(host);
    } catch (err) {
      clear(host);
      host.append(el('div', { className: 'status', attrs: { role: 'alert' }, dataset: { kind: 'error' } }, errorMessage(err)));
    }
  }

  function renderCategories(categories) {
    const name = inputField('new-cat-en', t('admin.catalog.name_en'), '', { required: 'required', minlength: '2', maxlength: '120' });
    const nameAr = inputField('new-cat-ar', t('admin.catalog.name_ar'), '', { maxlength: '120' });
    const slug = inputField('new-cat-slug', t('admin.catalog.slug'), '', { required: 'required', minlength: '2', maxlength: '80', pattern: '[a-z0-9-]{2,80}' });
    const order = inputField('new-cat-order', t('admin.catalog.sort_order'), String((categories.reduce((m, c) => Math.max(m, c.sort_order || 0), -1) + 1) * 10), { type: 'number', step: '1', required: 'required' });
    name.input.addEventListener('input', () => {
      if (!slug.input.dataset.touched) slug.input.value = slugFromName(name.input.value);
    });
    slug.input.addEventListener('input', () => { slug.input.dataset.touched = '1'; });

    const addForm = el('form', { className: 'card form' },
      el('h2', {}, t('admin.catalog.add_category')),
      el('div', { className: 'form-grid two' }, name.field, nameAr.field, slug.field, order.field),
      el('div', { className: 'form-actions' },
        el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.catalog.create_category'))));
    addForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = addForm.querySelector('button[type="submit"]');
      if (!addForm.reportValidity()) return;
      setBusy(button, true, t('state.loading'));
      try {
        await api.insertCategoryAdmin({
          name_en: name.input.value.trim(),
          name_ar: nameAr.input.value.trim() || null,
          slug: slug.input.value.trim(),
          sort_order: Number(order.input.value),
          is_active: true,
        });
        setStatus(msg, t('admin.catalog.category_created'), 'success');
        await reload();
      } catch (err) {
        setStatus(msg, errorMessage(err), 'error');
      } finally {
        setBusy(button, false);
      }
    });

    const section = el('section', { className: 'stack' },
      el('h2', {}, `${t('admin.catalog.categories')} (${categories.length})`),
      addForm);
    if (!categories.length) section.append(el('p', { className: 'muted' }, t('admin.catalog.no_categories')));
    for (const category of categories) {
      const en = inputField(`cat-en-${category.id}`, t('admin.catalog.name_en'), category.name_en, { required: 'required', minlength: '1', maxlength: '120' });
      const ar = inputField(`cat-ar-${category.id}`, t('admin.catalog.name_ar'), category.name_ar || '', { maxlength: '120' });
      const sl = inputField(`cat-slug-${category.id}`, t('admin.catalog.slug'), category.slug, { required: 'required', minlength: '2', maxlength: '80', pattern: '[a-z0-9-]{2,80}' });
      const ord = inputField(`cat-order-${category.id}`, t('admin.catalog.sort_order'), String(category.sort_order), { type: 'number', step: '1', required: 'required' });
      const editForm = el('form', { className: 'card form' },
        el('div', { className: 'row' },
          el('h3', {}, category.name_en),
          el('span', { className: 'badge', dataset: { kind: category.is_active ? 'success' : 'muted' } }, t(category.is_active ? 'admin.catalog.active' : 'admin.catalog.inactive')),
          el('span', { className: 'spacer' })),
        el('div', { className: 'form-grid two' }, en.field, ar.field, sl.field, ord.field),
        el('div', { className: 'form-actions' },
          el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.save')),
          el('button', { className: 'btn btn-ghost', attrs: { type: 'button' }, on: { click: async () => {
            try {
              await api.setCategoryActiveAdmin(category.id, !category.is_active);
              setStatus(msg, t(category.is_active ? 'admin.catalog.category_hidden' : 'admin.catalog.category_shown'), 'success');
              await reload();
            } catch (err) { setStatus(msg, errorMessage(err), 'error'); }
          } } }, t(category.is_active ? 'admin.catalog.deactivate' : 'admin.catalog.activate')),
          el('button', { className: 'btn btn-danger', attrs: { type: 'button' }, on: { click: async () => {
            if (!(await confirmAction(t('admin.catalog.delete_category_confirm')))) return;
            try {
              await api.deleteCategoryAdmin(category.id);
              setStatus(msg, t('admin.catalog.category_deleted'), 'success');
              await reload();
            } catch (err) { setStatus(msg, errorMessage(err), 'error'); }
          } } }, t('admin.delete'))));
      editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!editForm.reportValidity()) return;
        const button = editForm.querySelector('button[type="submit"]');
        setBusy(button, true);
        try {
          await api.updateCategoryAdmin(category.id, {
            name_en: en.input.value.trim(),
            name_ar: ar.input.value.trim() || null,
            slug: sl.input.value.trim(),
            sort_order: Number(ord.input.value),
          });
          setStatus(msg, t('admin.saved'), 'success');
          await reload();
        } catch (err) {
          setStatus(msg, errorMessage(err), 'error');
        } finally { setBusy(button, false); }
      });
      section.append(editForm);
    }
    host.append(section);
  }

  function renderBrands(brands) {
    const brandName = inputField('new-brand-name', t('admin.catalog.brand_name'), '', { required: 'required', minlength: '1', maxlength: '80' });
    const form = el('form', { className: 'card form' },
      el('h2', {}, t('admin.catalog.brands')),
      el('p', { className: 'muted' }, t('admin.catalog.brand_hint')),
      el('div', { className: 'form-grid two' }, brandName.field),
      el('div', { className: 'form-actions' },
        el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.catalog.add_brand'))));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      setBusy(button, true);
      try {
        await api.insertBrandAdmin(brandName.input.value);
        setStatus(msg, t('admin.catalog.brand_created'), 'success');
        await reload();
      } catch (err) { setStatus(msg, errorMessage(err), 'error'); }
      finally { setBusy(button, false); }
    });
    const list = el('div', { className: 'card' },
      el('h3', {}, t('admin.catalog.saved_brands')));
    if (!brands.length) list.append(el('p', { className: 'muted' }, t('admin.catalog.no_brands')));
    else list.append(el('ul', { className: 'item-list' }, ...brands.map((brand) =>
      el('li', {}, el('span', {}, brand.name), ' ',
        el('button', { className: 'btn btn-danger btn-small', attrs: { type: 'button' }, on: { click: async () => {
          if (!(await confirmAction(t('admin.catalog.delete_brand_confirm')))) return;
          try {
            await api.deleteBrandAdmin(brand.id);
            setStatus(msg, t('admin.catalog.brand_deleted'), 'success');
            await reload();
          } catch (err) { setStatus(msg, errorMessage(err), 'error'); }
        } } }, t('admin.delete'))))));
    host.append(el('div', { className: 'two-col' }, form, list));
  }

  await reload();
  applyI18n(main);
}
