const fs = require('fs');
const path = require('path');
const QuantizedAnimationOptimizer = require('./QuantizedAnimationOptimizer.js');

const INPUT_FILE = path.join(__dirname, '../effects/QuantizedPatterns.js');
const OUTPUT_JS_FILE = path.join(__dirname, '../effects/QuantizedPatterns.js');
const OUTPUT_JSON_FILE = path.join(__dirname, '../../presets/QuantizedPatterns.json');

// --- CONSTANTS ---
const OPS = {
    'add': 1,
    'rem': 2,
    'addRect': 3,
    'addBlock': 3,
    'addSmart': 6,
    'removeBlock': 7,
    'nudge': 12,
    'nudgeML': 13
};

const FACES = {
    'N': 1, 'n': 1,
    'S': 2, 's': 2,
    'E': 4, 'e': 4,
    'W': 8, 'w': 8,
    'NW': 9, 'NE': 5, 'SW': 10, 'SE': 6
};

// --- HELPER FUNCTIONS ---

function encodeSequence(sequence) {
    const packedSequence = [];
    let totalOriginalSize = 0;
    let totalPackedSize = 0;

    for (const step of sequence) {
        totalOriginalSize += JSON.stringify(step).length;
        const stepData = [];
        
        for (const opObj of step) {
            let opName, args, layer = 0;
            if (Array.isArray(opObj)) {
                opName = opObj[0];
                args = opObj.slice(1);
                layer = opObj.length >= 6 ? opObj[5] : 0;
            } else {
                opName = opObj.op;
                args = opObj.args;
                layer = opObj.layer || 0;
            }

            const opCode = OPS[opName];
            if (!opCode) {
                console.warn(`Skipping unknown op: ${opName}`);
                continue;
            }

            // Args Packing
            if (opCode === 1) { // add
                if (layer > 0) stepData.push(8, args[0], args[1], layer);
                else stepData.push(1, args[0], args[1]);
            } else if (opCode === 3) { // addRect / addBlock
                if (layer > 0) stepData.push(9, args[0], args[1], args[2], args[3], layer);
                else stepData.push(3, args[0], args[1], args[2], args[3]);
            } else if (opCode === 6) { // addSmart
                if (layer > 0) stepData.push(10, args[0], args[1], layer);
                else stepData.push(6, args[0], args[1]);
            } else if (opCode === 7) { // removeBlock
                const x1 = args[0], y1 = args[1];
                const x2 = (args.length >= 4) ? args[2] : x1;
                const y2 = (args.length >= 4) ? args[3] : y1;
                if (layer > 0) stepData.push(11, x1, y1, x2, y2, layer);
                else stepData.push(7, x1, y1, x2, y2);
            } else if (opCode === 2) { // rem
                stepData.push(2, args[0], args[1]);
                let mask = (layer << 4);
                if (args.length > 2 && typeof args[2] === 'string') {
                    mask |= (FACES[args[2].toUpperCase()] || 0);
                }
                stepData.push(mask);
            } else if (opCode === 12 || opCode === 13) {
                // nudge: x, y, w, h, layer, faceMask
                stepData.push(opCode, args[0], args[1], args[2], args[3], layer);
                let faceMask = 0;
                if (args.length > 4 && typeof args[4] === 'string') {
                    faceMask = FACES[args[4].toUpperCase()] || 0;
                }
                stepData.push(faceMask);
            }
        }
        packedSequence.push(stepData);
        totalPackedSize += JSON.stringify(stepData).length;
    }

    console.log(`Step Compression: ${(totalOriginalSize/1024).toFixed(2)}KB -> ${(totalPackedSize/1024).toFixed(2)}KB`);
    return packedSequence;
}

// --- MAIN ---

try {
    if (!fs.existsSync(INPUT_FILE)) {
        throw new Error(`Input file not found: ${INPUT_FILE}`);
    }

    console.log(`Reading input from: ${INPUT_FILE}`);
    const fileContent = fs.readFileSync(INPUT_FILE, 'utf8');
    
    const window = {};
    eval(fileContent); 

    if (!window.matrixPatterns) {
        throw new Error("window.matrixPatterns not found in input file.");
    }
    const patterns = window.matrixPatterns;
    const optimizer = new QuantizedAnimationOptimizer();

    const newPatterns = {};
    for (const key in patterns) {
        console.log(`Processing pattern: ${key}`);
        const originalPattern = patterns[key];
        const optimizedPattern = optimizer.optimize(originalPattern);
        
        const originalOps = originalPattern.flat().length;
        const optimizedOps = optimizedPattern.flat().length;
        if (originalOps > 0) {
            const reduction = Math.round((1 - (optimizedOps / originalOps)) * 100);
            console.log(`- Optimization reduced operations by ${reduction}% (${originalOps} -> ${optimizedOps})`);
        }
        
        newPatterns[key] = encodeSequence(optimizedPattern);
    }

    // Generate JS Output
    let output = "// Optimized Matrix Patterns (Encoded)\n";
    output += "window.matrixPatterns = {\n";
    
    const keys = Object.keys(newPatterns);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const seq = newPatterns[key];
        output += `    "${key}": [\n`;
        for (let j = 0; j < seq.length; j++) {
            const step = seq[j];
            output += `        [${step.join(',')}]${j < seq.length - 1 ? ',' : ''}\n`;
        }
        output += `    ]${i < keys.length - 1 ? ',' : ''}\n`;
    }
    output += "};\n";

    fs.writeFileSync(OUTPUT_JS_FILE, output);
    console.log(`JS output written to: ${OUTPUT_JS_FILE}`);

    // Generate JSON Output
    fs.writeFileSync(OUTPUT_JSON_FILE, JSON.stringify(newPatterns));
    console.log(`JSON output written to: ${OUTPUT_JSON_FILE}`);

} catch (err) {
    console.error("Error:", err);
    process.exit(1);
}

