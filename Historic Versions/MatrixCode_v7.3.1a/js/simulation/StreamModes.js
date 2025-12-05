class StreamMode {
    constructor(config) {
        this.config = config;
    }

    spawn(stream) {
        // Default implementation for spawning a stream
    }

    style(stream, frame, state) {
        // Default implementation for style (no special effects)
        return null;
    }
}

class StandardMode extends StreamMode {
    // Inherits default behavior with no specific changes
    style(stream, frame, state) {
        // Convert stream color to HSL to provide a consistent style object
        // This ensures effects like Pulse and Deja Vu treat standard streams identical to Rainbow streams
        const rgb = Utils.hexToRgb(state.streamColor);
        const hsl = Utils.rgbToHsl(rgb.r, rgb.g, rgb.b);
        return { h: hsl.h, s: hsl.s, l: hsl.l, cycle: false, speed: 0, glitter: false };
    }
}

class StarPowerMode extends StreamMode {
    spawn(stream) {
        stream.baseHue = Utils.randomInt(0, 360);
    }

    style(stream, frame, state) {
        const hue = (state.starPowerRainbowMode === 'char')
            ? (frame + (stream.x * 10)) % 360 // Character-based hue
            : stream.baseHue; // Fixed hue based on baseHue
        return this._createStyle(hue, state.starPowerSaturation, state.starPowerIntensity, state.starPowerColorCycle, state.starPowerCycleSpeed, state.starPowerGlitter);
    }

    _createStyle(hue, saturation, lightness, cycle, speed, glitter) {
        return { h: hue, s: saturation, l: lightness, cycle, speed, glitter };
    }
}

class RainbowMode extends StreamMode {
    spawn(stream) {
        stream.baseHue = Utils.randomInt(0, 360);
    }

    style(stream, frame, state) {
        return this._createStyle(stream.baseHue, 100, state.rainbowStreamIntensity);
    }

    _createStyle(hue, saturation, lightness) {
        return { h: hue, s: saturation, l: lightness, cycle: false, speed: 0, glitter: false };
    }
}

    // =========================================================================
    // 5.0 SIMULATION SYSTEM 
    // =========================================================================
