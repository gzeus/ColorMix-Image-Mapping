import JSZip from 'jszip';
import type { MeshData } from '../geometry/meshTypes';

const MODEL_CONTENT_TYPE = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
const START_PART_RELATIONSHIP = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const CORE_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PRUSA_NAMESPACE = 'http://schemas.slic3r.org/3mf/2017/06';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function encodePrusaTriangleState(state: number): string {
  const bitstream: boolean[] = [false, false];
  if (state >= 3) {
    bitstream.push(true, true);
    const extendedState = state - 3;
    for (let bitIndex = 0; bitIndex < 4; bitIndex += 1) {
      bitstream.push(Boolean(extendedState & (1 << bitIndex)));
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
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="config" ContentType="application/octet-stream" />
</Types>`;
}

function relsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="${START_PART_RELATIONSHIP}" />
</Relationships>`;
}

function modelConfigXml(mesh: MeshData): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="2" instances_count="1">
  <metadata type="object" key="name" value="${escapeXml(mesh.name)}"/>
  <volume firstid="0" lastid="${Math.max(0, mesh.triangles.length - 1)}">
   <metadata type="volume" key="name" value="${escapeXml(mesh.name)}"/>
   <metadata type="volume" key="volume_type" value="ModelPart"/>
   <metadata type="volume" key="source_object_id" value="0"/>
   <metadata type="volume" key="source_volume_id" value="0"/>
   <mesh edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
  </volume>
 </object>
</config>`;
}

function prusaFullSpectrumJson(mesh: MeshData): string {
  const physicalExtruders = mesh.materials.slice(0, 2).map((material, index) => ({
    color: material.hex.toUpperCase(),
    id: index + 1,
  }));

  if (physicalExtruders.length === 1) {
    physicalExtruders.push({ color: physicalExtruders[0].color, id: 2 });
  }

  const virtualExtruders = mesh.materials.slice(2).map((material, offset) => {
    const paletteIndex = offset + 2;
    const denominator = Math.max(1, mesh.materials.length - 1);
    const highlightRatio = Math.round(((paletteIndex - 1) / denominator) * 10000) / 10000;
    const shadowRatio = Math.round(((mesh.materials.length - paletteIndex) / denominator) * 10000) / 10000;
    return {
      color: material.hex.toUpperCase(),
      components: [
        { extruder: 1, ratio: highlightRatio },
        { extruder: 2, ratio: shadowRatio },
      ],
      id: paletteIndex + 1,
      kind: 'fullspectrum',
    };
  });

  return JSON.stringify({
    physical_extruders: physicalExtruders,
    version: 1,
    virtual_extruders: virtualExtruders,
  }, null, 4);
}

function prusaProjectConfig(mesh: MeshData): string {
  const physicalColors = mesh.materials.slice(0, 2).map((material) => material.hex.toUpperCase());
  if (physicalColors.length === 1) {
    physicalColors.push(physicalColors[0]);
  }
  return `; extruder_colour = ${physicalColors.join(';')}\n`;
}

function modelXml(mesh: MeshData): string {
  const vertices = [];
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    vertices.push(`<vertex x="${mesh.vertices[i].toFixed(5)}" y="${mesh.vertices[i + 1].toFixed(5)}" z="${mesh.vertices[i + 2].toFixed(5)}" />`);
  }
  const triangles = mesh.triangles.map((triangle) => {
    const materialIndex = Math.max(0, Math.min(mesh.materials.length - 1, triangle.materialIndex));
    const prusaState = encodePrusaTriangleState(materialIndex + 1);
    return `<triangle v1="${triangle.a}" v2="${triangle.b}" v3="${triangle.c}" pid="1" p1="${materialIndex}" p2="${materialIndex}" p3="${materialIndex}" slic3rpe:mmu_segmentation="${prusaState}" />`;
  }).join('');
  const materials = mesh.materials
    .map((material, index) => `<base name="${escapeXml(material.name || `Material ${index + 1}`)}" displaycolor="${material.hex.toUpperCase()}" />`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NAMESPACE}" xmlns:slic3rpe="${PRUSA_NAMESPACE}">
  <metadata name="slic3rpe:Version3mf">1</metadata>
  <metadata name="slic3rpe:MmPaintingVersion">1</metadata>
  <metadata name="Application">3D Image Mapper</metadata>
  <resources>
    <basematerials id="1">${materials}</basematerials>
    <object id="2" type="model" name="${escapeXml(mesh.name)}">
      <mesh>
        <vertices>${vertices.join('')}</vertices>
        <triangles>${triangles}</triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="2" />
  </build>
</model>`;
}

export async function export3mf(mesh: MeshData, fileName: string): Promise<void> {
  const repairedMesh = repairMeshForExport(mesh);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml());
  zip.file('_rels/.rels', relsXml());
  zip.file('3D/3dmodel.model', modelXml(repairedMesh));
  zip.file('Metadata/Slic3r_PE.config', prusaProjectConfig(repairedMesh));
  zip.file('Metadata/Slic3r_PE_model.config', modelConfigXml(repairedMesh));
  zip.file('Metadata/Prusa_Slicer_full_spectrum.json', prusaFullSpectrumJson(repairedMesh));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(new Blob([blob], { type: 'model/3mf' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.endsWith('.3mf') ? fileName : `${fileName}.3mf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
