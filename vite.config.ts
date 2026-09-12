import os from 'node:os';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';
import { resolveDevelopmentUserDataDir } from './electron/appRuntimePolicy';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '127.0.0.1',
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        activeCallAlert: path.resolve(__dirname, 'active-call-alert.html'),
      },
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: {
          bootstrap: 'electron/bootstrap.ts',
          encryptedAudioWorker: 'electron/crypto/encryptedAudioWorker.ts',
        },
        onstart({ startup }) {
          const userDataDir = resolveDevelopmentUserDataDir({
            explicit: process.env.PLUTO_USER_DATA_DIR,
            tempDir: os.tmpdir(),
          });
          return startup(['.', `--user-data-dir=${userDataDir}`]);
        },
        vite: {
          build: {
            rollupOptions: {
              external: [
                // Keep ws optional native imports inside its runtime try/catch fallback.
                'bufferutil',
                'utf-8-validate',
                'better-sqlite3',
                'better-sqlite3-multiple-ciphers',
                'ffmpeg-static',
                '@ffprobe-installer/ffprobe',
              ],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer:
        process.env.NODE_ENV === 'test'
          ? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
            undefined
          : {},
    }),
  ],
});
