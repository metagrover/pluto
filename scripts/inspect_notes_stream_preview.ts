// Replay captured writer chunks through the new UI projection. No model/network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createNotesSource } from '../electron/llm/meetingNotesSource';
import { createNotesStreamPreview } from '../electron/llm/meetingNotesStreamPreview';
import { createNotesWireRequest } from '../electron/llm/meetingNotesWire';

function main() {
  assert.equal(process.argv.length, 4);
  const root = process.argv[2];
  const index = Number(process.argv[3]);
  assert.ok(
    path.isAbsolute(root) &&
      Number.isInteger(index) &&
      index >= 1 &&
      index <= 10,
  );
  const directory = fs.lstatSync(root);
  assert.ok(
    directory.isDirectory() &&
      directory.uid === process.getuid?.() &&
      (directory.mode & 0o777) === 0o700,
  );
  const read = (name: string) => {
    const stat = fs.lstatSync(path.join(root, name));
    assert.ok(
      stat.isFile() &&
        stat.uid === process.getuid?.() &&
        (stat.mode & 0o777) === 0o600,
    );
    return fs.readFileSync(path.join(root, name), 'utf8');
  };
  const manifest = JSON.parse(read('manifest.json'));
  const source = createNotesSource(
    JSON.parse(read('sources.json')).rows[index - 1].transcript_json,
  );
  const events = read('events.jsonl')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const attempts = events.filter(
    (e) => e.event === 'physical_started' && e.caseIndex === index,
  );
  const rows = [];
  for (const attempt of attempts) {
    assert.equal(attempt.prefix, `case-${index}-attempt-${attempt.attempt}`);
    const request = JSON.parse(read(`${attempt.prefix}-request.json`));
    if (
      request.format?.required?.includes('meetingType') ||
      request.messages?.some((m: { content: string }) =>
        m.content.includes('BEGIN DRAFT DATA'),
      )
    )
      continue;
    const prompt = request.messages
      .map((m: { content: string }) => m.content)
      .join('\n');
    const packetRows = prompt.match(
      /BEGIN SOURCE DATA\n([\s\S]*?)\nEND SOURCE DATA/,
    )?.[1];
    if (!packetRows) continue;
    const expectedRows = source.segments.map((s, i) => [
      `R${i}`,
      s.speaker,
      s.text,
    ]);
    // Only direct, complete-source writers have the appropriate label mapping.
    if (
      JSON.stringify(
        packetRows
          .split('\n')
          .filter(Boolean)
          .map((line: string) => JSON.parse(line)),
      ) !== JSON.stringify(expectedRows)
    )
      continue;
    const spans = source.segments.map((s) => ({
      segment: s.index,
      start: 0,
      end: s.text.length,
    }));
    const wire = createNotesWireRequest('', spans);
    let timestamp: number | null = null;
    let first: number | null = null;
    let updates = 0;
    let bullets = 0;
    let bytesAtFirst: number | null = null;
    let text = '';
    const preview = createNotesStreamPreview({
      source,
      spans,
      decode: wire.decode,
      onDraft: (draft) => {
        first ??= timestamp;
        bytesAtFirst ??= Buffer.byteLength(text);
        updates++;
        bullets = draft.sections.reduce((n, s) => n + s.items.length, 0);
      },
    });
    const raw = read(`${attempt.prefix}-response.ndjson`);
    let done = false;
    for (const line of raw.trim().split('\n')) {
      const packet = JSON.parse(line);
      assert.ok(!done && !packet.error && packet.model === manifest.model);
      const at = Date.parse(packet.created_at);
      timestamp = Number.isFinite(at) ? at : null;
      text += packet.message?.content ?? '';
      if (packet.message?.content?.includes('}')) preview(text);
      if (packet.done) {
        assert.equal(packet.done_reason, 'stop');
        done = true;
      }
    }
    assert.ok(done);
    rows.push({
      attempt: attempt.attempt,
      responseSha256: createHash('sha256').update(raw).digest('hex'),
      firstCompleteBulletRecordedMs: first === null ? null : first - attempt.at,
      writerCompleteRecordedMs:
        timestamp === null ? null : timestamp - attempt.at,
      bytesAtFirst,
      updates,
      bullets,
    });
  }
  assert.ok(rows.length);
  console.log(
    JSON.stringify(
      {
        physicalRequests: 0,
        publication: false,
        timing: 'recorded_server_timestamps_not_live_UI_measurements',
        rows,
      },
      null,
      2,
    ),
  );
}
try {
  main();
} catch {
  console.error('notes_preview_inspection_failed');
  process.exitCode = 1;
}
