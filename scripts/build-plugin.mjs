import { finishPackage } from '../../../packages/plugin-tools/pack.mjs'
import './validate-template.mjs'
import './check-core-compatibility.mjs'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = process.argv.includes('--release')
const archive = process.argv.includes('--archive')
const manifest = JSON.parse(await readFile(path.join(root, 'package/manifest.json'), 'utf8'))
const cargoToml = await readFile(path.join(root, 'Cargo.toml'), 'utf8')
const cargoPackageName = cargoToml.match(/^name\s*=\s*"([a-z0-9_-]+)"/m)?.[1]
if (!cargoPackageName) throw new Error('Cannot read the package name from Cargo.toml.')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The current template build supports Windows x86_64 MSVC only.')
}
if (
  manifest.platform?.os !== 'windows'
  || manifest.platform?.architecture !== 'x86_64'
  || manifest.platform?.abi !== 'msvc'
) {
  throw new Error('manifest.json does not target Windows x86_64 MSVC.')
}

const targetRoot = path.resolve(root, 'target')
const output = path.resolve(targetRoot, release ? 'release-package' : 'dev-package')
const relativeOutput = path.relative(targetRoot, output)
if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
  throw new Error('Refusing to replace an output directory outside this repository target directory.')
}

function run(command, args, cwd = root) {
  let commandName = command
  let commandArgs = args
  if (process.platform === 'win32' && command === 'pnpm') {
    commandName = process.env.ComSpec ?? 'cmd.exe'
    commandArgs = ['/d', '/s', '/c', ['pnpm.cmd', ...args].join(' ')]
  }
  const result = spawnSync(commandName, commandArgs, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('pnpm', ['--dir', 'ui', 'run', 'typecheck'])
run('pnpm', ['--dir', 'ui', 'run', 'build'])
run('cargo', [
  'build',
  '--locked',
  '--package',
  cargoPackageName,
  ...(release ? ['--release'] : []),
])

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(path.join(root, 'package/manifest.json'), path.join(output, 'manifest.json'))
await cp(path.join(root, 'package/contract.json'), path.join(output, 'contract.json'))

const uiEntry = manifest.ui?.entry
if (!uiEntry?.startsWith('ui/')) throw new Error('manifest.ui.entry must be inside ui/.')
await cp(path.join(root, 'ui/dist'), path.join(output, 'ui'), { recursive: true })

const backendEntry = manifest.backend?.entry
if (!backendEntry?.startsWith('backend/')) throw new Error('manifest.backend.entry must be inside backend/.')
const profile = release ? 'release' : 'debug'
const backendSource = path.join(targetRoot, profile, `${cargoPackageName}.exe`)
const backendDestination = path.join(output, ...backendEntry.split('/'))
await mkdir(path.dirname(backendDestination), { recursive: true })
await cp(backendSource, backendDestination)

const packageResult = await finishPackage({root,stage:output,archivePath:archive ? path.join(targetRoot,`${manifest.id}-${manifest.version}-windows-${manifest.platform.architecture}.wplug`) : undefined})
if (archive) {
  const archivePath=packageResult.archivePath
  console.log(`Release package created: ${archivePath}`)
} else {
  console.log(`Plugin package created: ${output}`)
}
