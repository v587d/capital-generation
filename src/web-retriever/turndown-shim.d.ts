/**
 * 本地类型声明垫片：turndown 与 @joplin/turndown-plugin-gfm。
 *
 * 本仓刻意不引入 @types/turndown（也不引入 @types/node，见 src/chart/html.ts 的明文约定），
 * 只声明我们真正用到的形状。tsconfig 的 include 覆盖 src 目录，会自动收录本文件。
 */

declare module 'turndown' {
  export default class TurndownService {
    turndown(html: string): string
    use(plugin: unknown): unknown
    addRule(key: string, rule: unknown): unknown
    remove(filter: string | string[]): unknown
  }
}

declare module '@joplin/turndown-plugin-gfm' {
  export const gfm: unknown
}