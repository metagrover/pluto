/**
 * Applies runtime defaults and reports whether the browser preview IPC
 * fallback is needed. Kept apart from the fallback so the desktop app never
 * loads its preview data.
 */
export const prepareRuntimeEnvironment = (): boolean => {
  if (!window.ipcRenderer && /\bElectron\//.test(navigator.userAgent)) {
    throw new Error(
      'Pluto desktop connection is unavailable: preload did not load.',
    );
  }
  if (!window.plutoRuntimePlatform) {
    const browserPlatform = navigator.platform.toLowerCase();
    window.plutoRuntimePlatform = Object.freeze({
      platform: browserPlatform.includes('mac')
        ? 'darwin'
        : browserPlatform.includes('win')
          ? 'win32'
          : browserPlatform.includes('linux')
            ? 'linux'
            : 'unknown',
      arch: 'unknown',
    });
  }
  return !window.ipcRenderer;
};
