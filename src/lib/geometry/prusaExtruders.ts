import type JSZip from 'jszip';
import { makePaletteColor, type PaletteColor } from '../colorUtils';
import type { MeshData } from './meshTypes';

const color = (value: unknown): string => {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Missing or invalid extruder color.');
  return value;
};
const id = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 255) throw new Error('Unsupported extruder ID.');
  return value;
};

export async function readPrusaExtruders(zip: JSZip): Promise<{ materials: PaletteColor[]; setup: NonNullable<MeshData['extruderSetup']> }> {
  const spectrum = zip.file('Metadata/Prusa_Slicer_full_spectrum.json');
  let physical: Array<{ id: number; color: string }>;
  let virtual: Array<{ id: number; color: string; components?: Array<{ extruder: number; ratio: number }>; kind?: string; gradient?: unknown }>;
  let fullSpectrum: string;
  if (spectrum) {
    fullSpectrum = await spectrum.async('string');
    const data = JSON.parse(fullSpectrum);
    if (data.version !== 1 || !Array.isArray(data.physical_extruders) || !Array.isArray(data.virtual_extruders)) throw new Error('Unsupported virtual extruder configuration.');
    physical = data.physical_extruders;
    virtual = data.virtual_extruders;
  } else {
    const config = await zip.file('Metadata/Slic3r_PE.config')?.async('string') ?? '';
    const values = (key: string) => (config.match(new RegExp(`^;?\\s*${key}\\s*=\\s*(.*)$`, 'm'))?.[1] ?? '').trim().split(';');
    const extruderColors = values('extruder_colour'), filamentColors = values('filament_colour');
    physical = Array.from({ length: Math.max(extruderColors.length, filamentColors.length) }, (_, i) => ({ id: i + 1, color: extruderColors[i] || filamentColors[i] }));
    virtual = [];
    fullSpectrum = JSON.stringify({ version: 1, physical_extruders: physical, virtual_extruders: virtual });
  }
  if (!physical.length || physical.length > 255) throw new Error('Missing physical extruder setup.');
  physical = [...physical].sort((a, b) => a.id - b.id);
  const physicalExtruders = physical.map((entry, i) => {
    if (id(entry.id) !== i + 1) throw new Error('Physical extruder IDs must start at 1 without gaps.');
    return { ...makePaletteColor(color(entry.color), i, `Filament ${entry.id}`), extruderId: entry.id, components: [{ extruder: entry.id, ratio: 1 }] };
  });
  const used = new Set(physical.map(entry => entry.id));
  const materials: PaletteColor[] = [...physicalExtruders];
  for (const entry of [...virtual].sort((a, b) => a.id - b.id)) {
    const number = id(entry.id);
    if (used.has(number) || number <= physical.length) throw new Error('Duplicate or overlapping virtual extruder IDs.');
    used.add(number);
    if ((entry.kind ?? 'fullspectrum') !== 'fullspectrum' || !Array.isArray(entry.components) || !entry.components.length || entry.gradient) throw new Error('Only fixed-ratio full-spectrum virtual extruders are supported.');
    let sum = 0;
    for (const component of entry.components) {
      if (id(component.extruder) > physical.length || !Number.isFinite(component.ratio) || component.ratio < 0) throw new Error('Invalid virtual extruder recipe.');
      sum += component.ratio;
    }
    if (!(sum > 0) || !Number.isFinite(sum)) throw new Error('Empty or invalid virtual extruder recipe.');
    materials.push({ ...makePaletteColor(color(entry.color), materials.length, `Virtual ${number}`), extruderId: number, components: entry.components.map(c => ({ ...c })) });
  }
  return { materials, setup: { physicalExtruders, fullSpectrum } };
}

export function withoutImportedPaint(mesh: MeshData): MeshData {
  return { ...mesh, extruderSetup: undefined, materials: [], paintPreview: undefined, paintLeafCount: undefined,
    triangles: mesh.triangles.map(({ a, b, c }) => ({ a, b, c, materialIndex: 0 })) };
}
