// No `@types/node` in this repo (same rule as `node-url.d.ts`): declare only the signatures
// used, one line per need — a whole package would leak out through the `lib/` declarations.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function existsSync(path: string): boolean
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}
