const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'MatrixCode_v8.5/js/effects/QuantizedAddEffect.js');

try {
    const content = fs.readFileSync(filePath, 'utf8');
    new Function(content); 
    console.log('Syntax OK');
} catch (e) {
    console.error('Syntax Error:', e.message);
    process.exit(1);
}
