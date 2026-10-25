import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'))
const [manifest, contract, packageMetadata, uiMetadata, cargoToml, backendSource, uiApiSource, uiStyles, notice] = await Promise.all([
  readJson('package/manifest.json'),
  readJson('package/contract.json'),
  readJson('package.json'),
  readJson('ui/package.json'),
  readFile(path.join(root, 'Cargo.toml'), 'utf8'),
  readFile(path.join(root, 'src/main.rs'), 'utf8'),
  readFile(path.join(root, 'ui/src/api/plugin.ts'), 'utf8'),
  readFile(path.join(root, 'ui/src/style.css'), 'utf8'),
  readFile(path.join(root, 'NOTICE.md'), 'utf8'),
])

const fail = (message) => {
  console.error(`Template validation failed: ${message}`)
  process.exit(1)
}
const cargoName = cargoToml.match(/^name\s*=\s*"([a-z0-9_-]+)"/m)?.[1]
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"\n]+)"/m)?.[1]
const activityCount = manifest.ui?.contributions?.filter((item) => item.kind === 'activity').length ?? 0

if (manifest.manifestVersion !== 3) fail('manifestVersion must be 3.')
if (manifest.backend?.supportsServiceContext !== true) fail('updated SDK context support is required.')
if (manifest.remoteAccess !== undefined && typeof manifest.remoteAccess !== 'boolean') fail('remoteAccess must be a boolean when declared.')
if (manifest.hostCompatibility?.minCoreVersion !== '0.2.0' || manifest.hostCompatibility?.maxCoreVersionExclusive !== '0.3.0') fail('template requires the Core 0.2.0 SDK baseline below 0.3.0.')
if (!/^[a-z][a-z0-9_-]{0,63}$/.test(manifest.id)) fail('manifest ID does not match the plugin ID schema.')
if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(manifest.id)) fail('manifest ID is a reserved Windows device name.')
if (!['on_demand', 'background_restore', 'on_startup'].includes(manifest.backend?.activation)) fail('backend activation must declare a supported lifecycle policy.')
if (!manifest.name || manifest.name.length > 120) fail('manifest name is missing or too long.')
if (!cargoName || !cargoVersion) fail('Cargo package name or version is missing.')
if (cargoVersion !== manifest.version) fail('Cargo and manifest versions differ.')
if (activityCount !== 1) fail('a user-facing plugin must declare exactly one Activity.')
if (manifest.contract !== 'contract.json') fail('contract must point to the package root contract.json.')
if (manifest.backend?.entry !== `backend/${cargoName}.exe`) fail('backend entry must match the Cargo executable name.')
if (manifest.ui?.entry !== 'ui/index.html') fail('UI entry must point to ui/index.html.')
if (contract.methods?.get_info?.result?.properties?.id?.const !== manifest.id) fail('contract get_info ID differs from manifest ID.')
if (contract.methods?.get_info?.result?.properties?.version?.const !== manifest.version) fail('contract get_info version differs from manifest version.')
if (!backendSource.includes(`const PLUGIN_ID: &str = ${JSON.stringify(manifest.id)};`)) fail('Rust backend ID differs from manifest ID.')
if (!backendSource.includes(`const PLUGIN_NAME: &str = ${JSON.stringify(manifest.name)};`)) fail('Rust backend name differs from manifest name.')
if (!uiApiSource.includes(`createPluginHostClient('${manifest.id}')`)) fail('UI Bridge client ID differs from manifest ID.')
if (!/@import ['"]@wonderland\/ui\/(?:plugin-theme|plugin)\.css['"]/.test(uiStyles)) fail('UI must import the shared Core plugin stylesheet.')
if (typeof manifest.author !== 'string' || !manifest.author.trim()) fail('manifest author is required for formal packaging.')
let cargoAuthors
try { cargoAuthors = JSON.parse(cargoToml.match(/^authors\s*=\s*(\[[^\n]+\])$/m)?.[1] ?? 'null') } catch { fail('Cargo authors must be a string array.') }
if (packageMetadata.author !== manifest.author || uiMetadata.author !== manifest.author || !Array.isArray(cargoAuthors) || !cargoAuthors.includes(manifest.author) || !notice.split(/\r?\n/).includes(`Plugin author: ${manifest.author}`)) fail('author metadata must match the manifest in Cargo, npm, and NOTICE.md.')
if (packageMetadata.version !== manifest.version || uiMetadata.version !== manifest.version) fail('Cargo, npm, and manifest versions must match.')
if (['capabilities', 'networkPublicHosts', 'provides', 'requires'].some((key) => Object.hasOwn(manifest, key))) fail('manifest v3 must not declare removed host capability or service fields.')
if (manifest.dependencies?.length) fail('the starter template declares no plugin dependencies by default.')

for (const relative of [
  'README.md',
  'CORE-COMPATIBILITY.md',
  'PLUGIN_STRUCTURE.md',
  'LICENSE',
  'NOTICE.md',
  'rust-toolchain.toml',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'ui/index.html',
  'ui/src/main.tsx',
  'ui/src/App.tsx',
  'ui/src/api/plugin.ts',
  'ui/src/pages/MainPage.tsx',
  'ui/src/pages/DetailsPage.tsx',
  'src/commands.rs',
  'package/contract.json',
  'scripts/init-plugin.mjs',
  'scripts/debug-plugin.mjs',
  'scripts/build-plugin.mjs',
  'scripts/check-core-compatibility.mjs',
  'scripts/test-protocol.mjs',
  '.github/workflows/ci.yml',
  '.github/workflows/package.yml',
]) {
  try {
    await access(path.join(root, relative))
  } catch {
    fail(`required source file is missing: ${relative}`)
  }
}

console.log(`Template metadata is consistent (${manifest.id} ${manifest.version}).`)
