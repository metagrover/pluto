import type { MeetingAskPlutoRequest } from '../types/askPluto';

export const createMeetingAskPlutoRequestId = () => {
  const suffix = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `ask-pluto-${suffix}`;
};

export const describeMeetingAskPlutoRequest = (
  request: MeetingAskPlutoRequest,
) => {
  const base = {
    requestId: request.requestId,
    scopeType: request.scope.type,
    queryChars: request.query.length,
    turnCount: request.turns?.length ?? 0,
  };

  if (request.scope.type === 'meeting') {
    return base;
  }

  return {
    ...base,
    transcriptSegments: request.scope.transcript.length,
    transcriptChars: request.scope.transcript.reduce(
      (total, segment) => total + segment.text.length,
      0,
    ),
    notesChars: request.scope.notes.length,
    interimChars: request.scope.interimText?.length ?? 0,
    participantCount: request.scope.participants.length,
  };
};
