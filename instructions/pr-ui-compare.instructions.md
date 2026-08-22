---
name: PR UI Compare Safety
description: "Use when: the user asks for generated visual evidence of a UI change, such as a GIF, screenshot, Before and After PNG, theme or visual-state comparison, or a recorded UI fix demonstration. Not for code comparisons or diff reviews that need no generated media."
---

The `pr-ui-compare_createComparison` tool generates media. Invoke it only when the user wants a GIF or image to look at or share. Requests to compare a branch against `main`, review a fix, summarize what changed, or confirm that something works are code questions and must be answered by reading the code and the diff. When it is unclear whether the user wants generated media, ask before running the tool.

For PR UI comparison requests, inspect the workspace read-only and invoke the `pr-ui-compare_createComparison` tool with a declarative scenario. Default to animation. Use static image output when the user explicitly requests it or when the subject is a settled state that holds still. Image mode still accepts actions, which replay as setup so the state being photographed can be anywhere in the app rather than only the initial route. Use animation when the change the user needs to see is the motion itself, such as a transition, loading sequence, resize, zoom, or scroll. When uncertain, use animation.

For animation, use `scenario.setupActions` for page preparation that must finish before recording begins. Setup runs after the initial route reaches `networkidle` and is omitted from the GIF. Use explicit `waitFor` actions for concrete application state because `networkidle` does not guarantee that delayed rendering, background data, or animations have settled. Add a short `hold` when the prepared state needs a fixed settling period. Put camera `zoom` and every interaction the reviewer should see in visible `scenario.actions`. Animation must contain at least one visible action.

Keep labels short and let the tool append the short commit SHA, so never write a SHA into a label. Prefer naming the side and the ref, such as `Before • main` and `After • fix-overflow`, or just the ref name on each side. When the user states a label, pass it through exactly as given.

Every resize action must explicitly set `resizeMode`. Match the user's requested invariant directly. Use `keep-left-edge-fixed` when only the right edge may move. Use `keep-right-edge-fixed` when only the left edge may move. Use `keep-window-centered` when both edges must move simultaneously at the same rate. A request for the left edge to slide right while the right edge remains fixed must use `resizeMode: keep-right-edge-fixed`. Never substitute a mode based only on a direction word such as left or right. After the tool returns, check the `resizeOutcomes` entries in the result against the user's request and rerun with a corrected `resizeMode` if any fixed edge is wrong.

Do not set `labelSize` unless the user explicitly requests a specific label size. Leave resize `captureStrategy` at its stop-motion default unless the user asks for real-time resize behavior or reports the transition differs from a real browser.

Do not create, edit, delete, or generate files in the user's workspace. Do not write a JavaScript, TypeScript, Playwright, or shell helper script. Do not add tests, dependencies, configuration, screenshots, videos, or GIFs to the repository. The extension stores its generated artifacts outside the repository.

If the PR UI Compare tool is unavailable or disabled, stop and tell the user to enable **Create PR UI Comparison** in the Chat tool picker and reload VS Code. Do not emulate the extension with file edits or terminal scripts.