import { brightness, nearestPaletteIndex, type PaletteColor } from '../colorUtils';
import type { MeshData, ReliefSettings, Sampler, ShapeSettings } from './meshTypes';

type RadiusFn = (v: number) => number;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function vaseRadiusAt(v: number, settings: ShapeSettings): number {
  const bottom = settings.bottomDiameterMm / 2;
  const middle = settings.middleDiameterMm / 2;
  const top = settings.topDiameterMm / 2;
  if (v < 0.5) {
    return bottom + (middle - bottom) * smoothstep(v / 0.5);
  }
  return middle + (top - middle) * smoothstep((v - 0.5) / 0.5);
}

function pushVertex(vertices: number[], u: number, v: number, radius: number, height: number, sampler: Sampler, relief: ReliefSettings, displace: boolean): number {
  const angle = u * Math.PI * 2;
  let finalRadius = radius;
  if (displace && relief.enabled && relief.strengthMm > 0) {
    const amount = relief.invert ? 1 - brightness(sampler(u, v)) : brightness(sampler(u, v));
    finalRadius += amount * relief.strengthMm;
  }
  vertices.push(Math.cos(angle) * finalRadius, v * height, Math.sin(angle) * finalRadius);
  return vertices.length / 3 - 1;
}

export function buildLatheMesh(
  name: string,
  settings: ShapeSettings,
  palette: PaletteColor[],
  insideMaterialIndex: number,
  sampler: Sampler,
  relief: ReliefSettings,
  radiusAt: RadiusFn,
): MeshData {
  const vertices: number[] = [];
  const uvs: number[] = [];
  const triangles: MeshData['triangles'] = [];
  const radial = Math.max(8, Math.round(settings.radialSegments));
  const heightSegments = Math.max(2, Math.round(settings.heightSegments));
  const height = settings.heightMm;
  const safeInsideMaterialIndex = Math.max(0, Math.min(palette.length - 1, insideMaterialIndex));
  const outer: number[][] = [];
  const inner: number[][] = [];

  for (let y = 0; y <= heightSegments; y += 1) {
    const v = y / heightSegments;
    outer[y] = [];
    inner[y] = [];
    const outerRadius = radiusAt(v);
    const innerRadius = Math.max(0.4, outerRadius - Math.max(0, settings.wallThicknessMm));
    for (let x = 0; x < radial; x += 1) {
      const u = x / radial;
      outer[y][x] = pushVertex(vertices, u, v, outerRadius, height, sampler, relief, true);
      uvs.push(u, v);
      if (settings.wallThicknessMm > 0) {
        inner[y][x] = pushVertex(vertices, u, v, innerRadius, height, sampler, relief, false);
        uvs.push(u, v);
      }
    }
  }

  for (let y = 0; y < heightSegments; y += 1) {
    for (let x = 0; x < radial; x += 1) {
      const nx = (x + 1) % radial;
      const u = (x + 0.5) / radial;
      const v = (y + 0.5) / heightSegments;
      const materialIndex = nearestPaletteIndex(sampler(u, v), palette);
      triangles.push({ a: outer[y][x], b: outer[y][nx], c: outer[y + 1][nx], materialIndex, uvCenter: { u, v } });
      triangles.push({ a: outer[y][x], b: outer[y + 1][nx], c: outer[y + 1][x], materialIndex, uvCenter: { u, v } });

      if (settings.wallThicknessMm > 0) {
        triangles.push({ a: inner[y][nx], b: inner[y][x], c: inner[y + 1][x], materialIndex: safeInsideMaterialIndex });
        triangles.push({ a: inner[y + 1][nx], b: inner[y][nx], c: inner[y + 1][x], materialIndex: safeInsideMaterialIndex });
      }
    }
  }

  if (settings.wallThicknessMm > 0 && settings.openTop) {
    const y = heightSegments;
    for (let x = 0; x < radial; x += 1) {
      const nx = (x + 1) % radial;
      triangles.push({ a: outer[y][x], b: inner[y][x], c: inner[y][nx], materialIndex: safeInsideMaterialIndex });
      triangles.push({ a: outer[y][x], b: inner[y][nx], c: outer[y][nx], materialIndex: safeInsideMaterialIndex });
    }
  }

  if (settings.addBottom) {
    const y = 0;
    if (settings.wallThicknessMm > 0) {
      const center = vertices.length / 3;
      vertices.push(0, 0, 0);
      uvs.push(0.5, 0);
      for (let x = 0; x < radial; x += 1) {
        const nx = (x + 1) % radial;
        triangles.push({ a: outer[y][nx], b: inner[y][nx], c: inner[y][x], materialIndex: safeInsideMaterialIndex });
        triangles.push({ a: outer[y][nx], b: inner[y][x], c: outer[y][x], materialIndex: safeInsideMaterialIndex });
        triangles.push({ a: inner[y][nx], b: center, c: inner[y][x], materialIndex: safeInsideMaterialIndex });
      }
    } else {
      const center = vertices.length / 3;
      vertices.push(0, 0, 0);
      uvs.push(0.5, 0);
      for (let x = 0; x < radial; x += 1) {
        const nx = (x + 1) % radial;
        triangles.push({ a: outer[y][nx], b: outer[y][x], c: center, materialIndex: safeInsideMaterialIndex });
      }
    }
  }

  return { name, vertices, uvs, triangles, materials: palette };
}
