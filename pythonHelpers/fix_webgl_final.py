import re

def fix_webgl_renderer(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Fix Feedback Loop in _drawFullscreenPass
    # We should unbind textures after the draw call to prevent feedback loops in subsequent passes
    # that target those textures' FBOs but don't overwrite those slots.
    
    # Let's add a cleanup loop after drawArrays.
    old_draw_arrays = "this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);"
    new_draw_arrays = """this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

        // 6.5 Cleanup Texture Slots to avoid feedback loops
        for (const unit in textures) {
            const slot = unit | 0;
            this.gl.activeTexture(this.gl.TEXTURE0 + slot);
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        }"""
    content = content.replace(old_draw_arrays, new_draw_arrays)

    # 2. Fix Shader Distinctions (Layer 1 vs 2 parity)
    # Remove brightDeltaB reducción for Layer 1
    content = content.replace("float brightDeltaB = 0.0; // Synchronized", "float brightDeltaB = 0.0;")
    content = re.sub(r"brightDeltaB = \(l0occ > 0\.01\) \? -0\.3 : 0\.0;", "brightDeltaB = 0.0;", content)
    
    # Remove normalMax/fadeMax distinction in Mode 0 (Generate Lines)
    # Match the if (isS123 && ...) blocks and replace with normalMax only.
    # Pattern: if (isS123 && a0NW > 0.01 && a0NE > 0.01) { fadeMax = max(fadeMax, val); } else { normalMax = max(normalMax, val); }
    # I'll use a regex that handles various a0XX combinations.
    content = re.sub(r"if \(isS123 && a0[A-Z]{2} > 0\.01 && a0[A-Z]{2} > 0\.01\) \{\s*fadeMax = max\(fadeMax, val\);\s*\} else \{\s*normalMax = max\(normalMax, val\);\s*\}", 
                     "normalMax = max(normalMax, val);", content)

    # 3. Final Parity: Ensure u_intensity or other multipliers are same
    # (Already did this in previous steps, but ensuring)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_webgl_renderer('MatrixCode_v10.0/js/rendering/WebGLRenderer.js')
