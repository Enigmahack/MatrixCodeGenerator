const fs = require('fs');
const path = require('path');

const generatorPath = path.join('MatrixCode_v8.5', 'js', 'effects', 'QuantizedSequenceGenerator.js');
const generatorCode = fs.readFileSync(generatorPath, 'utf8');

// Hack to export the class from eval
const wrappedCode = generatorCode + "\n;global.QuantizedSequenceGenerator = QuantizedSequenceGenerator;";
eval(wrappedCode);

try {
    const gen = new global.QuantizedSequenceGenerator();
    const width = 20;
    const height = 15;
    const seq = gen.generate(width, height, 100, {
        blocksPerStep: 2,
        maxBlocksPerStep: 10,
        innerLineDuration: 5
    });

    console.log("Sequence Length:", seq.length);
    
    if (seq.length > 0) {
        console.log("Step 0 Ops:", JSON.stringify(seq[0]));
        if (seq.length > 5) {
            console.log("Step 5 Ops:", JSON.stringify(seq[5]));
        }
    } else {
        console.log("SEQUENCE IS EMPTY!");
    }

    // Check for specific ops
    let hasAdd = false;
    let hasAddLine = false;
    let hasRemLine = false;

    for (const step of seq) {
        for (const op of step) {
            if (op[0] === 'add' || op[0] === 'addRect') hasAdd = true;
            if (op[0] === 'addLine') hasAddLine = true;
            if (op[0] === 'remLine') hasRemLine = true;
        }
    }

    console.log("Has Add/AddRect:", hasAdd);
    console.log("Has AddLine:", hasAddLine);
    console.log("Has RemLine:", hasRemLine);

} catch (e) {
    console.error("Generator Crashed:", e);
}