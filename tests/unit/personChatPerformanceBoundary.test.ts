import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const main = readFileSync('electron/main.ts', 'utf8');
const start = main.indexOf("'intelligence:person-chat:send'");
const end = main.indexOf("'intelligence:person-chat:cancel'", start);
const handler = main.slice(start, end);

describe('Person Chat performance boundary', () => {
  it('reuses the fast Ask Pluto inference path without classifier or title calls', () => {
    expect(handler).toContain('provider.answerAskPluto');
    expect(handler).toContain("mode: 'fast'");
    expect(handler).not.toContain('classifyQueryIntent');
    expect(handler).not.toContain('generateTitle');
    expect(handler).not.toContain('synthesizeKnowledgeDocument');
  });

  it('records content-free first-token diagnostics', () => {
    expect(handler).toContain('firstTokenMs');
    expect(handler).toContain('promptChars');
    expect(handler).toContain('evidenceChars');
    // Inspect the diagnostic call, not inference arguments elsewhere in the handler.
    const source = ts.createSourceFile(
      'main.ts',
      main,
      ts.ScriptTarget.Latest,
      true,
    );
    const diagnosticCalls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === 'console.info' &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === '[Pluto][Person Chat] provider-response'
      )
        diagnosticCalls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(diagnosticCalls).toHaveLength(1);
    const call = diagnosticCalls[0];
    expect(call.arguments).toHaveLength(2);
    const payload = call.arguments[1];
    expect(ts.isObjectLiteralExpression(payload)).toBe(true);
    if (!ts.isObjectLiteralExpression(payload))
      throw new Error('Expected structured diagnostics');
    expect(
      payload.properties.map((property) => property.name?.getText(source)),
    ).toEqual([
      'requestId',
      'firstTokenMs',
      'totalMs',
      'promptChars',
      'evidenceChars',
      'meetingSourceCount',
    ]);
    for (const [name, value] of [
      ['promptChars', 'prompt.length'],
      ['evidenceChars', 'context.evidence.length'],
    ] as const) {
      const property = payload.properties.find(
        (property) => property.name?.getText(source) === name,
      );
      expect(
        property && ts.isPropertyAssignment(property)
          ? property.initializer.getText(source)
          : null,
      ).toBe(value);
    }
  });
});
