#pragma once

#import <MetalKit/MetalKit.h>
#include "CellGrid.hpp"
#include "Configuration.hpp"
#include "QuantizedTypes.hpp"
#include <simd/simd.h>
#include <vector>

namespace Matrix {

struct InstanceData {
    float x, y;
    uint16_t charIdx;
    uint16_t nextChar;
    uint32_t color;
    float alpha;
    float glow;
    float mix;
    uint8_t decay;
    uint8_t shapeID;
    uint16_t maxDecay;
    float glimmerFlicker;
    float glimmerAlpha;
    float dissolve;
};

class MetalRenderer {
public:
    MetalRenderer(id<MTLDevice> device);
    ~MetalRenderer();

    void Resize(int width, int height);
    id<MTLRenderCommandEncoder> Render(id<MTLCommandBuffer> commandBuffer, MTLRenderPassDescriptor* finalPass, CellGrid& grid, CellGrid* shadowGrid, id<MTLTexture> zoomTexture, float zoomScale, Configuration& config, DerivedConfig& dConfig);
    void RenderLogicGrid(id<MTLRenderCommandEncoder> renderEncoder, const LogicGrid& lg, float alpha, DerivedConfig& dConfig, bool isMask = false);

    id GetMaskPassDescriptor() const { return maskPassDescriptor; }
    id GetOffscreenTexture() const { return offscreenTexture; }

private:
    id<MTLDevice> device;
    id<MTLRenderPipelineState> matrixPipelineState;
    id<MTLRenderPipelineState> postPipelineState;
    id<MTLRenderPipelineState> logicPipelineState;
    
    id<MTLBuffer> vertexBuffer;
    id<MTLBuffer> screenQuadBuffer;
    id<MTLBuffer> instanceBuffer;
    id<MTLBuffer> logicGridBuffer;
    id<MTLTexture> atlasTexture;
    
    // Offscreen rendering
    id<MTLTexture> offscreenTexture;
    id<MTLTexture> shadowTexture;
    id<MTLTexture> maskTexture;
    
    id offscreenPassDescriptor;
    id shadowPassDescriptor;
    id maskPassDescriptor;

    int width = 0;
    int height = 0;
    int instanceCapacity = 0;

    void CreateAtlas(const std::string& chars, int fontSize);
    void CreateOffscreenTextures();
};

} // namespace Matrix
