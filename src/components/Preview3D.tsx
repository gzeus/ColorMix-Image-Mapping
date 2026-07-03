import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshData } from '../lib/geometry/meshTypes';

type Props = {
  mesh: MeshData | null;
};

type MeshBounds = {
  center: THREE.Vector3;
  size: THREE.Vector3;
  maxDimension: number;
};

function toBufferGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const materialGroups = new Map<number, { start: number; count: number }[]>();
  let vertexCursor = 0;
  mesh.triangles.forEach((triangle) => {
    [triangle.a, triangle.b, triangle.c].forEach((index) => {
      positions.push(mesh.vertices[index * 3], mesh.vertices[index * 3 + 1], mesh.vertices[index * 3 + 2]);
    });
    const list = materialGroups.get(triangle.materialIndex) ?? [];
    const last = list[list.length - 1];
    if (last && last.start + last.count === vertexCursor) {
      last.count += 3;
    } else {
      list.push({ start: vertexCursor, count: 3 });
    }
    materialGroups.set(triangle.materialIndex, list);
    vertexCursor += 3;
  });
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  materialGroups.forEach((groups, materialIndex) => {
    groups.forEach((group) => geometry.addGroup(group.start, group.count, materialIndex));
  });
  return geometry;
}

function computeMeshBounds(mesh: MeshData): MeshBounds {
  const box = new THREE.Box3();
  for (let index = 0; index < mesh.vertices.length; index += 3) {
    box.expandByPoint(new THREE.Vector3(mesh.vertices[index], mesh.vertices[index + 1], mesh.vertices[index + 2]));
  }
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  return {
    center,
    size,
    maxDimension: Math.max(size.x, size.y, size.z, 1),
  };
}

function fitCameraToBounds(camera: THREE.OrthographicCamera, bounds: MeshBounds, aspect: number, padding = 1.12) {
  const viewHeight = Math.max(bounds.size.y, bounds.size.x / Math.max(0.001, aspect), 1) * padding;
  const viewWidth = viewHeight * Math.max(0.001, aspect);
  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.near = -bounds.maxDimension * 4;
  camera.far = bounds.maxDimension * 4;
  camera.updateProjectionMatrix();
}

export function Preview3D({ mesh }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const objectRef = useRef<THREE.Mesh | null>(null);
  const boundsRef = useRef<MeshBounds | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const materials = useMemo(() => mesh?.materials.map((material) => new THREE.MeshBasicMaterial({
    color: material.hex,
    side: THREE.DoubleSide,
  })) ?? [], [mesh?.materials]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f3f5f7');
    const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, -1000, 1000);
    camera.position.set(0, 60, 220);
    camera.lookAt(0, 50, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 45, 0);
    const grid = new THREE.GridHelper(220, 22, '#9aa4ad', '#d3d8de');
    scene.add(grid);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    rendererRef.current = renderer;

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      renderer.setSize(bounds.width, bounds.height);
      const aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height);
      if (boundsRef.current) {
        fitCameraToBounds(camera, boundsRef.current, aspect);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => () => {
    materials.forEach((material) => material.dispose());
  }, [materials]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    if (objectRef.current) {
      scene.remove(objectRef.current);
      objectRef.current.geometry.dispose();
    }
    if (!mesh) {
      objectRef.current = null;
      boundsRef.current = null;
      return;
    }
    const object = new THREE.Mesh(toBufferGeometry(mesh), materials);
    scene.add(object);
    objectRef.current = object;
    const bounds = computeMeshBounds(mesh);
    boundsRef.current = bounds;
    controlsRef.current?.target.copy(bounds.center);
    const host = hostRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (host && renderer && camera) {
      const hostBounds = host.getBoundingClientRect();
      fitCameraToBounds(camera, bounds, Math.max(1, hostBounds.width) / Math.max(1, hostBounds.height));
      setView([0, bounds.center.y, bounds.center.z + bounds.maxDimension * 2.1], bounds.center);
    }
  }, [materials, mesh]);

  const setView = (position: [number, number, number], target = boundsRef.current?.center ?? new THREE.Vector3(0, 50, 0)) => {
    cameraRef.current?.position.set(...position);
    cameraRef.current?.lookAt(target);
    controlsRef.current?.target.copy(target);
    controlsRef.current?.update();
  };

  const viewDistance = () => (boundsRef.current?.maxDimension ?? 120) * 2.1;
  const target = () => boundsRef.current?.center ?? new THREE.Vector3(0, 50, 0);

  return (
    <section className="preview-panel">
      <div className="viewport-toolbar">
        <button type="button" onClick={() => {
          const center = target();
          setView([center.x, center.y, center.z + viewDistance()], center);
        }}>Front</button>
        <button type="button" onClick={() => {
          const center = target();
          setView([center.x + viewDistance(), center.y, center.z], center);
        }}>Side</button>
        <button type="button" onClick={() => {
          const center = target();
          setView([center.x, center.y + viewDistance(), center.z + 0.1], center);
        }}>Top</button>
        <button type="button" onClick={() => {
          const center = target();
          setView([center.x + viewDistance() * 0.7, center.y + viewDistance() * 0.5, center.z + viewDistance() * 0.7], center);
        }}>Reset</button>
      </div>
      <div className="viewport" ref={hostRef} />
      {!mesh ? <div className="viewport-empty">Upload an image to generate a printable color mesh.</div> : null}
    </section>
  );
}
