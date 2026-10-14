import { attachProjectionOverlay, projectionUniforms } from '../lib/geometry/previewProjection';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { projectionFrame, type CustomSettings } from '../lib/geometry/customModel';
import type { ImageMappingSettings, MeshData } from '../lib/geometry/meshTypes';

type Props = {
  projectionEditing: boolean;
  imageCanvas: HTMLCanvasElement | null;
  onBeginProjection: (settings: CustomSettings) => void;
  onApplyProjection: (settings: CustomSettings) => void;
  onCancelProjection: () => void;
  mesh: MeshData | null;
  customSettings?: CustomSettings;
  imageAspect: number | null;
  mapping: ImageMappingSettings;
  onMappingChange: (settings: ImageMappingSettings) => void;
  busy?: boolean;
  onBake: () => void;
  onClearBaked: () => void;
  bakedCount: number;
  importedPainting?: boolean;
  canBake: boolean;
  activeTexture: boolean;
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

type PreviewCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera;

function fitCameraToBounds(camera: PreviewCamera, bounds: MeshBounds, aspect: number, padding = 1.12) {
  const viewHeight = Math.max(bounds.size.length(), bounds.size.length() / Math.max(0.001, aspect), 1) * padding;
  if (camera instanceof THREE.OrthographicCamera) {
    const viewWidth = viewHeight * Math.max(0.001, aspect);
    camera.left = -viewWidth / 2; camera.right = viewWidth / 2;
    camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2;
  } else camera.aspect = aspect;
  camera.near = Math.max(0.001, bounds.maxDimension / 10000);
  camera.far = bounds.maxDimension * 100;
  camera.updateProjectionMatrix();
}

export function Preview3D({ projectionEditing, imageCanvas, onBeginProjection, onApplyProjection, onCancelProjection, mesh, customSettings, imageAspect, mapping, onMappingChange, busy, onBake, onClearBaked, bakedCount, canBake, activeTexture, importedPainting }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<PreviewCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const objectRef = useRef<THREE.Mesh | null>(null);
  const boundsRef = useRef<MeshBounds | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const [cameraMode, setCameraMode] = useState<'orthographic' | 'perspective'>('orthographic');
  const overlayUniforms = useRef(projectionUniforms());
  const refreshProjectionRef = useRef<() => void>(() => {});
  const projectionPendingRef = useRef(false);
  const guideRef = useRef<THREE.Line | null>(null);
  const projectionFrameCache = useRef<{ mesh: MeshData; key: string; frame: ReturnType<typeof projectionFrame> } | null>(null);
  const previewStateRef = useRef({ mesh, customSettings, mapping, projectionEditing, imageAspect });
  previewStateRef.current = { mesh, customSettings, mapping, projectionEditing, imageAspect };
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
      const currentCamera = cameraRef.current;
      if (!currentCamera) return;
      if (currentCamera instanceof THREE.PerspectiveCamera) currentCamera.aspect = aspect;
      else {
        const height = currentCamera.top - currentCamera.bottom;
        currentCamera.left = -height * aspect / 2;
        currentCamera.right = height * aspect / 2;
      }
      currentCamera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let activeFrame: ReturnType<typeof projectionFrame> | null = null;
    const projectPointer = (event: PointerEvent) => {
      const current = interactionRef.current;
      if (!current.mesh || !current.customSettings) return null;
      const frame = activeFrame ?? frameFor(current.mesh, previewSettings(current.customSettings));
      const bounds = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, cameraRef.current!);
      const point = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(frame.direction, frame.center), new THREE.Vector3());
      return point ? { point, frame } : null;
    };
    const down = (event: PointerEvent) => {
      const current = interactionRef.current;
      if (current.busy || !current.moveImage || current.customSettings?.projection !== 'planar' || event.button !== 0) return;
      activeFrame = null;
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
      let width = projected.frame.width * drag.mapping.scale, height = projected.frame.height * drag.mapping.scale;
      const aspect = previewStateRef.current.imageAspect ?? 1;
      if (drag.mapping.fitMode === 'contain') {
        if (aspect > width / height) height = width / aspect; else width = height * aspect;
      } else if (drag.mapping.fitMode === 'cover') {
        if (aspect > width / height) width = height * aspect; else height = width / aspect;
      }
      const angle = (interactionRef.current.customSettings?.imageRotation ?? 0) * Math.PI / 180;
      const x = delta.dot(projected.frame.right), y = delta.dot(projected.frame.up);
      drag.last = { ...drag.mapping,
        offsetU: Math.max(-1, Math.min(1, drag.mapping.offsetU - (x * Math.cos(angle) + y * Math.sin(angle)) / width * (drag.mapping.mirrorX ? -1 : 1))),
        offsetV: Math.max(-1, Math.min(1, drag.mapping.offsetV + (-x * Math.sin(angle) + y * Math.cos(angle)) / height * (drag.mapping.flipY ? -1 : 1))),
      };
      // Both the GPU overlay and frame move immediately. In placement mode the
      // release only updates draft settings; the worker waits for Apply.
      overlayUniforms.current.imageProjectionOffset.value.set(drag.last.offsetU, drag.last.offsetV);
      const guide = guideRef.current;
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

    const changed = () => { projectionPendingRef.current = true; };
    controls.addEventListener('change', changed);
    let frame = 0, lastProjectionUpdate = 0;
    const animate = () => {
      controls.update();
      const now = performance.now();
      if (projectionPendingRef.current && now - lastProjectionUpdate >= 80 && !dragStateRef.current) {
        projectionPendingRef.current = false;
        lastProjectionUpdate = now;
        if (previewStateRef.current.projectionEditing) refreshProjectionRef.current();
      }
      renderer.render(scene, cameraRef.current!);
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
      controls.removeEventListener('change', changed);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enabled = !moveImage;
    if (!moveImage) dragStateRef.current = null;
  }, [moveImage]);

  useEffect(() => { setMoveImage(false); }, [customSettings?.projection]);
  useEffect(() => { if (!projectionEditing) setMoveImage(false); }, [projectionEditing]);

  const previewSettings = (settings: CustomSettings): CustomSettings => {
    const camera = cameraRef.current;
    if (!previewStateRef.current.projectionEditing || !camera) return settings;
    return { ...settings,
      direction: camera.getWorldDirection(new THREE.Vector3()).negate().toArray(),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).toArray(),
    };
  };

  const frameFor = (model: MeshData, settings: CustomSettings) => {
    const key = `${settings.projection}:${settings.direction.join(',')}:${settings.up.join(',')}`;
    const cached = projectionFrameCache.current;
    if (cached?.mesh === model && cached.key === key) return cached.frame;
    const frame = projectionFrame(model, settings);
    projectionFrameCache.current = { mesh: model, key, frame };
    return frame;
  };

  refreshProjectionRef.current = () => {
    const { mesh, customSettings, mapping, projectionEditing, imageAspect } = previewStateRef.current;
    if (!mesh || !customSettings || !imageAspect) return;
    const settings = previewSettings(customSettings);
    const frame = frameFor(mesh, settings);
    const uniforms = overlayUniforms.current;
    uniforms.imageProjectionEnabled.value = projectionEditing;
    uniforms.imageProjectionCenter.value.copy(frame.center);
    uniforms.imageProjectionRight.value.copy(frame.right);
    uniforms.imageProjectionUp.value.copy(frame.up);
    uniforms.imageProjectionDirection.value.copy(frame.direction);
    uniforms.imageProjectionSize.value.set(frame.width, frame.height);
    uniforms.imageProjectionScale.value = mapping.scale;
    uniforms.imageProjectionOffset.value.set(mapping.offsetU, mapping.offsetV);
    uniforms.imageProjectionMirror.value = mapping.mirrorX;
    uniforms.imageProjectionFlip.value = mapping.flipY;
    uniforms.imageProjectionRepeat.value.set(Number(mapping.repeatX), Number(mapping.repeatY));
    uniforms.imageProjectionFit.value = mapping.fitMode === 'stretch' ? 0 : mapping.fitMode === 'contain' ? 1 : 2;
    uniforms.imageProjectionAspect.value = imageAspect;
    uniforms.imageProjectionAngle.value = settings.imageRotation * Math.PI / 180;
    uniforms.imageProjectionVisibleOnly.value = settings.visibleOnly;
    const guide = guideRef.current;
    if (!guide) return;
    let width = frame.width * mapping.scale, height = frame.height * mapping.scale;
    if (mapping.fitMode === 'contain') {
      if (imageAspect > width / height) height = width / imageAspect; else width = height * imageAspect;
    } else if (mapping.fitMode === 'cover') {
      if (imageAspect > width / height) width = height * imageAspect; else height = width / imageAspect;
    }
    const angle = settings.imageRotation * Math.PI / 180;
    const right = frame.right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.up, Math.sin(angle));
    const up = frame.up.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.right, -Math.sin(angle));
    // Convert image-space offsets back through the same fit transform as sampling.
    const center = frame.center.clone()
      .addScaledVector(right, -mapping.offsetU * width * (mapping.mirrorX ? -1 : 1))
      .addScaledVector(up, mapping.offsetV * height * (mapping.flipY ? -1 : 1));
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => center.clone().addScaledVector(right, x * width / 2).addScaledVector(up, y * height / 2));
    const positions = guide.geometry.getAttribute('position') as THREE.BufferAttribute;
    corners.forEach((point, i) => positions.setXYZ(i, point.x, point.y, point.z));
    positions.needsUpdate = true;
    guide.geometry.computeBoundingSphere();
    guide.position.set(0, 0, 0);
  };

  useEffect(() => {
    const uniforms = overlayUniforms.current;
    if (!imageCanvas) { uniforms.imageProjectionTexture.value = null; return; }
    const texture = new THREE.CanvasTexture(imageCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // The mapping sampler uses image coordinates from the top.
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    uniforms.imageProjectionTexture.value = texture;
    return () => { uniforms.imageProjectionTexture.value = null; texture.dispose(); };
  }, [imageCanvas]);

  useEffect(() => {
    overlayUniforms.current.imageProjectionEnabled.value = projectionEditing && Boolean(imageCanvas);
    refreshProjectionRef.current();
  }, [mesh, customSettings, mapping, projectionEditing, imageAspect, imageCanvas]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !mesh || !customSettings || customSettings.projection !== 'planar' || !showFrame || !imageAspect || !(activeTexture || projectionEditing)) return;
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3));
    const material = new THREE.LineBasicMaterial({ color: '#e77817', depthTest: false, transparent: true, opacity: 0.9 });
    const guide = new THREE.Line(geometry, material);
    guide.name = 'projection-guide'; guide.renderOrder = 10;
    scene.add(guide); guideRef.current = guide;
    refreshProjectionRef.current();
    return () => { guideRef.current = null; scene.remove(guide); geometry.dispose(); material.dispose(); };
  }, [mesh, Boolean(customSettings), customSettings?.projection, showFrame, Boolean(imageAspect), activeTexture, projectionEditing]);

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
    if (customSettings) geometry.computeVertexNormals();
    const material = useShading ? new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }) : new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    if (customSettings) attachProjectionOverlay(material, overlayUniforms.current);
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
      setView([bounds.center.x, bounds.center.y, bounds.center.z + viewDistance()], bounds.center);
    }
  }, [mesh, shaded, Boolean(customSettings), Boolean(imageAspect)]);

  const setView = (position: [number, number, number], target = boundsRef.current?.center ?? new THREE.Vector3(0, 50, 0)) => {
    cameraRef.current?.position.set(...position);
    cameraRef.current?.lookAt(target);
    controlsRef.current?.target.copy(target);
    controlsRef.current?.update();
  };

  const viewDistance = () => {
    const camera = cameraRef.current, bounds = boundsRef.current;
    if (camera instanceof THREE.PerspectiveCamera && bounds) {
      return Math.max(bounds.size.length(), 1) * 1.12 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 1));
    }
    return (bounds?.maxDimension ?? 120) * 2.1;
  };
  const target = () => boundsRef.current?.center ?? new THREE.Vector3(0, 50, 0);

  const switchCamera = (mode: 'orthographic' | 'perspective') => {
    const previous = cameraRef.current, controls = controlsRef.current, host = hostRef.current;
    if (!previous || !controls || !host || mode === cameraMode) return;
    const size = host.getBoundingClientRect();
    const aspect = Math.max(1, size.width) / Math.max(1, size.height);
    const distance = previous.position.distanceTo(controls.target);
    const height = previous instanceof THREE.OrthographicCamera ? (previous.top - previous.bottom) / previous.zoom
      : 2 * distance * Math.tan(THREE.MathUtils.degToRad(previous.getEffectiveFOV() / 2));
    const camera: PreviewCamera = mode === 'perspective'
      ? new THREE.PerspectiveCamera(45, aspect, previous.near, previous.far)
      : new THREE.OrthographicCamera(-height * aspect / 2, height * aspect / 2, height / 2, -height / 2, previous.near, previous.far);
    camera.up.copy(previous.up);
    camera.position.copy(previous.position);
    if (camera instanceof THREE.PerspectiveCamera) {
      const direction = previous.position.clone().sub(controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(direction, height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
    }
    camera.far = Math.max(camera.far, camera.position.distanceTo(controls.target) * 10);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    cameraRef.current = camera;
    controls.object = camera;
    controls.update();
    setCameraMode(mode);
    projectionPendingRef.current = true;
  };

  return (
    <section className="preview-panel">
      <div className="viewport-toolbar">
        <label className="camera-selector">Camera <select aria-label="Camera projection" value={cameraMode} onChange={e => switchCamera(e.target.value as 'orthographic' | 'perspective')}>
          <option value="orthographic">Orthographic</option><option value="perspective">Perspective</option>
        </select></label>
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
            const settings = { ...customSettings, direction: direction.toArray(), up: up.toArray() };
            if (projectionEditing) onApplyProjection(settings); else onBeginProjection(settings);
            setMoveImage(false);
          }}>{projectionEditing ? 'Apply' : 'Project from view'}</button>
          {projectionEditing && <button type="button" onClick={() => { setMoveImage(false); onCancelProjection(); }}>Cancel placement</button>}
          <button type="button" disabled={!imageAspect || busy} className={moveImage ? 'active' : ''} aria-pressed={moveImage} onClick={() => {
            if (!moveImage && !projectionEditing) {
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
        <button type="button" disabled={projectionEditing || busy || !canBake} onClick={onBake}>Bake current texture</button>
        {importedPainting && <span>Imported MMU painting</span>}
        {bakedCount > 0 && <>
          <span>{bakedCount} baked {bakedCount === 1 ? 'texture' : 'textures'}</span>
        </>}
        {(bakedCount > 0 || importedPainting) && <button type="button" disabled={projectionEditing || busy} onClick={onClearBaked}>{importedPainting ? 'Clear all painting' : 'Clear baked textures'}</button>}
        <label className="check-row"><input type="checkbox" disabled={projectionEditing} checked={shaded} onChange={e => setShaded(e.target.checked)} /> Shape shading</label>
        <span className="helper-copy">{busy ? 'Updating preview...' : projectionEditing ? 'Placement mode: orbit, drag, or resize the image. Image overlay is 30% transparent. Click Apply to calculate colors.' : !activeTexture && bakedCount ? 'Texture baked. Project this image from another view, adjust placement, or choose a new image.' : moveImage ? 'Drag to move the image; release to update colors.' : customSettings.projection === 'cylindrical' ? 'Wrap around Y: adjust scale and offsets in Image.' : 'Orbit to a side, then project. Placement stays fixed as you orbit.'}</span>
      </div>}
      <div className={`viewport${moveImage ? ' moving-image' : ''}`} ref={hostRef} />
      {busy && <div className="preview-progress" role="status">Preparing preview...</div>}
      {!mesh ? <div className="viewport-empty">{customSettings ? 'Load an STL, 3MF, or OBJ model to begin.' : 'Upload an image to generate a printable color mesh.'}</div> : null}
    </section>
  );
}
