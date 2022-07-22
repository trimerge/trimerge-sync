import { EOL } from 'os';
import { resolve } from 'path';
import fs from 'fs-extra';
import prettier from 'prettier';
import { createInterface } from 'readline';
import { spawnSync } from 'child_process';

const rl = createInterface({ input: process.stdin, output: process.stdout });
function readLine(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

const root = resolve('.');
const spawnOptions = { cwd: root, shell: true };

async function getPackages(packagesRoot) {
  const result = [];
  for (const packageName of await fs.readdir(packagesRoot, {
    withFileTypes: true,
  })) {
    if (packageName.isDirectory() && packageName.name[0] !== '.') {
      result.push({
        name: packageName.name,
        packageJsonPath: getPackageJsonPath({
          name: packageName.name,
          root: packagesRoot,
        }),
      });
    }
  }
  return result;
}

function getPackageJsonPath(packageObj) {
  return resolve(packageObj.root, packageObj.name, 'package.json');
}

const packages = [
  ...(await getPackages(resolve(root, 'packages'))),
  ...(await getPackages(resolve(root, 'examples'))),
];

function* iterateDependencies(json) {
  for (const dependencyType of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
  ]) {
    if (!json[dependencyType]) {
      continue;
    }
    for (const { name: dependencyName } of packages) {
      if (json[dependencyType][dependencyName]) {
        yield { dependencyType, dependencyName };
      }
    }
  }
}

for (const { name: packageName, packageJsonPath } of packages) {
  const json = await fs.readJson(packageJsonPath);
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

for (const { name, packageJsonPath } of packages) {
  console.log(`Setting ${name} to version ${newVersion}`);
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

  console.log(`Committing version change to git...`);
  spawnSync(`git`, ['add', packageJsonPath], spawnOptions);
}

spawnSync(`git`, ['commit', '-m', `"v${newVersion}"`], spawnOptions);
spawnSync(`git`, ['tag', `"v${newVersion}"`], spawnOptions);
rl.close();
