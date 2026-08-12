// Engine-facing host abstractions. vscode.CancellationToken and vscode.OutputChannel
// satisfy these interfaces structurally, so the extension passes its objects unchanged.

export interface CancellationToken {
	readonly isCancellationRequested: boolean;
	onCancellationRequested(listener: () => void): { dispose(): void };
}

export class CancellationError extends Error {
	constructor() {
		super('Canceled');
		this.name = 'Canceled';
	}
}

export interface OutputSink {
	append(value: string): void;
	appendLine(value: string): void;
}

export interface HostConfiguration {
	allowSystemBrowser(): boolean;
	ffmpegPath(): string | undefined;
}

let configuration: HostConfiguration = {
	allowSystemBrowser: () => false,
	ffmpegPath: () => undefined,
};

export function setHostConfiguration(value: HostConfiguration): void {
	configuration = value;
}

export function hostConfiguration(): HostConfiguration {
	return configuration;
}
