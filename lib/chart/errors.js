export class ChartError extends Error {
    code;
    /** 可选的机器可读补充（如 available 字段名列表），会随错误一起序列化回模型。 */
    details;
    constructor(code, detail, details = {}) {
        super(`${code}: ${detail}`);
        this.name = 'ChartError';
        this.code = code;
        this.details = details;
    }
    /** 工具边界统一把错误转成结构化信封，让模型能一次修正。 */
    toEnvelope() {
        return { error: this.code, detail: this.message.slice(this.message.indexOf(':') + 2), ...this.details };
    }
}
