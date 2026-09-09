import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { renderNotesGemmaPrompt } from './lib/notesGemmaPrompt';

// Read-only tokenization against an already-running, explicitly owned replay
// worker. Never starts a model, discovers shared workers, or changes admission.
async function main() {
  assert.equal(process.argv.length, 4);
  const [runtimeRoot, captureRoot] = process.argv.slice(2);
  for (const root of [runtimeRoot, captureRoot]) {
    assert.ok(path.isAbsolute(root));
    const stat = fs.lstatSync(root);
    assert.ok(
      stat.isDirectory() &&
        stat.uid === process.getuid?.() &&
        (stat.mode & 0o777) === 0o700,
    );
  }
  const read = (root: string, name: string) => {
    const file = path.join(root, name);
    const stat = fs.lstatSync(file);
    assert.ok(
      stat.isFile() &&
        stat.uid === process.getuid?.() &&
        (stat.mode & 0o777) === 0o600,
    );
    return fs.readFileSync(file, 'utf8');
  };
  const isolation = JSON.parse(read(runtimeRoot, 'isolation.json'));
  assert.equal(isolation.status, 'running');
  assert.equal(isolation.endpoint, '127.0.0.1:11435');
  const ports = [
    ...read(runtimeRoot, 'daemon.log').matchAll(
      /starting llama-server.*?--port (\d+)/g,
    ),
  ];
  assert.equal(ports.length, 1, 'single_owned_worker_required');
  const port = Number(ports[0][1]);
  const owner = (value: number) =>
    Number(
      execFileSync(
        '/usr/sbin/lsof',
        ['-t', '-nP', `-iTCP:${value}`, '-sTCP:LISTEN'],
        { encoding: 'utf8', timeout: 3000 },
      ).trim(),
    );
  assert.equal(owner(11435), isolation.daemonPid);
  const worker = owner(port);
  assert.ok(Number.isSafeInteger(worker) && worker > 0);
  assert.equal(
    Number(
      execFileSync('/bin/ps', ['-p', String(worker), '-o', 'ppid='], {
        encoding: 'utf8',
        timeout: 3000,
      }).trim(),
    ),
    isolation.daemonPid,
  );
  const json = async (endpoint: string, body?: unknown) => {
    const response = await fetch(endpoint, {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    assert.ok(response.ok);
    return response.json();
  };
  const version = await json('http://127.0.0.1:11435/api/version');
  assert.equal(version.version, '0.33.3');
  const manifest = JSON.parse(read(captureRoot, 'manifest.json'));
  assert.equal(manifest.model, 'gemma4:12b');
  const resident = await json('http://127.0.0.1:11435/api/ps');
  assert.equal(resident.models.length, 1);
  assert.equal(resident.models[0].digest, manifest.digest);
  const rows = [];
  for (const name of fs
    .readdirSync(captureRoot)
    .filter((name) => /^case-\d+-attempt-\d+-request\.json$/.test(name))
    .sort()) {
    assert.equal(owner(port), worker);
    const request = JSON.parse(read(captureRoot, name));
    const prompt = renderNotesGemmaPrompt(request, version.version);
    const result = await json(`http://127.0.0.1:${port}/tokenize`, {
      content: prompt,
      add_special: false,
      parse_special: true,
    });
    assert.ok(
      Array.isArray(result.tokens) &&
        result.tokens.every((token: unknown) => Number.isSafeInteger(token)),
    );
    const packets = read(
      captureRoot,
      name.replace('-request.json', '-response.ndjson'),
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const terminal = [...packets].reverse().find((packet) => packet.done);
    rows.push({
      attempt: name.replace('-request.json', ''),
      renderedPromptSha256: createHash('sha256').update(prompt).digest('hex'),
      nativeTokens: result.tokens.length,
      observedPromptTokens: terminal?.prompt_eval_count ?? null,
      matchesObserved: terminal
        ? result.tokens.length === terminal.prompt_eval_count
        : null,
    });
  }
  console.log(
    JSON.stringify(
      {
        runtimeVersion: version.version,
        modelDigest: manifest.digest,
        generationRequests: 0,
        admissionDecision: false,
        rows,
      },
      null,
      2,
    ),
  );
}
void main().catch(() => {
  console.error('owned_notes_token_inspection_failed');
  process.exitCode = 1;
});
