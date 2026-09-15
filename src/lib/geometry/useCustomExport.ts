import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectionRequest } from './projectModel';
import type { MeshData } from './meshTypes';
import type { MeshValidationResult } from './validateMesh';

export type CustomExportSettings = { multiplier: number; budget: number; islandAreaMm2: number };
export const defaultCustomExportSettings: CustomExportSettings = { multiplier: 2, budget: 1_000_000, islandAreaMm2: 0.05 };
export type PreparedModel = {
  mesh: MeshData; limited: boolean; painted: number; validation: MeshValidationResult;
  cleanup: { replacedIslandCount: number; replacedTriangleCount: number } | null;
};

export function useCustomExport() {
  const [preparing, setPreparing] = useState(false);
  const active = useRef<{ worker: Worker; reject: (error: Error) => void } | null>(null);
  const cancel = useCallback(() => {
    if (!active.current) return;
    active.current.worker.terminate();
    active.current.reject(new Error('Export preparation cancelled.'));
    active.current = null;
    setPreparing(false);
  }, []);
  useEffect(() => cancel, [cancel]);
  const prepare = useCallback((request: ProjectionRequest): Promise<PreparedModel> => {
    cancel();
    setPreparing(true);
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try { worker = new Worker(new URL('./projection.worker.ts', import.meta.url), { type: 'module' }); }
      catch (error) { setPreparing(false); reject(error); return; }
      active.current = { worker, reject };
      const finish = () => { worker.terminate(); active.current = null; setPreparing(false); };
      worker.onmessage = ({ data }) => { finish(); if (data.error) reject(new Error(data.error)); else resolve(data); };
      worker.onerror = () => { finish(); reject(new Error('Export preparation failed. Try a lower triangle budget.')); };
      try { worker.postMessage(request); }
      catch (error) { finish(); reject(error); }
    });
  }, [cancel]);
  return { preparing, prepare, cancel };
}
