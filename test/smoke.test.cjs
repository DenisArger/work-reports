const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('telegram handler and helper libs exist', () => {
  assert.ok(fs.existsSync('api/telegram.ts'));
  assert.ok(fs.existsSync('lib/telegram.ts'));
  assert.ok(fs.existsSync('lib/googleDrive.ts'));
});
