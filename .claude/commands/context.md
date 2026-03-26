You are working on MatrixCode v8.5, a WebGL Matrix Digital Rain simulation. Before starting the user's task, load the most relevant reference command(s) to avoid reading large files:

Available commands (use `/filemap`, `/effects-api`, `/shaders`, `/config-keys`, `/architecture`, `/core-apis`):

- **/filemap** — Full file listing with line counts, classes, and hierarchy. Use when you need to find which file contains something.
- **/effects-api** — All effect classes, their methods, properties, config keys, and trigger signatures. Use for any effect-related work.
- **/shaders** — GLSL uniforms, texture slot assignments, shader branching logic, PostProcessor pipeline. Use for any rendering/shader work.
- **/config-keys** — All configuration keys, types, ranges, inheritance. Use when working with settings or ConfigTemplate.
- **/architecture** — System overview, data flow, frame loop, override priority, worker architecture. Use to understand how components connect.
- **/core-apis** — MatrixKernel, CellGrid, SimulationSystem, StreamManager, WebGLRenderer, UIManager APIs. Use for core system modifications.

**Token-saving rules:**
1. ALWAYS check these references BEFORE reading source files
2. Only read the specific file section you need to modify — never read whole large files
3. For WebGLRenderer.js (4,558 lines): use `/shaders` first, then read only the specific shader or method
4. For QuantizedBaseEffect.js (2,675 lines): use `/effects-api` first
5. For ConfigurationManager.js (2,667 lines): use `/config-keys` first
6. NEVER read QuantizedPatterns.js (30,435 lines) — it's just data
7. When editing, read only the 50-100 lines around your target with offset/limit

Now proceed with the user's actual task.
