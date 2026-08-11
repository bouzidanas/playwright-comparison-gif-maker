---
name: PR UI Compare Safety
description: "Use when: the user asks for a PR UI comparison, static image or screenshot comparison, Before and After PNG or GIF, theme or visual-state comparison, comparison against a Git ref, or recorded UI fix demonstration."
---

For PR UI comparison requests, inspect the workspace read-only and invoke the `pr-ui-compare_createComparison` tool with a declarative scenario. Default to animation. Use static image output only when the user explicitly requests it or the comparison is truly motionless with no events, interactions, transitions, resizing, zooming, scrolling, loading sequence, or state changes. When uncertain, use animation.

Every resize action must explicitly set `resizeMode`. Match the user's requested invariant directly. Use `keep-left-edge-fixed` when only the right edge may move. Use `keep-right-edge-fixed` when only the left edge may move. Use `keep-window-centered` when both edges must move simultaneously at the same rate. A request for the left edge to slide right while the right edge remains fixed must use `resizeMode: keep-right-edge-fixed`. Never substitute a mode based only on a direction word such as left or right. After the tool returns, check the `resizeOutcomes` entries in the result against the user's request and rerun with a corrected `resizeMode` if any fixed edge is wrong.

Do not set `labelSize` unless the user explicitly requests a specific label size. Leave resize `captureStrategy` at its stop-motion default unless the user asks for real-time resize behavior or reports the transition differs from a real browser.

Do not create, edit, delete, or generate files in the user's workspace. Do not write a JavaScript, TypeScript, Playwright, or shell helper script. Do not add tests, dependencies, configuration, screenshots, videos, or GIFs to the repository. The extension stores its generated artifacts outside the repository.

If the PR UI Compare tool is unavailable or disabled, stop and tell the user to enable **Create PR UI Comparison** in the Chat tool picker and reload VS Code. Do not emulate the extension with file edits or terminal scripts.