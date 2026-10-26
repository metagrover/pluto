import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { writeOwnerOnlyPrivateFile } from '../../scripts/lib/privateEvaluationFile';
import {
  type Observations,
  fingerprint,
  parseRealMeetingCase,
  scoreRealMeeting,
} from '../../scripts/lib/realMeetingE2E';

// Opt-in: real Electron IPC, database, inference, and persisted projections.
const suite =
  process.env.RUN_REAL_MEETING_E2E === '1' ? describe : describe.skip;
const privateRoot = path.resolve('.private/real-meeting-e2e');
const timeoutMs = 20 * 60_000;

class Renderer {
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(private socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const packet = JSON.parse(String(event.data));
      const pending = this.pending.get(packet.id);
      if (!pending) return;
      this.pending.delete(packet.id);
      clearTimeout(pending.timer);
      if (packet.error || packet.result?.exceptionDetails)
        pending.reject(
          new Error(
            packet.error?.message ||
              packet.result.exceptionDetails.exception?.description ||
              'renderer_ipc_failed',
          ),
        );
      else pending.resolve(packet.result?.result?.value);
    });
    socket.addEventListener('close', () => this.close());
  }
  static async connect(port: number) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const targets = await (
          await fetch(`http://127.0.0.1:${port}/json/list`, {
            signal: AbortSignal.timeout(2_000),
          })
        ).json();
        const target = targets.find(
          (t: any) =>
            t.type === 'page' &&
            (/^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(t.url) ||
              t.url.startsWith('file://')) &&
            !t.url.includes('active-call-alert'),
        );
        if (target) {
          const socket = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise<void>((resolve, reject) => {
            socket.addEventListener('open', () => resolve(), { once: true });
            socket.addEventListener(
              'error',
              () => reject(new Error('renderer_connection_failed')),
              { once: true },
            );
          });
          const renderer = new Renderer(socket);
          try {
            await renderer.invoke('GET_MEETINGS');
            return renderer;
          } catch {
            renderer.close();
          }
        }
      } catch {
        /* Startup and migrations may still be running. */
      }
      await sleep(500);
    }
    throw new Error('renderer_startup_timeout');
  }
  invoke(channel: string, ...args: unknown[]): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('renderer_ipc_timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: {
            expression: `window.ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
    });
  }
  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('renderer_closed'));
    }
    this.pending.clear();
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}

suite('private real meeting E2E', () => {
  it(
    'regenerates notes and checks commitments, Projects, People, and chat',
    async () => {
      const requested =
        process.env.REAL_MEETING_E2E_CASE ||
        path.join(privateRoot, 'case.json');
      const casePath = fs.realpathSync(requested);
      if (!casePath.startsWith(`${fs.realpathSync(privateRoot)}${path.sep}`))
        throw new Error('case_must_be_inside_private_real_meeting_e2e');
      const fixture = parseRealMeetingCase(
        JSON.parse(fs.readFileSync(casePath, 'utf8')),
      );
      const packagedApp = process.env.REAL_MEETING_E2E_APP
        ? fs.realpathSync(process.env.REAL_MEETING_E2E_APP)
        : undefined;
      const executable = packagedApp
        ? path.join(packagedApp, 'Contents/MacOS/Pluto')
        : 'pnpm';
      if (packagedApp && !fs.statSync(executable).isFile())
        throw new Error('packaged_app_executable_unavailable');
      fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
      const runDir = fs.mkdtempSync(path.join(privateRoot, 'run-'));
      fs.chmodSync(runDir, 0o700);
      const profile = path.join(runDir, 'profile');
      fs.mkdirSync(profile, { mode: 0o700 });
      // A new, disposable local profile needs no production key or database copy.
      writeOwnerOnlyPrivateFile(
        path.join(profile, 'database-storage.json'),
        JSON.stringify({
          version: 1,
          mode: 'standard',
          initialized: false,
        }),
      );
      const report: any = {
        caseSha256: fingerprint(fixture),
        sourceSha256: fingerprint(fixture.meeting.transcript_json),
        model: fixture.model,
        fastModel: fixture.fastModel,
        startedAt: new Date().toISOString(),
        scope:
          'Saved validated transcript through Electron IPC; excludes capture/transcription and visual UI.',
        runtime: packagedApp ? 'packaged' : 'source',
        stages: [],
        checks: [],
        expectations: fixture.checks,
        semanticReview: 'pending_source_review',
      };
      const observations: Observations = {
        notes: [],
        commitments: [],
        projects: [],
        people: [],
        chat: [],
      };
      const saveReport = () =>
        writeOwnerOnlyPrivateFile(
          path.join(runDir, 'report.json'),
          JSON.stringify({ ...report, observations }, null, 2),
        );
      const stage = async (name: string, work: () => Promise<void>) => {
        const entry: any = {
          name,
          status: 'running',
          startedAt: new Date().toISOString(),
        };
        report.stages.push(entry);
        saveReport();
        console.log(`[RealMeetingE2E] ${name}`);
        try {
          await work();
          entry.status = 'passed';
        } catch (error) {
          entry.status = 'failed';
          entry.error = String(error);
        } finally {
          entry.finishedAt = new Date().toISOString();
          saveReport();
        }
        return entry.status === 'passed';
      };
      const port = Number(process.env.REAL_MEETING_E2E_PORT || 9367);
      if (!Number.isInteger(port) || port < 1024 || port > 65535)
        throw new Error('invalid_e2e_port');
      // Refuse an occupied endpoint so no mutation can reach an unrelated app.
      const net = await import('node:net');
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const log = fs.openSync(path.join(runDir, 'runtime.log'), 'wx', 0o600);
      const child = spawn(
        executable,
        packagedApp
          ? [
              `--user-data-dir=${profile}`,
              `--remote-debugging-port=${port}`,
              '--remote-debugging-address=127.0.0.1',
            ]
          : ['run', 'dev'],
        {
          cwd: process.cwd(),
          detached: true,
          stdio: ['ignore', log, log],
          env: {
            ...process.env,
            VITEST: '',
            PLUTO_USER_DATA_DIR: profile,
            PLUTO_REMOTE_DEBUGGING_PORT: String(port),
          },
        },
      );
      fs.closeSync(log);
      const childExited = once(child, 'exit');
      void childExited.catch(() => {});
      const stop = () => {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid)
          return;
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      };
      const watchdog = setTimeout(stop, 60 * 60_000);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      let renderer: Renderer | undefined;
      const meetingId = 'real-meeting-e2e-source';
      try {
        const inventory = await (
          await fetch('http://127.0.0.1:11434/api/tags', {
            signal: AbortSignal.timeout(5_000),
          })
        ).json();
        report.models = [fixture.model, fixture.fastModel].map((name) => {
          const model = inventory.models?.find((m: any) => m.name === name);
          if (!model?.digest) throw new Error('local_e2e_model_not_installed');
          return { name, digest: model.digest };
        });
        renderer = await Renderer.connect(port);
        const ipc = renderer.invoke.bind(renderer);
        const seeded = await stage('seed', async () => {
          if ((await ipc('GET_MEETINGS')).length)
            throw new Error('profile_not_empty');
          for (const [key, value] of Object.entries({
            llm_provider: 'ollama',
            ollama_model: fixture.model,
            ollama_fast_model: fixture.fastModel,
          }))
            await ipc('SET_SETTING', { key, value });
          await ipc('SAVE_MEETING', { ...fixture.meeting, id: meetingId });
          const saved = await ipc('GET_MEETING', meetingId);
          if (
            !saved ||
            saved.analysis_json ||
            saved.enhanced_notes ||
            saved.transcript_json !== fixture.meeting.transcript_json
          )
            throw new Error('seed_source_changed_or_contains_generated_notes');
        });
        if (!seeded) throw new Error('seed_failed');
        const generated = await stage('notes-and-secondary', async () => {
          const result = await ipc('GENERATE_MEETING_NOTES', {
            meetingId,
            requestId: `e2e-${Date.now()}`,
            reason: 'manual',
          });
          if (result?.status !== 'published')
            throw new Error('notes_not_published');
          observations.notes = [
            JSON.parse((await ipc('GET_MEETING', meetingId)).analysis_json),
          ];
          saveReport();
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const saved = await ipc('GET_MEETING', meetingId);
            const run = JSON.parse(saved.analysis_run_json || 'null');
            if (run?.run_id !== result.runId)
              throw new Error('notes_run_superseded');
            if (run.secondary_status === 'failed')
              throw new Error('secondary_failed');
            if (run.secondary_status === 'complete') {
              if (saved.transcript_json !== fixture.meeting.transcript_json)
                throw new Error('source_changed_during_generation');
              observations.notes = [JSON.parse(saved.analysis_json)];
              observations.commitments = (
                await ipc('GET_MEETING_ENTITIES', meetingId)
              ).filter((e: any) => e.type === 'action_item');
              return;
            }
            await sleep(1_000);
          }
          throw new Error('secondary_timeout');
        });
        if (generated)
          await stage('people-and-projects', async () => {
            await ipc('REFRESH_KNOWLEDGE_FOR_MEETING_NOW', meetingId);
            const deadline = Date.now() + timeoutMs;
            let result: any;
            do {
              result = await ipc('DISCOVER_PROJECT_INITIATIVE', {
                retryFailed: true,
              });
              if (result.failed || result.deferred)
                throw new Error('project_synthesis_incomplete');
            } while (
              (result.remaining || result.routingRemaining) &&
              Date.now() < deadline
            );
            if (result.remaining || result.routingRemaining)
              throw new Error('project_synthesis_timeout');
            for (const person of await ipc('GET_PEOPLE_BRIEFING_SUMMARIES')) {
              let detail = await ipc('GET_PERSON_BRIEFING', person.id);
              if (detail?.meetings?.some((m: any) => m.id === meetingId)) {
                if (!detail.isSelf) {
                  expect(detail.knowledgeDoc?.id).toBeTruthy();
                  const refreshed = await ipc(
                    'REFRESH_KNOWLEDGE_DOC',
                    detail.knowledgeDoc.id,
                  );
                  expect(refreshed?.status).toBe('up_to_date');
                  detail = await ipc('GET_PERSON_BRIEFING', person.id);
                }
                observations.people.push(detail);
              }
            }
            for (const project of await ipc('GET_PROJECT_PORTFOLIO')) {
              const brief = await ipc('GET_PROJECT_BRIEF', project.id);
              if (brief?.meetings?.some((m: any) => m.id === meetingId))
                observations.projects.push(brief);
            }
          });
        if (generated)
          await stage('chat', async () => {
            await ipc('intelligence:query:session-active', true);
            await ipc('intelligence:query:new-conversation');
            const priorTurns: unknown[] = [];
            for (const question of fixture.questions) {
              const response = await ipc('intelligence:query', {
                requestId: `e2e-${question.id}-${Date.now()}`,
                query: question.query,
                modeOverride: 'auto',
                priorTurns,
              });
              observations.chat.push({ questionId: question.id, ...response });
              saveReport();
              if (
                response.outcome !== 'answered' ||
                !response.answer?.trim() ||
                !response.citations?.some(
                  (c: any) => c.meeting_id === meetingId,
                ) ||
                (response.unsupportedClaimCount || 0) > 0
              )
                throw new Error(`chat_not_grounded_${question.id}`);
              priorTurns.push(
                { role: 'user', content: question.query },
                {
                  role: 'assistant',
                  content: response.answer,
                  meetingIds: [meetingId],
                  outcome: response.outcome,
                  resolvedScope: response.resolvedScope,
                  conversationContext: response.conversationContext,
                },
              );
            }
            await ipc('intelligence:query:session-active', false);
          });
      } catch (error) {
        report.fatalError = String(error);
      } finally {
        if (renderer) {
          try {
            report.finalMeeting = await renderer.invoke(
              'GET_MEETING',
              meetingId,
            );
          } catch {
            report.finalSnapshotUnavailable = true;
          }
        }
        renderer?.close();
        clearTimeout(watchdog);
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
        if (child.exitCode === null && child.signalCode === null && child.pid) {
          stop();
          await Promise.race([childExited, sleep(5_000)]);
          if (child.exitCode === null && child.signalCode === null) {
            process.kill(-child.pid, 'SIGKILL');
            await childExited;
          }
        }
        report.checks = scoreRealMeeting(fixture, observations);
        for (const name of ['people-and-projects', 'chat']) {
          if (!report.stages.some((s: any) => s.name === name))
            report.stages.push({
              name,
              status: 'blocked',
              reason: 'fresh_notes_or_secondary_unavailable',
            });
        }
        report.passed =
          !report.fatalError &&
          report.stages.length === 4 &&
          report.stages.every((s: any) => s.status === 'passed') &&
          report.checks.every((c: any) => c.passed);
        report.finishedAt = new Date().toISOString();
        saveReport();
        console.log(
          `[RealMeetingE2E] private report: ${path.relative(process.cwd(), runDir)}/report.json`,
        );
      }
      // Never let Vitest print private expected/actual values on failure.
      expect(
        report.passed,
        'Real meeting E2E failed; inspect the private report.',
      ).toBe(true);
    },
    90 * 60_000,
  );
});
