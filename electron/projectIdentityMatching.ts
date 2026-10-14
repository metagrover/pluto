// A label wrapper is not a different initiative. Use this only together with
// shared, saved-note evidence; it is deliberately not fuzzy name matching.
export const projectIdentityName = (name: string): string =>
  name
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/^project\s+/, '')
    .replace(/\s+/g, ' ');
