import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { CancellationError, type CancellationToken } from './host';

export async function findOpenPort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close();
				reject(new Error('Could not allocate a local port.'));
				return;
			}
			server.close(error => error ? reject(error) : resolve(address.port));
		});
	});
}

export async function runShellCommand(
	command: string,
	cwd: string,
	environment: NodeJS.ProcessEnv,
	token: CancellationToken,
	onOutput: (text: string) => void,
): Promise<void> {
	const child = spawn(command, {
		cwd,
		env: { ...process.env, ...environment },
		shell: true,
		windowsHide: true,
	});
	pipeOutput(child, onOutput);
	const cancellation = token.onCancellationRequested(() => terminateProcessTree(child));
	try {
		await waitForExit(child, command);
	} finally {
		cancellation.dispose();
	}
}

export class ManagedServer {
	private child: ChildProcess | undefined;

	constructor(
		private readonly command: string,
		private readonly cwd: string,
		private readonly environment: NodeJS.ProcessEnv,
		private readonly onOutput: (text: string) => void,
	) {}

	start(): void {
		this.child = spawn(this.command, {
			cwd: this.cwd,
			env: { ...process.env, ...this.environment },
			detached: process.platform !== 'win32',
			shell: true,
			windowsHide: true,
		});
		pipeOutput(this.child, this.onOutput);
	}

	async stop(): Promise<void> {
		if (!this.child || this.child.exitCode !== null) {
			return;
		}
		await terminateProcessTree(this.child);
	}
}

export async function waitForUrl(
	url: string,
	token: CancellationToken,
	timeoutMs = 120_000,
): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
			if (response.status < 500) {
				return;
			}
		} catch {
			// The application may still be starting.
		}
		await new Promise(resolve => setTimeout(resolve, 250));
	}
	throw new Error(`Application did not become ready at ${url} within ${timeoutMs / 1000} seconds.`);
}

function pipeOutput(child: ChildProcess, onOutput: (text: string) => void): void {
	child.stdout?.on('data', data => onOutput(String(data)));
	child.stderr?.on('data', data => onOutput(String(data)));
}

function waitForExit(child: ChildProcess, command: string): Promise<void> {
	return new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Command failed with exit code ${code}: ${command}`));
			}
		});
	});
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
	if (!child.pid || child.exitCode !== null) {
		return;
	}
	if (process.platform === 'win32') {
		await new Promise<void>(resolve => {
			spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
				.once('exit', () => resolve())
				.once('error', () => resolve());
		});
		return;
	}
	try {
		process.kill(-child.pid, 'SIGTERM');
	} catch {
		child.kill('SIGTERM');
	}
}