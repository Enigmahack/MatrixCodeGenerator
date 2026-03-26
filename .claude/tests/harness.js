/**
 * Test Harness — loads global-scope JS files into a Node.js VM context.
 * No dependencies beyond Node built-ins.
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const JS_ROOT = path.join(PROJECT_ROOT, 'MatrixCode_v8.5');

// Load order mirrors FORCED_FIRST from matrix_builder.py
const FORCED_FIRST = [
    'js/core/Utils.js',
    'js/config/ConfigurationManager.js',
    'js/data/FontData.js',
    'js/data/CellGrid.js',
    'js/effects/EffectRegistry.js',
    'js/config/ConfigTemplate.js',
    'js/effects/QuantizedBaseEffect.js',
    'js/effects/QuantizedProceduralEngine.js'
];

const FORCED_LAST = [
    'js/core/MatrixKernel.js'
];

// Files that are too large or problematic for quick loading
const SKIP_FILES = new Set([
    'js/effects/QuantizedPatterns.js',   // 30K lines data-only
    'js/simulation/SimulationWorker.js'  // Worker context
]);

/**
 * Build a minimal browser-like context for VM execution.
 */
function createBrowserStubs() {
    const noop = () => {};
    const noopObj = () => ({});

    // Minimal localStorage stub
    const storage = {};
    const localStorageStub = {
        getItem: (k) => storage[k] ?? null,
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: (k) => { delete storage[k]; },
        clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
    };

    // Minimal document stub
    const documentStub = {
        createElement: (tag) => ({
            tagName: tag.toUpperCase(),
            style: {},
            classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
            addEventListener: noop,
            removeEventListener: noop,
            appendChild: noop,
            removeChild: noop,
            setAttribute: noop,
            getAttribute: () => null,
            getContext: () => createCanvasContextStub(),
            click: noop,
            href: '',
            download: '',
            width: 800,
            height: 600,
            toDataURL: () => 'data:image/png;base64,',
            transferControlToOffscreen: () => ({
                width: 800, height: 600,
                getContext: () => createCanvasContextStub()
            })
        }),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        body: {
            appendChild: noop,
            removeChild: noop,
            style: {},
            classList: { add: noop, remove: noop }
        },
        documentElement: { style: {} },
        head: { appendChild: noop },
        addEventListener: noop,
        removeEventListener: noop,
        createElementNS: (ns, tag) => ({
            tagName: tag,
            style: {},
            setAttribute: noop,
            getAttribute: () => null,
            appendChild: noop
        }),
        fonts: { add: noop, check: () => true }
    };

    function createCanvasContextStub() {
        return {
            fillRect: noop, clearRect: noop, strokeRect: noop,
            fillText: noop, strokeText: noop, measureText: () => ({ width: 10 }),
            drawImage: noop, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
            putImageData: noop, createLinearGradient: () => ({ addColorStop: noop }),
            createRadialGradient: () => ({ addColorStop: noop }),
            createPattern: () => ({}),
            save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
            beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
            arc: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
            setTransform: noop, resetTransform: noop,
            canvas: { width: 800, height: 600 },
            font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
            globalAlpha: 1, globalCompositeOperation: 'source-over',
            textAlign: 'left', textBaseline: 'top',
            shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0
        };
    }

    // Minimal WebGL stub
    const webglStub = {
        createShader: () => ({}), shaderSource: noop, compileShader: noop,
        getShaderParameter: () => true, getShaderInfoLog: () => '',
        createProgram: () => ({}), attachShader: noop, linkProgram: noop,
        getProgramParameter: () => true, getProgramInfoLog: () => '',
        useProgram: noop, deleteShader: noop,
        getUniformLocation: () => ({}), getAttribLocation: () => 0,
        uniform1f: noop, uniform1i: noop, uniform2f: noop, uniform3f: noop, uniform4f: noop,
        uniform1fv: noop, uniform2fv: noop, uniform3fv: noop, uniform4fv: noop,
        uniformMatrix4fv: noop,
        createBuffer: () => ({}), bindBuffer: noop, bufferData: noop, bufferSubData: noop,
        createTexture: () => ({}), bindTexture: noop, texImage2D: noop, texSubImage2D: noop,
        texParameteri: noop, texParameterf: noop, generateMipmap: noop, deleteTexture: noop,
        createFramebuffer: () => ({}), bindFramebuffer: noop, framebufferTexture2D: noop,
        checkFramebufferStatus: () => 0x8CD5,
        createRenderbuffer: () => ({}), bindRenderbuffer: noop, renderbufferStorage: noop,
        framebufferRenderbuffer: noop,
        viewport: noop, clear: noop, clearColor: noop, enable: noop, disable: noop,
        blendFunc: noop, blendFuncSeparate: noop, depthFunc: noop, depthMask: noop,
        enableVertexAttribArray: noop, disableVertexAttribArray: noop,
        vertexAttribPointer: noop, vertexAttribDivisor: noop,
        drawArrays: noop, drawElements: noop, drawArraysInstanced: noop,
        drawElementsInstanced: noop,
        createVertexArray: () => ({}), bindVertexArray: noop,
        getExtension: (name) => {
            if (name === 'EXT_color_buffer_float') return {};
            if (name === 'ANGLE_instanced_arrays') return {
                drawArraysInstancedANGLE: noop,
                vertexAttribDivisorANGLE: noop
            };
            return null;
        },
        getParameter: () => 16,
        activeTexture: noop, pixelStorei: noop,
        readPixels: noop, scissor: noop,
        canvas: { width: 800, height: 600 },
        drawingBufferWidth: 800, drawingBufferHeight: 600,
        VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30,
        COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82,
        ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
        STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8, STREAM_DRAW: 0x88E0,
        FLOAT: 0x1406, UNSIGNED_BYTE: 0x1401, UNSIGNED_SHORT: 0x1403, UNSIGNED_INT: 0x1405,
        TEXTURE_2D: 0x0DE1, TEXTURE0: 0x84C0,
        RGBA: 0x1908, RGB: 0x1907, LUMINANCE: 0x1909,
        NEAREST: 0x2600, LINEAR: 0x2601,
        TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
        CLAMP_TO_EDGE: 0x812F, REPEAT: 0x2901,
        FRAMEBUFFER: 0x8D40, COLOR_ATTACHMENT0: 0x8CE0,
        FRAMEBUFFER_COMPLETE: 0x8CD5,
        TRIANGLES: 0x0004, TRIANGLE_STRIP: 0x0005, TRIANGLE_FAN: 0x0006,
        COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100,
        BLEND: 0x0BE2, DEPTH_TEST: 0x0B71,
        SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303, ONE: 1,
        R16UI: 0x8234, RED_INTEGER: 0x8D94, R8: 0x8229, RED: 0x1903,
        RG8: 0x822B, RG: 0x8227, RGBA32F: 0x8814,
        MAX_TEXTURE_IMAGE_UNITS: 0x8872
    };

    // Window stub
    const windowStub = {
        innerWidth: 1920,
        innerHeight: 1080,
        devicePixelRatio: 1,
        addEventListener: noop,
        removeEventListener: noop,
        requestAnimationFrame: (cb) => setTimeout(cb, 16),
        cancelAnimationFrame: noop,
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        matchMedia: () => ({ matches: false, addEventListener: noop }),
        location: { href: 'http://localhost', search: '', hash: '' },
        history: { pushState: noop, replaceState: noop },
        localStorage: localStorageStub,
        navigator: {
            userAgent: 'Node.js Test Harness',
            platform: 'Win32',
            language: 'en-US',
            hardwareConcurrency: 4,
            gpu: null
        },
        matrix: {},
        screen: { width: 1920, height: 1080 },
        crypto: {
            subtle: { digest: async () => new ArrayBuffer(32) },
            getRandomValues: (arr) => {
                for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
                return arr;
            }
        },
        WebGLRenderingContext: function() { return webglStub; },
        WebGL2RenderingContext: function() { return webglStub; }
    };

    return {
        window: windowStub,
        self: windowStub,
        globalThis: windowStub,
        document: documentStub,
        localStorage: localStorageStub,
        navigator: windowStub.navigator,
        console: console,
        performance: { now: () => Date.now() },
        requestAnimationFrame: windowStub.requestAnimationFrame,
        cancelAnimationFrame: noop,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval,
        Math: Math,
        Date: Date,
        JSON: JSON,
        Array: Array,
        Object: Object,
        String: String,
        Number: Number,
        Boolean: Boolean,
        RegExp: RegExp,
        Error: Error,
        TypeError: TypeError,
        RangeError: RangeError,
        Map: Map,
        Set: Set,
        WeakMap: WeakMap,
        WeakSet: WeakSet,
        Promise: Promise,
        Symbol: Symbol,
        Proxy: Proxy,
        Reflect: Reflect,
        Int8Array: Int8Array,
        Uint8Array: Uint8Array,
        Uint8ClampedArray: Uint8ClampedArray,
        Int16Array: Int16Array,
        Uint16Array: Uint16Array,
        Int32Array: Int32Array,
        Uint32Array: Uint32Array,
        Float32Array: Float32Array,
        Float64Array: Float64Array,
        BigInt64Array: BigInt64Array,
        BigUint64Array: BigUint64Array,
        ArrayBuffer: ArrayBuffer,
        SharedArrayBuffer: SharedArrayBuffer,
        DataView: DataView,
        Blob: class Blob { constructor() {} },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL: noop },
        Worker: class Worker { constructor() {} postMessage() {} terminate() {} addEventListener() {} },
        FontFace: class FontFace {
            constructor(family, source) { this.family = family; this.status = 'loaded'; }
            load() { return Promise.resolve(this); }
        },
        HTMLCanvasElement: class HTMLCanvasElement {},
        HTMLImageElement: class HTMLImageElement { set src(v) {} get src() { return ''; } },
        Image: class Image { set src(v) {} get src() { return ''; } set onload(v) { if (v) v(); } },
        CanvasRenderingContext2D: class CanvasRenderingContext2D {},
        WebGLRenderingContext: windowStub.WebGLRenderingContext,
        WebGL2RenderingContext: windowStub.WebGL2RenderingContext,
        OffscreenCanvas: class OffscreenCanvas {
            constructor(w, h) { this.width = w; this.height = h; }
            getContext() { return createCanvasContextStub(); }
        },
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        encodeURIComponent: encodeURIComponent,
        decodeURIComponent: decodeURIComponent,
        unescape: unescape,
        escape: escape,
        parseInt: parseInt,
        parseFloat: parseFloat,
        isNaN: isNaN,
        isFinite: isFinite,
        Infinity: Infinity,
        NaN: NaN,
        undefined: undefined,
        crypto: windowStub.crypto
    };
}

/**
 * Discover all JS files in dependency order (simplified version of matrix_builder.py logic).
 */
function discoverJSFiles() {
    const jsDir = path.join(JS_ROOT, 'js');
    const files = [];

    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && !['node_modules', '.git', 'tools'].includes(entry.name)) {
                walk(path.join(dir, entry.name));
            } else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'SimulationWorker.js') {
                const rel = path.relative(JS_ROOT, path.join(dir, entry.name)).replace(/\\/g, '/');
                if (!SKIP_FILES.has(rel)) {
                    files.push(rel);
                }
            }
        }
    }

    walk(jsDir);

    // Sort: FORCED_FIRST, then the rest alphabetically, then FORCED_LAST
    const first = FORCED_FIRST.filter(f => files.includes(f) && !SKIP_FILES.has(f));
    const last = FORCED_LAST.filter(f => files.includes(f) && !SKIP_FILES.has(f));
    const middle = files.filter(f => !first.includes(f) && !last.includes(f));
    middle.sort();

    return [...first, ...middle, ...last];
}

/**
 * Extract top-level class and const declarations from source code.
 * Returns code that exposes them as properties on `this` (the VM context).
 */
function buildExportPatch(code) {
    const names = [];
    // Match top-level: class Foo, const Foo =, const FOO =
    const classRe = /^class\s+(\w+)/gm;
    const constRe = /^const\s+(\w+)\s*=/gm;
    let m;
    while ((m = classRe.exec(code)) !== null) names.push(m[1]);
    while ((m = constRe.exec(code)) !== null) names.push(m[1]);
    if (names.length === 0) return '';
    return '\n' + names.map(n => `this.${n} = ${n};`).join('\n') + '\n';
}

/**
 * Load specific JS files into a fresh VM context.
 * @param {string[]} relPaths - Relative paths from JS_ROOT (e.g., 'js/core/Utils.js')
 * @returns {Object} The VM context with all globals loaded
 */
function loadFiles(relPaths) {
    const stubs = createBrowserStubs();
    const ctx = vm.createContext(stubs);

    for (const rel of relPaths) {
        const fullPath = path.join(JS_ROOT, rel);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${fullPath}`);
        }
        const code = fs.readFileSync(fullPath, 'utf-8');
        const patch = buildExportPatch(code);
        const wrappedCode = code + patch;
        try {
            const script = new vm.Script(wrappedCode, { filename: rel });
            script.runInContext(ctx, { timeout: 10000 });
        } catch (e) {
            throw new Error(`Failed to load ${rel}: ${e.message}`);
        }
    }

    return ctx;
}

/**
 * Load only Utils (the lightest context).
 */
function loadUtils() {
    return loadFiles(['js/core/Utils.js']);
}

/**
 * Load Utils + CellGrid.
 */
function loadCellGrid() {
    return loadFiles([
        'js/core/Utils.js',
        'js/data/CellGrid.js'
    ]);
}

/**
 * Load up through EffectRegistry (includes ConfigurationManager).
 */
function loadEffects() {
    return loadFiles([
        'js/core/Utils.js',
        'js/config/ConfigurationManager.js',
        'js/data/CellGrid.js',
        'js/effects/EffectRegistry.js'
    ]);
}

/**
 * Load the full stack (all files in dependency order).
 */
function loadAll() {
    const allFiles = discoverJSFiles();
    return loadFiles(allFiles);
}

/**
 * Normalize a VM-created object to the host realm so deepStrictEqual works.
 * Handles plain objects, arrays, and primitives.
 */
function normalize(val) {
    if (val === null || val === undefined) return val;
    if (typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(normalize);
    const out = {};
    for (const key of Object.keys(val)) {
        out[key] = normalize(val[key]);
    }
    return out;
}

module.exports = {
    PROJECT_ROOT,
    JS_ROOT,
    SKIP_FILES,
    createBrowserStubs,
    discoverJSFiles,
    loadFiles,
    loadUtils,
    loadCellGrid,
    loadEffects,
    loadAll,
    normalize
};
