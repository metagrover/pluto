import { assertFeatureEnabled } from '../config/featureFlags';
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
  attached_meetings?: Array<{ id: string; title: string }>;
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => {
  assertFeatureEnabled('sources');
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

export const listMeetingArtifacts = (
  meetingId: string | number,
): Promise<LocalArtifact[]> => invoke('MEETING_ARTIFACTS_LIST', meetingId);

export const attachMeetingArtifact = (
  meetingId: string | number,
  artifactId: string,
): Promise<boolean> =>
  invoke('MEETING_ARTIFACTS_ATTACH', { meetingId, artifactId });

export const detachMeetingArtifact = (
  meetingId: string | number,
  artifactId: string,
): Promise<boolean> =>
  invoke('MEETING_ARTIFACTS_DETACH', { meetingId, artifactId });

export const importAndAttachMeetingArtifacts = (
  meetingId: string | number,
): Promise<LocalArtifact[]> =>
  invoke('MEETING_ARTIFACTS_IMPORT_AND_ATTACH', meetingId);

export const importAndAttachMeetingArtifactPaths = (
  meetingId: string | number,
  paths: string[],
): Promise<LocalArtifact[]> =>
  invoke('MEETING_ARTIFACTS_IMPORT_PATHS_AND_ATTACH', { meetingId, paths });
