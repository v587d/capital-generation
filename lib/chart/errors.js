export class ChartError extends Error {
    code;
    /** Machine-readable extras (e.g. available fields), serialized back to the model. */
    details;
    constructor(code, detail, details = {}) {
        super(`${code}: ${detail}`);
        this.name = 'ChartError';
        this.code = code;
        this.details = details;
    }
    toEnvelope() {
        return { error: this.code, detail: this.message.slice(this.message.indexOf(':') + 2), ...this.details };
    }
}
