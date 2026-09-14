import { projectModel, type ProjectionRequest } from './projectModel';
import { validateMeshManifold } from './validateMesh';

self.onmessage = (event: MessageEvent<ProjectionRequest>) => {
  try {
    const result = projectModel(event.data);
    const validation = validateMeshManifold(result.mesh);
    self.postMessage({ ...result, validation: { ...validation, edgeUseCounts: new Map() } });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not project the image.' });
  }
};
