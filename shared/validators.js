// shared/validators.js — client-side validation for UX. The database re-validates everything.
import { t } from '/shared/i18n.js';

export const PATTERNS = Object.freeze({
  phone: /^\+?[0-9 ()-]{6,20}$/,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  slug: /^[a-z0-9-]{2,120}$/,
  sku: /^[A-Za-z0-9._-]{2,64}$/,
  specKey: /^[a-z][a-z0-9_]{1,40}$/,
  couponCode: /^[A-Z0-9_-]{3,32}$/,
});

export function isEmail(v) {
  return v.length <= 254 && PATTERNS.email.test(v);
}

export function isPhone(v) {
  return PATTERNS.phone.test(v.trim());
}

/** Empty is allowed; otherwise the URL must be https. */
export function isHttpsUrlOrEmpty(v) {
  if (!v) return true;
  try {
    return new URL(v).protocol === 'https:' && v.length <= 500;
  } catch {
    return false;
  }
}

/** Returns an object of {fieldName: message} for the customer checkout form. Empty object = valid. */
export function validateCustomer(values) {
  const errors = {};
  const name = (values.name || '').trim();
  const phone = (values.phone || '').trim();
  const email = (values.email || '').trim();
  const address = (values.address || '').trim();
  if (name.length < 2 || name.length > 120) errors.name = t('val.name');
  if (!isPhone(phone)) errors.phone = t('val.phone');
  if (email && !isEmail(email)) errors.email = t('val.email');
  if (!(values.governorate || '').trim()) errors.governorate = t('val.required');
  if (!(values.city || '').trim()) errors.city = t('val.required');
  if (address.length < 5 || address.length > 300) errors.address = t('val.address');
  if ((values.notes || '').length > 500) errors.notes = t('val.too_long', { n: 500 });
  if (!isHttpsUrlOrEmpty((values.location || '').trim())) errors.location = t('val.https');
  return errors;
}

/** Parse "key: value" lines into a specs object. Returns {specs, errors[]}. */
export function parseSpecs(text) {
  const specs = {};
  const errors = [];
  const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 1) {
      errors.push(`Missing "key: value" format: ${line}`);
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!PATTERNS.specKey.test(key)) {
      errors.push(`Invalid key "${key}": use lowercase letters, digits and underscores.`);
      continue;
    }
    if (!value || value.length > 300) {
      errors.push(`Value for "${key}" is empty or longer than 300 characters.`);
      continue;
    }
    specs[key] = value;
  }
  if (Object.keys(specs).length > 60) errors.push('Maximum 60 specification lines.');
  return { specs, errors };
}

/** Human-readable spec lines for display or editing. */
export function specsToText(specs) {
  if (!specs || typeof specs !== 'object') return '';
  return Object.entries(specs).map(([k, v]) => `${k}: ${v}`).join('\n');
}

export function slugify(text) {
  return (text || '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function isStrongEnoughPassword(v) {
  return typeof v === 'string' && v.length >= 8 && v.length <= 72;
}
