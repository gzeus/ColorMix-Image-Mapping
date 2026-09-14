import JSZip from 'jszip';
import { BufferGeometry, Matrix4, Mesh, Vector3 } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { MeshData } from './meshTypes';

const MAX_TRIANGLES = 400_000;
const children = (node: Element, name: string) => Array.from(node.children).filter(child => child.localName === name);
const child = (node: Element, name: string) => children(node, name)[0];
const zUpToYUp = new Matrix4().makeRotationX(-Math.PI / 2);

function xml(text: string): Element {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid 3MF XML.');
  return doc.documentElement;
}

function transform(value: string | null): Matrix4 {
  if (!value) return new Matrix4();
  const n = value.trim().split(/\s+/).map(Number);
  if (n.length !== 12 || !n.every(Number.isFinite)) throw new Error('Invalid 3MF transform.');
  return new Matrix4().set(n[0], n[3], n[6], n[9], n[1], n[4], n[7], n[10], n[2], n[5], n[8], n[11], 0, 0, 0, 1);
}

// Imports geometry only. Existing paint, textures, supports and printer settings are not applied.
export async function importModel(file: File): Promise<MeshData> {
  if (file.size > 80 * 1024 * 1024) throw new Error('Choose a model smaller than 80 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  const vertices: number[] = [];
  const triangles: MeshData['triangles'] = [];
  const point = new Vector3();
  let part = 0;
  const append = (positions: ArrayLike<number>, indices: ArrayLike<number> | null, matrix: Matrix4) => {
    const count = indices?.length ?? positions.length / 3;
    if (count % 3 || triangles.length + count / 3 > MAX_TRIANGLES) throw new Error('Model exceeds 400,000 triangles. Simplify it before importing.');
    // Weld within each part only, preserving separately instanced/touching shells.
    const weld = new Map<string, number>();
    const remap: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      point.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(matrix);
      if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('Model contains invalid coordinates.');
      const key = `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`;
      let index = weld.get(key);
      if (index === undefined) { index = vertices.length / 3; weld.set(key, index); vertices.push(point.x, point.y, point.z); }
      remap.push(index);
    }
    const mirrored = matrix.determinant() < 0;
    const seen = new Set<string>();
    for (let i = 0; i < count; i += 3) {
      const ids = [0, 1, 2].map(j => remap[indices ? indices[i + j] : i + j]);
      if (ids.some(id => id === undefined)) throw new Error('Model contains invalid triangle indices.');
      if (new Set(ids).size < 3) continue;
      const key = [...ids].sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      triangles.push({ a: ids[0], b: ids[mirrored ? 2 : 1], c: ids[mirrored ? 1 : 2], materialIndex: 0 });
    }
    part++;
  };
  const appendGeometry = (geometry: BufferGeometry, matrix: Matrix4) => {
    const position = geometry.getAttribute('position');
    if (position) append(position.array, geometry.index?.array ?? null, matrix);
  };

  if (extension === 'stl') {
    const geometry = new STLLoader().parse(await file.arrayBuffer());
    try { appendGeometry(geometry, zUpToYUp); } finally { geometry.dispose(); }
  } else if (extension === 'obj') {
    const object = new OBJLoader().parse(await file.text());
    object.updateMatrixWorld(true);
    object.traverse(node => {
      if (node instanceof Mesh) {
        appendGeometry(node.geometry, zUpToYUp.clone().multiply(node.matrixWorld));
        node.geometry.dispose();
        (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => material.dispose());
      }
    });
  } else if (extension === '3mf') {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const normalize = (path: string, from = '') => {
      const parts: string[] = [];
      const combined = path.startsWith('/') ? path : `${from.slice(0, from.lastIndexOf('/') + 1)}${path}`;
      for (const item of combined.replace(/\\/g, '/').split('/')) {
        if (item === '..') parts.pop(); else if (item && item !== '.') parts.push(item);
      }
      return parts.join('/');
    };
    const relFile = zip.file('_rels/.rels');
    if (!relFile) throw new Error('3MF is missing its package relationships.');
    const relationships = xml(await relFile.async('string'));
    const relationship = children(relationships, 'Relationship').find(r => r.getAttribute('Type')?.endsWith('/3dmodel'));
    if (!relationship || relationship.getAttribute('TargetMode') === 'External') throw new Error('3MF has no local build model.');
    const rootPath = normalize(relationship.getAttribute('Target') ?? '');
    const documents = new Map<string, Element>();
    const load = async (path: string) => {
      let root = documents.get(path);
      if (!root) {
        const entry = zip.file(path);
        if (!entry) throw new Error(`Missing 3MF part: ${path}`);
        root = xml(await entry.async('string'));
        documents.set(path, root);
      }
      return root;
    };
    const units: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
    const visit = async (path: string, id: string, parent: Matrix4, ancestors: Set<string>): Promise<void> => {
      const key = `${path}#${id}`;
      if (ancestors.has(key) || ancestors.size > 32) throw new Error('3MF contains recursive components.');
      const root = await load(path);
      const resources = child(root, 'resources');
      const object = resources && children(resources, 'object').find(o => o.getAttribute('id') === id);
      if (!object) throw new Error(`Missing 3MF object ${id}.`);
      if (object.getAttribute('type') && object.getAttribute('type') !== 'model') return;
      const mesh = child(object, 'mesh');
      if (mesh) {
        const vs = child(mesh, 'vertices'); const ts = child(mesh, 'triangles');
        if (!vs || !ts) throw new Error('Incomplete 3MF mesh.');
        append(children(vs, 'vertex').flatMap(v => ['x', 'y', 'z'].map(k => Number(v.getAttribute(k) ?? NaN))),
          children(ts, 'triangle').flatMap(t => ['v1', 'v2', 'v3'].map(k => Number(t.getAttribute(k) ?? NaN))), parent);
      }
      const components = child(object, 'components');
      if (!mesh && !components) throw new Error('This 3MF contains an object without a supported triangle mesh.');
      if (components) for (const component of children(components, 'component')) {
        const external = Array.from(component.attributes).find(a => a.localName === 'path')?.value;
        const nextPath = external ? normalize(external, path) : path;
        const nextMatrix = parent.clone().multiply(transform(component.getAttribute('transform')));
        if (nextPath !== path) {
          const nextRoot = await load(nextPath);
          const factor = (units[nextRoot.getAttribute('unit') ?? 'millimeter'] ?? NaN) / (units[root.getAttribute('unit') ?? 'millimeter'] ?? NaN);
          nextMatrix.multiply(new Matrix4().makeScale(factor, factor, factor));
        }
        await visit(nextPath, component.getAttribute('objectid') ?? '', nextMatrix, new Set([...ancestors, key]));
      }
    };
    const root = await load(rootPath);
    const unit = units[root.getAttribute('unit') ?? 'millimeter'];
    if (!unit) throw new Error('Unsupported 3MF units.');
    const build = child(root, 'build');
    if (!build) throw new Error('3MF has no build items.');
    for (const item of children(build, 'item')) {
      await visit(rootPath, item.getAttribute('objectid') ?? '', zUpToYUp.clone().multiply(new Matrix4().makeScale(unit, unit, unit)).multiply(transform(item.getAttribute('transform'))), new Set());
    }
  } else throw new Error('Choose an STL, 3MF, or OBJ file.');
  if (!part || !triangles.length) throw new Error('The file contains no triangle geometry.');
  return { name: file.name.replace(/\.[^.]+$/, ''), vertices, triangles, materials: [], preserveTopology: true };
}
