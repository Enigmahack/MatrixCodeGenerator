class NotificationManager {
            constructor() {
                this.container = document.getElementById('toast-container');
                if (!this.container) {
                    this.container = document.createElement('div');
                    this.container.id = 'toast-container';
                    document.body.appendChild(this.container);
                }
            }

            show(msg, type = 'info') {
                const d = document.createElement('div');
                d.className = `toast-msg toast-${type}`;
                d.textContent = msg;
                if(!document.body.contains(this.container)) document.body.appendChild(this.container);
                this.container.appendChild(d);
                requestAnimationFrame(() => d.classList.add('visible'));
                setTimeout(() => { d.classList.remove('visible'); setTimeout(() => d.remove(), 300); }, 3000);
            }
        }

        // =========================================================================
        // 2. CONFIGURATION (Singleton)
        // =========================================================================
