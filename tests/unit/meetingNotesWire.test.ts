import { expect, it } from 'vitest';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';

it('uses compact source handles without changing immutable source text and decodes exact spans', () => {
  const span = { segment: 8, start: 12, end: 54 };
  const sourceText = 'A quoted {"segment":0,"start":0,"end":1} is data.';
  const prompt = `BEGIN SOURCE DATA\n${JSON.stringify({ descriptor: span, speaker: 'Milo', text: sourceText })}\nEND SOURCE DATA\n{"sources":[{"segment":0,"start":0,"end":1}]}`;
  const wire = createNotesWireRequest(prompt, [span]);
  expect(wire.prompt).toContain('"descriptor":"R0"');
  expect(wire.prompt).toContain(JSON.stringify(sourceText));
  expect(wire.prompt).toContain('"sources":["R0"]');
  expect(
    JSON.parse(wire.decode('{"text":"Claim","sources":["R0"]}')).sources,
  ).toEqual([span]);
});

it('never broadens invented or unknown references and leaves malformed responses for bounded repair', () => {
  const wire = createNotesWireRequest('', [{ segment: 0, start: 0, end: 50 }]);
  expect(wire.decode('{"sources":["R99"]}')).toBe('{"sources":["R99"]}');
  expect(wire.decode('not json')).toBe('not json');
  expect(
    wire.decode('{"sources":[{"segment":0,"start":0,"end":1}]}'),
  ).toContain('"end":1');
});
