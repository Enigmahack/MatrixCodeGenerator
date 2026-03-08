#include <metal_stdlib>
using namespace metal;

struct VertexIn {
    float2 position [[attribute(0)]];
    float2 pos [[attribute(1)]];
    ushort charIdx [[attribute(2)]];
    ushort nextChar [[attribute(3)]];
    uchar4 color [[attribute(4)]];
    float alpha [[attribute(5)]];
    float glow [[attribute(6)]];
    float mix [[attribute(7)]];
    uchar decay [[attribute(8)]];
    uchar shapeID [[attribute(9)]];
    ushort maxDecay [[attribute(10)]];
    float glimmerFlicker [[attribute(11)]];
    float glimmerAlpha [[attribute(12)]];
};

struct VertexOut {
    float4 position [[position]];
    float2 uv;
    float2 uv2;
    float4 color;
    float mix;
    float glow;
};

struct Uniforms {
    float2 resolution;
    float2 atlasSize;
    float cellSize;
    float cols;
    float brightness;
};

struct PostUniforms {
    float2 resolution;
    float time;
    float crtAmount;
    float scanlineAmount;
    float barrelDistortion;
    float bloomIntensity;
    float zoomScale;
    bool hasZoom;
};

// --- Matrix Main Vertex Shader ---
vertex VertexOut matrix_vertex(VertexIn in [[stage_in]],
                               constant Uniforms &u [[buffer(2)]]) {
    VertexOut out;
    
    float2 worldPos = in.pos + (in.position - 0.5) * u.cellSize;
    float2 clipPos = (worldPos / u.resolution) * 2.0 - 1.0;
    out.position = float4(clipPos.x, -clipPos.y, 0.0, 1.0);
    
    out.color = float4(float3(in.color.rgb) / 255.0, in.alpha);
    out.mix = in.mix;
    out.glow = in.glow;
    
    // UV 1
    float row = floor((float)in.charIdx / u.cols);
    float col = fmod((float)in.charIdx, u.cols);
    float2 uvBase = float2(col, row) * u.cellSize;
    out.uv = (uvBase + in.position * u.cellSize) / u.atlasSize;
    
    // UV 2
    row = floor((float)in.nextChar / u.cols);
    col = fmod((float)in.nextChar, u.cols);
    float2 uvBase2 = float2(col, row) * u.cellSize;
    out.uv2 = (uvBase2 + in.position * u.cellSize) / u.atlasSize;
    
    return out;
}

// --- Matrix Main Fragment Shader ---
fragment float4 matrix_fragment(VertexOut in [[stage_in]],
                                texture2d<float> atlas [[texture(0)]]) {
    sampler s(mag_filter::linear, min_filter::linear);
    float4 tex1 = atlas.sample(s, in.uv);
    float4 tex2 = atlas.sample(s, in.uv2);
    
    float alpha = mix(tex1.a, tex2.a, in.mix);
    float3 color = in.color.rgb;
    
    // Apply Glow boost
    color += in.glow * 0.2 * in.color.a;
    
    return float4(color, alpha * in.color.a);
}

// --- Post-Processing Shaders ---

struct ScreenVertexOut {
    float4 position [[position]];
    float2 uv;
};

vertex ScreenVertexOut post_vertex(uint vertexID [[vertex_id]],
                                  constant float2 *vertices [[buffer(0)]]) {
    ScreenVertexOut out;
    out.position = float4(vertices[vertexID], 0.0, 1.0);
    out.uv = vertices[vertexID] * 0.5 + 0.5;
    out.uv.y = 1.0 - out.uv.y;
    return out;
}

fragment float4 post_fragment(ScreenVertexOut in [[stage_in]],
                             texture2d<float> sceneTexture [[texture(0)]],
                             texture2d<float> shadowTexture [[texture(1)]],
                             texture2d<float> maskTexture [[texture(2)]],
                             texture2d<float> zoomTexture [[texture(3)]],
                             constant PostUniforms &u [[buffer(0)]]) {
    sampler s(mag_filter::linear, min_filter::linear);
    
    // --- Barrel Distortion ---
    float2 centeredCoord = in.uv - 0.5;
    float r2 = dot(centeredCoord, centeredCoord);
    float factor = 1.0 + r2 * (u.barrelDistortion * 0.1);
    float2 warpedUV = centeredCoord * factor + 0.5;
    
    if (warpedUV.x < 0.0 || warpedUV.x > 1.0 || warpedUV.y < 0.0 || warpedUV.y > 1.0) {
        return float4(0,0,0,1);
    }
    
    // --- Reveal Mask ---
    float reveal = maskTexture.sample(s, warpedUV).a;
    
    // --- Zoom Logic ---
    float2 zoomUV = (warpedUV - 0.5) / u.zoomScale + 0.5;
    
    // --- Chromatic Aberration ---
    float shift = 0.002 * u.crtAmount;
    
    float3 colorRGB;
    if (u.hasZoom) {
        float r = mix(sceneTexture.sample(s, warpedUV + float2(-shift, 0)).r, zoomTexture.sample(s, zoomUV + float2(-shift, 0)).r, reveal);
        float g = mix(sceneTexture.sample(s, warpedUV).g, zoomTexture.sample(s, zoomUV).g, reveal);
        float b = mix(sceneTexture.sample(s, warpedUV + float2(shift, 0)).b, zoomTexture.sample(s, zoomUV + float2(shift, 0)).b, reveal);
        colorRGB = float3(r, g, b);
    } else {
        float r = mix(sceneTexture.sample(s, warpedUV + float2(-shift, 0)).r, shadowTexture.sample(s, warpedUV + float2(-shift, 0)).r, reveal);
        float g = mix(sceneTexture.sample(s, warpedUV).g, shadowTexture.sample(s, warpedUV).g, reveal);
        float b = mix(sceneTexture.sample(s, warpedUV + float2(shift, 0)).b, shadowTexture.sample(s, warpedUV + float2(shift, 0)).b, reveal);
        colorRGB = float3(r, g, b);
    }

    float4 color = float4(colorRGB, 1.0);
    
    // --- Scanlines ---
    float scanline = sin(warpedUV.y * u.resolution.y * 1.5) * 0.1 * u.scanlineAmount;
    color.rgb -= scanline;
    
    // --- Pseudo Glow / Bloom ---
    float3 sceneGlow = sceneTexture.sample(s, warpedUV, bias(2.0)).rgb;
    float3 targetGlow = u.hasZoom ? zoomTexture.sample(s, zoomUV, bias(2.0)).rgb : shadowTexture.sample(s, warpedUV, bias(2.0)).rgb;
    float3 glow = mix(sceneGlow, targetGlow, reveal) * 0.5 * u.bloomIntensity;
    color.rgb += glow;
    
    return color;
}

// --- Logic Grid Effect ---

struct LogicUniforms {
    float2 resolution;
    float2 gridOrigin;
    float2 cellSize;
    float2 gridSize;
    float alpha;
    bool isMask;
};

fragment float4 logic_fragment(ScreenVertexOut in [[stage_in]],
                               device const int *logicGrid [[buffer(0)]],
                               constant LogicUniforms &u [[buffer(1)]]) {
    float2 pixelPos = in.uv * u.resolution;
    float2 localPos = pixelPos - u.gridOrigin;
    
    int gx = floor(localPos.x / u.cellSize.x);
    int gy = floor(localPos.y / u.cellSize.y);
    
    if (gx < 0 || gx >= (int)u.gridSize.x || gy < 0 || gy >= (int)u.gridSize.y) {
        discard_fragment();
    }
    
    int frame = logicGrid[gy * (int)u.gridSize.x + gx];
    if (frame == -1) discard_fragment();
    
    if (u.isMask) {
        return float4(1, 1, 1, 1);
    }
    
    // Block rendering with yellow borders and green fills
    float2 cellLocal = fmod(localPos, u.cellSize) / u.cellSize;
    bool edge = cellLocal.x < 0.05 || cellLocal.x > 0.95 || cellLocal.y < 0.05 || cellLocal.y > 0.95;
    
    float3 color = edge ? float3(1.0, 0.8, 0.0) : float3(0.0, 0.4, 0.0);
    return float4(color, u.alpha);
}
