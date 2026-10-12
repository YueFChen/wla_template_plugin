import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const options = parseArgs(process.argv.slice(2))
const id = options.id ?? ''
const name = options.name?.trim() ?? ''
const author = options.author?.trim() ?? ''
const version = options.version?.trim() ?? '0.1.0'
const description = options.description?.trim() || `${name} plugin for Wonderland Assistant.`

if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) {
  throw new Error('--id must be a unique lowercase ID containing only letters, numbers, hyphens, or underscores.')
}
if (!name || name.length > 120) throw new Error('--name is required and must be at most 120 characters.')
if (!author || author.length > 120) throw new Error('--author is required and must be at most 120 characters.')
if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('--version must be a semantic version such as 0.1.0.')
}
if (description.length > 500) throw new Error('--description must be at most 500 characters.')
if ([name, author, description].some((value) => /[\u0000-\u001f\u007f]/.test(value))) {
  throw new Error('Name, author, and description cannot contain control characters.')
}

const [manifestText, contractText, cargoText, cargoLockText, packageText] = await Promise.all([
  readFile(path.join(root, 'package/manifest.json'), 'utf8'),
  readFile(path.join(root, 'package/contract.json'), 'utf8'),
  readFile(path.join(root, 'Cargo.toml'), 'utf8'),
  readFile(path.join(root, 'Cargo.lock'), 'utf8'),
  readFile(path.join(root, 'package.json'), 'utf8'),
])
const manifest = JSON.parse(manifestText)
const contract = JSON.parse(contractText)
const packageMetadata = JSON.parse(packageText)
const oldId = manifest.id
const oldCargoName = cargoText.match(/^name\s*=\s*"([a-z0-9_-]+)"/m)?.[1]
const idProperty = contract.methods?.get_info?.result?.properties?.id
if (!oldCargoName || !idProperty || idProperty.const !== oldId) {
  throw new Error('Template manifest, contract, or Cargo metadata is inconsistent. No files were changed.')
}

const slug = id.replaceAll('_', '-')
const crateName = `wonderland-${slug}`
const uiPackageName = `@wonderland/${slug}`
const rootPackageName = `wonderland-plugin-${slug}`
manifest.id = id
manifest.name = name
manifest.description = description
manifest.version = version
manifest.backend.entry = `backend/${crateName}.exe`
for (const contribution of manifest.ui?.contributions ?? []) {
  if (contribution.kind === 'activity') contribution.title = name
  else if (contribution.kind === 'view') contribution.title = `${name} Details`
}
contract.methods.get_info.result.properties.id.const = id
contract.methods.get_info.result.properties.version.const = version

const changes = new Map()
changes.set('package/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
changes.set('package/contract.json', `${JSON.stringify(contract, null, 2)}\n`)
let nextCargo = replaceLine(cargoText, /^name\s*=\s*"[a-z0-9_-]+"$/m, `name = ${tomlString(crateName)}`)
nextCargo = replaceLine(nextCargo, /^authors\s*=\s*\[[^\]]*\]$/m, `authors = [${tomlString(author)}]`)
nextCargo = replaceLine(nextCargo, /^version\s*=\s*"[^"\n]+"$/m, `version = ${tomlString(version)}`)
const workspacePackageIndex = nextCargo.indexOf('[workspace.package]')
if (workspacePackageIndex < 0) throw new Error('Cargo.toml has no workspace.package section.')
nextCargo = nextCargo.slice(0, workspacePackageIndex)
  + replaceLine(nextCargo.slice(workspacePackageIndex), /^version\s*=\s*"[^"\n]+"$/m, `version = ${tomlString(version)}`)
changes.set('Cargo.toml', nextCargo)
changes.set('Cargo.lock', updateCargoLock(cargoLockText, oldCargoName, crateName, version))

for (const relative of ['package.json', 'ui/package.json']) {
  const data = relative === 'package.json'
    ? packageMetadata
    : JSON.parse(await readFile(path.join(root, relative), 'utf8'))
  data.name = relative === 'package.json' ? rootPackageName : uiPackageName
  data.author = author
  data.version = version
  changes.set(relative, `${JSON.stringify(data, null, 2)}\n`)
}

let uiCopy = await readFile(path.join(root, 'ui/src/api/plugin.ts'), 'utf8')
uiCopy = replaceFirst(uiCopy, /createPluginHostClient\('([^']+)'\)/, `createPluginHostClient(${jsString(id)})`, 'UI Bridge client ID')
changes.set('ui/src/api/plugin.ts', uiCopy)

let backend = await readFile(path.join(root, 'src/main.rs'), 'utf8')
backend = replaceRustConstant(backend, 'PLUGIN_ID', id)
backend = replaceRustConstant(backend, 'PLUGIN_NAME', name)
changes.set('src/main.rs', backend)

let html = await readFile(path.join(root, 'ui/index.html'), 'utf8')
html = replaceFirst(html, /<title>[^<]*<\/title>/, `<title>${escapeHtml(name)}</title>`, 'HTML title')
changes.set('ui/index.html', html)

let translation = await readFile(path.join(root, 'ui/src/i18n/zh-CN.ts'), 'utf8')
translation = replaceTranslation(translation, 'view.title', `${name} 详情`)
translation = replaceTranslation(translation, 'app.badge', `${name.toUpperCase()} PLUGIN`)
translation = replaceTranslation(translation, 'app.title', name)
changes.set('ui/src/i18n/zh-CN.ts', translation)

const readme = [
  `# ${name}`,
  '',
  description,
  '',
  '## 开发',
  '',
  '此仓库是独立 Wonderland 插件。Core checkout 提供宿主和本地 SDK/UI 包，插件源码、业务和 Git 历史由本仓库管理。',
  '',
  '```powershell',
  'pnpm install',
  'pnpm run validate',
  'pnpm run debug',
  '```',
  '',
  '`pnpm run debug` 会重新构建插件并启动 Core debug 版，UI 使用常规隔离 iframe。请先关闭已运行的 Core 开发版。',
  '',
  '使用支持 manifest v3 的匹配 Core checkout，具体兼容范围见 manifest。默认不声明远程访问，不能被共享；完成远程适配后才在 manifest 根节点添加 `remoteAccess: true`。详见 [CORE-COMPATIBILITY.md](CORE-COMPATIBILITY.md)。',
  '',
  '## 接口与宿主服务',
  '',
  '- `package/manifest.json` 使用 v3，声明插件身份、Core 兼容范围、贡献点和可选插件依赖。',
  '- `package/contract.json` 声明 UI 调用的后端方法及数据结构。',
  '- `src/` 通过 `wonderland-plugin-sdk` 接入 Core；标准输出只写协议帧。',
  '- `ui/` 通过 UI Bridge SDK 调用后端和 Core 服务，不直接调用 Tauri 命令。',
  '- 普通宿主服务默认可用，文件交互由 Core 统一适配本地与远程环境；插件后端以当前用户身份运行，安装者应审阅代码来源。',
  '- 目录规范、用户数据、插件服务与可选 Agent/MCP 适配器见 `PLUGIN_STRUCTURE.md`。',
  '',
  '## 发布',
  '',
  '`pnpm run package:plugin` 生成 Windows x86_64 的 `.wplug` 和 SHA-256 校验清单。校验清单用于检查包完整性，不代表发布者身份。作者信息记录于 Cargo/npm 元数据和 `NOTICE.md`。',
  '',
].join('\n')
changes.set('README.md', readme)

let notice = await readFile(path.join(root, 'NOTICE.md'), 'utf8')
notice = replaceFirst(notice, /^Plugin author:.*$/m, `Plugin author: ${author}`, 'NOTICE plugin author')
changes.set('NOTICE.md', notice)

for (const [relative, content] of changes) {
  await writeFile(path.join(root, relative), content)
}

console.log(`Initialized ${name} (${id}) by ${author}.`)
console.log('Run pnpm install, pnpm run validate, then pnpm run debug from this plugin repository.')

function parseArgs(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (!['--id', '--name', '--author', '--version', '--description'].includes(key)) {
      throw new Error(`Unknown option: ${key}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`)
    parsed[key.slice(2)] = value
    index += 1
  }
  return parsed
}

function updateCargoLock(text, oldName, newName, newVersion) {
  const lines = text.split(/\r?\n/)
  const packageIndex = lines.findIndex((line, index) =>
    line === '[[package]]' && lines[index + 1] === `name = ${tomlString(oldName)}`,
  )
  if (packageIndex < 0 || !/^version\s*=\s*"[^"\n]+"$/.test(lines[packageIndex + 2] ?? '')) {
    throw new Error('Cargo.lock has no matching package entry. Run cargo check before initializing.')
  }
  lines[packageIndex + 1] = `name = ${tomlString(newName)}`
  lines[packageIndex + 2] = `version = ${tomlString(newVersion)}`
  return lines.join('\n')
}

function replaceLine(text, pattern, replacement) {
  if (!pattern.test(text)) throw new Error(`Expected configuration line was not found: ${pattern}`)
  return text.replace(pattern, () => replacement)
}

function replaceFirst(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`Expected ${label} was not found.`)
  return text.replace(pattern, () => replacement)
}

function replaceRustConstant(text, constant, value) {
  const pattern = new RegExp(`(const ${constant}: &str = )"[^"\\n]*";`)
  if (!pattern.test(text)) throw new Error(`Expected Rust ${constant} was not found.`)
  return text.replace(pattern, (_match, prefix) => `${prefix}${rustString(value)};`)
}

function replaceTranslation(text, key, value) {
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((line) => line.trimStart().startsWith(`'${key}':`))
  if (index < 0) throw new Error(`Translation key was not found: ${key}`)
  const prefix = lines[index].match(/^(\s*'[^']+'\s*:\s*)/)?.[1]
  if (!prefix) throw new Error(`Translation entry is malformed: ${key}`)
  lines[index] = `${prefix}${jsString(value)},`
  return lines.join('\n')
}

function tomlString(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function rustString(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function jsString(value) {
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')}'`
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
