class StreamMode {
            constructor(config) { this.config = config; }
            spawn(st) {} 
            style(st, frame, s) { return null; }
        }
        
        class StandardMode extends StreamMode {
            spawn(st) {}
            style(st, frame, s) { return null; }
        }

        class StarPowerMode extends StreamMode {
            spawn(st) { st.baseHue = Utils.randomInt(0, 360); }
            style(st, frame, s) {
                return { 
                    h: (s.starPowerRainbowMode === 'char' ? (frame + (st.x * 10)) % 360 : st.baseHue), 
                    s: s.starPowerSaturation, 
                    l: s.starPowerIntensity, 
                    cycle: s.starPowerColorCycle, 
                    speed: s.starPowerCycleSpeed, 
                    glitter: s.starPowerGlitter 
                };
            }
        }

        class RainbowMode extends StreamMode {
            spawn(st) { st.baseHue = Utils.randomInt(0, 360); }
            style(st, frame, s) {
                return { h: st.baseHue, s: 100, l: s.rainbowStreamIntensity, cycle: false, speed: 0, glitter: false };
            }
        }

        // =========================================================================
        // 4. SIMULATION LAYER
        // =========================================================================
