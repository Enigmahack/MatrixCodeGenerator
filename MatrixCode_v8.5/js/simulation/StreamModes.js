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
        return null;
    }
}

class StarPowerMode extends StreamMode {
    spawn(stream) {
        stream.baseHue = Utils.randomInt(0, 360);
    }

    style(stream, frame, state) {
        let hue;
        if (state.starPowerRainbowMode === 'char') {
            hue = (frame + (stream.x * 10)) % 360; // Character-based hue
        } else {
            // Full Stream Mode: Sync hue start time so they cycle together
            // If cycling is enabled, offset the base hue by the current frame * speed
            hue = stream.baseHue;
            if (state.starPowerColorCycle) {
                 hue = (hue + (frame * state.starPowerCycleSpeed)) % 360;
            }
        }
        return this._createStyle(hue, state.starPowerSaturation, state.starPowerIntensity, state.starPowerColorCycle, state.starPowerCycleSpeed);
    }

    _createStyle(hue, saturation, lightness, cycle, speed) {
        return { h: hue, s: saturation, l: lightness, cycle, speed, isEffect: true, type: 'star_glimmer' };
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
        return { h: hue, s: saturation, l: lightness, cycle: false, speed: 0, isEffect: true };
    }
}

    // =========================================================================
    // 5.0 SIMULATION SYSTEM 
    // =========================================================================
