import { readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { installManagedChromium } from './browserInstaller';
import { ComparisonRunner } from './comparisonRunner';
import { initializeFfmpegLocator, installFfmpeg, resolveFfmpegPath } from './ffmpegInstaller';
import { CancellationError, setHostConfiguration, type CancellationToken, type OutputSink } from './host';
import { describeResizeOutcomes, type ComparisonRequest, type ComparisonResult } from './model';
import { cleanupExpiredSessions } from './sessionStorage';

interface ExtensionManifest {
	version: string;
	contributes: {
		languageModelTools: Array<{
			modelDescription: string;
			inputSchema: Record<string, unknown>;
		}>;
	};
}

// The manifest sits one level above both dist/ and out/, and npm always packs package.json.
const manifest = JSON.parse(
	readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
) as ExtensionManifest;
const comparisonTool = manifest.contributes.languageModelTools[0];

// Clients that read the MCP instructions field, such as Claude Code and Codex, get the guidance
// the extension contributes to VS Code chat as skills and instructions. Claude Code truncates
// this and every tool description at 2KB, so keep both under that and lead with what matters.
const INSTRUCTIONS = `PR UI Compare records a running application twice, once at a baseline Git ref checked out into a temporary detached worktree and once at the current working tree, then renders a labeled Before and After GIF or PNG.

Call create_comparison only when the user wants generated media to look at or share. Comparing branches, reviewing a diff, summarizing a change, or checking that a fix works are code questions: answer those by reading the code instead.

Before calling, confirm the workspace is a Git repository and the baseline ref exists, then read package.json, lockfiles, and development docs to determine the install command, start command, ready URL, and route. Put {port} where a port belongs in both the start command and the ready URL. Never write a Playwright, shell, or Node helper script; this tool does the recording.

Animation is the default. Use outputMode image only for a settled state that holds still. Put preparation the reviewer should not see in scenario.setupActions and the interactions they should see in scenario.actions. Prefer role, text, label, and data-testid locators over CSS classes. Set focusLocator when one region is the subject, and leave layout on auto.

Every resize action needs an explicit resizeMode: keep-left-edge-fixed moves only the right edge, keep-right-edge-fixed moves only the left edge, keep-window-centered moves both. Check the resizeOutcomes in the result against what the user asked for and rerun with a corrected mode if a fixed edge is wrong.

Keep labels short. The tool appends the short commit SHA, so never write a SHA into a label.

When create_comparison reports that Chromium or FFmpeg is missing, run install_browser or install_ffmpeg once and retry. Artifacts are written outside the repository, so report the returned paths, and when candidateDirty is true tell the user to regenerate after committing.`;

const storageRoot = process.env.PR_UI_COMPARE_STORAGE_DIR
	|| path.join(os.homedir(), '.pr-ui-compare');
const workspaceFlag = process.argv.indexOf('--workspace');
const defaultWorkspacePath = workspaceFlag !== -1 && process.argv[workspaceFlag + 1]
	? path.resolve(process.argv[workspaceFlag + 1])
	: process.env.PR_UI_COMPARE_WORKSPACE
		? path.resolve(process.env.PR_UI_COMPARE_WORKSPACE)
		: process.cwd();

// One server can be configured globally and used across repositories, which the VS Code shell
// never needs, so the property is added here instead of in the shared manifest schema.
function comparisonInputSchema(): Record<string, unknown> {
	const schema = comparisonTool.inputSchema as { properties?: Record<string, unknown> };
	return {
		...schema,
		properties: {
			...schema.properties,
			workspacePath: {
				type: 'string',
				description: 'Absolute path to the Git repository to compare. Defaults to the workspace the server was started in. Pass it when one server serves several repositories.',
			},
		},
	};
}

const log: OutputSink = {
	append: text => process.stderr.write(text),
	appendLine: text => process.stderr.write(`${text}\n`),
};

function toCancellationToken(signal: AbortSignal): CancellationToken {
	return {
		get isCancellationRequested() {
			return signal.aborted;
		},
		onCancellationRequested(listener: () => void) {
			signal.addEventListener('abort', listener, { once: true });
			return { dispose: () => signal.removeEventListener('abort', listener) };
		},
	};
}

function textResult(text: string, isError = false) {
	return { content: [{ type: 'text' as const, text }], isError };
}

async function createComparison(
	input: ComparisonRequest & { workspacePath?: string },
	token: CancellationToken,
	onProgress: (message: string) => void,
) {
	if (!await resolveFfmpegPath()) {
		return textResult(
			'FFmpeg was not found. Run the install_ffmpeg tool once, set PR_UI_COMPARE_FFMPEG, or add ffmpeg to PATH, then retry.',
			true,
		);
	}
	const { workspacePath, ...request } = input;
	const repositoryPath = workspacePath ? path.resolve(workspacePath) : defaultWorkspacePath;
	const runner = new ComparisonRunner(storageRoot, log);
	const result: ComparisonResult = await runner.run(repositoryPath, request, token, onProgress);
	const resizeOutcomes = describeResizeOutcomes(request);
	const summary = {
		outputMode: result.outputMode,
		...(result.outputMode === 'animation' ? { frameRate: result.frameRate } : {}),
		comparisonPath: result.comparisonPath,
		beforePath: result.beforePath,
		afterPath: result.afterPath,
		sessionDirectory: result.sessionDirectory,
		baseSha: result.baseSha,
		candidateSha: result.candidateSha,
		candidateDirty: result.candidateDirty,
		beforeColorScheme: result.beforeColorScheme,
		afterColorScheme: result.afterColorScheme,
		beforeObservedColorScheme: result.beforeObservedColorScheme,
		afterObservedColorScheme: result.afterObservedColorScheme,
		beforeLabel: result.beforeLabel,
		afterLabel: result.afterLabel,
		layout: result.layout,
		...(resizeOutcomes.length > 0 ? { resizeOutcomes } : {}),
	};
	const verification = resizeOutcomes.length > 0
		? '\n\nVerify that each resizeOutcomes entry matches the edge motion the user requested. If any fixed edge is wrong, correct resizeMode and rerun.'
		: '';
	return textResult(`The PR UI comparison was created successfully.\n\n${JSON.stringify(summary, null, 2)}${verification}`);
}

async function main(): Promise<void> {
	initializeFfmpegLocator(storageRoot);
	setHostConfiguration({
		allowSystemBrowser: () => process.env.PR_UI_COMPARE_ALLOW_SYSTEM_BROWSER === '1',
		ffmpegPath: () => undefined,
		browserInstallHint: () => 'Run the install_browser tool once and retry.',
	});
	const retentionDays = Number(process.env.PR_UI_COMPARE_RETENTION_DAYS) || 7;
	void cleanupExpiredSessions(storageRoot, retentionDays).catch(() => undefined);

	const server = new Server(
		{ name: 'pr-ui-compare', version: manifest.version },
		{ capabilities: { tools: {} }, instructions: INSTRUCTIONS },
	);

	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: [
			{
				name: 'create_comparison',
				description: comparisonTool.modelDescription,
				inputSchema: comparisonInputSchema(),
			},
			{
				name: 'install_browser',
				description: 'Downloads the managed headless Chromium build PR UI Compare records with. Run once before the first comparison, or when create_comparison reports that no managed Chromium installation was found.',
				inputSchema: { type: 'object', properties: {} },
			},
			{
				name: 'install_ffmpeg',
				description: 'Downloads a static FFmpeg build into PR UI Compare storage. Run once when create_comparison reports that FFmpeg was not found and it is not on PATH.',
				inputSchema: { type: 'object', properties: {} },
			},
		],
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const token = toCancellationToken(extra.signal);
		// A comparison runs for minutes. Progress keeps the client from treating the call as idle,
		// and shows the user which stage is running.
		const progressToken = request.params._meta?.progressToken;
		let step = 0;
		const report = (message: string): void => {
			log.appendLine(message);
			if (progressToken === undefined) {
				return;
			}
			void extra.sendNotification({
				method: 'notifications/progress',
				params: { progressToken, progress: ++step, message },
			}).catch(() => undefined);
		};
		try {
			switch (request.params.name) {
				case 'create_comparison':
					return await createComparison(
						request.params.arguments as unknown as ComparisonRequest & { workspacePath?: string },
						token,
						report,
					);
				case 'install_browser':
					await installManagedChromium(log, token);
					return textResult('Managed Chromium is ready for PR UI Compare.');
				case 'install_ffmpeg': {
					const installedPath = await installFfmpeg(log, token);
					return textResult(`FFmpeg is ready for PR UI Compare at ${installedPath}.`);
				}
				default:
					return textResult(`Unknown tool: ${request.params.name}`, true);
			}
		} catch (error) {
			if (error instanceof CancellationError) {
				return textResult('The request was cancelled.', true);
			}
			return textResult(error instanceof Error ? error.message : String(error), true);
		}
	});

	await server.connect(new StdioServerTransport());
	log.appendLine(`pr-ui-compare MCP server ready (workspace: ${defaultWorkspacePath}, storage: ${storageRoot})`);
}

main().catch(error => {
	process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
	process.exit(1);
});
