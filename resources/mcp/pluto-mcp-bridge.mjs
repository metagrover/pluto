// Node 20+. A stdio MCP client bridge; Pluto owns the database and authorization.
import fs from 'node:fs';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--connection' || !args[1]) {
  process.stderr.write(
    'Usage: node pluto-mcp-bridge.mjs --connection /path/to/connection.json\n',
  );
  process.exit(1);
}
const connectionFile = args[1];

function readConnection() {
  const fd = fs.openSync(
    connectionFile,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size > 64 * 1024 ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    ) {
      throw new Error('invalid_connection_file');
    }
    const connection = JSON.parse(fs.readFileSync(fd, 'utf8'));
    const endpoint = new URL(connection.endpoint);
    if (
      endpoint.protocol !== 'http:' ||
      endpoint.hostname !== '127.0.0.1' ||
      !endpoint.port ||
      endpoint.pathname !== '/mcp' ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.username ||
      endpoint.password ||
      typeof connection.token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(connection.token)
    ) {
      throw new Error('invalid_connection');
    }
    return connection;
  } finally {
    fs.closeSync(fd);
  }
}

async function forward(line) {
  let request;
  try {
    request = JSON.parse(line);
    if (
      !request ||
      Array.isArray(request) ||
      request.jsonrpc !== '2.0' ||
      typeof request.method !== 'string' ||
      (request.id !== undefined &&
        typeof request.id !== 'string' &&
        typeof request.id !== 'number')
    ) {
      throw new Error('invalid_request');
    }
  } catch {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid MCP request.' } })}\n`,
    );
    return;
  }
  try {
    // Discovery must not wait for a busy application or a preceding data read.
    // Notifications need no forwarding: the HTTP service is stateless.
    if (request.id === undefined) return;
    const { endpoint, token, discovery } = readConnection();
    if (discovery) {
      let result;
      if (request.method === 'initialize') {
        const requested = request.params?.protocolVersion;
        result = {
          ...discovery.initialize,
          protocolVersion: discovery.protocolVersions.includes(requested)
            ? requested
            : discovery.protocolVersions[0],
        };
      } else if (request.method === 'tools/list') {
        result = discovery.tools;
      } else if (request.method === 'ping') {
        result = {};
      }
      if (result) {
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`,
        );
        return;
      }
    }
    // Reload on every read so disable/restart revokes or rotates access.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: line,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('local_service_unavailable');
    if (request.id === undefined) {
      await response.body?.cancel();
      return;
    }
    if (!response.body) throw new Error('empty_response');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
      chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (result.jsonrpc !== '2.0' || result.id !== request.id)
      throw new Error('invalid_response');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    if (request.id !== undefined) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Pluto is unavailable. Open Pluto and enable the ChatGPT connection in Settings.' } })}\n`,
      );
    }
  }
}

// Bound data work without blocking discovery behind an outstanding request.
const inFlight = new Set();
function dispatch(line) {
  if (inFlight.size >= 8) {
    // The bounded overload response contains no request arguments or note data.
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      /* forward reports invalid JSON */
    }
    if (!['initialize', 'tools/list', 'ping'].includes(request?.method)) {
      if (request.id !== undefined)
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Pluto is busy. Try again shortly.' } })}\n`,
        );
      return;
    }
  }
  const work = forward(line);
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
}
let pending = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  pending = Buffer.concat([pending, chunk]);
  let newline = pending.indexOf(10);
  while (newline !== -1) {
    if (newline > MAX_REQUEST_BYTES) {
      process.stderr.write('MCP request exceeds the size limit.\n');
      process.exit(1);
    }
    const line = pending.subarray(0, newline).toString('utf8').trim();
    pending = pending.subarray(newline + 1);
    if (line) dispatch(line);
    newline = pending.indexOf(10);
  }
  if (pending.length > MAX_REQUEST_BYTES) {
    process.stderr.write('MCP request exceeds the size limit.\n');
    process.exit(1);
  }
}
if (pending.length) dispatch(pending.toString('utf8'));
await Promise.all(inFlight);
