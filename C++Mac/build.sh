#!/bin/bash

# Exit on any error
set -e

# Define directories and outputs
BUILD_DIR="build"
OUTPUT_BIN="MatrixCodeNative"

echo "🧹 Cleaning previous builds..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

echo "🔨 Compiling Metal Shaders..."
# Compile Metal shaders into a library
xcrun -sdk macosx metal -c Shaders.metal -o "$BUILD_DIR/Shaders.air"
xcrun -sdk macosx metallib "$BUILD_DIR/Shaders.air" -o "$BUILD_DIR/default.metallib"

echo "🔨 Compiling native Mac application with ImGui and Quantized Effects..."

# List ImGui source files
IMGUI_SRC="imgui/imgui.cpp imgui/imgui_draw.cpp imgui/imgui_widgets.cpp imgui/imgui_tables.cpp imgui/imgui_demo.cpp imgui/imgui_impl_metal.mm imgui/imgui_impl_osx.mm"

# Compile the Objective-C++ files
# -framework Cocoa -framework Metal -framework MetalKit -framework QuartzCore -framework AppKit are required
clang++ -O3 -std=c++20 -fobjc-arc \
    -Iimgui \
    -framework Cocoa \
    -framework Metal \
    -framework MetalKit \
    -framework QuartzCore \
    -framework AppKit \
    -framework GameController \
    main.mm \
    CellGrid.cpp \
    StreamManager.cpp \
    SimulationSystem.cpp \
    MetalRenderer.mm \
    QuantizedBaseEffect.cpp \
    QuantizedSequence.cpp \
    QuantizedPulseEffect.cpp \
    QuantizedZoomEffect.mm \
    $IMGUI_SRC \
    -o "$BUILD_DIR/$OUTPUT_BIN"

# Copy the metal library into the same folder as the binary
cp "$BUILD_DIR/default.metallib" .

echo "✅ Build complete. Executable created at: $BUILD_DIR/$OUTPUT_BIN"
echo ""
echo "🚀 To run the application, execute:"
echo "   ./$BUILD_DIR/$OUTPUT_BIN"
