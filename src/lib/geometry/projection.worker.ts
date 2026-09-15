import { projectModel, type ProjectionRequest } from './projectModel';
import { validateMeshManifold } from './validateMesh';
import { cleanupColorIslandsByArea } from './cleanupColorIslands';

self.onmessage = (event: MessageEvent<ProjectionRequest>) => {
  try {
    const result = projectModel(event.data);
    const cleanup = event.data.cleanupAreaMm2 ? cleanupColorIslandsByArea(result.mesh, event.data.cleanupAreaMm2) : null;
    const mesh = cleanup?.mesh ?? result.mesh;
    const validation = validateMeshManifold(mesh);
    self.postMessage({ ...result, mesh, cleanup: cleanup ? { replacedIslandCount: cleanup.replacedIslandCount, replacedTriangleCount: cleanup.replacedTriangleCount } : null, validation: { ...validation, edgeUseCounts: new Map() } });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not project the image.' });
  }
};
