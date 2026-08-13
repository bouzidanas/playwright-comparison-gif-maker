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

const storageRoot = process.env.PR_UI_COMPARE_STORAGE_DIR
	|| path.join(os.homedir(), '.pr-ui-compare');
const workspaceFlag = process.argv.indexOf('--workspace');
const workspacePath = workspaceFlag !== -1 && process.argv[workspaceFlag + 1]
	? path.resolve(process.argv[workspaceFlag + 1])
	: process.cwd();

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

async function createComparison(request: ComparisonRequest, token: CancellationToken) {
	if (!await resolveFfmpegPath()) {
		return textResult(
			'FFmpeg was not found. Run the install_ffmpeg tool once, set PR_UI_COMPARE_FFMPEG, or add ffmpeg to PATH, then retry.',
			true,
		);
	}
	const runner = new ComparisonRunner(storageRoot, log);
	const result: ComparisonResult = await runner.run(workspacePath, request, token, message => log.appendLine(message));
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
	});
	const retentionDays = Number(process.env.PR_UI_COMPARE_RETENTION_DAYS) || 7;
	void cleanupExpiredSessions(storageRoot, retentionDays).catch(() => undefined);

	const server = new Server(
		{ name: 'pr-ui-compare', version: manifest.version },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: [
			{
				name: 'create_comparison',
				description: comparisonTool.modelDescription,
				inputSchema: comparisonTool.inputSchema,
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
		try {
			switch (request.params.name) {
				case 'create_comparison':
					return await createComparison(request.params.arguments as unknown as ComparisonRequest, token);
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
	log.appendLine(`pr-ui-compare MCP server ready (workspace: ${workspacePath}, storage: ${storageRoot})`);
}

main().catch(error => {
	process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
	process.exit(1);
});
