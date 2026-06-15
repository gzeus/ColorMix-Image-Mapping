import type { PaletteColor, Rgba } from '../colorUtils';

export type FitMode = 'stretch' | 'contain' | 'cover';
export type ShapeKind = 'cylinder' | 'vase';

export type ImageMappingSettings = {
  fitMode: FitMode;
  offsetU: number;
  offsetV: number;
  scale: number;
  mirrorX: boolean;
  flipY: boolean;
  repeatX: boolean;
  repeatY: boolean;
};

export type ShapeSettings = {
  type: ShapeKind;
  heightMm: number;
  diameterMm: number;
  bottomDiameterMm: number;
  middleDiameterMm: number;
  topDiameterMm: number;
  wallThicknessMm: number;
  radialSegments: number;
  heightSegments: number;
  openTop: boolean;
  addBottom: boolean;
};

export type ReliefSettings = {
  enabled: boolean;
  strengthMm: number;
  invert: boolean;
  blurPx: number;
};

export type ExportSettings = {
  fileName: string;
  insideColorHex: string;
  includePrusaMetadata: boolean;
};

export type TriangleData = {
  a: number;
  b: number;
  c: number;
  materialIndex: number;
  uvCenter?: { u: number; v: number };
};

export type MeshData = {
  name: string;
  vertices: number[];
  normals?: number[];
  uvs?: number[];
  triangles: TriangleData[];
  materials: PaletteColor[];
};

export type Sampler = (u: number, v: number) => Rgba;
