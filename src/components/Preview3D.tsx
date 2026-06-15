import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshData } from '../lib/geometry/meshTypes';

type Props = {
  mesh: MeshData | null;
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

export function Preview3D({ mesh }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const objectRef = useRef<THREE.Mesh | null>(null);

  const materials = useMemo(() => mesh?.materials.map((material) => new THREE.MeshStandardMaterial({
    color: material.hex,
    roughness: 0.72,
    metalness: 0,
    side: THREE.DoubleSide,
  })) ?? [], [mesh?.materials]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f3f5f7');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(170, 120, 170);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 45, 0);
    scene.add(new THREE.HemisphereLight('#ffffff', '#9aa4ad', 2.4));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(120, 180, 80);
    scene.add(key);
    const grid = new THREE.GridHelper(220, 22, '#9aa4ad', '#d3d8de');
    scene.add(grid);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      renderer.setSize(bounds.width, bounds.height);
      camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height);
      camera.updateProjectionMatrix();
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
      return;
    }
    const object = new THREE.Mesh(toBufferGeometry(mesh), materials);
    object.castShadow = true;
    object.receiveShadow = true;
    scene.add(object);
    objectRef.current = object;
    controlsRef.current?.target.set(0, mesh.vertices.length ? mesh.vertices[4] / 2 : 40, 0);
  }, [materials, mesh]);

  const setView = (position: [number, number, number]) => {
    cameraRef.current?.position.set(...position);
    controlsRef.current?.target.set(0, 50, 0);
    controlsRef.current?.update();
  };

  return (
    <section className="preview-panel">
      <div className="viewport-toolbar">
        <button type="button" onClick={() => setView([0, 80, 220])}>Front</button>
        <button type="button" onClick={() => setView([220, 80, 0])}>Side</button>
        <button type="button" onClick={() => setView([0, 260, 0.1])}>Top</button>
        <button type="button" onClick={() => setView([170, 120, 170])}>Reset</button>
      </div>
      <div className="viewport" ref={hostRef} />
      {!mesh ? <div className="viewport-empty">Upload an image to generate a printable color mesh.</div> : null}
    </section>
  );
}
