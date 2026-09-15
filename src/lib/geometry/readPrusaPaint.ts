import type { MeshData } from './meshTypes';
import { encodePrusaTriangleState, type PaintForest, type PaintNode } from './prusaPaint';

type PaintTree = { state: number; split: number; side: number; children: PaintTree[] };
const MAX_PAINT_LEAVES = 2_000_000;

export function readPaintTree(text: string, stateUsed?: (state: number) => void): PaintTree {
  if (!/^[0-9a-f]+$/i.test(text)) throw new Error('Invalid MMU paint encoding.');
  let offset = text.length - 1;
  const read = () => {
    if (offset < 0) throw new Error('Truncated MMU paint tree.');
    return Number.parseInt(text[offset--], 16);
  };
  const visit = (depth: number): PaintTree => {
    if (depth > 64) throw new Error('MMU paint tree is too deep.');
    const code = read(), split = code & 3, side = code >> 2;
    if (!split) {
      let state = side;
      if (state === 3) {
        const extension = read();
        if (extension === 15) throw new Error('Unsupported MMU material state.');
        state = extension === 14 ? 17 + read() + 16 * read() : 3 + extension;
      }
      if (state > 255) throw new Error('Unsupported MMU material state.');
      stateUsed?.(state);
      return { state, split, side: 0, children: [] };
    }
    if (side > 2 || split === 3 && side !== 0) throw new Error('Invalid MMU subdivision.');
    const children = new Array<PaintTree>(split + 1);
    for (let i = split; i >= 0; i--) children[i] = visit(depth + 1);
    return { state: 0, split, side, children };
  };
  const root = visit(0);
  if (offset !== -1) throw new Error('Trailing MMU paint data.');
  return root;
}

// Shared by decoding and mirrored-instance conversion. Vertex order is significant.
function childrenOf<T>(points: T[], split: number, side: number, midpoint: (a: T, b: T) => T): T[][] {
  const [a, b, c] = [points[side], points[(side + 1) % 3], points[(side + 2) % 3]];
  if (split === 1) { const bc = midpoint(b, c); return [[a, b, bc], [bc, c, a]]; }
  const ab = midpoint(a, b), ca = midpoint(c, a);
  if (split === 2) return [[a, ab, ca], [ab, b, ca], [b, c, ca]];
  const bc = midpoint(b, c);
  return [[a, ab, ca], [ab, b, bc], [bc, c, ca], [ab, bc, ca]];
}

export function mirrorPaintTree(text: string): string {
  const reorder = (tree: PaintTree, permutation: number[]): string => {
    if (!tree.split) return encodePrusaTriangleState(tree.state);
    if (tree.split === 2) {
      // The three-child split has an asymmetric diagonal. Express it as two
      // binary splits first, so reversing winding preserves the exact regions.
      const binary: PaintTree = { state: 0, split: 1, side: (tree.side + 1) % 3, children: [
        tree.children[2],
        { state: 0, split: 1, side: 0, children: [
          readPaintTree(reorder(tree.children[0], [2, 0, 1])), tree.children[1],
        ] },
      ] };
      return reorder(binary, permutation);
    }
    const side = tree.split === 3 ? 0 : permutation.indexOf(tree.side);
    // Barycentric coordinates identify corresponding child triangles exactly.
    const points = [[2, 0, 0], [0, 2, 0], [0, 0, 2]];
    const midpoint = (a: number[], b: number[]) => a.map((v, i) => (v + b[i]) / 2);
    const oldChildren = childrenOf(points, tree.split, tree.side, midpoint).map(child => child.map(p => p.join(',')));
    const nextChildren = childrenOf(permutation.map(i => points[i]), tree.split, side, midpoint);
    return nextChildren.map(child => {
      const keys = child.map(p => p.join(','));
      const index = oldChildren.findIndex(old => keys.every(key => old.includes(key)));
      if (index < 0) throw new Error('Could not mirror MMU paint.');
      return reorder(tree.children[index], keys.map(key => oldChildren[index].indexOf(key)));
    }).join('') + (tree.split | side << 2).toString(16);
  };
  return reorder(readPaintTree(text), [0, 2, 1]).toUpperCase();
}

export function validatePaint(mesh: MeshData): void {
  const ids = new Set(mesh.materials.map((m, i) => m.extruderId ?? i + 1));
  let leaves = 0;
  for (const face of mesh.triangles) {
    if (!mesh.materials[face.materialIndex]) throw new Error('Missing default extruder for a model part.');
    readPaintTree(face.prusaPaint || '0', state => {
      if (state && !ids.has(state)) throw new Error(`Painting refers to missing extruder ${state}.`);
      if (++leaves > MAX_PAINT_LEAVES) throw new Error('Painting exceeds 2 million paint regions.');
    });
  }
}

export function decodePaint(mesh: MeshData): { mesh: MeshData; forest: PaintForest } {
  const vertices = mesh.vertices.slice();
  const triangles: MeshData['triangles'] = [];
  const nodes: PaintNode[] = mesh.triangles.map(face => ({ split: 0, side: 0, children: [], materialIndex: face.materialIndex }));
  const ids = new Map(mesh.materials.map((m, i) => [m.extruderId ?? i + 1, i]));
  const midpoints = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const existing = midpoints.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length / 3;
    for (let k = 0; k < 3; k++) vertices.push((vertices[a * 3 + k] + vertices[b * 3 + k]) / 2);
    midpoints.set(key, index);
    return index;
  };
  mesh.triangles.forEach((face, rootIndex) => {
    const visit = (tree: PaintTree, points: number[], index: number) => {
      const node = nodes[index];
      node.split = tree.split; node.side = tree.side;
      if (!tree.split) {
        const materialIndex = tree.state ? ids.get(tree.state) : face.materialIndex;
        if (materialIndex === undefined) throw new Error(`Painting refers to missing extruder ${tree.state}.`);
        node.materialIndex = materialIndex;
        if (triangles.length >= MAX_PAINT_LEAVES) throw new Error('Painting exceeds 2 million paint regions.');
        triangles.push({ a: points[0], b: points[1], c: points[2], materialIndex, paintNode: index, projectionRegion: 0 });
        return;
      }
      childrenOf(points, tree.split, tree.side, midpoint).forEach((child, i) => {
        const childIndex = nodes.length;
        nodes.push({ split: 0, side: 0, children: [], materialIndex: face.materialIndex });
        node.children.push(childIndex);
        visit(tree.children[i], child, childIndex);
      });
    };
    visit(readPaintTree(face.prusaPaint || '0'), [face.a, face.b, face.c], rootIndex);
  });
  return { mesh: { ...mesh, vertices, triangles, paintPreview: undefined }, forest: { original: mesh, nodes } };
}

// State zero inherits an object/volume extruder in PrusaSlicer. Our export merges
// parts into one object, so resolve that inheritance before losing the volume table.
export function resolveDefaultPaint(text: string, baseId: number): string {
  const encode = (tree: PaintTree): string => tree.split
    ? tree.children.map(encode).join('') + (tree.split | tree.side << 2).toString(16).toUpperCase()
    : encodePrusaTriangleState(tree.state || baseId);
  return encode(readPaintTree(text));
}
