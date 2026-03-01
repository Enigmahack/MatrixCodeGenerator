/**
 * QuantizedBlockBuilder.js - A procedural block builder with additive mosaic unfolding.
 */
class QuantizedBlockBuilder extends QuantizedBlockGeneration {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedBlockBuilder";
        this.configPrefix = "quantizedBlockBuilder";
        this.visibleLayers = [true, true, true, true]; 
    }

    trigger(force = false) {
        if (!super.trigger(force)) return false;
        this.visibleLayers = [true, true, true, true];
        this.expansionPhase = 0;
        this.genTimer = 0;
        this._updateRenderGridLogic();
        return true;
    }

    _initProceduralState() {
        if (this.proceduralInitiated) return;
        this.proceduralInitiated = true;
        
        console.log("QuantizedBlockBuilder: Seeding center blocks...");
        for (let l = 0; l <= 3; l++) {
            this._spawnBlock(0, 0, 1, 1, l, false, 0, true, true, true, false, true);
        }
    }

    _attemptGrowth() {
        if (this.expansionComplete) return;
        this._initProceduralState();

        console.log(`QuantizedBlockBuilder: Step ${this.expansionPhase} Attempting growth...`);

        const xChance = 0.66;
        const yChance = 0.66; 

        // 1. X-Axis Growth (West)
        if (Math.random() < xChance) {
            this._growLayerWest(1, null);
            this._growLayerWest(2, null);
            this._growLayerWest(3, null);
        }
        if (Math.random() < xChance) {
            this._growLayerWest(0, 1); 
        }

        // 2. Y-Axis Growth (North ONLY)
        if (Math.random() < yChance) {
            this._growLayerNorth(1, null);
            this._growLayerNorth(2, null);
            this._growLayerNorth(3, null);
        }
        if (Math.random() < yChance) {
            this._growLayerNorth(0, 1);
        }
    }

    _growLayerWest(layer, constraintLayer) {
        const xAxisBlocks = this.activeBlocks.filter(b => b.layer === layer && b.y === 0);
        if (xAxisBlocks.length === 0) return false;

        let minX = 0;
        for (const b of xAxisBlocks) if (b.x < minX) minX = b.x;

        const tx = minX - 1, ty = 0;
        if (constraintLayer !== null && !this._isOccupied(tx, ty, constraintLayer)) return false;
        if (this._isOccupied(tx, ty, layer)) return false;

        const id = this._spawnBlock(tx, ty, 1, 1, layer, false, 0, true, true, true, false, true);
        if (id !== -1) {
            console.log(`QuantizedBlockBuilder: Layer ${layer} grew West to (${tx}, ${ty})`);
            return true;
        }
        return false;
    }

    _growLayerNorth(layer, constraintLayer) {
        const xCoords = [...new Set(this.activeBlocks.filter(b => b.layer === layer && b.y === 0).map(b => b.x))];
        if (xCoords.length === 0) return false;

        const tx = xCoords[Math.floor(Math.random() * xCoords.length)];
        const columnBlocks = this.activeBlocks.filter(b => b.layer === layer && b.x === tx);
        let minY = 0;
        for (const b of columnBlocks) if (b.y < minY) minY = b.y;

        const ty = minY - 1;
        if (constraintLayer !== null && !this._isOccupied(tx, ty, constraintLayer)) return false;
        if (this._isOccupied(tx, ty, layer)) return false;

        const id = this._spawnBlock(tx, ty, 1, 1, layer, false, 0, true, true, true, false, true);
        if (id !== -1) {
            console.log(`QuantizedBlockBuilder: Layer ${layer} grew North to (${tx}, ${ty})`);
            return true;
        }
        return false;
    }

    _isOccupied(x, y, layer) {
        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const gx = cx + x, gy = cy + y;
        if (gx < 0 || gx >= w || gy < 0 || gy >= h) return false;
        const grid = this.layerGrids[layer];
        return grid && grid[gy * w + gx] !== -1;
    }
}
