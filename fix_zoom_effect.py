import os

file_path = 'MatrixCode_v8.5/js/effects/QuantizedZoomEffect.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

with open('new_perimeter.txt', 'r', encoding='utf-8') as f:
    new_perimeter = f.read()

with open('new_addblock.txt', 'r', encoding='utf-8') as f:
    new_addblock = f.read()

# SPLIT AND STITCH
# Find indices
idx_perimeter = content.find("_addPerimeterFacePath(bx, by, faceObj, widthX, widthY) {")
idx_addblock = content.find("_addBlock(blockStart, blockEnd, isExtending, visibilityCheck) {")
idx_swapstates = content.find("_swapStates() {")

if idx_perimeter != -1 and idx_addblock != -1 and idx_swapstates != -1:
    part1 = content[:idx_perimeter]
    # new_perimeter contains the whole function.
    # part 2 is the gap? No, we skip the old function.
    # We write part1, then new_perimeter, then gap to next function?
    
    # We replace from start of _addPerimeter to start of _addBlock
    # Then from start of _addBlock to start of _swapStates
    
    # But _addBlock starts at idx_addblock.
    
    # Verify order
    if idx_perimeter < idx_addblock < idx_swapstates:
        new_content = part1 + new_perimeter + "\n\n" + new_addblock + "\n\n" + content[idx_swapstates:]
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("SUCCESS")
    else:
        print("Order mismatch")
        print(f"Perimeter: {idx_perimeter}, AddBlock: {idx_addblock}, Swap: {idx_swapstates}")
else:
    print("FAILED TO FIND INDICES")
    print(f"Perimeter: {idx_perimeter}, AddBlock: {idx_addblock}, Swap: {idx_swapstates}")
