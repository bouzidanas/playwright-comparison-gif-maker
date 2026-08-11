# PR UI Compare

PR UI Compare creates a labeled Before and After GIF for a pull request by replaying the same Playwright scenario against a baseline Git revision and the current working tree.

The intended workflow is straightforward. Implement and test a visible UI change, commit and push when the final artifact is needed, generate the comparison, review it in VS Code, then drag the exported GIF into the GitHub PR description. An open pull request is not required.

## Features

- Resolves the selected baseline ref to an immutable commit SHA.
- Creates a detached temporary Git worktree without changing the current workspace.
- Starts Before and After applications sequentially on separate dynamic ports.
- Replays one declarative Playwright scenario against both applications.
- Tracks an optional focused element throughout the scenario and crops to its padded bounds.
- Keeps normal comparisons side by side.
- Automatically stacks top and bottom only when a focused region is at least three times wider than tall.
- Renders visible Before and After labels inside the outer top corners.
- Stores recordings in VS Code workspace storage rather than the repository.
- Contributes the `/create-pr-ui-comparison` Agent Skill and `#createPrUiComparison` tool.

## Requirements

- VS Code 1.125 or later
- A trusted local Git workspace
- The package manager and runtime required by the application
- Playwright-managed Chromium

Run **PR UI Compare: Install Managed Chromium** once after installing the extension. The browser is stored in Playwright's user cache. The extension does not launch Google Chrome from `/Applications` by default.

PR UI Compare packages FFmpeg, so a separate media encoder is not required.

## Agent usage

Ask Copilot something similar to:

```text
Create a PR UI comparison that demonstrates the mobile menu fix against upstream/main.
```

The contributed skill tells the agent to inspect project scripts and lockfiles, choose stable Playwright locators, keep the scenario short, and request confirmation before project commands run.

Set `focusLocator` for a stable region such as `role=navigation`, `data-testid=menu-bar`, or `#settings-panel`. Auto layout remains side by side for ordinary desktop and mobile captures. A region such as a full-width menu bar switches to top and bottom when its aspect ratio reaches 3:1.

Supported actions are `goto`, `click`, `hover`, `fill`, `press`, `scroll`, `waitFor`, and `hold`. Use locator strings such as `role=button[name="Menu"]`, `text=Settings`, and `data-testid=profile-panel`.

## Manual usage

Run **PR UI Compare: Create PR UI Comparison** from the Command Palette. The wizard asks for the baseline ref, start command, readiness URL, optional baseline install command, route, optional focus locator, and scenario actions as JSON.

Use `{port}` in commands and URLs:

```text
npm run dev -- --port {port}
http://127.0.0.1:{port}
```

The manual wizard defaults to a two-second static recording. Agent usage is preferred for interaction scenarios.

## Storage

Raw videos, timing metadata, and rendered GIFs are written under VS Code workspace storage. They do not appear in Source Control. The preview provides **Save GIF As...** and **Reveal Session** controls.

`prUiCompare.retentionDays` keeps temporary sessions for 1 to 90 days. The default is 7 days.

`prUiCompare.allowSystemBrowser` enables Google Chrome or Microsoft Edge fallback. It is disabled by default. On macOS, leaving it disabled avoids App Management warnings caused when a VS Code child process launches an application from the system Applications folder.

## Current limitations

- Version 0.0.1 compares one baseline Git ref with the current workspace.
- Firefox and WebKit are not supported yet.
- Action timing is recorded, but segment normalization and sequential playback are not exposed yet.
- GitHub attachment upload remains manual. Save the GIF and drag it into the PR editor.
- Authentication, database fixtures, environment files, and backend state remain project-specific.
- Git submodule worktrees and Git LFS projects may require additional setup.

## Development

```sh
npm install
npm run compile
npm test
npm run test:e2e
npm run package:vsix
```

`npm test` runs model and renderer tests in a VS Code extension host. `npm run test:e2e` additionally uses managed Chromium to run the complete Git worktree, server, Playwright, FFmpeg, metadata, and cleanup pipeline.

Press `F5` to open an Extension Development Host.

## Architecture

This is intentionally one repository and one extension package. The recording engine is split into internal modules so a CLI or MCP adapter can reuse it later without introducing a monorepo before there is a second shipped package.

- `src/comparisonRunner.ts` coordinates sessions and cleanup.
- `src/gitRepository.ts` resolves refs and manages detached worktrees.
- `src/processes.ts` owns commands, servers, ports, and readiness checks.
- `src/capture.ts` tracks focus bounds and records Playwright scenarios.
- `src/renderer.ts` selects layout, crops recordings, adds labels, and creates GIFs.
- `src/previewPanel.ts` provides review and export inside VS Code.
- `src/compareTool.ts` exposes the runner to agents.
- `skills/create-pr-ui-comparison/` teaches agents the pre-PR workflow.

## Security

The extension requires Workspace Trust because install and start commands execute project code. Agent tool invocations show the baseline ref and commands before execution. Webview content uses a restrictive content security policy and can only load generated session resources.

## License

PR UI Compare is open-source software available under the [MIT License](LICENSE).
