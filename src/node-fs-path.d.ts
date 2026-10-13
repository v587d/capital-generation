// 本仓不装 `@types/node`（与 `node-url.d.ts` 同一条口径）：只声明真正用到的那几个签名，
// 用到别的就再加一行——比整包类型进来后被 `lib/` 声明文件带出去要干净。
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}
