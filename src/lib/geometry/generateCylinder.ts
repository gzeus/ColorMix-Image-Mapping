import type { MeshData, ReliefSettings, Sampler, ShapeSettings } from './meshTypes';
import { buildLatheMesh } from './buildSurface';

export function generateCylinder(settings: ShapeSettings, sampler: Sampler, relief: ReliefSettings, palette: MeshData['materials'], insideMaterialIndex: number): MeshData {
  return buildLatheMesh('image-cylinder', settings, palette, insideMaterialIndex, sampler, relief, () => settings.diameterMm / 2);
}
