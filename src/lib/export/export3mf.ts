import JSZip from 'jszip';
import type { MeshData } from '../geometry/meshTypes';

const MODEL_CONTENT_TYPE = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
const START_PART_RELATIONSHIP = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const CORE_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PRUSA_NAMESPACE = 'http://schemas.slic3r.org/3mf/2017/06';
const BED_CENTER_X_MM = 180;
const BED_CENTER_Y_MM = 180;
const THUMBNAIL_PATH = 'Metadata/Thumbnail.png';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function encodePrusaTriangleState(state: number): string {
  const bitstream: boolean[] = [false, false];
  if (state >= 3) {
    bitstream.push(true, true);
    if (state <= 16) {
      const extendedState = state - 3;
      for (let bitIndex = 0; bitIndex < 4; bitIndex += 1) {
        bitstream.push(Boolean(extendedState & (1 << bitIndex)));
      }
    } else {
      const extendedState = Math.min(255, state) - 17;
      bitstream.push(false, true, true, true);
      for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
        bitstream.push(Boolean(extendedState & (1 << bitIndex)));
      }
    }
  } else {
    bitstream.push(Boolean(state & 1), Boolean(state & 2));
  }
  let output = '';
  for (let offset = 0; offset < bitstream.length; offset += 4) {
    let nibble = 0;
    for (let bitIndex = 3; bitIndex >= 0; bitIndex -= 1) {
      nibble = (nibble << 1) | (bitstream[offset + bitIndex] ? 1 : 0);
    }
    output = nibble.toString(16).toUpperCase() + output;
  }
  return output;
}

function repairMeshForExport(mesh: MeshData): MeshData {
  const vertexMap = new Map<string, number>();
  const vertices: number[] = [];
  const remap: number[] = [];
  const precision = 100000;

  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const x = Math.round(mesh.vertices[i] * precision) / precision;
    const y = Math.round(mesh.vertices[i + 1] * precision) / precision;
    const z = Math.round(mesh.vertices[i + 2] * precision) / precision;
    const key = `${x},${y},${z}`;
    let nextIndex = vertexMap.get(key);
    if (nextIndex === undefined) {
      nextIndex = vertices.length / 3;
      vertexMap.set(key, nextIndex);
      vertices.push(x, y, z);
    }
    remap[i / 3] = nextIndex;
  }

  const triangleKeys = new Set<string>();
  const triangles: MeshData['triangles'] = [];
  mesh.triangles.forEach((triangle) => {
    const a = remap[triangle.a];
    const b = remap[triangle.b];
    const c = remap[triangle.c];
    if (a === b || b === c || a === c) {
      return;
    }
    const sorted = [a, b, c].sort((left, right) => left - right).join(',');
    if (triangleKeys.has(sorted)) {
      return;
    }
    triangleKeys.add(sorted);
    triangles.push({ ...triangle, a, b, c });
  });

  return { ...mesh, vertices, triangles };
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="${MODEL_CONTENT_TYPE}" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="config" ContentType="application/octet-stream" />
</Types>`;
}

function relsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="${START_PART_RELATIONSHIP}" />
  <Relationship Target="/${THUMBNAIL_PATH}" Id="rel1" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" />
</Relationships>`;
}

function getColorMixPhysicalCount(mesh: MeshData): number | null {
  const hasVirtualRecipes = mesh.materials.some((material) => (material.components?.length ?? 0) > 1);
  if (!hasVirtualRecipes) {
    return null;
  }
  return Math.max(2, ...mesh.materials.flatMap((material) => material.components?.map((component) => component.extruder) ?? []));
}

function getMaxUsedMaterialCount(mesh: MeshData): number {
  return Math.max(1, ...mesh.triangles.map((triangle) => triangle.materialIndex + 1));
}

function parseHexColor(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '').trim();
  const fullHex = normalized.length === 3
    ? normalized.split('').map((character) => `${character}${character}`).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  return [
    Number.parseInt(fullHex.slice(0, 2), 16) || 0,
    Number.parseInt(fullHex.slice(2, 4), 16) || 0,
    Number.parseInt(fullHex.slice(4, 6), 16) || 0,
  ];
}

function averageHexColor(left: string, right: string): string {
  const leftRgb = parseHexColor(left);
  const rightRgb = parseHexColor(right);
  return `#${leftRgb.map((channel, index) => Math.round((channel + rightRgb[index]) / 2).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function prusaFullSpectrumJson(mesh: MeshData): string {
  const colorMixPhysicalCount = getColorMixPhysicalCount(mesh);
  const physicalCount = colorMixPhysicalCount ?? Math.max(2, getMaxUsedMaterialCount(mesh));
  const physicalExtruders = Array.from({ length: physicalCount }, (_, index) => ({
    color: (mesh.materials[index]?.hex ?? mesh.materials[mesh.materials.length - 1]?.hex ?? '#FF8000').toUpperCase(),
    id: index + 1,
  }));

  const virtualExtruders = colorMixPhysicalCount === null ? [] : mesh.materials.slice(physicalCount).map((material, offset) => {
    const paletteIndex = offset + physicalCount;
    return {
      color: material.hex.toUpperCase(),
      components: material.components ?? [{ extruder: 1, ratio: 1 }],
      id: paletteIndex + 1,
      kind: 'fullspectrum',
    };
  });
  virtualExtruders.push({
    color: averageHexColor(physicalExtruders[0].color, physicalExtruders[1].color),
    components: [
      { extruder: 1, ratio: 0.5 },
      { extruder: 2, ratio: 0.5 },
    ],
    id: Math.max(physicalCount, ...virtualExtruders.map((extruder) => extruder.id)) + 1,
    kind: 'fullspectrum',
  });

  return JSON.stringify({
    physical_extruders: physicalExtruders,
    version: 1,
    virtual_extruders: virtualExtruders,
  }, null, 4);
}

function modelXml(mesh: MeshData): string {
  const vertices = [];
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const x = mesh.vertices[i];
    const y = -mesh.vertices[i + 2];
    const z = mesh.vertices[i + 1];
    vertices.push(`<vertex x="${x.toFixed(5)}" y="${y.toFixed(5)}" z="${z.toFixed(5)}" />`);
  }
  const triangles = mesh.triangles.map((triangle) => {
    const materialIndex = Math.max(0, Math.min(mesh.materials.length - 1, triangle.materialIndex));
    const prusaState = encodePrusaTriangleState(materialIndex + 1);
    return `<triangle v1="${triangle.a}" v2="${triangle.b}" v3="${triangle.c}" slic3rpe:mmu_segmentation="${prusaState}" />`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NAMESPACE}" xmlns:slic3rpe="${PRUSA_NAMESPACE}">
  <metadata name="slic3rpe:Version3mf">1</metadata>
  <metadata name="slic3rpe:MmPaintingVersion">2</metadata>
  <metadata name="Title">${escapeXml(mesh.name)}</metadata>
  <metadata name="Description">${escapeXml(mesh.name)}</metadata>
  <metadata name="Application">ColorMix Image Mapper</metadata>
  <resources>
    <object id="1" type="model" name="${escapeXml(mesh.name)}">
      <mesh>
        <vertices>${vertices.join('')}</vertices>
        <triangles>${triangles}</triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" printable="1" transform="1 0 0 0 1 0 0 0 1 ${BED_CENTER_X_MM.toFixed(5)} ${BED_CENTER_Y_MM.toFixed(5)} 0" />
  </build>
</model>`;
}

type ProjectedTriangle = {
  points: [number, number][];
  depth: number;
  color: string;
};

function projectIso(x: number, y: number, z: number): [number, number, number] {
  const angle = Math.PI / 6;
  const px = (x - z) * Math.cos(angle);
  const py = y + (x + z) * Math.sin(angle);
  const depth = x + z - y * 0.15;
  return [px, py, depth];
}

function createThumbnailBlob(mesh: MeshData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 240;
  const context = canvas.getContext('2d');
  if (!context || mesh.triangles.length === 0) {
    return Promise.resolve(new Blob());
  }

  context.fillStyle = '#f3f5f7';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const stride = Math.max(1, Math.ceil(mesh.triangles.length / 8000));
  const projected: ProjectedTriangle[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let index = 0; index < mesh.triangles.length; index += stride) {
    const triangle = mesh.triangles[index];
    const vertexIndexes = [triangle.a, triangle.b, triangle.c];
    const points = vertexIndexes.map((vertexIndex) => {
      const offset = vertexIndex * 3;
      const [x, y, depth] = projectIso(mesh.vertices[offset], mesh.vertices[offset + 1], mesh.vertices[offset + 2]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      return { x, y, depth };
    });
    projected.push({
      color: mesh.materials[Math.max(0, Math.min(mesh.materials.length - 1, triangle.materialIndex))]?.hex ?? '#cccccc',
      depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length,
      points: points.map((point) => [point.x, point.y]),
    });
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min((canvas.width - 52) / width, (canvas.height - 44) / height);
  const offsetX = (canvas.width - width * scale) / 2 - minX * scale;
  const offsetY = (canvas.height + height * scale) / 2 + minY * scale;

  projected.sort((left, right) => left.depth - right.depth);
  projected.forEach((triangle) => {
    context.beginPath();
    triangle.points.forEach(([x, y], pointIndex) => {
      const px = x * scale + offsetX;
      const py = offsetY - y * scale;
      if (pointIndex === 0) {
        context.moveTo(px, py);
      } else {
        context.lineTo(px, py);
      }
    });
    context.closePath();
    context.fillStyle = triangle.color;
    context.globalAlpha = 0.96;
    context.fill();
  });
  context.globalAlpha = 1;

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? new Blob()), 'image/png');
  });
}

export async function export3mf(mesh: MeshData, fileName: string): Promise<void> {
  const repairedMesh = repairMeshForExport(mesh);
  const thumbnailBlob = await createThumbnailBlob(repairedMesh);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml());
  zip.file('_rels/.rels', relsXml());
  zip.file('3D/3dmodel.model', modelXml(repairedMesh));
  zip.file(THUMBNAIL_PATH, thumbnailBlob);
  zip.file('Metadata/Prusa_Slicer_full_spectrum.json', prusaFullSpectrumJson(repairedMesh));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(new Blob([blob], { type: 'model/3mf' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.toLowerCase().endsWith('.3mf') ? fileName : `${fileName}.3MF`;
  anchor.click();
  URL.revokeObjectURL(url);
}
