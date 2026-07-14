const FILENAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const FIELD_PATTERN = /^- \*\*(Issue|PR|Changed|Why|Replaced|Notes):\*\*(?:\s+(.*))?$/;
const REQUIRED_FIELDS = ['Issue', 'PR', 'Changed', 'Why', 'Replaced', 'Notes'];
const MERGE_MARKER_PATTERN = /^(?:<<<<<<<|=======|>>>>>>>)(?:\s|$)/m;

const isCalendarDate = (value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

const inspectFragment = ({ path, body }) => {
  const errors = [];
  const filename = path.split('/').at(-1) ?? path;
  const filenameMatch = filename.match(FILENAME_PATTERN);
  const metadata = filenameMatch
    ? { date: filenameMatch[1], issue: Number(filenameMatch[2]), path, body }
    : null;

  if (!filenameMatch) {
    errors.push(
      `${path}: filename must match YYYY-MM-DD-<issue-number>-<short-slug>.md`,
    );
  } else if (!isCalendarDate(filenameMatch[1])) {
    errors.push(`${path}: filename contains invalid calendar date ${filenameMatch[1]}`);
  }

  if (MERGE_MARKER_PATTERN.test(body)) {
    errors.push(`${path}: contains an unresolved merge marker`);
  }

  const entryHeadings = body.match(/^###\s+\S.*$/gm) ?? [];
  if (entryHeadings.length !== 1) {
    errors.push(`${path}: must contain exactly one entry heading`);
  }

  const fields = body
    .split(/\r?\n/)
    .map((line, index) => ({ match: line.match(FIELD_PATTERN), line: index + 1 }))
    .filter(({ match }) => match);

  for (const name of REQUIRED_FIELDS) {
    const matching = fields.filter(({ match }) => match[1] === name);
    if (matching.length === 0) {
      errors.push(`${path}: missing required ${name} field`);
    } else if (matching.length > 1) {
      errors.push(`${path}: ${name} field appears more than once`);
    } else if (!(matching[0].match[2] ?? '').trim()) {
      errors.push(`${path}: ${name} field must not be empty`);
    }
  }

  const actualOrder = fields.map(({ match }) => match[1]);
  if (
    actualOrder.length === REQUIRED_FIELDS.length &&
    actualOrder.some((name, index) => name !== REQUIRED_FIELDS[index])
  ) {
    errors.push(`${path}: fields must appear in ${REQUIRED_FIELDS.join(', ')} order`);
  }

  const issueFields = fields.filter(({ match }) => match[1] === 'Issue');
  if (metadata && issueFields.length === 1) {
    const issueValue = issueFields[0].match[2] ?? '';
    const issueMatch = issueValue.match(/#(\d+)/);
    if (!issueMatch) {
      errors.push(`${path}: Issue field must contain an issue number such as #${metadata.issue}`);
    } else if (Number(issueMatch[1]) !== metadata.issue) {
      errors.push(
        `${path}: Issue field #${issueMatch[1]} does not match filename issue #${metadata.issue}`,
      );
    }
  }

  return { errors, metadata };
};

export const validateFragments = (fragments) => {
  const errors = [];
  const issueOwners = new Map();

  for (const fragment of fragments) {
    const inspected = inspectFragment(fragment);
    errors.push(...inspected.errors);
    if (!inspected.metadata) continue;

    const existingPath = issueOwners.get(inspected.metadata.issue);
    if (existingPath) {
      errors.push(
        `${fragment.path}: duplicate issue #${inspected.metadata.issue}; already used by ${existingPath}`,
      );
    } else {
      issueOwners.set(inspected.metadata.issue, fragment.path);
    }
  }

  return errors;
};

const INTRODUCTION = `# Pluto Product/Development Journal

<!-- Generated from docs/changelog/entries. Do not edit this output directly. -->

This is Pluto's human-readable development journal. It is not a formal release-notes file.`;

export const assembleChangelog = (fragments) => {
  const errors = validateFragments(fragments);
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  const entries = fragments
    .map((fragment) => inspectFragment(fragment).metadata)
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        right.issue - left.issue ||
        left.path.localeCompare(right.path),
    );
  const sections = [];
  let currentDate = null;

  for (const entry of entries) {
    if (entry.date !== currentDate) {
      sections.push(`## ${entry.date}`);
      currentDate = entry.date;
    }
    sections.push(entry.body.trim());
  }

  return `${[INTRODUCTION, ...sections].join('\n\n')}\n`;
};
