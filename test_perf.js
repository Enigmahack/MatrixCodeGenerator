const fs = require('fs');
const path = require('path');

const generatorPath = path.join('MatrixCode_v8.5', 'js', 'effects', 'QuantizedSequenceGeneratorV2.js');
const generatorCode = fs.readFileSync(generatorPath, 'utf8');

const wrappedCode = generatorCode + "\n;global.QuantizedSequenceGeneratorV2 = QuantizedSequenceGeneratorV2;";
eval(wrappedCode);

try {
    console.time("Generation");
    const gen = new global.QuantizedSequenceGeneratorV2();
    const width = 30; // Standard grid size
    const height = 30;
    const params = {
        aspectRatio: 1.0,
        minBlockSize: 2,
        maxBlockSize: 6,
        blockWidth: 1,
        blockHeight: 1
    };

    console.log("Starting Generation...");
    const seq = gen.generate(width, height, 100, params); // 100 steps
    console.timeEnd("Generation");

    let totalOps = 0;
    let maxCoord = 0;
    let minCoord = 0;

    for (const step of seq) {
        totalOps += step.length;
        for (const op of step) {
            if (op[0] === 'addRect') {
                const x = op[1];
                const y = op[2];
                maxCoord = Math.max(maxCoord, x, y);
                minCoord = Math.min(minCoord, x, y);
            }
        }
    }

    console.log(`Total Steps: ${seq.length}`);
    console.log(`Total Ops: ${totalOps}`);
    console.log(`Coordinate Range: ${minCoord} to ${maxCoord}`);
    
    if (Math.abs(maxCoord) > 100 || Math.abs(minCoord) > 100) {
        console.log("WARNING: Coordinates are exploding!");
    } else {
        console.log("Coordinates look healthy.");
    }

} catch (e) {
    console.error("Test Failed:", e);
}
