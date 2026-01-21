const fs = require('fs');
const path = require('path');

const generatorPath = path.join('MatrixCode_v8.5', 'js', 'effects', 'QuantizedSequenceGeneratorV2.js');
const generatorCode = fs.readFileSync(generatorPath, 'utf8');

const wrappedCode = generatorCode + "\n;global.QuantizedSequenceGeneratorV2 = QuantizedSequenceGeneratorV2;";
eval(wrappedCode);

try {
    const gen = new global.QuantizedSequenceGeneratorV2();
    const width = 100;
    const height = 50;
    const params = {
        aspectRatio: 2.0,
        minBlockSize: 2,
        maxBlockSize: 6,
        blockWidth: 1,
        blockHeight: 1
    };

    console.log("Testing Random Spawn + Layer Check with Aspect Ratio:", params.aspectRatio);

    const seq = gen.generate(width, height, 50, params); // 50 steps

    let layer0 = 0;
    let layer1 = 0;

    for (const step of seq) {
        for (const op of step) {
            if (op[0] === 'addRect') {
                const layer = op[5]; // Layer ID is index 5
                if (layer === 0) layer0++;
                if (layer === 1) layer1++;
            }
        }
    }

    console.log(`Layer 0 Blocks: ${layer0}`);
    console.log(`Layer 1 Blocks: ${layer1}`);

    if (layer1 === 0 && layer0 > 0) {
        console.log("SUCCESS: All blocks forced to Layer 0.");
    } else {
        console.log("FAILURE: Layer 1 blocks still exist.");
    }

} catch (e) {
    console.error("Test Failed:", e);
}
