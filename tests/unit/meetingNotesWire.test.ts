import { expect, it } from 'vitest';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';

it('uses compact source handles without changing immutable source text and decodes exact spans', () => {
  const span = { segment: 8, start: 12, end: 54 };
  const sourceText = 'A quoted {"segment":0,"start":0,"end":1} is data.';
  const prompt = `BEGIN SOURCE DATA\n${JSON.stringify({ descriptor: span, speaker: 'Milo', text: sourceText })}\nEND SOURCE DATA\n{"sources":[{"segment":0,"start":0,"end":1}]}`;
  const wire = createNotesWireRequest(prompt, [span]);
  expect(wire.sourceLabels).toEqual(['R0']);
  expect(wire.prompt).toContain('"descriptor":"R0"');
  expect(wire.prompt).toContain(JSON.stringify(sourceText));
  expect(wire.prompt).toContain('"sources":["R0"]');
  expect(
    JSON.parse(wire.decode('{"text":"Claim","sources":["R0"]}')).sources,
  ).toEqual([span]);
});

it('exposes the exact request-local labels used by the schema, including reordered spans', () => {
  const spans = [
    { segment: 8, start: 4, end: 20 },
    { segment: 2, start: 0, end: 12 },
  ];
  const wire = createNotesWireRequest('', spans);
  expect(wire.sourceLabels).toEqual(['R0', 'R1']);
  expect(JSON.parse(wire.decode('{"sources":["R1","R0"]}')).sources).toEqual([
    spans[1],
    spans[0],
  ]);
});

it('never broadens invented or unknown references and leaves malformed responses for bounded repair', () => {
  const wire = createNotesWireRequest('', [{ segment: 0, start: 0, end: 50 }]);
  expect(wire.decode('{"sources":["R99"]}')).toBe('{"sources":["R99"]}');
  expect(wire.decode('not json')).toBe('not json');
  expect(
    wire.decode('{"sources":[{"segment":0,"start":0,"end":1}]}'),
  ).toContain('"end":1');
});
