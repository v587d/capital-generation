/**
 * Type shim for turndown + @joplin/turndown-plugin-gfm: no `@types/*` in this repo
 * (same rule as `src/chart/html.ts`), only the shapes we use are declared.
 * tsconfig `include` covers src, so this file is picked up automatically.
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