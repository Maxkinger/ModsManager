# macOS Generic Mod Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publicly release an unsigned macOS edition that safely manages Mods in a user-selected game directory on Intel and Apple silicon Macs.

**Architecture:** Keep the existing Electron/Vue application and Windows behavior. Centralize renderer-side filesystem path construction, gate unverified Windows game rules on macOS, then exercise the existing main-process import/install/backup/download flow before adding macOS packaging and release automation.

**Tech Stack:** Electron 33, Vue 3, TypeScript, Pinia, electron-builder 26, Node.js 20 in GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-23-macos-generic-mod-manager-design.md`

## Global Constraints

- Preserve upstream Git history, attribution, `LICENSE`, and Windows functionality.
- macOS first release supports custom games and user-chosen game-relative rules; it makes no compatibility claim for the 144 Windows `.exe` presets.
- Produce separate unsigned, unnotarized arm64 and x64 DMGs in GitHub Releases, with accurate first-open instructions.
- Keep macOS data in Electron `userData` and Mod files under the user's selected storage directory.
- Do not use PowerShell/.NET or Windows `AppData` paths on macOS.

## Review Focus

1. macOS paths containing spaces and Chinese characters resolve to the chosen directory; Task 1 and Task 3 pin this down.
2. Windows drive and UNC paths retain their original meaning after renderer path refactoring; Task 1 tests both.
3. A custom install path containing `..` or an absolute path never writes outside the game directory; Task 3 tests this.
4. A pre-existing symlink inside the game directory pointing outside does not allow install or uninstall to touch the target; Task 3 tests this.
5. A malicious archive path and a failed extraction leave the game and storage directories unchanged; Task 3 tests this.

---

### Task 1: Shared renderer path operations

**Files:**
- Create: `src/utils/platform-path.ts`
- Create: `scripts/check-platform-paths.cjs`
- Modify: `electron/preload.ts`
- Modify: `src/types/global.d.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `joinPlatformPath(platform: string, root: string, ...segments: string[]): string` and `dirnamePlatformPath(platform: string, input: string): string`.
- Produces read-only `window.mayfly.platform: string` from `process.platform`.
- Consumers: Task 2 store and UI path call sites.

- [ ] **Step 1: Write a failing path test.** Use `typescript.transpileModule` from the existing TypeScript dependency to load the pure TS helper in `scripts/check-platform-paths.cjs`. Assert at least these exact cases:

```js
assert.equal(joinPlatformPath('darwin', '/tmp/游戏 Mods', 'mods', '角色.zip'), '/tmp/游戏 Mods/mods/角色.zip');
assert.equal(dirnamePlatformPath('darwin', '/Users/a/Game.app'), '/Users/a');
assert.equal(joinPlatformPath('win32', 'C:\\Games', 'mods', 'a.zip'), 'C:\\Games\\mods\\a.zip');
assert.equal(joinPlatformPath('win32', '\\\\server\\share', 'mods'), '\\\\server\\share\\mods');
```

- [ ] **Step 2: Run `node scripts/check-platform-paths.cjs` and confirm the missing module fails.**
- [ ] **Step 3: Implement the two pure helpers.** Normalize segment separators, preserve a POSIX root, Windows drive root and UNC prefix, and reject empty roots. Add `platform: process.platform` to the exposed preload API and its global type.

```ts
export function joinPlatformPath(platform: string, root: string, ...segments: string[]): string;
export function dirnamePlatformPath(platform: string, input: string): string;
```

- [ ] **Step 4: Run the path test and `npm run typecheck`; fix only failures caused by this task.**
- [ ] **Step 5: Commit the helper and bridge as `feat: expose platform paths to renderer`.**

### Task 2: macOS generic game entry and renderer file paths

**Files:**
- Modify: `src/stores/library.ts`
- Modify: `src/App.vue`
- Modify: `electron/main.ts`
- Modify: `scripts/check-platform-paths.cjs`

**Interfaces:**
- Consumes `joinPlatformPath`, `dirnamePlatformPath`, `window.mayfly.platform` from Task 1.
- Produces renderer paths that are native to the current OS and a macOS custom-game-only entry.

- [ ] **Step 1: Extend the path test with a safe relative-path case and a rejected traversal case.** The helper used for joining deployed relative files must reject `../outside` and `/absolute`, while accepting `Mods/角色/manifest.json`.

```js
assert.equal(joinGameRelativePath('darwin', '/tmp/game', 'Mods/角色/manifest.json'), '/tmp/game/Mods/角色/manifest.json');
assert.equal(joinGameRelativePath('darwin', '/tmp/game', '../outside'), '');
assert.equal(joinGameRelativePath('darwin', '/tmp/game', '/absolute'), '');
```

- [ ] **Step 2: Run the path test and observe failure, then implement `joinGameRelativePath(platform, root, relativePath)` in the same helper.**
- [ ] **Step 3: Replace the path-producing `\\` string templates and duplicate `dirName` functions in `src/stores/library.ts` and `src/App.vue`.** Include cache metadata, Mod roots, download paths, backup paths, cover images and folder-open actions. Keep existing Windows JSON values readable; compare normalized paths when migrating legacy records.

```ts
const platform = window.mayfly.platform;
const outputPath = joinPlatformPath(platform, settings.value.storagePath, 'backups', game.id, `${name}.zip`);
```

- [ ] **Step 4: Make macOS default to custom game directory selection.** Hide Windows preset selection, `.exe` picker, `.exe` launcher and aria2 settings on macOS. In the store, refuse a Windows preset on macOS even if an action bypasses the UI. In the main process, reject non-game target scopes and Windows-only strategies on macOS before any mutation.

```ts
if (process.platform === 'darwin' && targetScope !== 'game') {
  throw new Error('此安装规则尚未适配 macOS');
}
```

- [ ] **Step 5: Run path tests, `npm run typecheck`, and `npm run check:all`.** Launch development Electron and verify the custom game form appears on macOS and accepts a selected directory.
- [ ] **Step 6: Commit as `feat: enable generic game management on macOS`.**

### Task 3: Real filesystem workflow and packaged archive tools

**Files:**
- Modify: `electron/main.ts`
- Create: `electron/fs-safety.ts`
- Create: `scripts/check-macos-path-safety.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes renderer paths and custom-game rules from Task 2.
- Produces safe install, uninstall, archive import, backup and download behavior on macOS.

- [ ] **Step 1: Write `scripts/check-macos-path-safety.cjs` against the new `electron/fs-safety.ts` interface.** Under `mkdtemp` in `/tmp`, make a game directory with Unicode and spaces, an outside sentinel, and a symlink from inside the game to the outside directory. Assert `assertSafeTarget(gameRoot, targetPath)` accepts an ordinary nested game path and rejects `../outside`, an absolute outside path and a path below the symlinked parent. Transpile the TS module with the existing TypeScript dependency, as in Task 1.

```js
const outside = join(tempRoot, 'outside.txt');
await writeFile(outside, 'sentinel');
await assert.rejects(() => assertSafeTarget(gameRoot, outside));
await assert.rejects(() => assertSafeTarget(gameRoot, join(gameRoot, 'link-to-outside', 'mod.txt')));
assert.equal(await readFile(outside, 'utf8'), 'sentinel');
```

- [ ] **Step 2: Run the regression script and record the first real failing case.**
- [ ] **Step 3: Implement `assertSafeTarget(rootPath: string, targetPath: string): Promise<void>` and call it from main-process installation and deletion paths before mutating files.** Reject symbolic-link ancestors that redirect outside the root; allow removal of an installed symlink itself without following it. Keep the existing archive entry check and extend `scripts/check-archive-import-security.cjs` with a `../` archive entry plus a symbolic-link archive entry. Resolve `7zip-bin` to a runnable binary in a packaged `.app` with `asarUnpack` and verify executable permission rather than relying on source-tree behavior.

```ts
const sevenZipExecutable = electron.app.isPackaged
  ? path7za.replace('app.asar/', 'app.asar.unpacked/')
  : path7za;
```

- [ ] **Step 4: Repeat `node scripts/check-macos-path-safety.cjs`, `npm run check:archive-import` and `npm run check:install-safety` until they pass.** In the running macOS app, use a temporary game directory to import a Mod, preview its targets, install, uninstall, download a small test file, back up, and restore. Confirm no filename contains a literal backslash. If symlink installation fails on a volume, show the error and verify copying still works.
- [ ] **Step 5: Commit as `fix: validate macOS mod filesystem workflow`.**

### Task 4: macOS packages, CI, and public documentation

**Files:**
- Modify: `package.json`
- Create: `.github/workflows/macos.yml`
- Create: `resources/icon.icns`
- Modify: `README.md`

**Interfaces:**
- Consumes verified app from Tasks 1–3.
- Produces local `dist:mac` command, arm64/x64 DMGs, GitHub tag-triggered Release assets and user instructions.

- [ ] **Step 1: Add an executable build script and macOS builder settings.** Keep `dist` for Windows; add `dist:mac` for both architectures, DMG targets, icon, unsigned build settings, and the proven 7-Zip resource rule.

```json
"dist:mac": "npm run build && electron-builder --mac dmg --arm64 --x64",
"mac": { "target": ["dmg"], "icon": "resources/icon.icns", "identity": null, "notarize": false }
```

- [ ] **Step 2: Generate `resources/icon.icns` from the existing icon artwork and inspect it in Finder.** Do not substitute an unrelated brand icon.
- [ ] **Step 3: Add the `macos-latest` CI job using Node 20 and `npm ci`.** Run type checks and relevant safety checks, build both architectures, upload DMGs for ordinary pushes, and attach both DMGs to a GitHub Release on `v*` tags using `GITHUB_TOKEN`. Keep the Windows job and its `.exe` artifact intact.

```yaml
env:
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
- uses: actions/upload-artifact@v4
  with:
    name: mayflyMods-macOS
    path: release/*.dmg
- uses: softprops/action-gh-release@v2
  if: startsWith(github.ref, 'refs/tags/v')
  with:
    files: release/*.dmg
```

- [ ] **Step 4: Update README with tested scope, original attribution, architecture choice, download instructions, and Apple's Privacy & Security “Open Anyway” process for unsigned apps.** Cite Apple support documentation, state that notarization is absent, and do not promise one-click launch.
- [ ] **Step 5: Run `npm run check:all` and `npm run dist:mac` locally.** Open the packaged arm64 `.app`, verify the main window and custom game form, then mount/inspect both DMGs. Compare CI YAML with actual output names.
- [ ] **Step 6: Commit as `build: publish unsigned macOS DMGs`.**

### Task 5: Publish and read back the GitHub release

**Files:**
- No source modifications unless CI reveals a reproducible defect.

**Interfaces:**
- Consumes working `Maxkinger/ModsManager` write access and Task 4's CI workflow.
- Produces a public GitHub Release URL with arm64 and x64 DMGs.

- [ ] **Step 1: Set `origin` to `https://github.com/Maxkinger/ModsManager.git` and `upstream` to `https://github.com/aojiangfuyou1/mayflyMods.git`.** Confirm the destination is empty or reconcile any commits before pushing; never force-push existing user history.
- [ ] **Step 2: Verify `gh auth status`.** If it still reports an invalid token, request a fresh login and continue all local checks while awaiting it.
- [ ] **Step 3: Push the reviewed branch and a `v*` release tag only after local verification.** Observe the macOS Actions job, download both DMGs, and compare their architecture and checksums with the local build.
- [ ] **Step 4: Read the public Release page and verify that download links, unsigned-app instructions and attribution are present.** Report the URL and any macOS restrictions accurately.
