#include "MetalRenderer.hpp"
#import <Metal/Metal.h>
#import <AppKit/AppKit.h>

namespace Matrix {

MetalRenderer::MetalRenderer(id<MTLDevice> dev) : device(dev) {
    NSLog(@"[MetalRenderer] Initializing...");
    float quad[] = { 0,0, 1,0, 0,1, 0,1, 1,0, 1,1 };
    vertexBuffer = [device newBufferWithBytes:quad length:sizeof(quad) options:MTLResourceStorageModeShared];

    float screenQuad[] = { -1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1 };
    screenQuadBuffer = [device newBufferWithBytes:screenQuad length:sizeof(screenQuad) options:MTLResourceStorageModeShared];

    NSLog(@"[MetalRenderer] Loading Default Library...");
    id<MTLLibrary> library = [device newDefaultLibrary];
    if (!library) {
        NSLog(@"[ERROR] Failed to load default library. default.metallib missing?");
        return;
    }
    
    // Matrix Vertex Descriptor
    MTLVertexDescriptor *vd = [MTLVertexDescriptor vertexDescriptor];
    // Attribute 0: position (from vertexBuffer)
    vd.attributes[0].format = MTLVertexFormatFloat2;
    vd.attributes[0].offset = 0;
    vd.attributes[0].bufferIndex = 0;
    
    // Attributes 1-13: Instance data (from instanceBuffer)
    vd.attributes[1].format = MTLVertexFormatFloat2; // pos
    vd.attributes[1].offset = 0;
    vd.attributes[1].bufferIndex = 1;
    vd.attributes[2].format = MTLVertexFormatUShort; // charIdx
    vd.attributes[2].offset = 8;
    vd.attributes[2].bufferIndex = 1;
    vd.attributes[3].format = MTLVertexFormatUShort; // nextChar
    vd.attributes[3].offset = 10;
    vd.attributes[3].bufferIndex = 1;
    vd.attributes[4].format = MTLVertexFormatUChar4; // color
    vd.attributes[4].offset = 12;
    vd.attributes[4].bufferIndex = 1;
    vd.attributes[5].format = MTLVertexFormatFloat; // alpha
    vd.attributes[5].offset = 16;
    vd.attributes[5].bufferIndex = 1;
    vd.attributes[6].format = MTLVertexFormatFloat; // glow
    vd.attributes[6].offset = 20;
    vd.attributes[6].bufferIndex = 1;
    vd.attributes[7].format = MTLVertexFormatFloat; // mix
    vd.attributes[7].offset = 24;
    vd.attributes[7].bufferIndex = 1;
    vd.attributes[8].format = MTLVertexFormatUChar; // decay
    vd.attributes[8].offset = 28;
    vd.attributes[8].bufferIndex = 1;
    vd.attributes[9].format = MTLVertexFormatUChar; // shapeID
    vd.attributes[9].offset = 29;
    vd.attributes[9].bufferIndex = 1;
    vd.attributes[10].format = MTLVertexFormatUShort; // maxDecay
    vd.attributes[10].offset = 30;
    vd.attributes[10].bufferIndex = 1;
    vd.attributes[11].format = MTLVertexFormatFloat; // glimmerFlicker
    vd.attributes[11].offset = 32;
    vd.attributes[11].bufferIndex = 1;
    vd.attributes[12].format = MTLVertexFormatFloat; // glimmerAlpha
    vd.attributes[12].offset = 36;
    vd.attributes[12].bufferIndex = 1;
    
    vd.layouts[0].stride = 8;
    vd.layouts[0].stepFunction = MTLVertexStepFunctionPerVertex;
    vd.layouts[1].stride = 40;
    vd.layouts[1].stepFunction = MTLVertexStepFunctionPerInstance;

    auto createPipeline = [&](NSString* vertName, NSString* fragName, MTLPixelFormat format, BOOL blending, MTLVertexDescriptor* vDesc) -> id<MTLRenderPipelineState> {
        id<MTLFunction> vertFunc = [library newFunctionWithName:vertName];
        id<MTLFunction> fragFunc = [library newFunctionWithName:fragName];
        if (!vertFunc || !fragFunc) {
            NSLog(@"[ERROR] Failed to find functions: %@ or %@", vertName, fragName);
            return nil;
        }
        MTLRenderPipelineDescriptor *desc = [[MTLRenderPipelineDescriptor alloc] init];
        desc.vertexFunction = vertFunc;
        desc.fragmentFunction = fragFunc;
        desc.vertexDescriptor = vDesc;
        desc.colorAttachments[0].pixelFormat = format;
        if (blending) {
            desc.colorAttachments[0].blendingEnabled = YES;
            desc.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorSourceAlpha;
            desc.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
        }
        NSError *err = nil;
        id<MTLRenderPipelineState> ps = [device newRenderPipelineStateWithDescriptor:desc error:&err];
        if (!ps) NSLog(@"[ERROR] Pipeline creation failed for %@/%@: %@", vertName, fragName, err);
        return ps;
    };

    matrixPipelineState = createPipeline(@"matrix_vertex", @"matrix_fragment", MTLPixelFormatRGBA8Unorm, YES, vd);
    postPipelineState = createPipeline(@"post_vertex", @"post_fragment", MTLPixelFormatBGRA8Unorm, NO, nil);
    logicPipelineState = createPipeline(@"post_vertex", @"logic_fragment", MTLPixelFormatBGRA8Unorm, YES, nil);
    
    NSLog(@"[MetalRenderer] Initialization sequence finished.");
}

MetalRenderer::~MetalRenderer() = default;

void MetalRenderer::Resize(int w, int h) {
    width = w; height = h;
    CreateOffscreenTextures();
}

void MetalRenderer::CreateOffscreenTextures() {
    if (width <= 0 || height <= 0) return;
    auto createTex = [&](MTLPixelFormat fmt, bool mipmaps) {
        MTLTextureDescriptor *td = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:fmt width:width height:height mipmapped:mipmaps];
        td.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead;
        return [device newTextureWithDescriptor:td];
    };

    offscreenTexture = createTex(MTLPixelFormatRGBA8Unorm, true);
    MTLRenderPassDescriptor* opd = [MTLRenderPassDescriptor renderPassDescriptor];
    opd.colorAttachments[0].texture = offscreenTexture;
    opd.colorAttachments[0].loadAction = MTLLoadActionClear;
    opd.colorAttachments[0].storeAction = MTLStoreActionStore;
    opd.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 1);
    offscreenPassDescriptor = opd;

    shadowTexture = createTex(MTLPixelFormatRGBA8Unorm, true);
    MTLRenderPassDescriptor* spd = [MTLRenderPassDescriptor renderPassDescriptor];
    spd.colorAttachments[0].texture = shadowTexture;
    spd.colorAttachments[0].loadAction = MTLLoadActionClear;
    spd.colorAttachments[0].storeAction = MTLStoreActionStore;
    spd.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 1);
    shadowPassDescriptor = spd;

    maskTexture = createTex(MTLPixelFormatRGBA8Unorm, false);
    MTLRenderPassDescriptor* mpd = [MTLRenderPassDescriptor renderPassDescriptor];
    mpd.colorAttachments[0].texture = maskTexture;
    mpd.colorAttachments[0].loadAction = MTLLoadActionClear;
    mpd.colorAttachments[0].storeAction = MTLStoreActionStore;
    mpd.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0);
    maskPassDescriptor = mpd;
}

void MetalRenderer::CreateAtlas(const std::string& chars, int fontSize) {
    int atlasSize = 1024;
    MTLTextureDescriptor *td = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm width:atlasSize height:atlasSize mipmapped:NO];
    atlasTexture = [device newTextureWithDescriptor:td];
    uint32_t *data = (uint32_t *)malloc(atlasSize * atlasSize * 4);
    memset(data, 0, atlasSize * atlasSize * 4);
    for(int i=0; i<256; i++) {
        int x = (i % 16) * 64; int y = (i / 16) * 64;
        for(int dy=5; dy<59; dy++) {
            for(int dx=5; dx<59; dx++) {
                if (dy % 4 == 0 || dx % 4 == 0) continue;
                data[(y+dy)*atlasSize + (x+dx)] = 0xFFFFFFFF;
            }
        }
    }
    [atlasTexture replaceRegion:MTLRegionMake2D(0, 0, atlasSize, atlasSize) mipmapLevel:0 withBytes:data bytesPerRow:atlasSize * 4];
    free(data);
}

id<MTLRenderCommandEncoder> MetalRenderer::Render(id<MTLCommandBuffer> commandBuffer, MTLRenderPassDescriptor* finalPass, CellGrid& grid, CellGrid* shadowGrid, id<MTLTexture> zoomTex, float zoomScale, Configuration& config, DerivedConfig& dConfig) {
    if (!matrixPipelineState || !postPipelineState) return nil;
    if (!atlasTexture) CreateAtlas(dConfig.chars, config.fontSize);
    if (!offscreenTexture) CreateOffscreenTextures();
    if (!offscreenTexture || !shadowTexture || !maskTexture) return nil;

    auto renderToTarget = [&](CellGrid& g, id pd_id, const char* label) {
        MTLRenderPassDescriptor* pd = (MTLRenderPassDescriptor*)pd_id;
        if (!pd) return;
        id<MTLRenderCommandEncoder> encoder = [commandBuffer renderCommandEncoderWithDescriptor:pd];
        if (!encoder) return;
        [encoder setLabel:[NSString stringWithUTF8String:label]];
        int total = g.cols * g.rows;
        if (total > 0) {
            size_t bufSize = total * 40;
            if (!instanceBuffer || instanceCapacity < total) {
                instanceCapacity = total;
                instanceBuffer = [device newBufferWithLength:bufSize options:MTLResourceStorageModeShared];
            }
            if (!instanceBuffer) { [encoder endEncoding]; return; }
            
            uint8_t *ptr = (uint8_t *)[instanceBuffer contents];
            size_t gridTotal = g.colors.size();
            for (int i = 0; i < total && i < (int)gridTotal; i++) {
                int baseOff = i * 40;
                float x = (i % g.cols) * dConfig.cellWidth + dConfig.cellWidth * 0.5f;
                float y = (i / g.cols) * dConfig.cellHeight + dConfig.cellHeight * 0.5f;
                *(float*)(ptr + baseOff + 0) = x;
                *(float*)(ptr + baseOff + 4) = y;
                *(uint16_t*)(ptr + baseOff + 8) = (uint16_t)(i % 256);
                *(uint16_t*)(ptr + baseOff + 10) = 0;
                *(uint32_t*)(ptr + baseOff + 12) = g.colors[i];
                *(float*)(ptr + baseOff + 16) = g.alphas[i];
                *(float*)(ptr + baseOff + 20) = g.glows[i];
                *(float*)(ptr + baseOff + 24) = g.mix[i];
                *(uint8_t*)(ptr + baseOff + 28) = g.decays[i];
                *(uint8_t*)(ptr + baseOff + 29) = 0;
                *(uint16_t*)(ptr + baseOff + 30) = g.maxDecays[i];
                *(float*)(ptr + baseOff + 32) = 1.0f;
                *(float*)(ptr + baseOff + 36) = 0.0f;
            }
            struct Uniforms { simd_float2 res; simd_float2 atlas; float cell; float cols; float bright; } u;
            u.res = simd_make_float2(width, height); u.atlas = simd_make_float2(1024, 1024); u.cell = dConfig.cellWidth; u.cols = 16.0f; u.bright = config.brightness;
            [encoder setRenderPipelineState:matrixPipelineState];
            [encoder setVertexBuffer:vertexBuffer offset:0 atIndex:0];
            [encoder setVertexBuffer:instanceBuffer offset:0 atIndex:1];
            [encoder setVertexBytes:&u length:sizeof(u) atIndex:2];
            [encoder setFragmentTexture:atlasTexture atIndex:0];
            [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:6 instanceCount:total];
        }
        [encoder endEncoding];
        
        id<MTLTexture> targetTex = pd.colorAttachments[0].texture;
        if (targetTex && targetTex.mipmapLevelCount > 1) {
            id<MTLBlitCommandEncoder> blit = [commandBuffer blitCommandEncoder];
            [blit generateMipmapsForTexture:targetTex];
            [blit endEncoding];
        }
    };

    renderToTarget(grid, offscreenPassDescriptor, "MainMatrixPass");
    if (shadowGrid) {
        renderToTarget(*shadowGrid, shadowPassDescriptor, "ShadowMatrixPass");
    } else {
        id<MTLRenderCommandEncoder> encoder = [commandBuffer renderCommandEncoderWithDescriptor:(MTLRenderPassDescriptor*)shadowPassDescriptor];
        if (encoder) [encoder endEncoding];
    }

    // --- Final Post Pass ---
    id<MTLRenderCommandEncoder> finalEncoder = [commandBuffer renderCommandEncoderWithDescriptor:finalPass];
    if (!finalEncoder) return nil;
    [finalEncoder setLabel:@"FinalPostPass"];

    struct PostUniforms { 
        simd_float2 res; float time; float crt; float scan; float barrel; float bloom; 
        float zoomScale; bool hasZoom;
    } pu;
    pu.res = simd_make_float2(width, height); 
    pu.time = 0.0f; 
    pu.crt = config.crtAmount; 
    pu.scan = config.scanlineAmount; 
    pu.barrel = config.barrelDistortion; 
    pu.bloom = config.bloomIntensity;
    pu.zoomScale = zoomScale;
    pu.hasZoom = (zoomTex != nil);

    [finalEncoder setRenderPipelineState:postPipelineState];
    [finalEncoder setVertexBuffer:screenQuadBuffer offset:0 atIndex:0];
    [finalEncoder setVertexBytes:&pu length:sizeof(pu) atIndex:0];
    [finalEncoder setFragmentTexture:offscreenTexture atIndex:0];
    [finalEncoder setFragmentTexture:shadowTexture atIndex:1];
    [finalEncoder setFragmentTexture:maskTexture atIndex:2];
    [finalEncoder setFragmentTexture:zoomTex ? zoomTex : offscreenTexture atIndex:3];
    [finalEncoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:6];
    
    return finalEncoder;
}

void MetalRenderer::RenderLogicGrid(id<MTLRenderCommandEncoder> renderEncoder, const LogicGrid& lg, float alpha, DerivedConfig& dConfig, bool isMask) {
    if (lg.width <= 0 || lg.height <= 0 || alpha <= 0.0f) return;

    size_t gridSize = lg.width * lg.height * sizeof(int32_t);
    if (!logicGridBuffer || logicGridBuffer.length < gridSize) {
        logicGridBuffer = [device newBufferWithLength:gridSize options:MTLResourceStorageModeShared];
    }
    if (!logicGridBuffer) return;
    memcpy([logicGridBuffer contents], lg.renderGrid.data(), gridSize);

    struct LogicUniforms {
        simd_float2 resolution;
        simd_float2 gridOrigin;
        simd_float2 cellSize;
        simd_float2 gridSize;
        float alpha;
        bool isMask;
    } u;
    
    u.resolution = simd_make_float2(width, height);
    u.gridSize = simd_make_float2(lg.width, lg.height);
    u.cellSize = simd_make_float2(dConfig.cellWidth * 4, dConfig.cellHeight * 4); 
    float gridPixW = lg.width * u.cellSize.x;
    float gridPixH = lg.height * u.cellSize.y;
    u.gridOrigin = simd_make_float2(width * 0.5f - gridPixW * 0.5f, height * 0.5f - gridPixH * 0.5f);
    u.alpha = alpha;
    u.isMask = isMask;

    [renderEncoder setRenderPipelineState:logicPipelineState];
    [renderEncoder setVertexBuffer:screenQuadBuffer offset:0 atIndex:0];
    [renderEncoder setFragmentBuffer:logicGridBuffer offset:0 atIndex:0];
    [renderEncoder setFragmentBytes:&u length:sizeof(u) atIndex:1];
    [renderEncoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:6];
}

} // namespace Matrix
