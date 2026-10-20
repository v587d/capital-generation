/**
 * LTTB downsampling returning kept row indices. All subplots share one time axis, so indices
 * are computed once from the primary series and applied everywhere.
 */
export declare function largestTriangleThreeBuckets(values: readonly number[], threshold: number): number[];
