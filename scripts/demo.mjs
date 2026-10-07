// Renderer-only demo: never load the Electron plugin, profile, or native services.
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const server = await createServer({
  root,
  configFile: false,
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4187, strictPort: true },
});
await server.listen();
console.log(
  'Fictional Pluto workspace: http://127.0.0.1:4187/?preview=dashboard',
);
