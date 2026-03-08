#pragma once

#include "QuantizedBaseEffect.hpp"
#include <Metal/Metal.h>

namespace Matrix {

class QuantizedZoomEffect : public QuantizedBaseEffect {
public:
    QuantizedZoomEffect(CellGrid& grid, Configuration& config, DerivedConfig& dConfig, id<MTLDevice> device);
    
    bool Trigger(bool force = false) override;
    void Update(int frame) override;
    
    float GetZoomScale() const { return zoomScale; }
    id<MTLTexture> GetSnapshotTexture() const { return snapshotTexture; }

    void CaptureSnapshot(id<MTLTexture> sourceTexture, id<MTLCommandBuffer> commandBuffer);

private:
    id<MTLDevice> device;
    id<MTLTexture> snapshotTexture;
    float zoomScale = 1.0f;
    float zoomProgress = 0.0f;
    bool hasCaptured = false;
};

} // namespace Matrix
