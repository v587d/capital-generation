/**
 * Largest-Triangle-Three-Buckets 下采样：返回**保留下来的行下标**。
 *
 * 为什么返回下标而不是点：一张图上可能同时有主序列、K 线、成交量副图与标记点，
 * 它们必须**共用同一组时间轴**。若各自下采样，同一时刻会在不同子图上错位。
 * 于是只对"主序列"跑一次 LTTB 求下标，再把这组下标套用到所有子序列上。
 */
export function largestTriangleThreeBuckets(values: readonly number[], threshold: number): number[] {
  const count = values.length
  if (threshold >= count || threshold < 3) return Array.from({ length: count }, (_value, index) => index)

  const sampled: number[] = []
  const every = (count - 2) / (threshold - 2)
  let anchor = 0
  sampled.push(anchor)

  for (let bucket = 0; bucket < threshold - 2; bucket += 1) {
    // 下一个桶的均值，作为三角形的一个顶点。
    const averageStart = Math.floor((bucket + 1) * every) + 1
    const averageEnd = Math.min(Math.floor((bucket + 2) * every) + 1, count)
    const averageLength = Math.max(averageEnd - averageStart, 1)
    let averageX = 0
    let averageY = 0
    for (let index = averageStart; index < averageEnd && index < count; index += 1) {
      averageX += index
      averageY += values[index]!
    }
    averageX /= averageLength
    averageY /= averageLength

    // 当前桶里与 anchor、均值构成最大三角形面积的点。
    const rangeStart = Math.floor(bucket * every) + 1
    const rangeEnd = Math.min(Math.floor((bucket + 1) * every) + 1, count)
    const anchorX = anchor
    const anchorY = values[anchor]!
    let maxArea = -1
    let maxAreaIndex = Math.min(rangeStart, count - 1)
    for (let index = rangeStart; index < rangeEnd && index < count; index += 1) {
      const area = Math.abs((anchorX - averageX) * (values[index]! - anchorY) - (anchorX - index) * (averageY - anchorY)) * 0.5
      if (area > maxArea) {
        maxArea = area
        maxAreaIndex = index
      }
    }
    sampled.push(maxAreaIndex)
    anchor = maxAreaIndex
  }

  sampled.push(count - 1)
  // 去重并保持升序：LTTB 的桶边界在极端阈值下可能产生重复下标。
  const unique: number[] = []
  for (const index of sampled) if (unique.length === 0 || index > unique[unique.length - 1]!) unique.push(index)
  return unique
}
