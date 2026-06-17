import { brightness, nearestPaletteIndex } from '../colorUtils';
import type { MeshData, ReliefSettings, Sampler, ShapeSettings } from './meshTypes';

type VertexFn = (u: number, v: number, depth: number) => [number, number, number];

function addTriangle(triangles: MeshData['triangles'], a: number, b: number, c: number, materialIndex: number, uvCenter?: { u: number; v: number }) {
  if (a !== b && b !== c && a !== c) {
    triangles.push({ a, b, c, materialIndex, uvCenter });
  }
}

function addQuad(triangles: MeshData['triangles'], a: number, b: number, c: number, d: number, materialIndex: number, uvCenter?: { u: number; v: number }) {
  addTriangle(triangles, a, b, c, materialIndex, uvCenter);
  addTriangle(triangles, a, c, d, materialIndex, uvCenter);
}

function reliefDepth(u: number, v: number, sampler: Sampler, relief: ReliefSettings): number {
  if (!relief.enabled || relief.strengthMm <= 0) {
    return 0;
  }
  const amount = relief.invert ? 1 - brightness(sampler(u, v)) : brightness(sampler(u, v));
  return amount * relief.strengthMm;
}

function buildPanelMesh(
  name: string,
  settings: ShapeSettings,
  palette: MeshData['materials'],
  insideMaterialIndex: number,
  sampler: Sampler,
  relief: ReliefSettings,
  vertexAt: VertexFn,
): MeshData {
  const vertices: number[] = [];
  const uvs: number[] = [];
  const triangles: MeshData['triangles'] = [];
  const widthSegments = Math.max(1, Math.round(settings.radialSegments));
  const heightSegments = Math.max(1, Math.round(settings.heightSegments));
  const thickness = Math.max(0.4, settings.wallThicknessMm);
  const safeInsideMaterialIndex = Math.max(0, Math.min(palette.length - 1, insideMaterialIndex));
  const front: number[][] = [];
  const back: number[][] = [];

  const pushVertex = (u: number, v: number, depth: number) => {
    const [x, y, z] = vertexAt(u, v, depth);
    vertices.push(x, y, z);
    uvs.push(u, v);
    return vertices.length / 3 - 1;
  };

  for (let y = 0; y <= heightSegments; y += 1) {
    const v = y / heightSegments;
    front[y] = [];
    back[y] = [];
    for (let x = 0; x <= widthSegments; x += 1) {
      const u = x / widthSegments;
      front[y][x] = pushVertex(u, v, reliefDepth(u, v, sampler, relief));
      back[y][x] = pushVertex(u, v, -thickness);
    }
  }

  for (let y = 0; y < heightSegments; y += 1) {
    for (let x = 0; x < widthSegments; x += 1) {
      const u = (x + 0.5) / widthSegments;
      const v = (y + 0.5) / heightSegments;
      addQuad(
        triangles,
        front[y][x],
        front[y][x + 1],
        front[y + 1][x + 1],
        front[y + 1][x],
        nearestPaletteIndex(sampler(u, v), palette),
        { u, v },
      );
      addQuad(triangles, back[y][x], back[y + 1][x], back[y + 1][x + 1], back[y][x + 1], safeInsideMaterialIndex);
    }
  }

  for (let x = 0; x < widthSegments; x += 1) {
    addQuad(triangles, front[0][x], front[0][x + 1], back[0][x + 1], back[0][x], safeInsideMaterialIndex);
    addQuad(triangles, front[heightSegments][x + 1], front[heightSegments][x], back[heightSegments][x], back[heightSegments][x + 1], safeInsideMaterialIndex);
  }

  for (let y = 0; y < heightSegments; y += 1) {
    addQuad(triangles, front[y + 1][0], front[y][0], back[y][0], back[y + 1][0], safeInsideMaterialIndex);
    addQuad(triangles, front[y][widthSegments], front[y + 1][widthSegments], back[y + 1][widthSegments], back[y][widthSegments], safeInsideMaterialIndex);
  }

  return { name, vertices, uvs, triangles, materials: palette };
}

export function generatePlane(settings: ShapeSettings, sampler: Sampler, relief: ReliefSettings, palette: MeshData['materials'], insideMaterialIndex: number): MeshData {
  const width = Math.max(5, settings.widthMm);
  const height = Math.max(5, settings.heightMm);
  return buildPanelMesh('image-plane', settings, palette, insideMaterialIndex, sampler, relief, (u, v, depth) => [
    (u - 0.5) * width,
    v * height,
    depth,
  ]);
}

export function generateArc(settings: ShapeSettings, sampler: Sampler, relief: ReliefSettings, palette: MeshData['materials'], insideMaterialIndex: number): MeshData {
  const height = Math.max(5, settings.heightMm);
  const radius = Math.max(2.5, settings.diameterMm / 2);
  const angle = Math.max(5, Math.min(330, settings.arcAngleDeg)) * (Math.PI / 180);
  return buildPanelMesh('image-arc', settings, palette, insideMaterialIndex, sampler, relief, (u, v, depth) => {
    const theta = (u - 0.5) * angle;
    const finalRadius = radius + depth;
    return [
      Math.sin(theta) * finalRadius,
      v * height,
      Math.cos(theta) * finalRadius - radius,
    ];
  });
}
