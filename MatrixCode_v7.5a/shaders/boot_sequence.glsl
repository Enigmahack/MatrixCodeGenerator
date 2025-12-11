precision mediump float;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uParameter; // Represents the progress of the boot sequence (0.0 to 1.0)
varying vec2 vTexCoord;

// Utility function to smoothstep
float smoothstep_custom(float edge0, float edge1, float x) {
    x = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return x * x * (3.0 - 2.0 * x);
}

void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    vec2 uv = vTexCoord; // uv is 0-1, 0,0 is bottom left.

    // Adjust uv to be -1 to 1, 0,0 center
    vec2 centered_uv = uv * 2.0 - 1.0;
    
    // Convert to aspect-corrected uv for square/bar calculations
    float aspect = uResolution.x / uResolution.y;
    vec2 aspect_uv = centered_uv;
    aspect_uv.x *= aspect; // Stretch X to make squares look square

    vec4 finalColor = color;
    
    // --- Phase 1: White Square at Center (uParameter 0.0 - 0.1) ---
    // White square fades in and out before expanding
    // progress: 0.0 -> 0.1
    float phase1_start = 0.0;
    float phase1_end = 0.1;
    float phase1_progress = smoothstep_custom(phase1_start, phase1_end, uParameter);
    
    if (uParameter >= phase1_start && uParameter < phase1_end) {
        float square_size = 0.05 + phase1_progress * 0.1; // Small square, grows slightly
        float square_fade_start = 0.8;
        float square_fade_end = 1.0;

        float dist_x = abs(aspect_uv.x);
        float dist_y = abs(aspect_uv.y);
        
        float current_square_dist = max(dist_x, dist_y);
        float square_alpha_factor = smoothstep_custom(square_size * square_fade_start, square_size * square_fade_end, current_square_dist);
        
        // This makes the center of the square fully white, fading to transparent at the edges
        float white_alpha = 1.0 - square_alpha_factor;
        finalColor = mix(finalColor, vec4(1.0, 1.0, 1.0, 1.0), white_alpha * phase1_progress * (1.0 - phase1_progress) * 4.0); // Fade in then out
    }
    
    // --- Phase 2: Vertical Bar Expansion (uParameter 0.1 - 0.3) ---
    // progress: 0.1 -> 0.3
    float phase2_start = 0.1;
    float phase2_end = 0.3;
    float phase2_progress = smoothstep_custom(phase2_start, phase2_end, uParameter);

    if (uParameter >= phase2_start && uParameter < phase2_end) {
        float bar_width = 0.02; // 2 cells wide (relative to normalized aspect_uv)
        float current_height = mix(0.05, 2.0, phase2_progress); // Grows from small to full height (2.0 because centered_uv is -1 to 1)

        float dist_x = abs(aspect_uv.x);
        float dist_y = abs(centered_uv.y); // Use centered_uv for vertical expansion

        // Bar body (fully white)
        if (dist_x < bar_width && dist_y < current_height * 0.95) { // Leave some space for fade
            finalColor = vec4(1.0, 1.0, 1.0, 1.0);
        }

        // Vertical fade at top/bottom of bar
        float fade_thickness = 0.05; // Relative to current_height
        if (dist_x < bar_width) {
            float fade_top = smoothstep_custom(current_height * 0.95 - fade_thickness, current_height * 0.95, centered_uv.y);
            float fade_bottom = smoothstep_custom(-current_height * 0.95, -current_height * 0.95 + fade_thickness, centered_uv.y);
            float bar_alpha = 1.0 - max(fade_top, fade_bottom);
            finalColor = mix(finalColor, vec4(1.0, 1.0, 1.0, 1.0), bar_alpha);
        }
    }

    // --- Phase 3: Solid White Background Top to Bottom (uParameter 0.3 - 0.5) ---
    // progress: 0.3 -> 0.5
    float phase3_start = 0.3;
    float phase3_end = 0.5;
    float phase3_progress = smoothstep_custom(phase3_start, phase3_end, uParameter);

    if (uParameter >= phase3_start && uParameter < phase3_end) {
        // uv.y is 0 at bottom, 1 at top. We want top to bottom wipe.
        float wipe_line = 1.0 - phase3_progress; // Moves from 1.0 (top) to 0.0 (bottom)
        
        float fade_dist = 0.02; // Small fade at the wipe line
        float white_alpha = smoothstep_custom(wipe_line - fade_dist, wipe_line + fade_dist, uv.y);
        
        finalColor = mix(finalColor, vec4(1.0, 1.0, 1.0, 1.0), white_alpha);
    }
    
    // --- Phase 4: Complex Fading/Flashing Sequence (uParameter 0.5 - 1.0) ---
    // This is the most complex part, involving multiple sub-phases.
    // Using a nested smoothstep or direct conditional checks
    float phase4_start = 0.5;
    float phase4_end = 1.0;
    float phase4_duration = phase4_end - phase4_start;
    float current_phase4_progress = (uParameter - phase4_start) / phase4_duration; // 0.0 to 1.0 within phase 4

    // To ensure the white background persists until we explicitly fade it out,
    // we take the full white background as a base for phase 4.
    if (uParameter >= phase4_start) {
        finalColor = vec4(1.0, 1.0, 1.0, 1.0); // Start with full white
    }

    // Sub-phase: Initial fade of white (21-25 frames, approx 0.5 to 0.55 in uParameter if total is 4s = 240 frames)
    // Map 21-25 frames to a sub-range of current_phase4_progress
    float sub1_start = 0.0;
    float sub1_end = 0.1; // Represents the 21-25 frames fade.
    float sub1_progress = smoothstep_custom(sub1_start, sub1_end, current_phase4_progress);
    if (current_phase4_progress >= sub1_start && current_phase4_progress < sub1_end) {
        float fade_out_amount = sub1_progress; // Fades from 0 to 1
        finalColor = mix(finalColor, color, fade_out_amount); // Mix with original texture
    }

    // Sub-phase: Lower half becomes solid white again (0.1 to 0.15)
    float sub2_start = 0.1;
    float sub2_end = 0.15;
    float sub2_progress = smoothstep_custom(sub2_start, sub2_end, current_phase4_progress);
    if (current_phase4_progress >= sub2_start && current_phase4_progress < sub2_end) {
        float lower_half_coverage = smoothstep_custom(0.0, 0.5, uv.y); // Covers lower half
        finalColor = mix(finalColor, vec4(1.0, 1.0, 1.0, 1.0), lower_half_coverage * sub2_progress);
    }

    // Sub-phase: Lower half fades quickly revealing original white (0.15 to 0.2)
    float sub3_start = 0.15;
    float sub3_end = 0.2;
    float sub3_progress = smoothstep_custom(sub3_start, sub3_end, current_phase4_progress);
    if (current_phase4_progress >= sub3_start && current_phase4_progress < sub3_end) {
        float lower_half_coverage = smoothstep_custom(0.0, 0.5, uv.y);
        finalColor = mix(finalColor, color, lower_half_coverage * sub3_progress); // Fade back to background
    }

    // Sub-phase: 7/8 left side white, 1/8 right band faded (0.2 to 0.25)
    float sub4_start = 0.2;
    float sub4_end = 0.25;
    float sub4_progress = smoothstep_custom(sub4_start, sub4_end, current_phase4_progress);
    if (current_phase4_progress >= sub4_start && current_phase4_progress < sub4_end) {
        float left_side_coverage = smoothstep_custom(0.0, 7.0/8.0, uv.x); // Covers left 7/8
        float right_band_alpha = smoothstep_custom(7.0/8.0, 1.0, uv.x); // Fades for right 1/8

        vec4 current_color_state = mix(finalColor, vec4(1.0, 1.0, 1.0, 1.0), left_side_coverage * sub4_progress);
        finalColor = mix(current_color_state, color, right_band_alpha * sub4_progress); // Blend right band with background
    }

    // Sub-phase: Flashes immediately to lower half bright white (0.25 to 0.3)
    float sub5_start = 0.25;
    float sub5_end = 0.3;
    float sub5_progress = smoothstep_custom(sub5_start, sub5_end, current_phase4_progress);
    if (current_phase4_progress >= sub5_start && current_phase4_progress < sub5_end) {
        float lower_half_coverage = smoothstep_custom(0.0, 0.5, uv.y);
        finalColor = mix(finalColor, vec4(1.0, 1.0, 1.0, 1.0), lower_half_coverage * sub5_progress);
    }
    
    // Sub-phase: Bright white horizontal bar 1/2 to 3/4 down (0.3 to 0.35)
    float sub6_start = 0.3;
    float sub6_end = 0.35;
    float sub6_progress = smoothstep_custom(sub6_start, sub6_end, current_phase4_progress);
    if (current_phase4_progress >= sub6_start && current_phase4_progress < sub6_end) {
        float bar_top = 0.5;
        float bar_bottom = 0.75; // uv.y 0.5 to 0.75 means 1/2 to 3/4 from BOTTOM
        
        float is_in_bar = step(bar_top, uv.y) * step(uv.y, bar_bottom);
        float bar_alpha = smoothstep_custom(0.0, 1.0, is_in_bar); // Simple on/off for bar
        
        finalColor = mix(finalColor, vec4(1.0, 1.0, 1.0, 1.0), bar_alpha * sub6_progress);
    }

    // Sub-phase: Fades slightly and entire screen flashes bright white (0.35 to 0.4)
    float sub7_start = 0.35;
    float sub7_end = 0.4;
    float sub7_progress = smoothstep_custom(sub7_start, sub7_end, current_phase4_progress);
    if (current_phase4_progress >= sub7_start && current_phase4_progress < sub7_end) {
        float flash_alpha = sin(current_phase4_progress * 10.0 * 3.14159) * 0.5 + 0.5; // Quick flash pulse
        finalColor = mix(finalColor, vec4(1.0, 1.0, 1.0, 1.0), flash_alpha * sub7_progress);
    }
    
    // The rest of phase 4 (0.4 to 1.0) is the repeating cycle and final fade out.
    // For simplicity for now, let's just make it fade back to the original code.
    float final_fade_progress = smoothstep_custom(0.7, 1.0, current_phase4_progress);
    finalColor = mix(finalColor, color, final_fade_progress);


    gl_FragColor = finalColor;
}