import * as assert from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { ComparisonRunner } from '../comparisonRunner';
import type { ComparisonRequest } from '../model';

const execFileAsync = promisify(execFile);

suite('Comparison runner end to end', function () {
	this.timeout(180_000);

	test('records and renders a dirty working tree against HEAD', async function () {
		if (process.env.PR_UI_COMPARE_E2E !== '1') {
			this.skip();
		}

		const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-compare-repo-'));
		const storagePath = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-compare-storage-'));
		const output = vscode.window.createOutputChannel('PR UI Compare E2E');
		try {
			await createFixtureRepository(repositoryPath);
			const request: ComparisonRequest = {
				baseRef: 'HEAD',
				startCommand: 'node server.js {port}',
				readyUrl: 'http://127.0.0.1:{port}',
				beforeLabel: 'Before',
				afterLabel: 'After',
				beforeLabelAlignment: 'bottom-left',
				afterLabelAlignment: 'bottom-right',
				borderColor: '#2f81f7',
				frameRate: 30,
				viewport: { width: 640, height: 480 },
				scenario: {
					name: 'Responsive panel fix',
					actions: [
						{ type: 'hold', durationMs: 300 },
						{ type: 'resize', width: 360, height: 480, movingEdge: 'left', durationMs: 500, holdAfterMs: 300 },
						{ type: 'resize', width: 640, height: 480, movingEdge: 'left', durationMs: 500, holdAfterMs: 300 },
						{ type: 'zoom', locator: 'role=button[name="Toggle panel"]', scale: 1.8, durationMs: 500, holdAfterMs: 300 },
						{ type: 'click', locator: 'role=button[name="Toggle panel"]', holdAfterMs: 700 },
						{ type: 'zoom', scale: 1, durationMs: 500, holdAfterMs: 300 },
					],
				},
			};
			const runner = new ComparisonRunner(storagePath, output);
			const result = await runner.run(
				repositoryPath,
				request,
				new vscode.CancellationTokenSource().token,
				() => undefined,
			);

			assert.strictEqual(result.candidateDirty, true);
			if (result.outputMode !== 'animation') {
				assert.fail('Expected an animation comparison result.');
			}
			assert.strictEqual(result.layout, 'horizontal');
			assert.strictEqual(result.frameRate, 30);
			assert.match(result.beforeLabel, /^Before \([0-9a-f]{8}\)$/);
			assert.match(result.afterLabel, /^After \([0-9a-f]{8}\)$/);
			assert.ok((await stat(result.gifPath)).size > 1_000);
			assert.ok((await stat(result.beforeGifPath)).size > 1_000);
			assert.ok((await stat(result.afterGifPath)).size > 1_000);
			const session = JSON.parse(await readFile(path.join(result.sessionDirectory, 'session.json'), 'utf8')) as {
				timings: { before: unknown[]; after: unknown[] };
			};
			assert.strictEqual(session.timings.before.length, 6);
			assert.strictEqual(session.timings.after.length, 6);
			await assert.rejects(stat(path.join(result.sessionDirectory, 'before-worktree')));
		} finally {
			output.dispose();
			await rm(repositoryPath, { recursive: true, force: true });
			await rm(storagePath, { recursive: true, force: true });
		}
	});

	test('captures and composes final-state PNG images', async function () {
		if (process.env.PR_UI_COMPARE_E2E !== '1') {
			this.skip();
		}

		const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-compare-image-repo-'));
		const storagePath = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-compare-image-storage-'));
		const output = vscode.window.createOutputChannel('PR UI Compare Image E2E');
		try {
			await createFixtureRepository(repositoryPath);
			const request: ComparisonRequest = {
				outputMode: 'image',
				baseRef: 'HEAD',
				startCommand: 'node server.js {port}',
				readyUrl: 'http://127.0.0.1:{port}',
				beforeLabel: 'Before',
				afterLabel: 'After',
				beforeColorScheme: 'light',
				afterColorScheme: 'dark',
				borderColor: '#30363d',
				viewport: { width: 640, height: 480 },
				scenario: {
					name: 'Static panel comparison',
					actions: [],
				},
			};
			const result = await new ComparisonRunner(storagePath, output).run(
				repositoryPath,
				request,
				new vscode.CancellationTokenSource().token,
				() => undefined,
			);
			if (result.outputMode !== 'image') {
				assert.fail('Expected an image comparison result.');
			}
			assert.strictEqual(result.comparisonPath, result.imagePath);
			assert.strictEqual(result.beforeColorScheme, 'light');
			assert.strictEqual(result.afterColorScheme, 'dark');
			assert.strictEqual(result.beforeObservedColorScheme, 'light');
			assert.strictEqual(result.afterObservedColorScheme, 'dark');
			for (const imagePath of [result.imagePath, result.beforeImagePath, result.afterImagePath]) {
				const image = await readFile(imagePath);
				assert.deepStrictEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
				assert.ok(image.length > 1_000);
			}
			const combined = await readFile(result.imagePath);
			assert.strictEqual(combined.readUInt32BE(16), 972);
			assert.strictEqual(combined.readUInt32BE(20), 366);
			const before = await readFile(result.beforeImagePath);
			assert.strictEqual(before.readUInt32BE(16), 486);
			assert.strictEqual(before.readUInt32BE(20), 366);
			await assert.rejects(stat(path.join(result.sessionDirectory, 'before-worktree')));
		} finally {
			output.dispose();
			await rm(repositoryPath, { recursive: true, force: true });
			await rm(storagePath, { recursive: true, force: true });
		}
	});
});

async function createFixtureRepository(repositoryPath: string): Promise<void> {
	await writeFile(path.join(repositoryPath, 'server.js'), `
const fs = require('node:fs');
const http = require('node:http');
const port = Number(process.argv[2]);
http.createServer((_request, response) => {
  response.setHeader('content-type', 'text/html');
  response.end(fs.readFileSync('index.html'));
}).listen(port, '127.0.0.1');
`, 'utf8');
	await writeFile(path.join(repositoryPath, 'index.html'), fixtureHtml('260px', '#c84b31'), 'utf8');
	await execFileAsync('git', ['init'], { cwd: repositoryPath });
	await execFileAsync('git', ['add', '.'], { cwd: repositoryPath });
	await execFileAsync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'before'], {
		cwd: repositoryPath,
	});
	await writeFile(path.join(repositoryPath, 'index.html'), fixtureHtml('420px', '#2e7d5b'), 'utf8');
}

function fixtureHtml(panelWidth: string, panelColor: string): string {
	return `<!doctype html>
<html>
<head><style>
body { background: #f4f1ea; font: 18px sans-serif; margin: 40px; }
button { font: inherit; padding: 10px 16px; }
#toolbar { align-items: center; background: ${panelColor}; color: white; display: flex; gap: 24px; height: 52px; padding: 0 12px; width: 540px; }
#panel { background: ${panelColor}; color: white; height: 180px; margin-top: 20px; padding: 20px; transition: width 200ms; width: 100px; }
#panel.open { width: ${panelWidth}; }
@media (max-width: 480px) {
	#toolbar { width: calc(100vw - 104px); }
	#panel.open { width: calc(100vw - 120px); }
}
@media (prefers-color-scheme: dark) {
	body { background: #101418; color: #f0f3f6; }
}
</style></head>
<body>
<div id="toolbar"><button aria-label="Toggle panel" onclick="document.getElementById('panel').classList.toggle('open')">Toggle panel</button><span>Project navigation</span></div>
<div id="panel">Comparison fixture</div>
</body>
</html>`;
}
