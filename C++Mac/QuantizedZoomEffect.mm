#include "QuantizedZoomEffect.hpp"
#include "QuantizedSequence.hpp"
#include <cmath>
#include <algorithm>

namespace Matrix {

QuantizedZoomEffect::QuantizedZoomEffect(CellGrid& g, Configuration& c, DerivedConfig& d, id<MTLDevice> dev)
    : QuantizedBaseEffect(g, c, d), device(dev) {
    configPrefix = "quantizedZoom";
}

bool QuantizedZoomEffect::Trigger(bool force) {
    if (!QuantizedBaseEffect::Trigger(force)) return false;
    
    state = "WAITING";
    timer = 60; // 1 second delay
    zoomScale = 1.0f;
    zoomProgress = 0.0f;
    hasCaptured = false;
    
    // We would normally generate a sequence here, but for now we'll use a placeholder or pulse-like growth
    expansionPhase = 0;
    
    return true;
}

void QuantizedZoomEffect::Update(int frame) {
    if (!active) return;

    animFrame++;

    if (state == "WAITING") {
        timer--;
        if (timer <= 0) {
            state = "FADE_IN";
            timer = 0;
        }
        return;
    }

    QuantizedBaseEffect::Update(frame);

    if (state != "IDLE") {
        // Zoom Logic
        zoomProgress += 0.005f * config.quantizedZoomZoomRate;
        float t = std::min(1.0f, zoomProgress);
        float smoothT = t * t * (3 - 2 * t);
        zoomScale = 1.0f + (3.0f * smoothT);

        // Growth logic (placeholder expansion)
        cycleTimer++;
        if (cycleTimer >= 5) {
            cycleTimer = 0;
            // Simple radial expansion for zoom
            int cx = logicGrid.width / 2;
            int cy = logicGrid.height / 2;
            int r = expansionPhase;
            for (int y = -r; y <= r; y++) {
                for (int x = -r; x <= r; x++) {
                    if (std::abs(x) == r || std::abs(y) == r) {
                        QuantizedSequence::ExecuteStepOps(this, {6, x, y}); // SMART ADD
                    }
                }
            }
            expansionPhase++;
        }
    }
}

void QuantizedZoomEffect::CaptureSnapshot(id<MTLTexture> sourceTexture, id<MTLCommandBuffer> commandBuffer) {
    if (hasCaptured || !sourceTexture) return;

    MTLTextureDescriptor *td = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:sourceTexture.pixelFormat
                                                                                width:sourceTexture.width
                                                                               height:sourceTexture.height
                                                                            mipmapped:NO];
    td.usage = MTLTextureUsageShaderRead | MTLTextureUsageRenderTarget;
    snapshotTexture = [device newTextureWithDescriptor:td];

    id<MTLBlitCommandEncoder> blit = [commandBuffer blitCommandEncoder];
    [blit copyFromTexture:sourceTexture
              sourceSlice:0
              sourceLevel:0
             sourceOrigin:MTLOriginMake(0, 0, 0)
               sourceSize:MTLSizeMake(sourceTexture.width, sourceTexture.height, 1)
                toTexture:snapshotTexture
         destinationSlice:0
         destinationLevel:0
        destinationOrigin:MTLOriginMake(0, 0, 0)];
    [blit endEncoding];

    hasCaptured = true;
}

} // namespace Matrix
