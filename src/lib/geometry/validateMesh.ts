import type { MeshData } from './meshTypes';

export type MeshValidationResult = {
  boundaryEdges: number;
  nonManifoldEdges: number;
  duplicateTriangles: number;
  edgeUseCounts: Map<string, number>;
};

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function validateMeshManifold(mesh: MeshData): MeshValidationResult {
  const edgeUseCounts = new Map<string, number>();
  const triangleKeys = new Set<string>();
  let duplicateTriangles = 0;

  mesh.triangles.forEach((triangle) => {
    const sortedTriangle = [triangle.a, triangle.b, triangle.c].sort((a, b) => a - b).join(':');
    if (triangleKeys.has(sortedTriangle)) {
      duplicateTriangles += 1;
    } else {
      triangleKeys.add(sortedTriangle);
    }

    [
      edgeKey(triangle.a, triangle.b),
      edgeKey(triangle.b, triangle.c),
      edgeKey(triangle.c, triangle.a),
    ].forEach((key) => edgeUseCounts.set(key, (edgeUseCounts.get(key) ?? 0) + 1));
  });

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  edgeUseCounts.forEach((count) => {
    if (count === 1) boundaryEdges += 1;
    if (count > 2) nonManifoldEdges += 1;
  });

  return { boundaryEdges, nonManifoldEdges, duplicateTriangles, edgeUseCounts };
}
