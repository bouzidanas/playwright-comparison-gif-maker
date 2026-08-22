// End-to-end smoke test for the MCP server: builds a fixture repo, then drives
// dist/mcpServer.js over stdio to create a static image comparison.
const { execFile, spawn } = require('node:child_process');
const { mkdtemp, writeFile, rm, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function fixtureHtml(panelColor) {
	return `<!doctype html>
<html>
<head><style>
body { background: #f4f1ea; font: 18px sans-serif; margin: 40px; }
#panel { background: ${panelColor}; color: white; height: 180px; padding: 20px; width: 200px; }
</style></head>
<body><div id="panel">MCP fixture</div></body>
</html>`;
}

async function main() {
	const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-mcp-repo-'));
	const storagePath = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-mcp-storage-'));
	try {
		await writeFile(path.join(repositoryPath, 'server.js'), `
const fs = require('node:fs');
const http = require('node:http');
const port = Number(process.argv[2]);
http.createServer((_request, response) => {
  response.setHeader('content-type', 'text/html');
  response.end(fs.readFileSync('index.html'));
}).listen(port, '127.0.0.1');
`, 'utf8');
		await writeFile(path.join(repositoryPath, 'index.html'), fixtureHtml('#c84b31'), 'utf8');
		await execFileAsync('git', ['init'], { cwd: repositoryPath });
		await execFileAsync('git', ['add', '.'], { cwd: repositoryPath });
		await execFileAsync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'before'], { cwd: repositoryPath });
		await writeFile(path.join(repositoryPath, 'index.html'), fixtureHtml('#2e7d5b'), 'utf8');

		// No --workspace: the fixture repository is addressed per call through workspacePath.
		const child = spawn('node', [path.join(__dirname, '..', 'dist', 'mcpServer.js')], {
			env: { ...process.env, PR_UI_COMPARE_STORAGE_DIR: storagePath },
		});
		child.stderr.on('data', d => process.stderr.write(d));
		let buffer = '';
		let progressCount = 0;
		const pending = new Map();
		child.stdout.on('data', d => {
			buffer += d;
			let idx;
			while ((idx = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 1);
				if (!line.trim()) { continue; }
				const message = JSON.parse(line);
				if (message.method === 'notifications/progress') {
					progressCount += 1;
					continue;
				}
				if (message.id !== undefined && pending.has(message.id)) {
					pending.get(message.id)(message);
					pending.delete(message.id);
				}
			}
		});
		let nextId = 1;
		const request = (method, params, timeoutMs = 240_000) => new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, resolve);
			const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
			pending.set(id, message => { clearTimeout(timer); resolve(message); });
			child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
		});

		await request('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'e2e-smoke', version: '0' },
		});
		child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

		const install = await request('tools/call', { name: 'install_ffmpeg', arguments: {} });
		if (install.result?.isError) {
			throw new Error(`install_ffmpeg failed: ${install.result?.content?.[0]?.text}`);
		}
		console.log(install.result?.content?.[0]?.text);

		const call = await request('tools/call', {
			name: 'create_comparison',
			_meta: { progressToken: 'smoke-progress' },
			arguments: {
				workspacePath: repositoryPath,
				outputMode: 'image',
				baseRef: 'HEAD',
				startCommand: 'node server.js {port}',
				readyUrl: 'http://127.0.0.1:{port}/',
				scenario: { name: 'MCP fixture still', actions: [{ type: 'hold', durationMs: 300 }] },
			},
		});
		child.kill();
		const text = call.result?.content?.[0]?.text ?? '';
		if (call.result?.isError) {
			throw new Error(`create_comparison failed: ${text}`);
		}
		const summary = JSON.parse(text.slice(text.indexOf('{')));
		await stat(summary.comparisonPath);
		await stat(summary.beforePath);
		await stat(summary.afterPath);
		if (!summary.comparisonPath.startsWith(storagePath)) {
			throw new Error(`Artifacts landed outside the storage dir: ${summary.comparisonPath}`);
		}
		if (progressCount === 0) {
			throw new Error('The server sent no progress notifications for a call carrying a progress token.');
		}
		console.log(`MCP e2e smoke passed with ${progressCount} progress notifications:`, summary.comparisonPath);
	} finally {
		await rm(repositoryPath, { recursive: true, force: true });
		await rm(storagePath, { recursive: true, force: true });
	}
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
