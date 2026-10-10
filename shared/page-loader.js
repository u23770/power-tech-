// shared/page-loader.js — shared full-page transition loader for customer and admin pages.
(function () {
  'use strict';
  if (document.getElementById('page-loader')) return;

  var lang = (document.documentElement.lang || 'en').toLowerCase().indexOf('ar') === 0 ? 'ar' : 'en';
  var labels = lang === 'ar'
    ? { loading: 'جارٍ تحميل الصفحة', title: 'بنجهّز الصفحة ليك...', note: 'لحظات وتكون جاهزة' }
    : { loading: 'Loading page', title: 'Preparing your page…', note: 'Just a moment' };

  var overlay = document.createElement('div');
  overlay.id = 'page-loader';
  overlay.className = 'page-loader';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-label', labels.loading);
  overlay.setAttribute('aria-hidden', 'false');

  var card = document.createElement('div');
  card.className = 'page-loader-card';
  var badge = document.createElement('div');
  badge.className = 'page-loader-badge';
  badge.setAttribute('aria-hidden', 'true');
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('focusable', 'false');
  var bolt = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  bolt.setAttribute('d', 'M27.6 3.5 10.8 26h11.1l-1.6 18.5L37.2 20H25.8l1.8-16.5Z');
  bolt.setAttribute('fill', 'currentColor');
  svg.appendChild(bolt);
  badge.appendChild(svg);

  function textElement(tag, className, value) {
    var node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }

  var wordmark = textElement('div', 'page-loader-wordmark', 'POWER TECH');
  var subtitle = textElement('div', 'page-loader-subbrand', 'TECHNOLOGY STORE');
  var message = textElement('div', 'page-loader-message', labels.title);
  var note = textElement('div', 'page-loader-note', labels.note);
  var progress = document.createElement('div');
  progress.className = 'page-loader-track';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', labels.loading);
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.appendChild(document.createElement('span'));
  card.append(badge, wordmark, subtitle, message, note, progress);
  overlay.appendChild(card);
  document.documentElement.appendChild(overlay);

  var visibleSince = Date.now();
  var fallbackTimer = null;
  var navigationPending = false;
  var minimumVisibleMs = 380;

  function setBusy(busy) {
    if (!document.body) return;
    if (busy) document.body.setAttribute('aria-busy', 'true');
    else document.body.removeAttribute('aria-busy');
  }
  function hideImmediately() {
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    fallbackTimer = null;
    navigationPending = false;
    overlay.classList.add('is-hidden');
    overlay.setAttribute('aria-hidden', 'true');
    setBusy(false);
  }
  function hide() {
    var wait = Math.max(0, minimumVisibleMs - (Date.now() - visibleSince));
    window.setTimeout(hideImmediately, wait);
  }
  function showForNavigation() {
    navigationPending = true;
    visibleSince = Date.now();
    overlay.classList.remove('is-hidden');
    overlay.setAttribute('aria-hidden', 'false');
    setBusy(true);
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    fallbackTimer = window.setTimeout(function () {
      navigationPending = false;
      hide();
    }, 5000);
  }

  document.addEventListener('DOMContentLoaded', function () { setBusy(true); });
  window.addEventListener('load', function () { if (!navigationPending) hide(); }, { once: true });
  window.addEventListener('pageshow', function (event) { if (event.persisted) hideImmediately(); });

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download')) return;
    var target = (link.getAttribute('target') || '').toLowerCase();
    if (target && target !== '_self') return;
    var url;
    try { url = new URL(link.href, window.location.href); } catch (error) { return; }
    if (url.origin !== window.location.origin || (url.protocol !== 'http:' && url.protocol !== 'https:')) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    showForNavigation();
  }, true);

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement) || event.defaultPrevented) return;
    if (typeof form.checkValidity === 'function' && !form.checkValidity()) return;
    var target = (form.getAttribute('target') || '').toLowerCase();
    if (target && target !== '_self') return;
    var action;
    try { action = new URL(form.action || window.location.href, window.location.href); } catch (error) { return; }
    if (action.origin !== window.location.origin) return;
    window.setTimeout(function () { if (!event.defaultPrevented) showForNavigation(); }, 0);
  }, true);
})();