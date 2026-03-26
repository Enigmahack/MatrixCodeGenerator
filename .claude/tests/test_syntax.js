const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { JS_ROOT, discoverJSFiles, SKIP_FILES } = require('./harness');

describe('Syntax Validation', () => {
    const allFiles = discoverJSFiles();

    it('should discover JS files', () => {
        assert.ok(allFiles.length > 10, `Expected >10 JS files, found ${allFiles.length}`);
    });

    for (const rel of allFiles) {
        it(`parses without SyntaxError: ${rel}`, () => {
            const fullPath = path.join(JS_ROOT, rel);
            const code = fs.readFileSync(fullPath, 'utf-8');
            // vm.Script constructor will throw SyntaxError if code is invalid
            new vm.Script(code, { filename: rel });
        });
    }

    // Parse QuantizedPatterns separately with a generous timeout
    it('parses QuantizedPatterns.js (large file)', () => {
        const patternsPath = path.join(JS_ROOT, 'js/effects/QuantizedPatterns.js');
        if (!fs.existsSync(patternsPath)) {
            // Skip if file doesn't exist
            return;
        }
        const code = fs.readFileSync(patternsPath, 'utf-8');
        new vm.Script(code, { filename: 'QuantizedPatterns.js' });
    });
});
