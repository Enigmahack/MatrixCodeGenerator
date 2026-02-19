class QuantizedSequenceCache {
    constructor() {
        this.cache = new Map(); // Key: Config String, Value: Array of Sequences
        this.maxCacheSize = 5; 
    }

    get(configKey) {
        const sequences = this.cache.get(configKey);
        if (sequences && sequences.length > 0) {
            return sequences.shift(); // Return and remove from cache
        }
        return null;
    }

    put(configKey, sequence) {
        if (!this.cache.has(configKey)) {
            this.cache.set(configKey, []);
        }
        const sequences = this.cache.get(configKey);
        if (sequences.length < this.maxCacheSize) {
            sequences.push(sequence);
        }
    }

    has(configKey) {
        const sequences = this.cache.get(configKey);
        return sequences && sequences.length > 0;
    }

    clear() {
        this.cache.clear();
    }
}

// Global Instance
window.sequenceCache = new QuantizedSequenceCache();
