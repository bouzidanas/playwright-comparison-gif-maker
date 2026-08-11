const { spawnSync } = require('node:child_process');

const targets = {
	'darwin-arm64': 'darwin-arm64',
	'darwin-x64': 'darwin-x64',
	'linux-arm64': 'linux-arm64',
	'linux-x64': 'linux-x64',
	'win32-arm64': 'win32-arm64',
	'win32-x64': 'win32-x64',
};

const key = `${process.platform}-${process.arch}`;
const target = targets[key];
if (!target) {
	console.error(`Unsupported VSIX target: ${key}`);
	process.exit(1);
}

const command = process.platform === 'win32' ? 'vsce.cmd' : 'vsce';
const result = spawnSync(command, [
	'package',
	'--target', target,
	'--allow-missing-repository',
	'--skip-license',
], { stdio: 'inherit' });

process.exit(result.status ?? 1);