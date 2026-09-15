import type { MeshData, TriangleData } from './meshTypes';

// Independent encoder for the PrusaSlicer 2.9.6 triangle-paint interchange format.
// Reference: TriangleSelector::serialize / perform_split and FacetsAnnotation.
// Children use Prusa's vertex order. Hex stores the preorder stream backwards,
// with children visited in reverse order. This is paint data, not model topology.
export type PaintNode = { split: number; side: number; children: number[]; materialIndex: number };
export type PaintForest = { nodes: PaintNode[]; original: MeshData };

export function encodePrusaTriangleState(state: number): string {
  if (!Number.isInteger(state) || state < 0 || state > 255) throw new Error('PrusaSlicer paint supports material states 0–255.');
  if (state < 3) return (state * 4).toString(16).toUpperCase();
  if (state <= 16) return `${(state - 3).toString(16)}C`.toUpperCase();
  return `${(state - 17).toString(16).padStart(2, '0')}EC`.toUpperCase();
}

export function packPrusaPaint(forest: PaintForest, coloredMesh: MeshData): MeshData {
  const { nodes, original } = forest;
  for (const face of coloredMesh.triangles) {
    if (face.paintNode === undefined) throw new Error('Missing paint-tree leaf.');
    nodes[face.paintNode].materialIndex = face.materialIndex;
  }
  type Encoded = { text: string; uniform: number | null; leaves: number; representative: number };
  const encode = (index: number): Encoded => {
    const node = nodes[index];
    if (!node.children.length) return { text: encodePrusaTriangleState(node.materialIndex + 1), uniform: node.materialIndex, leaves: 1, representative: node.materialIndex };
    const children = node.children.map(encode);
    const material = children[0].uniform;
    if (material !== null && children.every(child => child.uniform === material)) {
      return { text: encodePrusaTriangleState(material + 1), uniform: material, leaves: 1, representative: material };
    }
    return {
      text: children.map(child => child.text).join('') + (node.split | node.side << 2).toString(16).toUpperCase(),
      uniform: null, leaves: children.reduce((sum, child) => sum + child.leaves, 0), representative: children[0].representative,
    };
  };
  let paintLeafCount = 0;
  const triangles = original.triangles.map((face, index): TriangleData => {
    const result = encode(index);
    paintLeafCount += result.leaves;
    return { ...face, materialIndex: result.representative, prusaPaint: result.text };
  });
  return {
    ...original, triangles, materials: coloredMesh.materials, paintLeafCount,
    paintPreview: { vertices: coloredMesh.vertices, triangles: coloredMesh.triangles },
  };
}
