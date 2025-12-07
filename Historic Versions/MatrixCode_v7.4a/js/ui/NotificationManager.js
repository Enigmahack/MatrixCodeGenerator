class NotificationManager {
    constructor() {
        this.container = document.getElementById('toast-container') || this._createContainer();
    }

    /**
     * Creates and initializes the toast container if it doesn't exist.
     * @returns {HTMLElement} The toast container DOM element.
     */
    _createContainer() {
        const container = document.createElement('div');
        container.id = 'toast-container';
        container.setAttribute('aria-live', 'polite'); // Accessibility: Announce updates to screen readers.
        container.setAttribute('role', 'status'); // Accessibility: Define the type of content the container holds.
        document.body.appendChild(container);
        return container;
    }

    /**
     * Displays a notification with the specified message and type.
     * @param {string} message - The message to display in the notification.
     * @param {string} [type='info'] - The type of the notification ('info', 'success', 'error', etc.).
     * @param {number} [duration=3000] - The duration (in milliseconds) for the notification to be visible.
     */
    show(message, type = 'info', duration = 3000) {
        // Create the notification element.
        const toast = this._createToast(message, type);

        // Ensure the container is attached.
        if (!document.body.contains(this.container)) {
            document.body.appendChild(this.container);
        }

        // Add the notification to the container and apply the "visible" class for animation.
        this.container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('visible'));

        // Set timers for hiding and removing the notification.
        this._scheduleToastRemoval(toast, duration);
    }

    /**
     * Creates an individual toast element.
     * @private
     * @param {string} message - The message to display.
     * @param {string} type - The type of the notification.
     * @returns {HTMLElement} The toast DOM element.
     */
    _createToast(message, type) {
        const toast = document.createElement('div');
        toast.className = `toast-msg toast-${type}`;
        toast.textContent = message;
        toast.setAttribute('role', 'alert'); // Accessibility: Specify that this is an alert message.
        return toast;
    }

    /**
     * Schedules the removal of the notification after the specified duration.
     * Handles smooth animation states before removing the DOM element.
     * @private
     * @param {HTMLElement} toast - The toast element to remove.
     * @param {number} duration - How long the toast remains visible.
     */
    _scheduleToastRemoval(toast, duration) {
        setTimeout(() => {
            // Trigger fade-out animation by removing the "visible" class.
            toast.classList.remove('visible');
            // Remove the toast element from the DOM after the animation completes.
            setTimeout(() => toast.remove(), 300); // Matches CSS animation transition time.
        }, duration);
    }
}

    // =========================================================================
    // 2.0 CONFIGURATION MANAGER 
    // =========================================================================
