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
				viewport: { width: 640, height: 480 },
				focusLocator: '#toolbar',
				focusPadding: 8,
				scenario: {
					name: 'Responsive panel fix',
					actions: [
						{ type: 'hold', durationMs: 300 },
						{ type: 'resize', width: 360, height: 480, durationMs: 500, holdAfterMs: 300 },
						{ type: 'resize', width: 640, height: 480, durationMs: 500, holdAfterMs: 300 },
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
			assert.strictEqual(result.layout, 'vertical');
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
</style></head>
<body>
<div id="toolbar"><button aria-label="Toggle panel" onclick="document.getElementById('panel').classList.toggle('open')">Toggle panel</button><span>Project navigation</span></div>
<div id="panel">Comparison fixture</div>
</body>
</html>`;
}