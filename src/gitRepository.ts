import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitRepository {
	private constructor(readonly root: string) {}

	static async open(workspacePath: string): Promise<GitRepository> {
		const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
			cwd: workspacePath,
		});
		return new GitRepository(stdout.trim());
	}

	async resolveCommit(ref: string): Promise<string> {
		try {
			const { stdout } = await this.git(['rev-parse', '--verify', `${ref}^{commit}`]);
			return stdout.trim();
		} catch {
			throw new Error(`Git ref "${ref}" does not resolve to a commit.`);
		}
	}

	async headSha(): Promise<string> {
		return this.resolveCommit('HEAD');
	}

	async currentBranch(): Promise<string | undefined> {
		try {
			const { stdout } = await this.git(['branch', '--show-current']);
			return stdout.trim() || undefined;
		} catch {
			return undefined;
		}
	}

	async isDirty(): Promise<boolean> {
		const { stdout } = await this.git(['status', '--porcelain=v1', '--untracked-files=normal']);
		return stdout.length > 0;
	}

	async suggestBaseRef(): Promise<string> {
		for (const ref of ['upstream/main', 'upstream/master', 'origin/main', 'origin/master', 'main', 'master']) {
			try {
				await this.resolveCommit(ref);
				return ref;
			} catch {
				// Try the next conventional PR target.
			}
		}
		return 'HEAD^';
	}

	async addDetachedWorktree(ref: string, destination: string): Promise<string> {
		const sha = await this.resolveCommit(ref);
		await this.git(['worktree', 'add', '--detach', destination, sha]);
		return sha;
	}

	async removeWorktree(destination: string): Promise<void> {
		try {
			await this.git(['worktree', 'remove', '--force', destination]);
		} catch {
			await this.git(['worktree', 'prune']);
		}
	}

	private async git(args: string[]): Promise<{ stdout: string; stderr: string }> {
		return execFileAsync('git', args, {
			cwd: this.root,
			maxBuffer: 10 * 1024 * 1024,
		});
	}
}