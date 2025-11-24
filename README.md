# Pathify

Workspace-aware module aliasing for local Node packages. Pathify walks your project tree, builds `pathify@name` aliases for every in-development package, installs a Node resolver hook, and keeps your editor config in sync so working on multi-package workspaces feels like consuming published modules.

## Install

```bash
npm install @reaxion/pathify
```

## Quick Start

```js
const pathify = require('@reaxion/pathify')
pathify.install({ prefix: 'reaxion@' })

const reglet = require('reaxion@reglet')
```

`install()` scans your workspace, registers each package behind the configured prefix, patches Node’s module resolver, and updates `jsconfig.json` (or the path you supply) with matching `paths` entries.

## Options

```js
pathify.install({
  root: __dirname,         // defaults to process.cwd()
  namespaceDirs: ['src'],  // additional directories to scan
  roots: ['packages'],     // extra roots for custom layouts
  scanNodeModules: false,  // set true to include node_modules
  syncEditor: true,        // disable if you don’t want jsconfig updates
  editorConfigPath: './jsconfig.json'
})
```

All packages discovered under `root`, `root/src`, and any extra roots will be available via `prefix + packageName`. Scoped directories (`@scope/name`) are supported.

## API

- `pathify.install(options?)` – install the resolver hook and optionally rescan.
- `pathify.uninstall()` – remove the hook (restores the previous resolver).
- `pathify.resolve(spec)` – resolve a `pathify@` specifier to an absolute path.
- `pathify.require(spec)` – require via the Pathify resolution.
- `pathify.isInstalled()` – check whether the hook is active.
- `pathify.create(options?)` – build a standalone `Pathify` instance without installing the global hook.

## Editor Sync

Pathify writes the alias map into `jsconfig.json`/`tsconfig.json` so IntelliSense, Go-To Definition, and refactors understand the same prefixes. If you want to customize the generated config, supply `editorConfigPath` or set `syncEditor: false` and manage the file yourself.

## Why Pathify?

- Works out of the box for monorepos without `npm link` gymnastics.
- Keeps runtime + editor state aligned; no more divergent alias configs.
- Supports hot prefix swapping (`pathify.pathify.setPrefix('new@')`) with automatic config refresh.
- Safe resolver chaining: uninstalling Pathify restores the previous hook without clobbering other tools.

## License

MIT © Reaxion
