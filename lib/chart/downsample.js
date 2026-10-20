/**
 * LTTB downsampling returning kept row indices. All subplots share one time axis, so indices
 * are computed once from the primary series and applied everywhere.
 */
export function largestTriangleThreeBuckets(values, threshold) {
    const count = values.length;
    if (threshold >= count || threshold < 3)
        return Array.from({ length: count }, (_value, index) => index);
    const sampled = [];
    const every = (count - 2) / (threshold - 2);
    let anchor = 0;
    sampled.push(anchor);
    for (let bucket = 0; bucket < threshold - 2; bucket += 1) {
        const averageStart = Math.floor((bucket + 1) * every) + 1;
        const averageEnd = Math.min(Math.floor((bucket + 2) * every) + 1, count);
        const averageLength = Math.max(averageEnd - averageStart, 1);
        let averageX = 0;
        let averageY = 0;
        for (let index = averageStart; index < averageEnd && index < count; index += 1) {
            averageX += index;
            averageY += values[index];
        }
        averageX /= averageLength;
        averageY /= averageLength;
        const rangeStart = Math.floor(bucket * every) + 1;
        const rangeEnd = Math.min(Math.floor((bucket + 1) * every) + 1, count);
        const anchorX = anchor;
        const anchorY = values[anchor];
        let maxArea = -1;
        let maxAreaIndex = Math.min(rangeStart, count - 1);
        for (let index = rangeStart; index < rangeEnd && index < count; index += 1) {
            const area = Math.abs((anchorX - averageX) * (values[index] - anchorY) - (anchorX - index) * (averageY - anchorY)) * 0.5;
            if (area > maxArea) {
                maxArea = area;
                maxAreaIndex = index;
            }
        }
        sampled.push(maxAreaIndex);
        anchor = maxAreaIndex;
    }
    sampled.push(count - 1);
    // Bucket edges can yield duplicate indices at extreme thresholds; keep ascending order.
    const unique = [];
    for (const index of sampled)
        if (unique.length === 0 || index > unique[unique.length - 1])
            unique.push(index);
    return unique;
}
