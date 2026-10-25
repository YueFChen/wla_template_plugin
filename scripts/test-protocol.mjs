import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = path.resolve(root, process.argv[2] ?? 'target/dev-package')
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
const contract = await readFile(path.join(directory, manifest.contract))
const executable = path.join(directory, manifest.backend.entry)
await access(executable)

const child = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
const closed = new Promise(resolve => {
  child.once('error', error => resolve({ error }))
  child.once('close', (code, signal) => resolve({ code, signal }))
})
const lines = createInterface({ input: child.stdout })
const frames = lines[Symbol.asyncIterator]()
const identity = { protocol: 'wonderland-plugin', version: '1.0.0' }
let stderr = ''
child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })

async function bounded(promise) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Plugin protocol check timed out.')), 10_000) }),
    ])
  } finally { clearTimeout(timer) }
}

async function receive() {
  const line = await bounded(frames.next())
  assert.equal(line.done, false, `Plugin exited before replying: ${stderr}`)
  const message = JSON.parse(line.value)
  assert.equal(message.protocol, identity.protocol)
  assert.equal(message.version, identity.version)
  return message
}

function send(message) {
  child.stdin.write(JSON.stringify({ ...identity, ...message }) + '\n')
}

try {
  send({ type: 'hello', role: 'host', pluginId: manifest.id, coreVersion: manifest.hostCompatibility.minCoreVersion })
  const hello = await receive()
  assert.equal(hello.type, 'hello')
  assert.equal(hello.role, 'plugin')
  assert.equal(hello.pluginId, manifest.id)
  assert.equal(hello.pluginVersion, manifest.version)
  assert.equal(hello.contractSha256, createHash('sha256').update(contract).digest('hex'))
  send({ type: 'request', id: 'info', method: 'get_info', params: {} })
  const info = await receive()
  assert.equal(info.id, 'info')
  assert.equal(info.type, 'result')
  assert.deepEqual(info.result, { id: manifest.id, name: manifest.name, version: manifest.version })
  for (const [id, method, params, code] of [
    ['invalid', 'get_info', { unexpected: true }, 'INVALID_INPUT'],
    ['missing', 'unknown_method', {}, 'METHOD_NOT_FOUND'],
  ]) {
    send({ type: 'request', id, method, params })
    const result = await receive()
    assert.equal(result.id, id)
    assert.equal(result.type, 'error')
    assert.equal(result.error.code, code)
  }
  child.stdin.end()
  const exit = await bounded(closed)
  assert.equal(exit.code, 0, stderr || String(exit.error ?? exit.signal))
  console.log(`Packaged backend protocol verified (${manifest.id} ${manifest.version}).`)
} finally {
  lines.close()
  if (child.exitCode === null && child.signalCode === null) {
    child.kill()
    await bounded(closed)
  }
}
