export interface PathifyPackage {
  name: string
  dir: string
}

export interface PathifyGraph {
  config: {
    prefix: string
    root: string
    roots: string[]
  }
  packages: PathifyPackage[]
}

export interface InstallOptions {
  root?: string
  roots?: string[]
  namespaceDirs?: string[]
  nodeModules?: string
  prefix?: string
  DEFAULT_PREFIX?: string
  filter?: (name: string, dir: string) => boolean
  syncEditor?: boolean
  editorConfigPath?: string
  autoScan?: boolean
  scanNodeModules?: boolean
}

export class Pathify {
  readonly config: any
  constructor(options?: InstallOptions)
  refresh(options?: { sync?: boolean; editorConfigPath?: string }): this
  syncEditorConfig(targetPath?: string): this
  setPrefix(prefix: string, options?: { refresh?: boolean; sync?: boolean; editorConfigPath?: string }): string
  onPrefixChange(handler: (payload: { prefix: string; previous: string }) => void): () => void
  list(): PathifyPackage[]
  graph(): PathifyGraph
  has(pkgName: string): boolean
  resolve(spec: string): string
  require<T = any>(spec: string): T
  createRequire(): NodeRequireFunction
}

export function install(options?: InstallOptions): typeof hookState
export function uninstall(): boolean
export function isInstalled(): boolean
export function resolve(spec: string, options?: InstallOptions): string
export function require<T = any>(spec: string, options?: InstallOptions): T
export function create(options?: InstallOptions): Pathify

export const PREFIX: string
export const hookState: {
  installed: boolean
  previousResolve: any
  resolver: any
  pathify: Pathify | null
  prefix: string
}
