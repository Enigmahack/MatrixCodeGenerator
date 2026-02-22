import os

file_path = r'C:\\Users\\Gamer-PC\\Documents\\MatrixCodeGenerator\\MatrixCode_v8.5\\js\\effects\\QuantizedRenderer.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Target the specific corrupted line
corrupted_text = "colorLayerCtx.globalCompositeOperation = 'source-over';\\n\\n        // Unified Shared Edge Rendering (Populate masks for both 2D and WebGL)\\n        this.renderEdges(fx, ctx, lineCtx, now, blocksX, blocksY, l.offX, l.offY);\\n        this.renderEdges(fx, colorLayerCtx, lineCtx, now, blocksX, blocksY, l.offX, l.offY);\\n\\n        // Corner Cleanup"

# Replacement with actual newlines
clean_text = """colorLayerCtx.globalCompositeOperation = 'source-over';

        // Unified Shared Edge Rendering (Populate masks for both 2D and WebGL)
        this.renderEdges(fx, ctx, lineCtx, now, blocksX, blocksY, l.offX, l.offY);
        this.renderEdges(fx, colorLayerCtx, lineCtx, now, blocksX, blocksY, l.offX, l.offY);

        // Corner Cleanup"""

if corrupted_text in content:
    new_content = content.replace(corrupted_text, clean_text)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Success: Corruption repaired.")
else:
    # Fallback if literal search fails
    print("Failed to find exact corrupted string. Attempting alternative search...")
    # Find indices
    start_tag = "colorLayerCtx.globalCompositeOperation = 'source-over';"
    end_tag = "// Corner Cleanup"
    
    start_idx = content.find(start_tag)
    end_idx = content.find(end_tag)
    
    if start_idx != -1 and end_idx != -1:
        new_content = content[:start_idx] + clean_text + content[end_idx + len(end_tag):]
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Success: Repaired via index find.")
    else:
        print(f"Failed to find indices: start={start_idx}, end={end_idx}")
