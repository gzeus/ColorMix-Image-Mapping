import type { PaletteColor } from '../colorUtils';
import type { MeshData, ReliefSettings, Sampler, ShapeSettings } from './meshTypes';
import { buildLatheMesh, vaseRadiusAt } from './buildSurface';

export function generateVase(settings: ShapeSettings, palette: PaletteColor[], sampler: Sampler, relief: ReliefSettings): MeshData {
  return buildLatheMesh('image-vase', settings, palette, sampler, relief, (v) => vaseRadiusAt(v, settings));
}
