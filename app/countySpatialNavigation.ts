interface CountyCenter {
  x: number;
  y: number;
  region: "contiguous" | "alaska" | "hawaii";
}

export type CountyArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

function countyRegion(state: string): CountyCenter["region"] {
  if (state === "Alaska") return "alaska";
  if (state === "Hawaii") return "hawaii";
  return "contiguous";
}

export function countyCenter(path: string, state: string): CountyCenter {
  const rings = path.match(/M[^M]+/g) ?? [];
  let totalArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  rings.forEach((ring) => {
    const coordinates = (ring.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const points: Array<{ x: number; y: number }> = [];
    for (let index = 0; index + 1 < coordinates.length; index += 2) {
      const x = coordinates[index];
      const y = coordinates[index + 1];
      if (x === undefined || y === undefined) continue;
      points.push({ x, y });
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
    if (points.length < 3) return;

    let twiceArea = 0;
    let centroidXNumerator = 0;
    let centroidYNumerator = 0;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
      const from = points[previous];
      const to = points[index];
      if (!from || !to) continue;
      const cross = (from.x * to.y) - (to.x * from.y);
      twiceArea += cross;
      centroidXNumerator += (from.x + to.x) * cross;
      centroidYNumerator += (from.y + to.y) * cross;
    }
    if (Math.abs(twiceArea) <= Number.EPSILON) return;
    totalArea += twiceArea / 2;
    weightedX += centroidXNumerator / 6;
    weightedY += centroidYNumerator / 6;
  });

  if (Math.abs(totalArea) > Number.EPSILON) {
    return { x: weightedX / totalArea, y: weightedY / totalArea, region: countyRegion(state) };
  }
  if ([minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) {
    return {
      x: (minimumX + maximumX) / 2,
      y: (minimumY + maximumY) / 2,
      region: countyRegion(state),
    };
  }
  return { x: 0, y: 0, region: countyRegion(state) };
}

export function isCountyArrowKey(key: string): key is CountyArrowKey {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
}

export function spatialCountyIndex(
  centers: CountyCenter[],
  currentIndex: number,
  key: CountyArrowKey,
): number {
  const origin = centers[currentIndex];
  if (!origin) return currentIndex;
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  let bestIndex = currentIndex;
  let bestScore = Number.POSITIVE_INFINITY;

  centers.forEach((candidate, index) => {
    if (index === currentIndex || candidate.region !== origin.region) return;
    const deltaX = candidate.x - origin.x;
    const deltaY = candidate.y - origin.y;
    const forward = key === "ArrowRight"
      ? deltaX
      : key === "ArrowLeft"
        ? -deltaX
        : key === "ArrowDown"
          ? deltaY
          : -deltaY;
    if (forward <= 0.25) return;
    const perpendicular = horizontal ? Math.abs(deltaY) : Math.abs(deltaX);
    if (perpendicular > forward) return;
    const distance = Math.hypot(deltaX, deltaY);
    const score = distance + 2 * perpendicular;
    if (score >= bestScore) return;
    bestScore = score;
    bestIndex = index;
  });

  return bestIndex;
}
