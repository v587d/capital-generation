/**
 * Largest-Triangle-Three-Buckets 下采样：返回**保留下来的行下标**。
 *
 * 为什么返回下标而不是点：一张图上可能同时有主序列、K 线、成交量副图与标记点，
 * 它们必须**共用同一组时间轴**。若各自下采样，同一时刻会在不同子图上错位。
 * 于是只对"主序列"跑一次 LTTB 求下标，再把这组下标套用到所有子序列上。
 */
export declare function largestTriangleThreeBuckets(values: readonly number[], threshold: number): number[];
