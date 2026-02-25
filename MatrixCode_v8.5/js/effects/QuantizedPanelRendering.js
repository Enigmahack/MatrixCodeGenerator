/**
 * QuantizedPanelRendering.js - Placeholder for new experimental GLSL-based line rendering.
 */

class QuantizedPanelRendering {
    constructor(grid, config) {
        this.g = grid;
        this.c = config;
        this.name = "QuantizedPanelRendering";
        this.active = false;
        
        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d');
        
        // Subscription for enabled state
        this.c.subscribe('newLineRenderingEnabled', (val) => {
            this.active = val;
        });
        
        // Initial state
        this.active = this.c.get('newLineRenderingEnabled');
    }

    update() {
        if (!this.active) return;
        
        // Locate active quantized effect
        let qEffect = null;
        if (window.matrix && window.matrix.effectRegistry) {
            const iterable = (window.matrix.effectRegistry.effects instanceof Map) ? 
                window.matrix.effectRegistry.effects.values() : 
                window.matrix.effectRegistry.effects;
            
            for (const effect of iterable) {
                if (effect.active && effect.name.startsWith('Quantized') && effect.name !== 'QuantizedPanelRendering') {
                    qEffect = effect;
                    break;
                }
            }
        }

        if (!qEffect || !qEffect.renderGrid) return;

        // Resize mask if needed (Matches screen resolution)
        if (!window.matrix.renderer) return;
        const canvas = window.matrix.renderer.cvs;
        const w = canvas.width;
        const h = canvas.height;
        if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
            this.maskCanvas.width = w;
            this.maskCanvas.height = h;
        }

        const ctx = this.maskCtx;
        ctx.fillStyle = 'rgb(0,0,0)';
        ctx.fillRect(0, 0, w, h);

        // Ensure layout exists
        if (!qEffect.layout || qEffect._maskDirty) {
            if (typeof qEffect._ensureCanvases === 'function') qEffect._ensureCanvases(w, h);
            if (typeof qEffect._updateMask === 'function') {
                qEffect._updateMask(w, h, qEffect.c.state, qEffect.c.derived);
                qEffect._maskDirty = false;
            }
        }

        const l = qEffect.layout;
        if (!l) return;

        const blocksX = qEffect.logicGridW;
        const blocksY = qEffect.logicGridH;
        const now = qEffect.animFrame;
        const fadeIn = qEffect.getConfig('FadeInFrames') || 0;
        const fadeOut = qEffect.getConfig('FadeFrames') || 0;

        // 1. Draw Body (30% brightness = rgb(76,76,76))
        // Iterate the renderGrid which already contains composite logic for all layers
        ctx.fillStyle = 'rgb(76,76,76)'; 
        for (let idx = 0; idx < qEffect.renderGrid.length; idx++) {
            const birth = qEffect.renderGrid[idx];
            let alpha = 0;
            
            if (birth !== -1) {
                if (fadeIn > 0 && now < birth + fadeIn) {
                    alpha = (now - birth) / fadeIn;
                } else {
                    alpha = 1.0;
                }
            } else {
                // Check removal grids for fading out
                for (let L = 0; L < 3; L++) {
                    const rGrid = qEffect.removalGrids[L];
                    if (rGrid && rGrid[idx] !== -1) {
                        const death = rGrid[idx];
                        if (fadeOut > 0 && now < death + fadeOut) {
                            alpha = Math.max(alpha, 1.0 - (now - death) / fadeOut);
                        }
                    }
                }
            }

            if (alpha > 0.01) {
                const bx = idx % blocksX;
                const by = Math.floor(idx / blocksX);
                
                const sx = Math.round((bx - l.offX + l.userBlockOffX) * l.cellPitchX);
                const ex = Math.round((bx + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                const sy = Math.round((by - l.offY + l.userBlockOffY) * l.cellPitchY);
                const ey = Math.round((by + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                
                const x = qEffect.screenOriginX + (sx * l.screenStepX) + l.pixelOffX;
                const y = qEffect.screenOriginY + (sy * l.screenStepY) + l.pixelOffY;
                const bw = (ex - sx) * l.screenStepX;
                const bh = (ey - sy) * l.screenStepY;

                ctx.globalAlpha = alpha;
                ctx.fillRect(x, y, bw, bh);
            }
        }

        // 2. Draw Edges (100% brightness = rgb(255,255,255))
        // We use qEffect.maskCanvas which contains the white lines with their own fading logic
        if (qEffect.maskCanvas) {
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(qEffect.maskCanvas, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    render(ctx, derived) {
        // No 2D rendering needed if using GLSL pass
    }
}

if (typeof module !== 'undefined') {
    module.exports = QuantizedPanelRendering;
}
