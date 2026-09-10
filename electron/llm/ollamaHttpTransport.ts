import { request as httpRequest } from 'node:http';
import { StringDecoder } from 'node:string_decoder';

const OLLAMA_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export const ollamaHttpFetch = (
  input: string,
  init: RequestInit = {},
  maxResponseBytes = OLLAMA_MAX_RESPONSE_BYTES,
): Promise<Response> =>
  new Promise((resolve, reject) => {
    const url = new URL(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const request = httpRequest(
      url,
      {
        method: init.method,
        headers,
        signal: init.signal ?? undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.set(name, value);
          }
        }
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > maxResponseBytes) {
            reject(
              new Error(
                `Ollama response exceeded ${maxResponseBytes} byte limit`,
              ),
            );
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('aborted', () =>
          reject(new Error('Ollama response aborted before completion')),
        );
        response.on('error', reject);
        response.on('end', () => {
          if (!response.complete) {
            reject(new Error('Ollama response aborted before completion'));
            return;
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage,
              headers: responseHeaders,
            }),
          );
        });
      },
    );

    request.on('error', reject);
    if (typeof init.body === 'string' || init.body instanceof Uint8Array) {
      request.write(init.body);
    } else if (init.body != null) {
      request.destroy(new Error('Unsupported Ollama request body'));
      return;
    }
    request.end();
  });

export const ollamaHttpStream = (
  input: string,
  init: RequestInit,
  onChunk: (chunk: string) => unknown,
  maxResponseBytes = OLLAMA_MAX_RESPONSE_BYTES,
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  errorBody?: string;
}> =>
  new Promise((resolve, reject) => {
    const url = new URL(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const request = httpRequest(
      url,
      {
        method: init.method,
        headers,
        signal: init.signal ?? undefined,
      },
      (response) => {
        let receivedBytes = 0;
        const decoder = new StringDecoder('utf8');
        let errorBody = '';
        const ok =
          response.statusCode !== undefined &&
          response.statusCode >= 200 &&
          response.statusCode < 300;
        const deliver = (chunk: string) => {
          if (!chunk) return true;
          if (!ok) {
            // Still subject to maxResponseBytes; never emit errors as tokens.
            errorBody += chunk;
            return true;
          }
          try {
            if (onChunk(chunk) === false) {
              resolve({
                ok,
                status: response.statusCode ?? 500,
                statusText: response.statusMessage || 'Unknown response',
              });
              response.destroy();
              return false;
            }
            return true;
          } catch (error) {
            reject(error);
            response.destroy();
            return false;
          }
        };
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > maxResponseBytes) {
            reject(
              new Error(
                `Ollama response exceeded ${maxResponseBytes} byte limit`,
              ),
            );
            response.destroy();
            return;
          }
          const decoded = decoder.write(chunk);
          deliver(decoded);
        });
        response.on('aborted', () =>
          reject(new Error('Ollama response aborted before completion')),
        );
        response.on('error', reject);
        response.on('end', () => {
          if (!response.complete) {
            reject(new Error('Ollama response aborted before completion'));
            return;
          }
          const trailing = decoder.end();
          if (!deliver(trailing)) return;
          resolve({
            ok,
            status: response.statusCode ?? 500,
            statusText: response.statusMessage || 'Unknown response',
            ...(!ok ? { errorBody } : {}),
          });
        });
      },
    );

    request.on('error', reject);
    if (typeof init.body === 'string' || init.body instanceof Uint8Array) {
      request.write(init.body);
    } else if (init.body != null) {
      request.destroy(new Error('Unsupported Ollama request body'));
      return;
    }
    request.end();
  });
