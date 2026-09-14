import { Box3, Euler, Matrix4, Vector3 } from 'three';
import type { MeshData } from './meshTypes';

export type ModelSource = 'simple' | 'custom';
export type CustomSettings = {
  scale: number;
  rotation: [number, number, number];
  projection: 'planar' | 'cylindrical';
  direction: [number, number, number];
  up: [number, number, number];
  imageRotation: number;
  visibleOnly: boolean;
  detail: 'standard' | 'fine';
};

export const defaultCustomSettings: CustomSettings = {
  scale: 1, rotation: [0, 0, 0], projection: 'planar',
  direction: [0, 0, 1], up: [0, 1, 0], imageRotation: 0,
  visibleOnly: true, detail: 'standard',
};

export function meshBounds(mesh: MeshData): Box3 {
  const box = new Box3();
  const point = new Vector3();
  for (let i = 0; i < mesh.vertices.length; i += 3) box.expandByPoint(point.fromArray(mesh.vertices, i));
  return box;
}

export function transformModel(source: MeshData, settings: CustomSettings): MeshData {
  const center = meshBounds(source).getCenter(new Vector3());
  const rotation = new Matrix4().makeRotationFromEuler(new Euler(...settings.rotation.map(v => v * Math.PI / 180) as [number, number, number]));
  const point = new Vector3();
  const vertices = source.vertices.slice();
  for (let i = 0; i < vertices.length; i += 3) {
    point.fromArray(vertices, i).sub(center).applyMatrix4(rotation).multiplyScalar(settings.scale).toArray(vertices, i);
  }
  const result = { ...source, vertices };
  const floor = meshBounds(result).min.y;
  for (let i = 1; i < vertices.length; i += 3) vertices[i] -= floor;
  return result;
}

// Coordinates remain attached to the model when the preview camera moves.
export function projectionFrame(mesh: MeshData, settings: CustomSettings) {
  const box = meshBounds(mesh);
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const direction = new Vector3(...settings.direction).normalize();
  const right = new Vector3(...settings.up).cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();
  let width = 0;
  let height = 0;
  const point = new Vector3();
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    point.fromArray(mesh.vertices, i).sub(center);
    width = Math.max(width, Math.abs(point.dot(right)) * 2);
    height = Math.max(height, Math.abs(point.dot(up)) * 2);
  }
  if (settings.projection === 'cylindrical') {
    width = Math.PI * Math.max(size.x, size.z);
    height = size.y;
  }
  return { center, direction, right, up, width: Math.max(width, 0.001), height: Math.max(height, 0.001) };
}
