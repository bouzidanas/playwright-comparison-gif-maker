---
name: create-pr-ui-comparison
description: Create a synchronized Before and After GIF that demonstrates a UI fix or feature for a pull request. Use after implementing a visible web application change and before opening or updating the PR.
argument-hint: Describe the UI behavior to demonstrate
---

# Create a PR UI comparison

Use the `pr-ui-compare_createComparison` tool to produce a reviewable artifact outside the repository.

Before invoking the tool:

1. Inspect the changed UI and identify the shortest interaction sequence that makes the difference obvious.
2. Determine the intended PR target ref. Prefer the current original-repository target such as `upstream/main`. Do not assume remote names when repository evidence says otherwise.
3. Inspect `package.json`, lockfiles, and existing development instructions to determine the install command, start command, readiness URL, and route.
4. Use `{port}` in the start command and readiness URL. The tool allocates a separate port for each run.
5. Use stable Playwright locators. Prefer roles with accessible names, labels, text, and test IDs. Avoid generated CSS classes and coordinate clicks.
6. Include short holds before the first action and after states a reviewer needs to inspect. Keep the full scenario concise.
7. Choose a viewport that contains the relevant UI without making the subject too small. Start with 1280 by 720 for desktop or an appropriate fixed mobile viewport.
8. Set `focusLocator` when the demonstration concerns one stable region such as a menu bar, dialog, panel, or toolbar. The recorder follows that element's bounds and crops with 16 pixels of padding by default.
9. Keep `layout` set to `auto` unless the user requests otherwise. Auto is side by side for normal captures and only stacks top and bottom when the focused region is at least three times wider than tall.
10. Use short Before and After labels. They are rendered inside the outer top corners of the recordings.
11. Do not include credentials, tokens, private account data, or destructive interactions in a recording.

The supported actions are `goto`, `click`, `hover`, `fill`, `press`, `scroll`, `waitFor`, and `hold`. Pointer actions accept a Playwright locator string. Add `holdAfterMs` when the resulting state should remain visible.

After the tool returns, report the GIF path, whether the candidate included uncommitted changes, and the exact baseline and candidate SHAs. Remind the user to regenerate after committing and pushing when the candidate was dirty.