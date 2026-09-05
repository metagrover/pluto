// child_process cannot execute a path inside Electron's virtual ASAR archive.
// Match the archive directory exactly; dev paths and unpacked paths stay intact.
export const resolveUnpackedExecutablePath = (executablePath: string): string =>
  executablePath.replace(/([\\/])app\.asar([\\/])/u, '$1app.asar.unpacked$2');
