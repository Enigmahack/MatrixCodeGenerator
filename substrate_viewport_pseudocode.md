# Pseudocode: Substrate & Viewport Dynamics
# Describes the evolution, growth, and structural rules of the dual-layer engine.

// ==========================================
// 1. ENGINE CONFIGURATION & ARCHITECTURE
// ==========================================
const GRID_WIDTH = 100
const GRID_HEIGHT = 100
const NUM_LAYERS = 3 // e.g., Base, Mid, Micro layers

// Substrate handles the physical blocks (The Mass)
class Substrate {
    Grid[GRID_WIDTH][GRID_HEIGHT] boolean
    ActiveFrontier: List of Coordinates
}

// Viewport handles the visibility masks (The Spotlight/Guillotine)
class Viewport {
    Rectangles: List of Rect(x, y, w, h)
}

// Each independent layer has its own Substrate and Viewport
Layers = Array of { Substrate, Viewport } of size NUM_LAYERS

// ==========================================
// 2. SUBSTRATE DYNAMICS (The Maze Evolution)
// ==========================================
function UpdateSubstrate(substrate, growthRate, axisBias):
    // A. Contiguous Expansion (Pushing Edges)
    let expandCandidates = GetEmptyNeighborsOf(substrate.ActiveFrontier)
    
    for each candidate in expandCandidates:
        if Random() < growthRate:
            // Apply axis bias (e.g., prefer vertical over horizontal)
            if MatchesAxisBias(candidate, axisBias):
                // Snap full blocks, not single cells
                let blockW = Random(1, 3)
                let blockH = Random(1, 5)
                AddBlockToSubstrate(substrate, candidate.x, candidate.y, blockW, blockH)

    // B. Frontier Seeding (Spawning Islands)
    // Allows blocks to appear disconnected, waiting to be revealed by Viewports
    if Random() < SEEDING_PROBABILITY:
        let seedPos = PickRandomLocationAheadOfFrontier(substrate.ActiveFrontier)
        let seedW = Random(1, 2)
        let seedH = Random(1, 2)
        AddBlockToSubstrate(substrate, seedPos.x, seedPos.y, seedW, seedH)

// ==========================================
// 3. VIEWPORT DYNAMICS (The Mask Evolution)
// ==========================================
function UpdateViewport(viewport, aggressiveness):
    for each rect in viewport.Rectangles:
        // Viewports are volatile: they expand, slide, and retract
        let action = ChooseRandomAction(["PAN", "EXPAND", "RETRACT", "SPLIT"])
        
        switch action:
            case "PAN":
                // Slides the mask, causing blocks to appear to move or reveal
                rect.x += Random(-2, 2)
                rect.y += Random(-2, 2)
                
            case "EXPAND":
                // Opens the window, revealing more substrate
                rect.w += Random(1, 3)
                rect.h += Random(1, 3)
                
            case "RETRACT":
                // The Guillotine Effect: Mask shrinks, instantly shearing the visible substrate
                if rect.w > 2: rect.w -= Random(1, 2)
                if rect.h > 2: rect.h -= Random(1, 2)
                
            case "SPLIT":
                // A mask divides into two, creating sudden gaps or boolean erasures
                if Random() < aggressiveness:
                    let newRect = rect.Clone()
                    rect.w = rect.w / 2
                    newRect.x = rect.x + rect.w
                    viewport.Rectangles.Add(newRect)

// ==========================================
// 4. MAIN UPDATE LOOP
// ==========================================
function UpdateEngineState():
    for each layer in Layers:
        // Substrates slowly accrete mass and spawn seeds
        UpdateSubstrate(layer.Substrate, growthRate=0.1, axisBias=0.5)
        
        // Viewports aggressively shift, creating the glitchy reveal/conceal
        UpdateViewport(layer.Viewport, aggressiveness=0.05)
        
    // (Proceed to Illumination Rules to render the result)
