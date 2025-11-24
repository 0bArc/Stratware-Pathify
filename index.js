const fs = require('fs')
const path = require('path')
const Module = require('module')

const DEFAULT_PREFIX = 'pathify@'
const DEFAULT_NAMESPACE_DIRS = ['src']

const hookState = {
	installed: false,
	previousResolve: null,
	resolver: null,
	pathify: null,
	prefix: DEFAULT_PREFIX
}

const toPosix = (input) => input.split(path.sep).join('/')

const dedupe = (items) => {
	const seen = new Set()
	const list = []
	for (const value of items) {
		if (!value) continue
		const resolved = path.resolve(value)
		if (seen.has(resolved)) continue
		seen.add(resolved)
		list.push(resolved)
	}
	return list
}

const safeReadDir = (dir) => {
	try {
		return fs.readdirSync(dir, { withFileTypes: true })
	} catch (error) {
		if (error.code === 'ENOENT') return []
		throw error
	}
}

const safeReadJson = (file) => {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'))
	} catch (error) {
		if (error.code === 'ENOENT') return null
		throw error
	}
}

const ensureDir = (filePath) => fs.mkdirSync(path.dirname(filePath), { recursive: true })

const splitSpecifier = (input) => {
	const spec = String(input || '').trim()
	if (!spec) throw new Error('pathify requires a specifier')
	if (spec.startsWith('@')) {
		const parts = spec.split('/')
		if (parts.length < 2) throw new Error('scoped pathify specifier must include package name')
		return { pkgName: `${parts[0]}/${parts[1]}`, subpath: parts.slice(2).join('/') }
	}
	const [pkgName, ...rest] = spec.split('/')
	return { pkgName, subpath: rest.join('/') }
}

const normalizePrefix = (prefix) => {
	const value = String(prefix || '').trim()
	if (!value) return DEFAULT_PREFIX
	return value.endsWith('@') ? value : `${value}@`
}

const buildConfig = (opts = {}) => {
	const root = opts.root ? path.resolve(opts.root) : process.cwd()
	const namespaceDirs = Array.isArray(opts.namespaceDirs) && opts.namespaceDirs.length
		? opts.namespaceDirs
		: DEFAULT_NAMESPACE_DIRS
	const scanNodeModules = opts.scanNodeModules === true
	return {
		prefix: normalizePrefix(opts.prefix || opts.DEFAULT_PREFIX || DEFAULT_PREFIX),
		root,
		nodeModules: opts.nodeModules ? path.resolve(opts.nodeModules) : path.join(root, 'node_modules'),
		namespaceDirs,
		extraRoots: Array.isArray(opts.roots) ? opts.roots.filter(Boolean).map((dir) => path.resolve(dir)) : [],
		filter: typeof opts.filter === 'function' ? opts.filter : (() => true),
		syncEditor: opts.syncEditor !== false,
		editorConfigPath: opts.editorConfigPath ? path.resolve(opts.editorConfigPath) : path.join(root, 'jsconfig.json'),
		scanNodeModules
	}
}

const deriveRoots = (config) => dedupe([
	config.root,
	...(config.scanNodeModules ? [config.nodeModules] : []),
	...config.namespaceDirs.map((dir) => path.join(config.root, dir)),
	...config.extraRoots
])

const scanWorkspace = (config) => {
	const index = new Map()
	for (const root of deriveRoots(config)) {
		for (const [name, dir] of scanRoot(root, config.filter)) {
			if (!index.has(name)) index.set(name, dir)
		}
	}
	return index
}

const scanRoot = (dir, filter) => {
	const results = new Map()
	for (const entry of safeReadDir(dir)) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue
		const full = path.join(dir, entry.name)
		if (entry.name.startsWith('@')) {
			for (const scoped of safeReadDir(full)) {
				if (!scoped.isDirectory()) continue
				const scopedName = `${entry.name}/${scoped.name}`
				const scopedDir = path.join(full, scoped.name)
				if (!filter(scopedName, scopedDir) || results.has(scopedName)) continue
				results.set(scopedName, scopedDir)
			}
			continue
		}
		if (!filter(entry.name, full) || results.has(entry.name)) continue
		results.set(entry.name, full)
	}
	return results
}

const buildPathsMap = (instance) => {
	const mappings = {}
	const namespaces = new Set()
	for (const [name, dir] of instance.index.entries()) {
		const entry = path.join(dir, 'index.js')
		const rel = toPosix(path.relative(instance.config.root, fs.existsSync(entry) ? entry : dir) || '.')
		mappings[`${instance.config.prefix}${name}`] = [rel]
		namespaces.add(name.split('/')[0])
	}
	if (!mappings[`${instance.config.prefix}*`]) {
		mappings[`${instance.config.prefix}*`] = namespaces.size
			? Array.from(namespaces).map((ns) => toPosix(path.join('src', ns, '*')))
			: ['src/*/index.js']
	}
	return mappings
}

const writeEditorConfig = (instance, targetPath) => {
	const configPath = targetPath || instance.config.editorConfigPath
	const config = safeReadJson(configPath) || {}
	config.compilerOptions = config.compilerOptions || {}
	config.compilerOptions.baseUrl = config.compilerOptions.baseUrl || '.'
	const existing = config.compilerOptions.paths || {}
	const prefixesToStrip = Array.from(instance.prefixHistory)
	const filtered = Object.fromEntries(
		Object.entries(existing).filter(([key]) => !prefixesToStrip.some((px) => key.startsWith(px)))
	)
	config.compilerOptions.paths = { ...filtered, ...buildPathsMap(instance) }
	if (!Array.isArray(config.include) || config.include.length === 0) {
		config.include = instance.config.namespaceDirs.length
			? instance.config.namespaceDirs
			: DEFAULT_NAMESPACE_DIRS
	}
	ensureDir(configPath)
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

const toTree = (instance) => ({
	config: {
		prefix: instance.config.prefix,
		root: instance.config.root,
		roots: deriveRoots(instance.config)
	},
	packages: instance.list()
})

class Pathify {
	constructor(opts = {}) {
		this.config = buildConfig(opts)
		this.index = new Map()
		this.events = { prefix: new Set() }
		this.prefixHistory = new Set([this.config.prefix])
		if (opts.autoScan !== false) this.refresh()
	}

	get roots() {
		return deriveRoots(this.config)
	}

	refresh(options = {}) {
		this.index = scanWorkspace(this.config)
		const shouldSync = options.sync !== false && this.config.syncEditor
		if (shouldSync) {
			try {
				writeEditorConfig(this, options.editorConfigPath)
			} catch (_) {
				// editor sync best-effort
			}
		}
		return this
	}

	syncEditorConfig(targetPath) {
		writeEditorConfig(this, targetPath)
		return this
	}

	setPrefix(nextPrefix, options = {}) {
		const normalized = normalizePrefix(nextPrefix)
		const previous = this.config.prefix
		if (normalized === previous) return normalized
		this.config.prefix = normalized
		this.prefixHistory.add(normalized)
		if (hookState.pathify === this) hookState.prefix = normalized
		const shouldRefresh = options.refresh !== false
		if (shouldRefresh) {
			this.refresh({ sync: options.sync })
		} else if (options.sync !== false && this.config.syncEditor) {
			this.syncEditorConfig(options.editorConfigPath)
		}
		this.#emit('prefix', { prefix: normalized, previous })
		return normalized
	}

	onPrefixChange(handler) {
		if (typeof handler !== 'function') return () => {}
		this.events.prefix.add(handler)
		return () => this.events.prefix.delete(handler)
	}

	list() {
		return Array.from(this.index.entries()).map(([name, dir]) => ({ name, dir }))
	}

	graph() {
		return toTree(this)
	}

	has(pkgName) {
		return this.index.has(pkgName)
	}

	resolve(spec) {
		const { pkgName, subpath } = splitSpecifier(spec)
		if (!this.index.has(pkgName)) {
			throw new Error(`pathify cannot resolve package "${pkgName}" under ${this.config.root}`)
		}
		const base = this.index.get(pkgName)
		return subpath ? path.join(base, subpath) : base
	}

	require(spec) {
		return require(this.resolve(spec))
	}

	createRequire() {
		const resolver = (spec) => this.require(spec)
		resolver.resolve = (spec) => this.resolve(spec)
		return resolver
	}

	#emit(type, payload) {
		for (const handler of this.events[type] || []) {
			try {
				handler(payload)
			} catch (_) {
				// ignore listener errors
			}
		}
	}
}

const install = (opts = {}) => {
	if (hookState.installed) {
		if ((opts.prefix || opts.DEFAULT_PREFIX) && hookState.pathify) {
			hookState.pathify.setPrefix(opts.prefix || opts.DEFAULT_PREFIX, { refresh: opts.refresh })
		}
		return hookState
	}
	const instance = opts.instance instanceof Pathify ? opts.instance : new Pathify(opts)
	const previousResolve = Module._resolveFilename

	const pathifyResolver = function pathifyResolver(request, parent, isMain, options) {
		const active = hookState.pathify
		if (active && typeof request === 'string') {
			const { prefix } = active.config
			if (prefix && request.startsWith(prefix)) {
				const spec = request.slice(prefix.length)
				const target = active.resolve(spec)
				return previousResolve.call(this, target, parent, isMain, options)
			}
		}
		return previousResolve.call(this, request, parent, isMain, options)
	}

	Module._resolveFilename = pathifyResolver
	
	hookState.installed = true
	hookState.previousResolve = previousResolve
	hookState.resolver = pathifyResolver
	hookState.pathify = instance
	hookState.prefix = instance.config.prefix
	return hookState
}

const uninstall = () => {
	if (!hookState.installed) return false
	if (Module._resolveFilename === hookState.resolver) {
		Module._resolveFilename = hookState.previousResolve
	}
	hookState.installed = false
	hookState.previousResolve = null
	hookState.resolver = null
	hookState.pathify = null
	hookState.prefix = DEFAULT_PREFIX
	return true
}

const isInstalled = () => hookState.installed

const resolve = (spec, opts = {}) => {
	const instance = opts.instance instanceof Pathify ? opts.instance : new Pathify(opts)
	return instance.resolve(spec)
}

const requireViaPathify = (spec, opts = {}) => {
	const instance = opts.instance instanceof Pathify ? opts.instance : new Pathify(opts)
	return instance.require(spec)
}

module.exports = {
	Pathify,
	install,
	uninstall,
	isInstalled,
	resolve,
	require: requireViaPathify,
	create: (opts) => new Pathify(opts),
	hookState,
	PREFIX: DEFAULT_PREFIX
}
