import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BULK_ADVISORY_URL =
  'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const SEVERITY_RANK = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const dependencyRecord = (node) => {
  if (!node || typeof node !== 'object') return {};
  if (!('dependencies' in node) || !node.dependencies) return {};
  return node.dependencies;
};

const collectVersions = (node, packages, fallbackName = null) => {
  if (!node || typeof node !== 'object') return;

  const name =
    typeof node.name === 'string' ? node.name : (fallbackName ?? null);
  const version = typeof node.version === 'string' ? node.version : null;
  const isPrivateRoot = node.private === true;
  if (name && version && !isPrivateRoot) {
    if (!packages[name]) packages[name] = new Set();
    packages[name].add(version);
  }

  for (const [dependencyName, dependency] of Object.entries(
    dependencyRecord(node),
  )) {
    collectVersions(dependency, packages, dependencyName);
  }
};

export function collectPackageVersionsFromPnpmList(tree) {
  const roots = Array.isArray(tree) ? tree : [tree];
  const packages = {};

  for (const root of roots) {
    collectVersions(root, packages);
  }

  return Object.fromEntries(
    Object.entries(packages)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, versions]) => [name, [...versions].sort()]),
  );
}

export function findAdvisoriesAtOrAboveSeverity(
  advisoriesByPackage,
  minimumSeverity,
) {
  const minimumRank = SEVERITY_RANK[minimumSeverity];

  return Object.entries(advisoriesByPackage)
    .flatMap(([packageName, advisories]) =>
      (Array.isArray(advisories) ? advisories : [])
        .filter((advisory) => {
          const severity = advisory?.severity;
          return (
            typeof severity === 'string' &&
            SEVERITY_RANK[severity] >= minimumRank
          );
        })
        .map((advisory) => ({ packageName, advisory })),
    )
    .sort((left, right) => {
      const severityDelta =
        SEVERITY_RANK[right.advisory.severity] -
        SEVERITY_RANK[left.advisory.severity];
      if (severityDelta !== 0) return severityDelta;
      return left.packageName.localeCompare(right.packageName);
    });
}

async function loadInstalledDependencyTree() {
  const { stdout } = await execFileAsync(
    'pnpm',
    ['list', '--json', '--depth', 'Infinity'],
    {
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  return JSON.parse(stdout);
}

async function fetchBulkAdvisories(payload) {
  const response = await fetch(BULK_ADVISORY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Bulk advisory request failed (${response.status} ${response.statusText}): ${body}`,
    );
  }

  return response.json();
}

function formatFindings(findings) {
  return findings.map(({ packageName, advisory }) => {
    const title =
      typeof advisory.title === 'string' ? advisory.title : 'Untitled advisory';
    const versions =
      typeof advisory.vulnerable_versions === 'string'
        ? advisory.vulnerable_versions
        : 'unknown versions';
    const url = typeof advisory.url === 'string' ? advisory.url : '';
    return `- ${advisory.severity.toUpperCase()} ${packageName}: ${title} (${versions})${url ? ` ${url}` : ''}`;
  });
}

async function main() {
  const minimumSeverity = 'high';
  const tree = await loadInstalledDependencyTree();
  const payload = collectPackageVersionsFromPnpmList(tree);
  const packageCount = Object.keys(payload).length;

  const advisoriesByPackage = await fetchBulkAdvisories(payload);
  const findings = findAdvisoriesAtOrAboveSeverity(
    advisoriesByPackage,
    minimumSeverity,
  );

  if (findings.length === 0) {
    console.log(
      `No ${minimumSeverity} severity advisories found across ${packageCount} installed packages.`,
    );
    return;
  }

  console.error(
    [
      `Found ${findings.length} ${minimumSeverity}+ advisories across ${packageCount} installed packages:`,
      ...formatFindings(findings),
    ].join('\n'),
  );
  process.exitCode = 1;
}

const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
