/**
 * Host-version awareness for the mount-time warning. The compatibility gate itself lives in the
 * host (`engines.dsh` in package.json): a host outside that window never imports this package, so
 * anything seen here is "same minor, not the release we tested" — worth one warn line, not a refusal.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
/** The release every surface in this package was last verified against (see the ledger). */
export const VERIFIED_DSH_VERSION = '0.2.2-rc.5';
function manifestVersion(path) {
    try {
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        return typeof manifest.version === 'string' ? manifest.version : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Two carriers: the CLI/web process runs `<dsh>/lib/bin.js`, while a Desktop bundle wraps the host
 * elsewhere and leaves the peer link beside this package as the only local evidence.
 */
export function detectDshVersion() {
    const entry = process.argv[1];
    if (entry !== undefined) {
        let dir = dirname(resolve(entry));
        for (let depth = 0; depth < 4; depth += 1) {
            const manifestPath = join(dir, 'package.json');
            try {
                const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
                if (manifest.name === '@deepseek-ai/dsh' && typeof manifest.version === 'string')
                    return manifest.version;
            }
            catch {
                // Not a package root here; keep walking.
            }
            const parent = dirname(dir);
            if (parent === dir)
                break;
            dir = parent;
        }
    }
    try {
        return manifestVersion(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-skill/package.json'));
    }
    catch {
        return undefined;
    }
}
/** `undefined` means "either verified or undetectable": an unknown host must stay silent. */
export function unverifiedHostWarning(detected, verified = VERIFIED_DSH_VERSION) {
    if (detected === undefined || detected === verified)
        return undefined;
    return `capital-generation: 宿主 dsh ${detected} 未逐项验证（本版验证基线 ${verified}，支持窗口见 package.json 的 engines.dsh）`
        + '；如遇异常请先升级插件，报 issue 时请附这一行';
}
