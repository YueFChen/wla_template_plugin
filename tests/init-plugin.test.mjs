import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function fixture(context) {
  const parent = path.join(root, 'target', 'init-tests')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(path.join(parent, 'plugin-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const excluded = new Set(['.git', 'target', 'node_modules', 'dist', 'artifacts', '.secrets', '.wrangler', '.cache', '.pnpm-store', '.cargo-home', '.npm-cache'])
  for (const name of await readdir(root)) {
    if (excluded.has(name) || name.startsWith('.env') || name === '.npmrc') continue
    await cp(path.join(root, name), path.join(directory, name), {
      recursive: true,
      filter: source => !path.relative(root, source).split(path.sep).some(segment => excluded.has(segment)),
    })
  }
  return directory
}

function initialize(directory, args) {
  return spawnSync(process.execPath, ['scripts/init-plugin.mjs', ...args], { cwd: directory, encoding: 'utf8' })
}

test('renamed template generates a consistent plugin with its own CI paths and escaped metadata', async context => {
  const directory = await fixture(context)
  const name = '工具 O\'Reilly <one> "$&"'
  const result = spawnSync(process.execPath, [
    'scripts/init-plugin.mjs', '--id', 'sample_plugin', '--name', name,
    '--author', 'Example "Author"', '--version', '1.2.3-beta.1',
  ], { cwd: directory, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const validate = spawnSync(process.execPath, ['scripts/validate-template.mjs'], { cwd: directory, encoding: 'utf8' })
  assert.equal(validate.status, 0, validate.stderr)
  const manifest = JSON.parse(await readFile(path.join(directory, 'package/manifest.json'), 'utf8'))
  assert.equal(manifest.id, 'sample_plugin')
  assert.equal(manifest.name, name)
  assert.equal(manifest.backend.activation, 'on_demand')
  assert.equal(manifest.remoteAccess, undefined)
  assert.equal(manifest.backend.entry, 'backend/wonderland-sample-plugin.exe')
  assert.match(await readFile(path.join(directory, 'ui/index.html'), 'utf8'), /O'Reilly &lt;one&gt;/)
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/package.yml']) {
    const workflow = await readFile(path.join(directory, file), 'utf8')
    assert.match(workflow, /plugins\/sample_plugin(?:\/|\s|$)/)
    assert.doesNotMatch(workflow, /plugins\/template_plugin\b/)
  }
  const compatibility = await readFile(path.join(directory, 'CORE-COMPATIBILITY.md'), 'utf8')
  assert.match(compatibility, /sample_plugin/)
  assert.match(compatibility, /1\.2\.3-beta\.1/)
  assert.doesNotMatch(compatibility, /wla_template_plugin/)
})

test('invalid initialization leaves every template file unchanged', async context => {
  for (const { args, error } of [
    { args: ['--id', 'con'], error: /reserved Windows device name/ },
    { args: ['--id', 'sample_plugin', '--name', 'Sample', '--author', 'Example', '--version', '1.2.3-01'], error: /semantic version/ },
    { args: ['--name', 'First', '--name', 'Repeated'], error: /may be specified once/ },
  ]) {
    const directory = await fixture(context)
    const manifest = await readFile(path.join(directory, 'package/manifest.json'))
    const cargo = await readFile(path.join(directory, 'Cargo.toml'))
    const result = initialize(directory, args)
    assert.notEqual(result.status, 0, JSON.stringify(args))
    assert.match(result.stderr, error)
    assert.deepEqual(await readFile(path.join(directory, 'package/manifest.json')), manifest)
    assert.deepEqual(await readFile(path.join(directory, 'Cargo.toml')), cargo)
  }
})

test('metadata validation rejects an author that differs between the manifest and package metadata', async context => {
  const directory = await fixture(context)
  const file = path.join(directory, 'package.json')
  const metadata = JSON.parse(await readFile(file, 'utf8'))
  metadata.author = 'Different Author'
  await writeFile(file, JSON.stringify(metadata))
  const result = spawnSync(process.execPath, ['scripts/validate-template.mjs'], { cwd: directory, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /author metadata must match/)
})
