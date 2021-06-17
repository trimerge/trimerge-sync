import { EOL } from 'os';
import { resolve } from 'path';
import fs from 'fs-extra';
import prettier from 'prettier';
import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });
function readLine(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

const packagesRoot = resolve('packages');
const packageNames = (await fs.readdir(packagesRoot, { withFileTypes: true }))
  .filter((x) => x.isDirectory() && x.name[0] !== '.')
  .map(({ name }) => name);

function* iterateDependencies(json) {
  for (const dependencyType of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
  ]) {
    if (!json[dependencyType]) {
      continue;
    }
    for (const dependencyName of packageNames) {
      if (json[dependencyType][dependencyName]) {
        yield { dependencyType, dependencyName };
      }
    }
  }
}

function getPackageJsonPath(packageName) {
  return resolve(packagesRoot, packageName, 'package.json');
}

for (const packageName of packageNames) {
  const json = await fs.readJson(getPackageJsonPath(packageName));
  console.log(`Found package ${packageName} version ${json.version}`);
  for (const { dependencyType, dependencyName } of iterateDependencies(json)) {
    console.log(
      `  -> ${dependencyType} ${dependencyName}: ${json[dependencyType][dependencyName]}`,
    );
  }
}

const newVersion = await readLine(`Enter the new version:${EOL}`);
// Check if the version is valid
if (!newVersion) {
  console.log(`${newVersion} is not a valid semantic version. Try again.`);
  process.exit(1);
}

const prettierConfig = await fs.readJson('./.prettierrc');

for (const name of packageNames) {
  console.log(`Setting ${name} to version ${newVersion}`);
  const packageJsonPath = getPackageJsonPath(name);
  const json = await fs.readJson(packageJsonPath);
  console.log(`Set ${name} version -> ${newVersion}`);
  json.version = newVersion;
  for (const { dependencyType, dependencyName } of iterateDependencies(json)) {
    console.log(
      `Set ${name} ${dependencyType} ${dependencyName} -> ${newVersion}`,
    );
    json[dependencyType][dependencyName] = newVersion;
  }
  console.log(`Writing out to ${packageJsonPath}…`);
  await fs.writeFile(
    packageJsonPath,
    prettier.format(JSON.stringify(json), {
      ...prettierConfig,
      parser: 'json',
    }),
  );
}
rl.close();
