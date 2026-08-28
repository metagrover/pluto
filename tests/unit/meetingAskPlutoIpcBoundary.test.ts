import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync('electron/main.ts', 'utf8');
const handlerStart = main.indexOf("'intelligence:meeting-chat'");
const handlerEnd = main.indexOf("'intelligence:query:debug'", handlerStart);
const meetingChatHandler = main.slice(handlerStart, handlerEnd);

describe('meeting Ask Pluto IPC boundary', () => {
  it('streams request-scoped visible provider deltas to the invoking renderer', () => {
    expect(main).toContain(
      "import { createMeetingAskPlutoVisibleStream } from './intelligence/meetingAskPlutoStream';",
    );
    expect(meetingChatHandler).toContain(
      'const visibleStream = createMeetingAskPlutoVisibleStream',
    );
    expect(meetingChatHandler).toContain("'intelligence:meeting-chat:delta'");
    expect(meetingChatHandler).toContain('requestId,');
    expect(meetingChatHandler).toContain('onToken: (delta) =>');
    expect(meetingChatHandler).toContain('visibleStream.push(delta)');
    expect(meetingChatHandler).toContain('visibleStream.flush()');
    expect(meetingChatHandler).toContain('event.sender.isDestroyed()');
  });
});
