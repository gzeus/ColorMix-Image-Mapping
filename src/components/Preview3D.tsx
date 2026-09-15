import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { projectionFrame, type CustomSettings } from '../lib/geometry/customModel';
import type { ImageMappingSettings, MeshData } from '../lib/geometry/meshTypes';

type Props = {
  mesh: MeshData | null;
  customSettings?: CustomSettings;
  imageAspect: number | null;
  mapping: ImageMappingSettings;
  onMappingChange: (settings: ImageMappingSettings) => void;
  onProjectionChange: (settings: CustomSettings) => void;
  busy?: boolean;
};

type MeshBounds = {
  center: THREE.Vector3;
  size: THREE.Vector3;
  maxDimension: number;
};

function toBufferGeometry(model: MeshData): THREE.BufferGeometry {
  const mesh = model.paintPreview ? { ...model, ...model.paintPreview } : model;
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  const palette = mesh.materials.map(material => new THREE.Color(material.hex));
  mesh.triangles.forEach(triangle => {
    const color = palette[triangle.materialIndex] ?? new THREE.Color('#eeeeee');
    [triangle.a, triangle.b, triangle.c].forEach(index => {
      positions.push(mesh.vertices[index * 3], mesh.vertices[index * 3 + 1], mesh.vertices[index * 3 + 2]);
      colors.push(color.r, color.g, color.b);
    });
  });
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
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
  const viewHeight = Math.max(bounds.size.length(), bounds.size.length() / Math.max(0.001, aspect), 1) * padding;
  const viewWidth = viewHeight * Math.max(0.001, aspect);
  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.near = -bounds.maxDimension * 4;
  camera.far = bounds.maxDimension * 4;
  camera.updateProjectionMatrix();
}

export function Preview3D({ mesh, customSettings, imageAspect, mapping, onMappingChange, onProjectionChange, busy }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const objectRef = useRef<THREE.Mesh | null>(null);
  const boundsRef = useRef<MeshBounds | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const [shaded, setShaded] = useState(false);
  const [moveImage, setMoveImage] = useState(false);
  const [showFrame, setShowFrame] = useState(true);
  const fitKeyRef = useRef('');
  const dragStateRef = useRef<{ start: THREE.Vector3; mapping: ImageMappingSettings; last: ImageMappingSettings } | null>(null);
  const interactionRef = useRef({ mesh, customSettings, mapping, onMappingChange, moveImage, busy });
  interactionRef.current = { mesh, customSettings, mapping, onMappingChange, moveImage, busy };

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
    scene.add(new THREE.AmbientLight('#ffffff', 1.6));
    const light = new THREE.DirectionalLight('#ffffff', 2.5);
    light.position.set(100, 200, 150); scene.add(light);

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

    let activeFrame: ReturnType<typeof projectionFrame> | null = null;
    const projectPointer = (event: PointerEvent) => {
      const current = interactionRef.current;
      if (!current.mesh || !current.customSettings) return null;
      const frame = activeFrame ?? projectionFrame(current.mesh, current.customSettings);
      const bounds = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const point = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(frame.direction, frame.center), new THREE.Vector3());
      return point ? { point, frame } : null;
    };
    const down = (event: PointerEvent) => {
      const current = interactionRef.current;
      if (current.busy || !current.moveImage || current.customSettings?.projection !== 'planar' || event.button !== 0) return;
      const projected = projectPointer(event);
      if (!projected) return;
      activeFrame = projected.frame;
      event.stopImmediatePropagation();
      renderer.domElement.setPointerCapture(event.pointerId);
      dragStateRef.current = { start: projected.point, mapping: current.mapping, last: current.mapping };
    };
    const move = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const projected = projectPointer(event);
      if (!projected) return;
      const delta = projected.point.sub(drag.start);
      const angle = (interactionRef.current.customSettings?.imageRotation ?? 0) * Math.PI / 180;
      const x = delta.dot(projected.frame.right), y = delta.dot(projected.frame.up);
      drag.last = { ...drag.mapping,
        offsetU: Math.max(-1, Math.min(1, drag.mapping.offsetU - (x * Math.cos(angle) + y * Math.sin(angle)) / projected.frame.width / drag.mapping.scale * (drag.mapping.mirrorX ? -1 : 1))),
        offsetV: Math.max(-1, Math.min(1, drag.mapping.offsetV + (-x * Math.sin(angle) + y * Math.cos(angle)) / projected.frame.height / drag.mapping.scale * (drag.mapping.flipY ? -1 : 1))),
      };
      // Move the guide immediately; expensive color refinement runs after release.
      const guide = scene.getObjectByName('projection-guide');
      if (guide) guide.position.copy(delta);
    };
    const up = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      dragStateRef.current = null;
      activeFrame = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      interactionRef.current.onMappingChange(drag.last);
    };
    renderer.domElement.addEventListener('pointerdown', down, true);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);

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
      renderer.domElement.removeEventListener('pointerdown', down, true);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', up);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      if (objectRef.current) {
        objectRef.current.geometry.dispose();
        (objectRef.current.material as THREE.Material).dispose();
      }
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enabled = !moveImage;
  }, [moveImage]);

  useEffect(() => { setMoveImage(false); }, [customSettings?.projection]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !mesh || !customSettings || customSettings.projection !== 'planar' || !showFrame || !imageAspect) return;
    const frame = projectionFrame(mesh, customSettings);
    let width = frame.width * mapping.scale, height = frame.height * mapping.scale;
    if (mapping.fitMode === 'contain') {
      if (imageAspect > width / height) height = width / imageAspect; else width = height * imageAspect;
    } else if (mapping.fitMode === 'cover') {
      if (imageAspect > width / height) width = height * imageAspect; else height = width / imageAspect;
    }
    const angle = customSettings.imageRotation * Math.PI / 180;
    const right = frame.right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.up, Math.sin(angle));
    const up = frame.up.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.right, -Math.sin(angle));
    const center = frame.center.clone()
      .addScaledVector(right, -mapping.offsetU * frame.width * mapping.scale * (mapping.mirrorX ? -1 : 1))
      .addScaledVector(up, mapping.offsetV * frame.height * mapping.scale * (mapping.flipY ? -1 : 1));
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => center.clone().addScaledVector(right, x * width / 2).addScaledVector(up, y * height / 2));
    const geometry = new THREE.BufferGeometry().setFromPoints(corners);
    const material = new THREE.LineBasicMaterial({ color: '#e77817', depthTest: false, transparent: true, opacity: 0.9 });
    const guide = new THREE.Line(geometry, material);
    guide.name = 'projection-guide'; guide.renderOrder = 10;
    scene.add(guide);
    return () => { scene.remove(guide); geometry.dispose(); material.dispose(); };
  }, [mesh, customSettings, mapping, showFrame, imageAspect]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    if (objectRef.current) {
      scene.remove(objectRef.current);
      objectRef.current.geometry.dispose();
      (objectRef.current.material as THREE.Material).dispose();
    }
    if (!mesh) {
      objectRef.current = null;
      boundsRef.current = null;
      return;
    }
    const geometry = toBufferGeometry(mesh);
    const useShading = Boolean(customSettings) && (shaded || !imageAspect);
    if (useShading) geometry.computeVertexNormals();
    const material = useShading ? new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }) : new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const object = new THREE.Mesh(geometry, material);
    scene.add(object);
    objectRef.current = object;
    const bounds = computeMeshBounds(mesh);
    boundsRef.current = bounds;
    const fitKey = `${mesh.name}:${bounds.size.toArray().map(v => v.toFixed(3)).join()}`;
    const needsFit = fitKeyRef.current !== fitKey;
    fitKeyRef.current = fitKey;
    const host = hostRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (host && renderer && camera && needsFit) {
      camera.zoom = 1;
      const hostBounds = host.getBoundingClientRect();
      fitCameraToBounds(camera, bounds, Math.max(1, hostBounds.width) / Math.max(1, hostBounds.height));
      setView([0, bounds.center.y, bounds.center.z + bounds.maxDimension * 2.1], bounds.center);
    }
  }, [mesh, shaded, Boolean(customSettings), Boolean(imageAspect)]);

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
          if (cameraRef.current) cameraRef.current.up.set(0, 1, 0);
          setMoveImage(false);
          const center = target();
          setView([center.x, center.y, center.z + viewDistance()], center);
        }}>Front</button>
        <button type="button" onClick={() => {
          if (cameraRef.current) cameraRef.current.up.set(0, 1, 0);
          setMoveImage(false);
          const center = target();
          setView([center.x + viewDistance(), center.y, center.z], center);
        }}>Side</button>
        <button type="button" onClick={() => {
          if (cameraRef.current) cameraRef.current.up.set(0, 1, 0);
          setMoveImage(false);
          const center = target();
          setView([center.x, center.y + viewDistance(), center.z + 0.1], center);
        }}>Top</button>
        <button type="button" onClick={() => {
          if (cameraRef.current) cameraRef.current.up.set(0, 1, 0);
          setMoveImage(false);
          const center = target();
          setView([center.x + viewDistance() * 0.7, center.y + viewDistance() * 0.5, center.z + viewDistance() * 0.7], center);
        }}>Reset</button>
      </div>
      {customSettings && mesh && <div className="projection-toolbar">
        {customSettings.projection === 'planar' && <>
          <button type="button" disabled={!imageAspect || busy} className="primary-button" onClick={() => {
            const camera = cameraRef.current;
            if (!camera) return;
            const direction = camera.getWorldDirection(new THREE.Vector3()).negate();
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
            onProjectionChange({ ...customSettings, direction: direction.toArray(), up: up.toArray() });
            setMoveImage(false);
          }}>Project from view</button>
          <button type="button" disabled={!imageAspect || busy} className={moveImage ? 'active' : ''} aria-pressed={moveImage} onClick={() => {
            if (!moveImage) {
              const bounds = boundsRef.current;
              const camera = cameraRef.current;
              if (bounds && camera) {
                camera.up.set(...customSettings.up);
                const position = bounds.center.clone().addScaledVector(new THREE.Vector3(...customSettings.direction), viewDistance());
                setView(position.toArray(), bounds.center);
              }
            }
            setMoveImage(!moveImage);
          }}>{moveImage ? 'Done moving' : 'Move image'}</button>
          <label className="check-row"><input type="checkbox" checked={showFrame} onChange={e => setShowFrame(e.target.checked)} /> Image frame</label>
        </>}
        {imageAspect && <label className="check-row">Image size <input aria-label="Preview image size" disabled={busy} type="range" min="0.25" max="3" step="0.01" value={mapping.scale} onChange={e => onMappingChange({ ...mapping, scale: Number(e.target.value) })} /></label>}
        <label className="check-row"><input type="checkbox" checked={shaded} onChange={e => setShaded(e.target.checked)} /> Shape shading</label>
        <span className="helper-copy">{busy ? 'Updating preview...' : moveImage ? 'Drag to move the image; release to update colors.' : customSettings.projection === 'cylindrical' ? 'Wrap around Y: adjust scale and offsets in Image.' : 'Orbit to a side, then project. Placement stays fixed as you orbit.'}</span>
      </div>}
      <div className={`viewport${moveImage ? ' moving-image' : ''}`} ref={hostRef} />
      {busy && <div className="preview-progress" role="status">Preparing preview...</div>}
      {!mesh ? <div className="viewport-empty">{customSettings ? 'Load an STL, 3MF, or OBJ model to begin.' : 'Upload an image to generate a printable color mesh.'}</div> : null}
    </section>
  );
}
