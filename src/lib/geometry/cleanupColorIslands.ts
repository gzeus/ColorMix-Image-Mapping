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
