#import <Cocoa/Cocoa.h>
#import <MetalKit/MetalKit.h>
#include "SimulationSystem.hpp"
#include "MetalRenderer.hpp"
#include "QuantizedNamedEffect.hpp"
#include "QuantizedZoomEffect.hpp"
#include "imgui/imgui.h"
#include "imgui/imgui_impl_metal.h"
#include "imgui/imgui_impl_osx.h"
#include <iostream>
#include <vector>
#include <memory>

using namespace Matrix;

@interface AppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, MTKViewDelegate> {
    std::unique_ptr<CellGrid> grid;
    std::unique_ptr<SimulationSystem> sim;
    std::unique_ptr<CellGrid> shadowGrid;
    std::unique_ptr<SimulationSystem> shadowSim;
    std::unique_ptr<Configuration> config;
    std::unique_ptr<DerivedConfig> dConfig;
    std::unique_ptr<MetalRenderer> renderer;
    std::vector<std::unique_ptr<QuantizedNamedEffect>> effects;
    std::unique_ptr<QuantizedZoomEffect> zoomEffect;
}

@property (strong, nonatomic) NSWindow *window;
@property (strong, nonatomic) MTKView *mtkView;
@property (assign, nonatomic) BOOL isRunning;
@property (assign, nonatomic) int frameCount;
@property (strong, nonatomic) id<MTLCommandQueue> commandQueue;

@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)aNotification {
    NSLog(@"[AppDelegate] Starting initialization...");
    NSRect frame = NSMakeRect(0, 0, 1280, 800);
    NSUInteger style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable;
    self.window = [[NSWindow alloc] initWithContentRect:frame styleMask:style backing:NSBackingStoreBuffered defer:NO];
    [self.window setTitle:@"Matrix Code Generator - Native Core"];
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [self.window setDelegate:self];

    NSLog(@"[AppDelegate] Setting up Metal...");
    id<MTLDevice> device = MTLCreateSystemDefaultDevice();
    if (!device) {
        NSLog(@"[FATAL] No Metal device found.");
        [NSApp terminate:nil];
        return;
    }
    self.commandQueue = [device newCommandQueue];
    self.mtkView = [[MTKView alloc] initWithFrame:frame device:device];
    self.mtkView.preferredFramesPerSecond = 60;
    self.mtkView.clearColor = MTLClearColorMake(0, 0, 0, 1);
    [self.window setContentView:self.mtkView];
    
    NSLog(@"[AppDelegate] Initializing Config and Grid...");
    config = std::make_unique<Configuration>();
    dConfig = std::make_unique<DerivedConfig>();
    
    int cols = frame.size.width / dConfig->cellWidth;
    int rows = frame.size.height / dConfig->cellHeight;
    grid = std::make_unique<CellGrid>();
    grid->Resize(cols, rows);
    
    NSLog(@"[AppDelegate] Initializing Simulations...");
    sim = std::make_unique<SimulationSystem>(*grid, *config, *dConfig);
    
    shadowGrid = std::make_unique<CellGrid>();
    shadowGrid->Resize(cols, rows);
    shadowSim = std::make_unique<SimulationSystem>(*shadowGrid, *config, *dConfig);
    
    NSLog(@"[AppDelegate] Initializing Renderer...");
    renderer = std::make_unique<MetalRenderer>(device);
    renderer->Resize(frame.size.width, frame.size.height);
    
    NSLog(@"[AppDelegate] Initializing Effects...");
    const char* effectNames[] = { "QuantizedPulse", "QuantizedExpansion", "QuantizedRetract", "QuantizedAdd", "QuantizedClimb" };
    for (const char* name : effectNames) {
        effects.push_back(std::make_unique<QuantizedNamedEffect>(*grid, *config, *dConfig, name));
    }
    zoomEffect = std::make_unique<QuantizedZoomEffect>(*grid, *config, *dConfig, device);
    
    NSLog(@"[AppDelegate] Initializing ImGui...");
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGui::StyleColorsDark();
    ImGui_ImplOSX_Init(self.window.contentView);
    ImGui_ImplMetal_Init(device);
    
    self.mtkView.delegate = self;
    self.isRunning = YES;
    NSLog(@"[AppDelegate] Initialization complete.");
}

- (void)swapWorlds {
    std::swap(grid, shadowGrid);
    std::swap(sim, shadowSim);
}

- (void)drawInMTKView:(MTKView *)view {
    static BOOL firstFrameLogged = NO;
    if (!firstFrameLogged) {
        NSLog(@"[AppDelegate] First frame rendering started.");
        firstFrameLogged = YES;
    }
    self.frameCount++;
    sim->Update(self.frameCount);
    shadowSim->Update(self.frameCount);
    
    QuantizedBaseEffect* activeFx = nullptr;
    for (auto& fx : effects) if (fx->IsActive()) { fx->Update(self.frameCount); activeFx = fx.get(); }
    if (zoomEffect->IsActive()) { zoomEffect->Update(self.frameCount); activeFx = zoomEffect.get(); }
    
    id<MTLCommandBuffer> commandBuffer = [self.commandQueue commandBuffer];
    MTLRenderPassDescriptor *renderPassDescriptor = view.currentRenderPassDescriptor;
    
    if (renderPassDescriptor != nil) {
        ImGui_ImplMetal_NewFrame(renderPassDescriptor);
        ImGui_ImplOSX_NewFrame(self.window.contentView);
        ImGui::NewFrame();

        ImGui::Begin("Matrix Native Control");
        if (ImGui::CollapsingHeader("Quantized Effects", ImGuiTreeNodeFlags_DefaultOpen)) {
            const char* effectLabels[] = { "Pulse", "Expansion", "Retract", "Add", "Climb" };
            for (size_t i = 0; i < effects.size(); ++i) {
                if (ImGui::Button(effectLabels[i])) effects[i]->Trigger(true);
                if (i < 4) ImGui::SameLine();
            }
            if (ImGui::Button("Quantized Zoom")) zoomEffect->Trigger(true);
            if (ImGui::Button("Swap Worlds Manually")) [self swapWorlds];
        }
        if (ImGui::CollapsingHeader("Post-Processing")) {
            ImGui::SliderFloat("Bloom Intensity", &config->bloomIntensity, 0.0f, 2.0f);
            ImGui::SliderFloat("CRT Bulge", &config->barrelDistortion, 0.0f, 2.0f);
            ImGui::SliderFloat("Chromatic Aberration", &config->crtAmount, 0.0f, 2.0f);
            ImGui::SliderFloat("Scanlines", &config->scanlineAmount, 0.0f, 2.0f);
        }
        if (ImGui::CollapsingHeader("Global Settings")) {
            ImGui::SliderFloat("Brightness", &config->brightness, 0.0f, 2.0f);
            ImGui::SliderInt("Font Size", &config->fontSize, 5, 50);
            ImGui::SliderInt("Stream Speed", &config->streamSpeed, 1, 20);
            ImGui::Checkbox("Pause Simulation", &config->simulationPaused);
        }
        ImGui::End();
        ImGui::Render();

        if (activeFx) {
            id<MTLRenderCommandEncoder> maskEncoder = [commandBuffer renderCommandEncoderWithDescriptor:renderer->GetMaskPassDescriptor()];
            renderer->RenderLogicGrid(maskEncoder, activeFx->GetLogicGrid(), activeFx->GetAlpha(), *dConfig, true);
            [maskEncoder endEncoding];
        }

        id<MTLTexture> zoomTex = nil;
        float zoomS = 1.0f;
        if (zoomEffect->IsActive()) {
            zoomEffect->CaptureSnapshot(renderer->GetOffscreenTexture(), commandBuffer);
            zoomTex = zoomEffect->GetSnapshotTexture();
            zoomS = zoomEffect->GetZoomScale();
        }

        id<MTLRenderCommandEncoder> renderEncoder = renderer->Render(commandBuffer, renderPassDescriptor, *grid, shadowGrid.get(), zoomTex, zoomS, *config, *dConfig);
        
        if (renderEncoder) {
            if (activeFx) {
                renderer->RenderLogicGrid(renderEncoder, activeFx->GetLogicGrid(), activeFx->GetAlpha(), *dConfig, false);
            }
            ImGui_ImplMetal_RenderDrawData(ImGui::GetDrawData(), commandBuffer, renderEncoder);
            [renderEncoder endEncoding];
        }
        [commandBuffer presentDrawable:view.currentDrawable];
    }
    [commandBuffer commit];
}

- (void)mtkView:(MTKView *)view drawableSizeWillChange:(CGSize)size {
    if (!renderer || !dConfig || !grid || !sim) return;
    renderer->Resize(size.width, size.height);
    int cols = size.width / dConfig->cellWidth;
    int rows = size.height / dConfig->cellHeight;
    if (cols <= 0) cols = 1;
    if (rows <= 0) rows = 1;
    grid->Resize(cols, rows);
    shadowGrid->Resize(cols, rows);
    sim->GetStreamManager().Resize(cols);
    shadowSim->GetStreamManager().Resize(cols);
}

- (void)windowWillClose:(NSNotification *)notification {
    if (self.isRunning) {
        self.isRunning = NO;
        ImGui_ImplMetal_Shutdown();
        ImGui_ImplOSX_Shutdown();
        ImGui::DestroyContext();
    }
    [NSApp terminate:nil];
}
@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        [app setDelegate:delegate];
        [app run];
    }
    return 0;
}
