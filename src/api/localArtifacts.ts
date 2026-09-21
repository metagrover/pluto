import type { TrustStatus } from '../utils/trustStatus';

export type LocalArtifactType = 'markdown' | 'text' | 'pdf' | 'docx' | 'pages';
export type LocalArtifactStatus = 'active' | 'noisy' | 'excluded';
export type LocalArtifactSourceQuality = 'usable' | 'limited' | 'noisy';

export interface LocalArtifact {
  id: string;
  type: LocalArtifactType;
  title: string;
  captured_at: string;
  imported_at: string;
  original_path: string;
  content_hash: string;
  extracted_text: string;
  metadata_json: string;
  source_quality: LocalArtifactSourceQuality;
  trust_status: TrustStatus;
  status: LocalArtifactStatus;
  created_at: string;
  updated_at: string;
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => {
  if (!window.ipcRenderer) {
    return Promise.reject(new Error('IPC unavailable'));
  }
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
};

export const listLocalArtifacts = (): Promise<LocalArtifact[]> =>
  invoke('LOCAL_ARTIFACTS_LIST');

export const importLocalArtifacts = (): Promise<LocalArtifact[]> =>
  invoke('LOCAL_ARTIFACTS_IMPORT');

export const importLocalArtifactPaths = (
  paths: string[],
): Promise<LocalArtifact[]> => invoke('LOCAL_ARTIFACTS_IMPORT_PATHS', paths);

export const setLocalArtifactStatus = (
  id: string,
  status: LocalArtifactStatus,
): Promise<LocalArtifact> =>
  invoke('LOCAL_ARTIFACTS_SET_STATUS', { id, status });

export const deleteLocalArtifact = (id: string): Promise<boolean> =>
  invoke('LOCAL_ARTIFACTS_DELETE', id);
