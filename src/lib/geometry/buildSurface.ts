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
  const angle = -u * Math.PI * 2;
  let finalRadius = radius;
  if (displace && relief.enabled && relief.strengthMm > 0) {
    const amount = relief.invert ? 1 - brightness(sampler(u, v)) : brightness(sampler(u, v));
    finalRadius += amount * relief.strengthMm;
  }
  vertices.push(Math.cos(angle) * finalRadius, v * height, Math.sin(angle) * finalRadius);
  return vertices.length / 3 - 1;
}

function addTriangle(triangles: MeshData['triangles'], a: number, b: number, c: number, materialIndex: number, uvCenter?: { u: number; v: number }) {
  if (a !== b && b !== c && a !== c) {
    triangles.push({ a, b, c, materialIndex, uvCenter });
  }
}

function addQuad(triangles: MeshData['triangles'], a: number, b: number, c: number, d: number, materialIndex: number, uvCenter?: { u: number; v: number }) {
  addTriangle(triangles, a, b, c, materialIndex, uvCenter);
  addTriangle(triangles, a, c, d, materialIndex, uvCenter);
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
  const wallThickness = Math.max(0, settings.wallThicknessMm);
  const hasWall = wallThickness > 0.01;
  const bottomThickness = settings.addBottom && hasWall
    ? Math.min(height * 0.45, Math.max(0.2, settings.bottomThicknessMm || Math.max(1.2, wallThickness)))
    : 0;
  const topRimDepth = settings.openTop && hasWall
    ? Math.min(Math.max(0.2, height - bottomThickness) * 0.45, Math.max(0.4, wallThickness))
    : 0;
  const innerStartV = bottomThickness / height;
  const innerEndV = settings.openTop && hasWall ? Math.max(innerStartV + 0.001, 1 - topRimDepth / height) : 1;
  const innerSegments = Math.max(1, Math.round(heightSegments * (innerEndV - innerStartV)));
  const outer: number[][] = [];
  const inner: number[][] = [];
  const innerLipTop: number[] = [];

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
    }
  }

  if (hasWall && settings.openTop) {
    for (let y = 0; y <= innerSegments; y += 1) {
      const v = innerStartV + (innerEndV - innerStartV) * (y / innerSegments);
      inner[y] = [];
      const innerRadius = Math.max(0.4, radiusAt(v) - wallThickness);
      for (let x = 0; x < radial; x += 1) {
        const u = x / radial;
        inner[y][x] = pushVertex(vertices, u, v, innerRadius, height, sampler, relief, false);
        uvs.push(u, v);
      }
    }
    const topInnerRadius = Math.max(0.4, radiusAt(1) - wallThickness);
    for (let x = 0; x < radial; x += 1) {
      const u = x / radial;
      innerLipTop[x] = pushVertex(vertices, u, 1, topInnerRadius, height, sampler, relief, false);
      uvs.push(u, 1);
    }
  }

  for (let y = 0; y < heightSegments; y += 1) {
    for (let x = 0; x < radial; x += 1) {
      const nx = (x + 1) % radial;
      const u = (x + 0.5) / radial;
      const v = (y + 0.5) / heightSegments;
      const materialIndex = nearestPaletteIndex(sampler(u, v), palette);
      addQuad(triangles, outer[y][x], outer[y][nx], outer[y + 1][nx], outer[y + 1][x], materialIndex, { u, v });
    }
  }

  if (hasWall && settings.openTop) {
    for (let y = 0; y < innerSegments; y += 1) {
      for (let x = 0; x < radial; x += 1) {
        const nx = (x + 1) % radial;
        addQuad(triangles, inner[y][nx], inner[y][x], inner[y + 1][x], inner[y + 1][nx], safeInsideMaterialIndex);
      }
    }

    // The lip is a short vertical collar plus a top bridge. Each rim edge is shared by exactly two faces.
    const outerTop = heightSegments;
    for (let x = 0; x < radial; x += 1) {
      const nx = (x + 1) % radial;
      addQuad(triangles, inner[innerSegments][nx], inner[innerSegments][x], innerLipTop[x], innerLipTop[nx], safeInsideMaterialIndex);
      addQuad(triangles, outer[outerTop][nx], innerLipTop[nx], innerLipTop[x], outer[outerTop][x], safeInsideMaterialIndex);
    }
  } else if (!settings.openTop) {
    const y = heightSegments;
    const center = vertices.length / 3;
    vertices.push(0, height, 0);
    uvs.push(0.5, 1);
    for (let x = 0; x < radial; x += 1) {
      const nx = (x + 1) % radial;
      addTriangle(triangles, outer[y][x], center, outer[y][nx], safeInsideMaterialIndex);
    }
  }

  if (settings.addBottom) {
    const bottomCenter = vertices.length / 3;
    vertices.push(0, 0, 0);
    uvs.push(0.5, 0);
    for (let x = 0; x < radial; x += 1) {
      const nx = (x + 1) % radial;
      addTriangle(triangles, outer[0][nx], outer[0][x], bottomCenter, safeInsideMaterialIndex);
    }

    if (hasWall && settings.openTop) {
      const floorCenter = vertices.length / 3;
      vertices.push(0, bottomThickness, 0);
      uvs.push(0.5, innerStartV);
      // The interior floor disk shares its perimeter with the first inner-wall ring.
      for (let x = 0; x < radial; x += 1) {
        const nx = (x + 1) % radial;
        addTriangle(triangles, inner[0][x], inner[0][nx], floorCenter, safeInsideMaterialIndex);
      }
    }
  }

  return { name, vertices, uvs, triangles, materials: palette };
}
