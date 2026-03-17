// QuantizedWorker.js

// --- Globals ---
let effect = null;
let renderer = null;
let config = null;
let grid = null;

// A simple 'window' shim for compatibility
self.window = self; 

// --- Message Handling ---
self.onmessage = function(e) {
    const msg = e.data;

    switch (msg.type) {
        case 'init':
            // Load necessary scripts. This is a workaround for lack of modules in workers.
            importScripts(
                './EffectRegistry.js', // Defines AbstractEffect
                '../config/ConfigTemplate.js', // Defines QuantizedInheritableSettings
                '../rendering/GlyphAtlas.js', // Defines GlyphAtlas, used by Base and Renderer
                './QuantizedRenderer.js',
                '../core/Utils.js', // Assuming Utils is needed by renderer or base
                './QuantizedSequence.js',
                './QuantizedShadow.js',
                './QuantizedBaseEffect.js',
                './QuantizedPulseEffect.js',
                './QuantizedAddEffect.js',
                './QuantizedRetractEffect.js',
                './QuantizedClimbEffect.js',
                './QuantizedZoomEffect.js',
                './QuantizedBlockGeneration.js'
            );
            
            // Initial configuration
            config = msg.config;
            grid = msg.grid;
            
            // Hydrate grid mock with necessary dummy functions that can't serialize over postMessage
            grid.clearAllOverrides = function() {};
            grid.clearAllEffects = function() {};

            // Shim required globals for the classes
            self.c = { state: config, derived: {} };
            self.g = grid;
            self.r = {}; // Mock renderer object if needed

            // Pre-bake derived values that the effects might need
            self.c.derived.cycleDuration = self.c.state.cycleDuration;

            // Instantiate the shared renderer for all effects
            renderer = new QuantizedRenderer();
            
            self.postMessage({ type: 'ready' });
            break;

        case 'trigger':
            if (!self.c) {
                console.error('[Worker] Worker not initialized. Send "init" message first.');
                return;
            }
            // Update config with latest state from main thread
            self.c.state = msg.config;

            // Tell QuantizedBaseEffect constructor that it's running inside a worker
            self.isQuantizedWorkerThread = true;

            // Stop any previously running effect before creating a new one
            if (effect) {
                stopLoop();
                effect = null;
            }

            // Create the correct effect instance
            const effectName = msg.name;
            switch(effectName) {
                case 'QuantizedPulse':
                    effect = new QuantizedPulseEffect(self.g, self.c, self.r);
                    break;
                case 'QuantizedAdd':
                    effect = new QuantizedAddEffect(self.g, self.c, self.r);
                    break;
                case 'QuantizedRetract':
                    effect = new QuantizedRetractEffect(self.g, self.c, self.r);
                    break;
                case 'QuantizedClimb':
                    effect = new QuantizedClimbEffect(self.g, self.c, self.r);
                    break;
                case 'QuantizedZoom':
                    effect = new QuantizedZoomEffect(self.g, self.c, self.r);
                    break;
                case 'QuantizedBlockGenerator':
                    effect = new QuantizedBlockGeneration(self.g, self.c, self.r);
                    break;
                default:
                    console.error(`[Worker] Unknown effect name: ${effectName}`);
                    return;
            }
            
            if (effect) {
                effect.trigger();
                startLoop();
            }
            break;

        case 'stop':
            stopLoop();
            effect = null;
            break;
            
        case 'buffers_recycled':
            // (For fallback mode) Acknowledge that we can reuse these buffers
            recycledBuffers.push(...msg.buffers);
            break;
    }
};

// --- Main Loop ---
let loopInterval = null;

function startLoop() {
    if (loopInterval) clearInterval(loopInterval);
    
    // Using a fixed interval is more reliable in a worker than rAF
    loopInterval = setInterval(update, 1000 / 60); 
}

function stopLoop() {
    if (loopInterval) {
        clearInterval(loopInterval);
        loopInterval = null;
    }
}

const recycledBuffers = [];

function update() {
    if (!effect || !effect.active) {
        stopLoop();
        return;
    }

    // 1. Update the effect logic
    effect.update();

    // 2. Prepare render data (this is the heavy part)
    // We need a mock canvas/context for the renderer to work with
    const mockCtx = {
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        save: () => {},
        restore: () => {},
        setTransform: () => {},
    };

    // The renderer populates its internal batches. We need to extract them.
    // This requires a small modification or a way to access the batches.
    // For now, let's assume we can access `renderer._batchMeta`
    
    // We need to fake the canvas dimensions and other properties
    const w = self.g.width;
    const h = self.g.height;
    const s = self.c.state;
    const d = { // Mock derived values
        cellWidth: self.g.cellWidth,
        cellHeight: self.g.cellHeight,
    };

    if (!effect.maskCtx) {
        // Provide mock canvas objects so _ensureCanvases is never called (no document in workers).
        // updateMask checks both ctx and canvas properties before proceeding.
        const mockCanvas = { width: w, height: h, getContext: () => mockCtx };
        effect.maskCtx = mockCtx;
        effect.maskCanvas = mockCanvas;
        effect.perimeterMaskCtx = mockCtx;
        effect.perimeterMaskCanvas = mockCanvas;
        effect.lineMaskCtx = mockCtx;
        effect.lineMaskCanvas = mockCanvas;
        effect.echoCtx = mockCtx;
        effect.echoCanvas = mockCanvas;
        effect.scratchCtx = mockCtx;
        effect.scratchCanvas = mockCanvas;
        effect.gridCacheCtx = mockCtx;
        effect.gridCacheCanvas = mockCanvas;
    }

    renderer.updateMask(effect, w, h, s, d);

    // 3. Extract and send render data to the main thread
    const batches = renderer._batchMeta;
    const transferableBuffers = [];
    const renderData = {
        alpha: effect.alpha,
        batches: [],
        layout: effect.layout
    };

    batches.forEach((batch, key) => {
        // For the fallback, we create a copy to transfer
        // Try to reuse a buffer from the pool first
        let buffer;
        if (recycledBuffers.length > 0) {
            buffer = recycledBuffers.pop();
            // Resize if necessary (though less likely with pooling)
            if (buffer.byteLength < batch.count * 4) {
                 buffer = new ArrayBuffer(batch.count * 4);
            }
        } else {
            buffer = new ArrayBuffer(batch.count * 4);
        }
        
        // Create a view limited to exactly batch.count elements to avoid
        // sending stale data when the recycled buffer is oversized.
        const transferableArray = new Float32Array(buffer, 0, batch.count);
        transferableArray.set(batch.arr.subarray(0, batch.count));

        renderData.batches.push({
            key: key,
            coords: transferableArray
        });
        transferableBuffers.push(buffer);
    });
    
    // Post data to main thread, transferring ownership of the buffers
    self.postMessage({
        type: 'render_data',
        renderData: renderData
    }, transferableBuffers);
}
