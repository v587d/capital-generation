const MESSAGES = {
    'unsupported-platform': '当前平台不在 Python 运行时的支持矩阵内。',
    'manifest-invalid': 'Python 运行时 manifest 不可读或字段不合法。',
    'runtime-not-ready': '分析环境尚未准备；请先在设置页准备，或运行 python-runtime CLI。',
    'data-runtime-not-ready': '分析环境（base pack）尚未安装；请在插件设置 → 分析环境里安装 base pack 后重试。',
    'runtime-locked': '另一个进程正在安装 Python 运行时，请稍后重试。',
    'pnpm-missing': '找不到可用的 pnpm；DSH 的包管理器不可用，无法自动安装运行时。',
    'network': '无法连接 npm registry；请检查网络/代理，或使用离线运行时包。',
    'not-found': '运行时包版本不存在，或当前镜像尚未同步。',
    'disk-space': '磁盘空间不足，无法安装 Python 运行时。',
    'permission': '没有权限写入或执行 Python 运行时缓存目录。',
    'probe-failed': 'Python 运行时自检失败。',
    'script-failed': 'Python 数据脚本执行失败。',
    timeout: 'Python 运行时操作超时。',
    cancelled: 'Python 运行时操作已取消。',
    'pack-invalid': '运行时包内容与 manifest 不一致。',
    busy: '已有另一个 Python 运行时任务在进行。',
    'invalid-request': 'Python 运行时请求不合法。',
    unknown: 'Python 运行时操作失败。',
};
export class PythonRuntimeError extends Error {
    code;
    diagnostics;
    /**
     * Stable analysis code raised by a reviewed module (e.g. `analysis_input_invalid`). The worker
     * reports it because a module cannot throw a TypeScript error; `script-failed` alone would hide
     * "this input shape is unsupported" behind "the module crashed".
     */
    analysisCode;
    constructor(code, message, diagnostics, analysisCode) {
        super(message ?? MESSAGES[code]);
        this.name = 'PythonRuntimeError';
        this.code = code;
        this.diagnostics = diagnostics;
        if (analysisCode !== undefined)
            this.analysisCode = analysisCode;
    }
}
export function isPythonRuntimeError(value) {
    return value instanceof PythonRuntimeError;
}
export function messageOf(value) {
    return value instanceof Error ? value.message : String(value);
}
