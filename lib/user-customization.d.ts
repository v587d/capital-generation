/**
 * Blank input registers nothing; oversize throws; the non-overridable safety reminder is
 * always appended.
 */
export declare function resolveUserCustomizationSection(customPersona?: string): {
    name: string;
    order: number;
    text: string;
} | undefined;
export declare function userCustomizationSection(read: () => string | undefined, onError?: (error: unknown) => void): {
    name: string;
    order: number;
    text: () => string;
};
