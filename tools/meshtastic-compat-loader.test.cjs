const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const loader = require('./meshtastic-compat-loader.cjs');

test('HTTP starts polling while configuration is pending', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@meshtastic', 'js', 'dist', 'index.js'), 'utf8');
    const patched = loader(source);
    const start = patched.indexOf('Connection succeeded, starting configuration and request timer.');
    const end = patched.indexOf('}, fetchInterval);', start);
    assert.ok(start >= 0 && end > start);
    const section = patched.slice(start, end);
    assert.match(section, /this\.configure\(\)\.catch/);
    assert.doesNotMatch(section, /await this\.configure\(\)/);
    assert.match(section, /this\.readFromRadio\(\)/);
});

test('compatibility loader fails explicitly if the upstream code changes', () => {
    assert.throws(() => loader('array.buffer instanceof SharedArrayBuffer'), /HTTP configuration patch/);
});
