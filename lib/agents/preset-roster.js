import { isInternalRolePresetId } from '../preset-ids.js';
// A future host may serve `agentPresets/list` straight from `list`; prefer the dedicated export.
const METHODS = ['remoteExportList', 'list'];
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isInternalRow(row) {
    return isRecord(row) && isInternalRolePresetId(row.id);
}
/** Drop internal rows without mutating the caller's array; unknown shapes pass through. */
export function filterPresetRoster(value) {
    try {
        if (Array.isArray(value))
            return value.filter((row) => !isInternalRow(row));
        if (!isRecord(value) || !Array.isArray(value.presets))
            return value;
        return { ...value, presets: value.presets.filter((row) => !isInternalRow(row)) };
    }
    catch {
        return value;
    }
}
function pickMethod(service) {
    return METHODS.find((method) => typeof service[method] === 'function');
}
/**
 * Install on one registry instance. Returns false when the host exposes no roster method or the
 * property cannot be shadowed; callers then behave exactly as if this filter did not exist.
 */
export function installPresetRosterFilter(service, ctx) {
    if (!isRecord(service))
        return false;
    const method = pickMethod(service);
    if (method === undefined)
        return false;
    const original = service[method];
    if (typeof original !== 'function')
        return false;
    const previous = Object.getOwnPropertyDescriptor(service, method);
    const wrapper = (...args) => {
        const result = original.call(service, ...args);
        try {
            if (isRecord(result) && typeof result.then === 'function') {
                return result.then((value) => filterPresetRoster(value));
            }
            return filterPresetRoster(result);
        }
        catch {
            return result;
        }
    };
    try {
        Object.defineProperty(service, method, {
            configurable: true,
            enumerable: previous?.enumerable ?? false,
            writable: true,
            value: wrapper,
        });
    }
    catch {
        return false;
    }
    const restore = () => {
        if (service[method] !== wrapper)
            return;
        try {
            if (previous === undefined)
                delete service[method];
            else
                Object.defineProperty(service, method, previous);
        }
        catch {
        }
    };
    if (typeof ctx.effect === 'function')
        ctx.effect(() => restore, 'capital-preset-roster');
    return true;
}
/** Wait for the registry service, then filter its remote roster. */
export function registerPresetRosterFilter(ctx) {
    const host = ctx;
    if (typeof host.inject !== 'function')
        return;
    host.inject(['agentPresets'], (injected) => {
        installPresetRosterFilter(injected.agentPresets, injected);
    });
}
