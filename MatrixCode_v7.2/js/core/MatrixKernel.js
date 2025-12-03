class MatrixKernel {
            constructor() {
                this.notifications = new NotificationManager();
                this.config = new ConfigurationManager();
                this.grid = new MatrixGrid(this.config);
                this.simulation = new SimulationSystem(this.grid, this.config);
                this.effectRegistry = new EffectRegistry(this.grid, this.config);
                
                this.effectRegistry.register(new PulseEffect(this.grid, this.config));
                this.effectRegistry.register(new MiniPulseEffect(this.grid, this.config));
                this.effectRegistry.register(new DejaVuEffect(this.grid, this.config));

                this.renderer = new CanvasRenderer('matrixCanvas', this.grid, this.config, this.effectRegistry);
                this.fontMgr = new FontManager(this.config, this.notifications);
                this.ui = new UIManager(this.config, this.effectRegistry, this.fontMgr, this.notifications);

                this.fontMgr.init();
                this.frame = 0; this.lastTime = 0; this.accumulator = 0; this.timestep = 1000 / 60;
                let resizeTimer;
                window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => this._resize(), 100); });
                
                this.config.subscribe((k) => { 
                    if(['resolution','stretchX','stretchY','fontSize','horizontalSpacingFactor'].includes(k) || k === 'ALL') this._resize(); 
                    if(['smoothingEnabled', 'smoothingAmount'].includes(k)) this.renderer.updateSmoothing();
                });
                
                this._resize();
                requestAnimationFrame(t => this._loop(t));
            }
        

            _resize() { this.renderer.resize(); this.grid.resize(window.innerWidth / this.config.state.stretchX, window.innerHeight / this.config.state.stretchY); }

            _loop(time) {
                if (!this.lastTime) this.lastTime = time;
                const delta = time - this.lastTime; this.lastTime = time;
                this.accumulator += delta;
                while (this.accumulator >= this.timestep) {
                    this.frame++;
                    this.effectRegistry.update();
                    this.simulation.update(this.frame);
                    this.accumulator -= this.timestep;
                }
                this.renderer.render(this.frame);
                requestAnimationFrame(t => this._loop(t));
            }
        }
        window.addEventListener('DOMContentLoaded', () => new MatrixKernel());
