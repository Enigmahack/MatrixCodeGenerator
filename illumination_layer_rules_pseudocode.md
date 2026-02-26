# Pseudocode: Illumination & Rendering Rules
# Describes how the intersection is calculated, how edges are extracted, and how ghost lines are managed.

// ==========================================
// 1. DATA STRUCTURES
// ==========================================
class Edge {
    x, y: Integer
    face: Enum(NORTH, SOUTH, EAST, WEST)
}

class GhostEdge extends Edge {
    opacity: Float (1.0 to 0.0)
}

Global PreviousFrameEdges = List of Edge
Global ActiveGhostEdges = List of GhostEdge

// ==========================================
// 2. THE BOOLEAN INTERSECTION
// ==========================================
// Returns the grid of what is ACTUALLY visible this frame
function CalculateVisibleGrid(layer):
    let visibleGrid = CreateEmptyGrid(GRID_WIDTH, GRID_HEIGHT)
    
    for x from 0 to GRID_WIDTH:
        for y from 0 to GRID_HEIGHT:
            // Condition 1: Substrate exists here
            let hasMass = layer.Substrate.Grid[x][y]
            
            // Condition 2: Viewport (Mask) covers this area
            let isIlluminated = false
            for each rect in layer.Viewport.Rectangles:
                if PointInRect(x, y, rect):
                    isIlluminated = true
                    break
            
            // The Core Rule: Visible = Substrate AND Viewport
            if hasMass AND isIlluminated:
                visibleGrid[x][y] = true
                
    return visibleGrid

// ==========================================
// 3. EDGE EXTRACTION (Perimeter Highlighting)
// ==========================================
function ExtractEdges(visibleGrid):
    let currentEdges = empty List of Edge
    
    for x from 0 to GRID_WIDTH:
        for y from 0 to GRID_HEIGHT:
            if visibleGrid[x][y] == true:
                // Check neighbors. If neighbor is empty (or off-grid), this is an edge.
                if NOT visibleGrid[x][y-1]: currentEdges.Add(Edge(x, y, NORTH))
                if NOT visibleGrid[x][y+1]: currentEdges.Add(Edge(x, y, SOUTH))
                if NOT visibleGrid[x+1][y]: currentEdges.Add(Edge(x, y, EAST))
                if NOT visibleGrid[x-1][y]: currentEdges.Add(Edge(x, y, WEST))
                
    return currentEdges

// ==========================================
// 4. TEMPORAL ECHOES (Ghost Line Generation)
// ==========================================
function ProcessGhostLines(currentEdges):
    // 1. Decay existing ghosts
    for ghost in ActiveGhostEdges:
        ghost.opacity -= DECAY_RATE (e.g., 0.2 per frame)
    RemoveDeadGhosts(ActiveGhostEdges) // Remove if opacity <= 0
    
    // 2. Find abandoned edges (lines that existed last frame, but not this frame)
    // This happens when Substrate grows, OR when Viewport retracts/slides
    for prevEdge in PreviousFrameEdges:
        if NOT currentEdges.Contains(prevEdge):
            // The edge moved or vanished. Leave a ghost behind.
            let newGhost = GhostEdge(prevEdge.x, prevEdge.y, prevEdge.face, opacity=1.0)
            ActiveGhostEdges.Add(newGhost)

// ==========================================
// 5. MASTER RENDER PIPELINE
// ==========================================
function RenderFrame():
    let allCurrentEdges = empty List of Edge
    
    // Process each independent layer
    for each layer in Layers:
        // 1. Get the intersected visible mass
        let visibleGrid = CalculateVisibleGrid(layer)
        
        // 2. Find the perimeter of that mass
        let layerEdges = ExtractEdges(visibleGrid)
        allCurrentEdges.AddRange(layerEdges)
        
        // 3. Render the solid character fill (Green Code) inside the visible mass
        RenderMatrixCharacters(visibleGrid)

    // Calculate fading temporal trails based on ALL layers
    ProcessGhostLines(allCurrentEdges)
    
    // 4. Render Ghost Lines (Faded Green, drawn UNDER active edges)
    for ghost in ActiveGhostEdges:
        DrawLine(ghost, color=FADED_GREEN, alpha=ghost.opacity)
        
    // 5. Render Active Edges (Bright Yellow/Gold, drawn ON TOP)
    // Overlapping edges from different layers will cross-hatch here
    for edge in allCurrentEdges:
        DrawLine(edge, color=BRIGHT_GOLD, alpha=1.0)
        
    // 6. Save state for next frame
    PreviousFrameEdges = allCurrentEdges
