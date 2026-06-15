import type { PaletteColor } from '../colorUtils';
import type { MeshData, ReliefSettings, Sampler, ShapeSettings } from './meshTypes';
import { buildLatheMesh } from './buildSurface';

export function generateCylinder(settings: ShapeSettings, palette: PaletteColor[], sampler: Sampler, relief: ReliefSettings): MeshData {
  return buildLatheMesh('image-cylinder', settings, palette, sampler, relief, () => settings.diameterMm / 2);
}
