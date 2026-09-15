import type { MeshData } from './meshTypes';

export type ColorIslandCleanupResult = {
  mesh: MeshData;
  replacedIslandCount: number;
  replacedTriangleCount: number;
};

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function addNeighbor(neighbors: number[][], left: number, right: number) {
  if (left !== right) {
    neighbors[left].push(right);
    neighbors[right].push(left);
  }
}

function buildTriangleNeighbors(mesh: MeshData): number[][] {
  const neighbors = mesh.triangles.map(() => [] as number[]);
  const edgeOwners = new Map<string, number[]>();

  mesh.triangles.forEach((triangle, index) => {
    [
      edgeKey(triangle.a, triangle.b),
      edgeKey(triangle.b, triangle.c),
      edgeKey(triangle.c, triangle.a),
    ].forEach((key) => {
      const owners = edgeOwners.get(key);
      if (owners) {
        owners.forEach((owner) => addNeighbor(neighbors, owner, index));
        owners.push(index);
      } else {
        edgeOwners.set(key, [index]);
      }
    });
  });

  return neighbors.map((entries) => Array.from(new Set(entries)));
}

function bestNeighborMaterial(component: number[], componentSet: Set<number>, neighbors: number[][], mesh: MeshData): number | null {
  const scores = new Map<number, number>();
  component.forEach((triangleIndex) => {
    neighbors[triangleIndex].forEach((neighborIndex) => {
      if (componentSet.has(neighborIndex)) {
        return;
      }
      const materialIndex = mesh.triangles[neighborIndex].materialIndex;
      scores.set(materialIndex, (scores.get(materialIndex) ?? 0) + 1);
    });
  });

  let bestMaterial: number | null = null;
  let bestScore = 0;
  scores.forEach((score, materialIndex) => {
    if (score > bestScore) {
      bestMaterial = materialIndex;
      bestScore = score;
    }
  });
  return bestMaterial;
}

export function cleanupSmallColorIslands(mesh: MeshData, maxTriangles: number): ColorIslandCleanupResult {
  const limit = Math.max(0, Math.floor(maxTriangles));
  if (limit <= 0 || mesh.triangles.length === 0) {
    return { mesh, replacedIslandCount: 0, replacedTriangleCount: 0 };
  }

  const neighbors = buildTriangleNeighbors(mesh);
  const visited = new Array<boolean>(mesh.triangles.length).fill(false);
  const nextMaterials = mesh.triangles.map((triangle) => triangle.materialIndex);
  let replacedIslandCount = 0;
  let replacedTriangleCount = 0;

  for (let start = 0; start < mesh.triangles.length; start += 1) {
    if (visited[start]) {
      continue;
    }

    const materialIndex = mesh.triangles[start].materialIndex;
    const component: number[] = [];
    const stack = [start];
    visited[start] = true;

    while (stack.length > 0) {
      const triangleIndex = stack.pop();
      if (triangleIndex === undefined) {
        continue;
      }
      component.push(triangleIndex);
      neighbors[triangleIndex].forEach((neighborIndex) => {
        if (!visited[neighborIndex] && mesh.triangles[neighborIndex].materialIndex === materialIndex) {
          visited[neighborIndex] = true;
          stack.push(neighborIndex);
        }
      });
    }

    if (component.length > limit) {
      continue;
    }

    const componentSet = new Set(component);
    const replacementMaterial = bestNeighborMaterial(component, componentSet, neighbors, mesh);
    if (replacementMaterial === null || replacementMaterial === materialIndex) {
      continue;
    }

    component.forEach((triangleIndex) => {
      nextMaterials[triangleIndex] = replacementMaterial;
    });
    replacedIslandCount += 1;
    replacedTriangleCount += component.length;
  }

  if (replacedTriangleCount === 0) {
    return { mesh, replacedIslandCount, replacedTriangleCount };
  }

  return {
    mesh: {
      ...mesh,
      triangles: mesh.triangles.map((triangle, index) => ({
        ...triangle,
        materialIndex: nextMaterials[index],
      })),
    },
    replacedIslandCount,
    replacedTriangleCount,
  };
}

// Imported meshes have uneven triangle sizes. Measure islands in mm² and never
// move color across the image/visibility mask. Typed adjacency keeps large exports manageable.
export function cleanupColorIslandsByArea(mesh: MeshData, maxAreaMm2: number): ColorIslandCleanupResult {
  const unchanged = { mesh, replacedIslandCount: 0, replacedTriangleCount: 0 };
  if (!(maxAreaMm2 > 0) || !Number.isFinite(maxAreaMm2)) return unchanged;
  const count = mesh.triangles.length;
  const neighbors = new Int32Array(count * 3).fill(-1);
  const owners = new Map<number, number>();
  const vertexCount = mesh.vertices.length / 3;
  mesh.triangles.forEach((face, index) => {
    const ids = [face.a, face.b, face.c];
    for (let i = 0; i < 3; i++) {
      const a = ids[i], b = ids[(i + 1) % 3];
      const key = Math.min(a, b) * vertexCount + Math.max(a, b);
      const slot = index * 3 + i;
      const other = owners.get(key);
      if (other === undefined) owners.set(key, slot);
      else if (other >= 0) {
        if (neighbors[other] >= 0) {
          // Do not propagate paint through a non-manifold edge.
          neighbors[neighbors[other]] = -1; neighbors[other] = -1; owners.set(key, -1);
        } else { neighbors[slot] = other; neighbors[other] = slot; }
      }
    }
  });
  owners.clear();
  const labels = new Int32Array(count).fill(-1);
  const areas: number[] = [];
  const materials: number[] = [];
  const sizes: number[] = [];
  const v = mesh.vertices;
  for (let start = 0; start < count; start++) {
    if (labels[start] !== -1 || mesh.triangles[start].projectionRegion !== 1) continue;
    const label = areas.length;
    const material = mesh.triangles[start].materialIndex;
    const stack = [start];
    labels[start] = label;
    let area = 0, size = 0;
    while (stack.length) {
      const index = stack.pop()!;
      size++;
      const face = mesh.triangles[index];
      const a = face.a * 3, b = face.b * 3, c = face.c * 3;
      const ux = v[b]-v[a], uy = v[b+1]-v[a+1], uz = v[b+2]-v[a+2];
      const vx = v[c]-v[a], vy = v[c+1]-v[a+1], vz = v[c+2]-v[a+2];
      area += Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx) / 2;
      for (let i = 0; i < 3; i++) {
        const slot = neighbors[index * 3 + i];
        if (slot < 0) continue;
        const next = Math.floor(slot / 3);
        if (labels[next] === -1 && mesh.triangles[next].projectionRegion === 1 && mesh.triangles[next].materialIndex === material) {
          labels[next] = label; stack.push(next);
        }
      }
    }
    areas.push(area); materials.push(material); sizes.push(size);
  }
  const scores = new Map<number, Map<number, number>>();
  mesh.triangles.forEach((face, index) => {
    const label = labels[index];
    if (label < 0 || areas[label] > maxAreaMm2) return;
    const ids = [face.a, face.b, face.c];
    for (let i = 0; i < 3; i++) {
      const slot = neighbors[index * 3 + i];
      if (slot < 0) continue;
      const nextLabel = labels[Math.floor(slot / 3)];
      // Merge only into stable, larger islands; avoid simultaneous color swaps.
      if (nextLabel < 0 || areas[nextLabel] <= maxAreaMm2 || materials[nextLabel] === materials[label]) continue;
      const a = ids[i] * 3, b = ids[(i + 1) % 3] * 3;
      const length = Math.hypot(v[a]-v[b], v[a+1]-v[b+1], v[a+2]-v[b+2]);
      let totals = scores.get(label);
      if (!totals) { totals = new Map(); scores.set(label, totals); }
      totals.set(materials[nextLabel], (totals.get(materials[nextLabel]) ?? 0) + length);
    }
  });
  const replacements = new Map<number, number>();
  let replacedTriangleCount = 0;
  scores.forEach((totals, label) => {
    let best = -1, bestScore = 0;
    totals.forEach((score, material) => { if (score > bestScore) { best = material; bestScore = score; } });
    if (best >= 0) { replacements.set(label, best); replacedTriangleCount += sizes[label]; }
  });
  if (!replacements.size) return unchanged;
  return {
    mesh: { ...mesh, triangles: mesh.triangles.map((face, index) => {
      const materialIndex = replacements.get(labels[index]);
      return materialIndex === undefined ? face : { ...face, materialIndex };
    }) },
    replacedIslandCount: replacements.size, replacedTriangleCount,
  };
}
