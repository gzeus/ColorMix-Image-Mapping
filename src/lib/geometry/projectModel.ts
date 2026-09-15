import { decodePaint } from './readPrusaPaint';
import type { PaintForest, PaintNode } from './prusaPaint';
import { Box3, Euler, Matrix4, Ray, Triangle, Vector3 } from 'three';
import { nearestPaletteIndex, type PaletteColor, type Rgba } from '../colorUtils';
import { makeImageCoordinateMapper, makePixelSampler, type ImagePixels } from '../imageSampling';
import { meshBounds, projectionFrame, transformModel, type CustomSettings } from './customModel';
import type { ImageMappingSettings, MeshData } from './meshTypes';

type Face = MeshData['triangles'][number];
const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;

// Split shared edges together, preserving the original surface and sharp edges.
type RefinementPriority = (face: Face, vertices: number[]) => [number, number, number];
export function refineMesh(source: MeshData, target: number, budget = 400_000, priority?: RefinementPriority, capturePaint = false, initialForest?: PaintForest) {
  const vertices = source.vertices.slice();
  const nodes: PaintNode[] = initialForest?.nodes ?? (capturePaint ? source.triangles.map(face => ({ split: 0, side: 0, children: [], materialIndex: face.materialIndex })) : []);
  let triangles = capturePaint && !initialForest ? source.triangles.map((face, paintNode) => ({ ...face, paintNode })) : source.triangles;
  let limited = false;
  for (let pass = 0; pass < 16; pass++) {
    const marked = new Map<string, { a: number; b: number; score: number; cost: number }>();
    // Each shared-edge split costs one additional triangle per incident face.
    // Gather scores first, then count all incident faces (including unpainted ones).
    for (const face of triangles) {
      const ids = [face.a, face.b, face.c];
      const scores = priority?.(face, vertices);
      for (let i = 0; i < 3; i++) {
        const a = ids[i], b = ids[(i + 1) % 3];
        const score = scores ? scores[i] : Math.hypot(vertices[a*3]-vertices[b*3], vertices[a*3+1]-vertices[b*3+1], vertices[a*3+2]-vertices[b*3+2]) / target;
        if (score <= 1) continue;
        const key = edgeKey(a, b);
        const existing = marked.get(key);
        if (existing) existing.score = Math.max(existing.score, score);
        else marked.set(key, { a, b, score, cost: 0 });
      }
    }
    if (!marked.size) break;
    for (const { a, b, c } of triangles) {
      for (const [x, y] of [[a, b], [b, c], [c, a]]) {
        const edge = marked.get(edgeKey(x, y));
        if (edge) edge.cost++;
      }
    }
    let remaining = Math.max(0, budget - triangles.length);
    const candidates = [...marked.entries()].sort((a, b) => b[1].score - a[1].score);
    for (const [key, edge] of candidates) {
      if (edge.cost <= remaining) remaining -= edge.cost;
      else { marked.delete(key); limited = true; }
    }
    if (!marked.size) break;
    const midpoints = new Map<string, number>();
    marked.forEach(({ a, b }, key) => {
      midpoints.set(key, vertices.length / 3);
      for (let k = 0; k < 3; k++) vertices.push((vertices[a * 3 + k] + vertices[b * 3 + k]) / 2);
    });
    const next: Face[] = [];
    for (const face of triangles) {
      const ids = [face.a, face.b, face.c];
      const mids = ids.map((a, i) => midpoints.get(edgeKey(a, ids[(i + 1) % 3])));
      const splitCount = mids.filter(mid => mid !== undefined).length;
      const children: number[] = [];
      const add = (a: number, b: number, c: number) => {
        if (capturePaint) {
          const paintNode = nodes.length;
          nodes.push({ split: 0, side: 0, children: [], materialIndex: face.materialIndex });
          children.push(paintNode);
          next.push({ ...face, a, b, c, paintNode });
        } else next.push({ ...face, a, b, c });
      };
      let side = 0;
      if (splitCount === 3) {
        const [a, b, c] = ids, [ab, bc, ca] = mids as number[];
        add(a, ab, ca); add(ab, b, bc); add(bc, c, ca); add(ab, bc, ca);
      } else if (splitCount === 2) {
        const i = mids.findIndex((mid, i) => mid !== undefined && mids[(i + 1) % 3] !== undefined);
        const a = ids[i], b = ids[(i + 1) % 3], c = ids[(i + 2) % 3];
        const ab = mids[i]!, bc = mids[(i + 1) % 3]!;
        side = (i + 1) % 3;
        add(b, bc, ab); add(bc, c, ab); add(c, a, ab);
      } else if (splitCount === 1) {
        const i = mids.findIndex(mid => mid !== undefined);
        const a = ids[i], b = ids[(i + 1) % 3], c = ids[(i + 2) % 3], mid = mids[i]!;
        side = (i + 2) % 3;
        add(c, a, mid); add(mid, b, c);
      } else next.push(face);
      if (capturePaint && splitCount) {
        const node = nodes[face.paintNode!];
        node.split = splitCount; node.side = side; node.children = children;
      }
    }
    triangles = next;
    if (pass === 15) limited = true;
  }
  const paintForest: PaintForest | undefined = capturePaint ? { original: initialForest?.original ?? source, nodes } : undefined;
  return { mesh: { ...source, vertices, triangles }, limited, paintForest };
}

type Node = { box: Box3; faces?: Triangle[]; left?: Node; right?: Node };
function buildTree(faces: Triangle[]): Node {
  const box = new Box3();
  for (const face of faces) { box.expandByPoint(face.a); box.expandByPoint(face.b); box.expandByPoint(face.c); }
  if (faces.length <= 12) return { box, faces };
  const size = box.getSize(new Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  faces.sort((a, b) => (a.a[axis] + a.b[axis] + a.c[axis]) - (b.a[axis] + b.b[axis] + b.c[axis]));
  const mid = Math.floor(faces.length / 2);
  return { box, left: buildTree(faces.slice(0, mid)), right: buildTree(faces.slice(mid)) };
}

function occluded(ray: Ray, node: Node, hit: Vector3): boolean {
  if (!ray.intersectsBox(node.box)) return false;
  if (node.faces) return node.faces.some(t => ray.intersectTriangle(t.a, t.b, t.c, false, hit) !== null);
  return occluded(ray, node.left!, hit) || occluded(ray, node.right!, hit);
}

// Immutable image placements share one project-wide material palette.
export type ProjectionLayer = {
  settings: CustomSettings; mapping: ImageMappingSettings; pixels: ImagePixels;
};

export type ProjectionRequest = {
  layers?: ProjectionLayer[];
  source: MeshData; settings: CustomSettings; mapping: ImageMappingSettings;
  pixels: ImagePixels | null; palette: PaletteColor[]; baseIndex: number;
  refinement?: { multiplier: number; budget: number };
  cleanupAreaMm2?: number;
  paintEncoding?: 'subtriangle' | 'geometry';

};

export function projectModel({ source, settings, mapping, pixels, palette, baseIndex, refinement, paintEncoding, layers = [] }: ProjectionRequest) {
  const original = transformModel(source, settings);
  const imported = source.extruderSetup ? decodePaint(original) : null;
  if (imported && !pixels && !layers.length) {
    return { mesh: { ...original, paintLeafCount: imported.mesh.triangles.length, paintPreview: { vertices: imported.mesh.vertices, triangles: imported.mesh.triangles } }, limited: false, painted: imported.mesh.triangles.length, paintForest: undefined };
  }
  const size = meshBounds(original).getSize(new Vector3());
  const maxSize = Math.max(size.x, size.y, size.z, 0.001);
  const base = palette[baseIndex];
  const placements = pixels ? [...layers, { settings, mapping, pixels }] : layers;
  const tree = placements.some(layer => layer.settings.projection === 'planar' && layer.settings.visibleOnly)
    ? buildTree(original.triangles.map(t => new Triangle(
      new Vector3().fromArray(original.vertices, t.a * 3), new Vector3().fromArray(original.vertices, t.b * 3), new Vector3().fromArray(original.vertices, t.c * 3),
    ))) : null;
  const triangle = new Triangle(), center = new Vector3(), normal = new Vector3();
  const ray = new Ray(), hit = new Vector3();
  const colorCache = new Map<number, number>();
  // Recover each transform's translation from a corresponding source vertex.
  // This keeps baked placements attached when the model is scaled or rotated.
  const matrixFor = (geometry: MeshData, configuration: CustomSettings) => {
    const matrix = new Matrix4().makeRotationFromEuler(new Euler(...configuration.rotation.map(v => v * Math.PI / 180) as [number, number, number]));
    matrix.scale(new Vector3().setScalar(configuration.scale));
    const translation = new Vector3().fromArray(geometry.vertices).sub(new Vector3().fromArray(source.vertices).applyMatrix4(matrix));
    return matrix.setPosition(translation);
  };
  const currentMatrix = matrixFor(original, settings);
  const inverseCurrent = currentMatrix.clone().invert();
  const contexts = placements.map(({ settings, mapping, pixels }) => {
    const layerGeometry = transformModel(source, settings);
    const frame = projectionFrame(layerGeometry, settings);
    const layerMatrix = matrixFor(layerGeometry, settings);
    const toLayer = layerMatrix.clone().multiply(inverseCurrent);
    const direction = frame.direction.clone().transformDirection(currentMatrix.clone().multiply(layerMatrix.clone().invert()));
    const relative = new Vector3();
    const sampler: (u: number, v: number) => Rgba = makePixelSampler(pixels, mapping, base, frame.width / frame.height);
    const angle = settings.imageRotation * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const uvAt = (point: Vector3) => {
      relative.copy(point).applyMatrix4(toLayer).sub(frame.center);
      if (settings.projection === 'cylindrical') return { u: Math.atan2(relative.x, relative.z) / (2 * Math.PI) + 0.5, v: relative.y / frame.height + 0.5 };
      const x = relative.dot(frame.right), y = relative.dot(frame.up);
      return { u: (x * cos + y * sin) / frame.width + 0.5, v: (-x * sin + y * cos) / frame.height + 0.5 };
    };
    const coordinates = makeImageCoordinateMapper(pixels.width / pixels.height, mapping, frame.width / frame.height);
    const detail = (settings.detail === 'fine' ? 128 : 64) * (refinement?.multiplier ?? 1);
    const priority: RefinementPriority = (face, vertices) => {
      triangle.a.fromArray(vertices, face.a * 3); triangle.b.fromArray(vertices, face.b * 3); triangle.c.fromArray(vertices, face.c * 3);
      triangle.getNormal(normal);
      if (settings.projection === 'planar' && settings.visibleOnly && Math.abs(normal.dot(direction)) <= Math.cos(75 * Math.PI / 180)) return [0, 0, 0];
      const points = [triangle.a, triangle.b, triangle.c].map(point => uvAt(point));
      // Unwrap this triangle locally so crossing the cylindrical seam is not an enormous edge.
      if (settings.projection === 'cylindrical') {
        for (let i = 1; i < 3; i++) points[i].u -= Math.round(points[i].u - points[0].u);
      }
      const mapped = points.map(p => coordinates(p.u, p.v));
      const minU = Math.min(...mapped.map(p => p.u)), maxU = Math.max(...mapped.map(p => p.u));
      const minV = Math.min(...mapped.map(p => p.v)), maxV = Math.max(...mapped.map(p => p.v));
      if (settings.projection === 'planar' && ((!mapping.repeatX && (maxU < 0 || minU > 1)) || (!mapping.repeatY && (maxV < 0 || minV > 1)))) return [0, 0, 0];
      const colors = [...points, {u:(points[0].u+points[1].u+points[2].u)/3, v:(points[0].v+points[1].v+points[2].v)/3}].map(p => {
        const color = sampler(p.u, p.v);
        return (color.r >> 4) * 4096 + (color.g >> 4) * 256 + (color.b >> 4) * 16 + ((color.a ?? 255) >> 4);
      });
      const boundary = colors.some(color => color !== colors[0]) || (!mapping.repeatX && (minU < 0 && maxU > 0 || minU < 1 && maxU > 1)) || (!mapping.repeatY && (minV < 0 && maxV > 0 || minV < 1 && maxV > 1));
      // Image-space refinement spends triangles on the artwork, especially its boundaries.
      return mapped.map((p, i) => {
        const q = mapped[(i + 1) % 3];
        const length = Math.hypot(p.u - q.u, p.v - q.v);
        return length * detail * (boundary ? 4 : 1);
      }) as [number, number, number];
    };

    const sample = (point: Vector3, faceNormal: Vector3): Rgba | null => {
      if (settings.projection === 'planar' && settings.visibleOnly) {
        if (Math.abs(faceNormal.dot(direction)) <= Math.cos(75 * Math.PI / 180)) return null;
        if (tree) {
          ray.set(point.clone().addScaledVector(direction, maxSize * 1e-7), direction);
          if (occluded(ray, tree, hit)) return null;
        }
      }
      const { u, v } = uvAt(point);
      const mapped = coordinates(u, v);
      if ((!mapping.repeatX && (mapped.u < 0 || mapped.u > 1)) || (!mapping.repeatY && (mapped.v < 0 || mapped.v > 1))) return null;
      const pixel = sampler(u, v);
      return (pixel.a ?? 255) > 0 ? pixel : null;
    };
    return { priority, sample };
  });
  const priority: RefinementPriority = (face, vertices) => {
    const scores: [number, number, number] = [0, 0, 0];
    for (const context of contexts) {
      const next = context.priority(face, vertices);
      for (let i = 0; i < 3; i++) scores[i] = Math.max(scores[i], next[i]);
    }
    return scores;
  };
  const refined = contexts.length ? refineMesh(imported?.mesh ?? original, maxSize / 64, refinement?.budget ?? 400_000, priority, paintEncoding === 'subtriangle' || Boolean(imported), imported?.forest) : { mesh: original, limited: false, paintForest: undefined };
  const mesh = refined.mesh;
  let painted = 0;
  const triangles = mesh.triangles.map(face => {
    triangle.a.fromArray(mesh.vertices, face.a * 3);
    triangle.b.fromArray(mesh.vertices, face.b * 3);
    triangle.c.fromArray(mesh.vertices, face.c * 3);
    triangle.getMidpoint(center); triangle.getNormal(normal);
    const underlying = imported ? palette[face.materialIndex] : base;
    let color = { r: underlying.r, g: underlying.g, b: underlying.b };
    let projectionRegion: 0 | 1 = 0;
    for (const context of contexts) {
      const pixel = context.sample(center, normal);
      if (!pixel) continue;
      projectionRegion = 1;
      const alpha = (pixel.a ?? 255) / 255;
      color = { r: Math.round(pixel.r * alpha + color.r * (1 - alpha)), g: Math.round(pixel.g * alpha + color.g * (1 - alpha)), b: Math.round(pixel.b * alpha + color.b * (1 - alpha)) };
    }
    let materialIndex = imported ? face.materialIndex : baseIndex;
    if (projectionRegion) {
      const key = color.r * 65536 + color.g * 256 + color.b;
      let index = colorCache.get(key);
      if (index === undefined) { index = nearestPaletteIndex(color, palette); colorCache.set(key, index); }
      materialIndex = index;
      if (index !== baseIndex) painted++;
    }
    return { ...face, materialIndex, projectionRegion };
  });
  return { mesh: { ...mesh, triangles, materials: palette }, limited: refined.limited, painted, paintForest: refined.paintForest };
}
