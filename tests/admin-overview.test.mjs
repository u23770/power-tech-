import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../admin/js/views/overview.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../admin/js/app.js', import.meta.url), 'utf8');

test('overview initializes the date-range status element before using it', () => {
  const declaration = source.indexOf('const rangeMsg = el(');
  const validationUse = source.indexOf('setStatus(rangeMsg,');
  const appendUse = source.indexOf('rangeMsg, host');

  assert.notEqual(declaration, -1, 'rangeMsg must be initialized');
  assert.ok(validationUse > declaration, 'validation must only use rangeMsg after initialization');
  assert.ok(appendUse > declaration, 'the page must append the initialized rangeMsg element');
});

test('admin app uses the route parser that separates date filters from the route name', () => {
  assert.match(app, /import \{ parseAdminHash \} from '\.\/router\.js'/);
  assert.match(app, /function parseHash\(\)\s*\{\s*return parseAdminHash\(location\.hash\);\s*\}/);
});
