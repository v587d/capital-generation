export function chartEventContextOf(ctx) {
    const raw = ctx;
    const context = {
        get: (name) => raw.get(name),
        // Failed registration returns undefined so events.ts can fall back to turn/start.
        on: (event, listener) => {
            if (typeof raw.on !== 'function')
                return undefined;
            return raw.on.call(ctx, event, (...args) => { listener(...args); });
        },
        onTurnStopping: (listener) => {
            if (typeof raw.on !== 'function')
                return undefined;
            try {
                return raw.on.call(ctx, 'agent/turn-stopping', (...args) => { listener(...args); });
            }
            catch {
                return undefined;
            }
        },
    };
    // root/effect are cordis getters: forward only when present.
    try {
        if (raw.root !== undefined) {
            Object.defineProperty(context, 'root', { get: () => raw.root, enumerable: true });
        }
    }
    catch { /* root unavailable: events.ts falls back to self */ }
    try {
        if (typeof raw.effect === 'function') {
            Object.defineProperty(context, 'effect', {
                value: (callback, label) => raw.effect.call(ctx, callback, label),
                enumerable: true,
            });
        }
    }
    catch { /* no disposer support */ }
    return context;
}
