import re

def fix_textures_undone(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Revert the blind replacement
    bad_replacement = """// 6.5 Cleanup Texture Slots to avoid feedback loops
        for (const unit in textures) {
            const slot = unit | 0;
            this.gl.activeTexture(this.gl.TEXTURE0 + slot);
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        }"""
    
    # We want to keep it in _drawFullscreenPass but remove it elsewhere.
    # Actually, let's just replace all occurrences with the original line,
    # then surgically add it back to _drawFullscreenPass.
    
    pattern = r"\s*// 6.5 Cleanup Texture Slots to avoid feedback loops\s*for \(const unit in textures\) \{\s*const slot = unit \| 0;\s*this\.gl\.activeTexture\(this\.gl\.TEXTURE0 \+ slot\);\s*this\.gl\.bindTexture\(this\.gl\.TEXTURE_2D, null\);\s*\}"
    content = re.sub(pattern, "", content)

    # Now surgically add it to _drawFullscreenPass
    old_draw = "this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);"
    # Find the one inside _drawFullscreenPass
    # We can use the context of "7. Standard Cleanup"
    target = old_draw + "\n\n        // 7. Standard Cleanup"
    replacement = old_draw + """

        // 6.5 Cleanup Texture Slots to avoid feedback loops
        for (const unit in textures) {
            const slot = unit | 0;
            this.gl.activeTexture(this.gl.TEXTURE0 + slot);
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        }""" + "\n\n        // 7. Standard Cleanup"
    
    content = content.replace(target, replacement)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_textures_undone('MatrixCode_v8.5/js/rendering/WebGLRenderer.js')
