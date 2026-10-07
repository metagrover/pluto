/** Local research only. Vite fixes the release override to zero at build time. */
export const NOTES_EXPERIMENTS_ENABLED =
  process.env.NODE_ENV !== 'production' &&
  process.env.PLUTO_NOTES_EXPERIMENTS !== '0';
