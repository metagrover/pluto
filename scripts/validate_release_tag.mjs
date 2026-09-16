import fs from 'node:fs';

const tag = process.argv[2]?.trim();
const packageJsonPath = process.argv[3] ?? 'package.json';
if (!tag || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
  throw new Error('Release tag must be a stable vMAJOR.MINOR.PATCH tag');
}
const packageVersion = JSON.parse(
  fs.readFileSync(packageJsonPath, 'utf8'),
).version;
if (tag.slice(1) !== packageVersion) {
  throw new Error(
    `Tag ${tag} does not match package.json version ${packageVersion}`,
  );
}
process.stdout.write(`${packageVersion}\n`);
