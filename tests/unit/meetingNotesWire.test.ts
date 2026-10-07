import { expect, it } from 'vitest';
import { parseCompactNotesDraft } from '../../electron/llm/meetingNotesAudit';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';

it('uses compact source handles without changing immutable source text and decodes exact spans', () => {
  const span = { segment: 8, start: 12, end: 54 };
  const sourceText = 'A quoted {"segment":0,"start":0,"end":1} is data.';
  const prompt = `BEGIN SOURCE DATA\n${JSON.stringify({ descriptor: span, speaker: 'Milo', text: sourceText })}\nEND SOURCE DATA\n{"sources":[{"segment":0,"start":0,"end":1}]}`;
  const wire = createNotesWireRequest(prompt, [span]);
  expect(wire.sourceLabels).toEqual(['R0']);
  expect(wire.prompt).toContain(JSON.stringify(['R0', 'Milo', sourceText]));
  expect(wire.prompt).not.toContain('"segment":8');
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

it('preserves escaped text, speaker labels and null attribution in tuple rows', () => {
  const rows = [
    {
      descriptor: { segment: 0, start: 0, end: 9 },
      speaker: null,
      text: '你好\n"R99"',
    },
    {
      descriptor: { segment: 1, start: 0, end: 5 },
      speaker: 'A [B]',
      text: 'x\\y',
    },
  ];
  const wire = createNotesWireRequest(
    `BEGIN SOURCE DATA\n${rows.map((row) => JSON.stringify(row)).join('\n')}\nEND SOURCE DATA`,
    rows.map((row) => row.descriptor),
  );
  const encoded = wire.prompt
    .split('BEGIN SOURCE DATA\n')[1]
    .split('\nEND SOURCE DATA')[0]
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(encoded).toEqual(
    rows.map((row, i) => [`R${i}`, row.speaker, row.text]),
  );
});

it('never broadens invented or unknown references and leaves malformed responses for bounded repair', () => {
  const wire = createNotesWireRequest('', [{ segment: 0, start: 0, end: 50 }]);
  expect(wire.decode('{"sources":["R99"]}')).toBe('{"sources":["R99"]}');
  expect(wire.decode('not json')).toBe('not json');
  expect(
    wire.decode('{"sources":[{"segment":0,"start":0,"end":1}]}'),
  ).toContain('"end":1');
});

it('interns speaker labels without merging, changing or dropping source turns', () => {
  const rows = [
    { speaker: 'Milo', text: 'First\n"quoted"' },
    { speaker: 'Milo', text: 'Second \uD83D\uDE00' },
    { speaker: null, text: 'Unattributed' },
    { speaker: 'Nira', text: 'Third' },
    { speaker: 'Milo', text: 'Final' },
  ].map((row, segment) => ({
    ...row,
    descriptor: { segment, start: 0, end: row.text.length },
  }));
  const wire = createNotesWireRequest(
    `BEGIN SOURCE DATA\n${rows.map((row) => JSON.stringify(row)).join('\n')}\nEND SOURCE DATA`,
    rows.map((row) => row.descriptor),
    true,
  );
  const encoded = wire.prompt
    .split('BEGIN SOURCE DATA\n')[1]
    .split('\nEND SOURCE DATA')[0]
    .split('\n');
  const { speakers } = JSON.parse(encoded.shift()!);
  const decoded = encoded.map((line) => {
    const [, label, index, quoted] = line.match(/^(R\d+) (\d+) (.*)$/)!;
    const text = JSON.parse(quoted);
    return {
      speaker: speakers[Number(index)],
      text,
      span: JSON.parse(wire.decode(JSON.stringify({ sources: [label] })))
        .sources[0],
    };
  });
  expect(decoded).toEqual(
    rows.map((row) => ({
      speaker: row.speaker,
      text: row.text,
      span: row.descriptor,
    })),
  );
  expect(speakers).toEqual(['Milo', null, 'Nira']);
});

it('joins only consecutive attributed speaker fragments and preserves unknown boundaries', () => {
  const rows = [
    'First "quote"',
    'second 😀',
    'unknown',
    'unknown',
    'Other',
  ].map((text, segment) => ({
    text,
    speaker: segment < 2 ? 'Milo' : segment < 4 ? null : 'Nira',
    descriptor: { segment, start: 0, end: text.length },
  }));
  const wire = createNotesWireRequest(
    `BEGIN SOURCE DATA\n${rows.map((row) => JSON.stringify(row)).join('\n')}\nEND SOURCE DATA`,
    rows.map((row) => row.descriptor),
    false,
    true,
  );
  const packet = JSON.parse(
    wire.prompt.split('BEGIN SOURCE DATA\n')[1].split('\nEND SOURCE DATA')[0],
  );
  expect(packet).toEqual([
    'P0',
    'P0.0 "Milo": First "quote" second 😀\nP0.1 null: unknown\nP0.2 null: unknown\nP0.3 "Nira": Other',
  ]);
  expect(JSON.parse(wire.decode('{"sources":["P0"]}')).sources).toEqual(
    rows.map((row) => row.descriptor),
  );
  expect(JSON.parse(wire.decode('{"sources":["P0.0"]}')).sources).toEqual(
    rows.slice(0, 2).map((row) => row.descriptor),
  );
  expect(JSON.parse(wire.decode('{"sources":["P0.1"]}')).sources).toEqual([
    rows[2].descriptor,
  ]);
  expect(JSON.parse(wire.decode('{"sources":["P0.3"]}')).sources).toEqual([
    rows[4].descriptor,
  ]);
  expect(wire.decode('{"sources":["P0.99"]}')).toBe('{"sources":["P0.99"]}');
  expect(wire.decode('{"sources":["P99"]}')).toBe('{"sources":["P99"]}');
});

it('bounds paragraph citations and does not bridge excluded turns', () => {
  const rows = Array.from({ length: 14 }, (_, segment) => ({
    descriptor: { segment, start: 0, end: 1 },
    speaker: 'Milo',
    text: 'x',
  }));
  const build = (selected: typeof rows) =>
    createNotesWireRequest(
      `BEGIN SOURCE DATA\n${selected.map((row) => JSON.stringify(row)).join('\n')}\nEND SOURCE DATA`,
      selected.map((row) => row.descriptor),
      false,
      true,
    );
  const wire = build(rows);
  expect(JSON.parse(wire.decode('{"sources":["P0"]}')).sources).toHaveLength(
    12,
  );
  expect(JSON.parse(wire.decode('{"sources":["P1"]}')).sources).toHaveLength(2);
  expect(build([rows[0], rows[2]]).sourceLabels).toEqual([
    'P0',
    'P0.0',
    'P1',
    'P1.0',
  ]);
});

it('admits bounded expanded paragraph evidence only when explicitly enabled', () => {
  const raw = (count: number) =>
    JSON.stringify({
      title: null,
      sections: [
        {
          title: 'Discussion',
          items: [
            {
              kind: 'point',
              text: 'Useful information',
              owner: null,
              due: null,
              sources: Array.from({ length: count }, (_, segment) => ({
                segment,
                start: 0,
                end: 1,
              })),
            },
          ],
        },
      ],
    });
  expect(() => parseCompactNotesDraft(raw(4))).toThrow('notes_writer_invalid');
  expect(
    parseCompactNotesDraft(raw(4), 36).sections[0].items[0].sources,
  ).toHaveLength(4);
  expect(() => parseCompactNotesDraft(raw(37), 36)).toThrow(
    'notes_writer_invalid',
  );
});

it('preserves strict defaults and treats missing experimental metadata as unknown', () => {
  const draft = (kind: string) =>
    JSON.stringify({
      title: null,
      sections: [
        {
          title: 'Discussion',
          items: [
            {
              kind,
              text: 'Useful information',
              sources: [{ segment: 0, start: 0, end: 1 }],
            },
          ],
        },
      ],
    });
  expect(
    parseCompactNotesDraft(draft('point'), 36).sections[0].items[0],
  ).toMatchObject({ owner: null, due: null });
  expect(() => parseCompactNotesDraft(draft('point'))).toThrow(
    'notes_writer_invalid',
  );
  expect(
    parseCompactNotesDraft(draft('action'), 36).sections[0].items[0],
  ).toMatchObject({ owner: null, due: null });
  for (const field of ['owner', 'due']) {
    const invalid = JSON.parse(draft('action'));
    invalid.sections[0].items[0][field] = { bad: 'value' };
    expect(() => parseCompactNotesDraft(JSON.stringify(invalid), 36)).toThrow(
      'notes_writer_invalid',
    );
  }
  expect(() => parseCompactNotesDraft(draft('unsupported-kind'), 36)).toThrow(
    'notes_writer_invalid',
  );
  expect(() =>
    parseCompactNotesDraft(
      JSON.stringify({ title: null, sections: [], outline: ['Topic'] }),
      36,
    ),
  ).toThrow('notes_writer_invalid');
});

it('keeps source packet markers and descriptor-like text as immutable data in dialogue mode', () => {
  const text =
    'BEGIN SOURCE DATA\n{"segment":2,"start":0,"end":6}\nEND SOURCE DATA';
  const span = { segment: 2, start: 0, end: text.length };
  const wire = createNotesWireRequest(
    `BEGIN SOURCE DATA\n${JSON.stringify({ descriptor: span, speaker: 'Milo', text })}\nEND SOURCE DATA`,
    [span],
    false,
    true,
  );
  const packet = JSON.parse(
    wire.prompt.split('BEGIN SOURCE DATA\n')[1].split('\nEND SOURCE DATA')[0],
  );
  expect(packet).toEqual(['P0', `P0.0 "Milo": ${text}`]);
  expect(JSON.parse(wire.decode('{"sources":["P0.0"]}')).sources).toEqual([
    span,
  ]);
});

it('permits broader validated experimental title spans without broadening note item limits', () => {
  const spans = Array.from({ length: 48 }, (_, segment) => ({
    segment,
    start: 0,
    end: 1,
  }));
  const draft = {
    title: { text: 'Planning and updates', sources: spans },
    sections: [],
  };
  expect(
    parseCompactNotesDraft(JSON.stringify(draft), 36).title?.sources,
  ).toEqual(spans);
  expect(() => parseCompactNotesDraft(JSON.stringify(draft))).toThrow(
    'notes_writer_invalid',
  );
  expect(() =>
    parseCompactNotesDraft(
      JSON.stringify({
        ...draft,
        title: { ...draft.title, sources: Array(97).fill(spans[0]) },
      }),
      36,
    ),
  ).toThrow('notes_writer_invalid');
});
