import type { MeshData, ReliefSettings, Sampler, ShapeSettings } from './meshTypes';
import { buildLatheMesh, vaseRadiusAt } from './buildSurface';

export function generateVase(settings: ShapeSettings, sampler: Sampler, relief: ReliefSettings, palette: MeshData['materials'], insideMaterialIndex: number): MeshData {
  return buildLatheMesh('image-vase', settings, palette, insideMaterialIndex, sampler, relief, (v) => vaseRadiusAt(v, settings));
}
