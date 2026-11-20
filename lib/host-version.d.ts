/** The release every surface in this package was last verified against (see the ledger). */
export declare const VERIFIED_DSH_VERSION = "0.2.2-rc.5";
/**
 * Two carriers: the CLI/web process runs `<dsh>/lib/bin.js`, while a Desktop bundle wraps the host
 * elsewhere and leaves the peer link beside this package as the only local evidence.
 */
export declare function detectDshVersion(): string | undefined;
/** `undefined` means "either verified or undetectable": an unknown host must stay silent. */
export declare function unverifiedHostWarning(detected: string | undefined, verified?: string): string | undefined;
