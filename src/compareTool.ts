import * as vscode from 'vscode';
import { describeResizeOutcomes, type ComparisonRequest, type ComparisonResult } from './model';

export class CreateComparisonTool implements vscode.LanguageModelTool<ComparisonRequest> {
	constructor(
		private readonly execute: (request: ComparisonRequest, token: vscode.CancellationToken) => Promise<ComparisonResult>,
	) {}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ComparisonRequest>): vscode.PreparedToolInvocation {
		const message = new vscode.MarkdownString();
		message.appendMarkdown(`Create **${options.input.scenario.name}** by running the following project command against `);
		message.appendCodeblock(`${options.input.baseRef}\n${options.input.startCommand}`, 'text');
		const resizeOutcomes = describeResizeOutcomes(options.input);
		if (resizeOutcomes.length > 0) {
			message.appendMarkdown('\n\nPlanned resize motion:\n');
			for (const outcome of resizeOutcomes) {
				message.appendMarkdown(`\n- ${outcome}`);
			}
		}
		return {
			invocationMessage: `Creating PR UI comparison for ${options.input.scenario.name}`,
			confirmationMessages: {
				title: 'Run applications and create a UI comparison?',
				message,
			},
		};
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ComparisonRequest>,
		token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const result = await this.execute(options.input, token);
		const resizeOutcomes = describeResizeOutcomes(options.input);
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
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(
				`The PR UI comparison was created successfully.\n\n${JSON.stringify(summary, null, 2)}${verification}`,
			),
		]);
	}
}