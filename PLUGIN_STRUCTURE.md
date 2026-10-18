# Wonderland 插件标准结构

本文按当前 Core 的 manifest v3、`wonderland-plugin` stdio-NDJSON v1、UI Bridge 和插件服务实现编写。模板先给出能运行的最小骨架；下面的可扩展目录按功能需要新增，不要求预先建空目录。

## 推荐目录

```text
my_plugin/
├─ .github/workflows/ci.yml       # 元数据、格式、lint、测试、构建
├─ package/
│  ├─ manifest.json               # 插件身份、兼容范围、UI 入口、集成和依赖声明
│  └─ contract.json               # 后端方法、事件及 JSON Schema
├─ scripts/
│  ├─ init-plugin.mjs              # 由模板初始化插件身份
│  ├─ validate-template.mjs        # 检查元数据和入口一致性
│  ├─ build-plugin.mjs             # 构建 UI/backend 并组装安装包
│  └─ debug-plugin.mjs             # 在 Core 开发环境运行
├─ src/
│  ├─ main.rs                      # 协议启动、插件常量和模块装配
│  ├─ commands.rs                  # contract 方法分派、参数解析和错误映射
│  ├─ domain/                      # 业务规则、模型和纯逻辑；按需创建
│  ├─ storage/                     # 用户数据读写、版本迁移；按需创建
│  └─ services/                    # Core 服务调用或外部服务适配；按需创建
├─ tests/
│  ├─ fixtures/                    # 稳定的小型测试样本
│  └─ *.rs                         # 跨模块/协议行为测试
├─ ui/
│  └─ src/
│     ├─ main.tsx                  # React 挂载和全局样式
│     ├─ App.tsx                   # 宿主生命周期与页面选择
│     ├─ api/                      # UI Bridge 与后端调用封装
│     ├─ pages/                    # Activity、View 等页面
│     ├─ features/                 # 按业务域拆分的交互模块；按需创建
│     ├─ components/               # 可复用 UI 组件；按需创建
│     ├─ i18n/                     # 文案和本地化
│     └─ style.css                 # 主题令牌和插件局部样式
├─ mcp/                            # 可选的 Agent/MCP 适配器，独立进程
├─ Cargo.toml / Cargo.lock
├─ package.json / pnpm-lock.yaml
├─ README.md / LICENSE / NOTICE.md
└─ rust-toolchain.toml
```

当前模板实际包含 `src/main.rs`、`src/commands.rs`、`ui/src/App.tsx`、`ui/src/api/plugin.ts` 和两个示例页面；业务增长后再引入 `domain/`、`storage/`、`features/` 等模块。小插件不需要照搬全部目录。

## 文件职责和数据流

1. Core 读取包根目录的 `manifest.json` 和 `contract.json`，检查身份、兼容性、贡献点、依赖声明和接口 schema。
2. Core 启动 manifest 指定的后端可执行文件，通过 stdin/stdout 交换 NDJSON 协议帧。`src/main.rs` 调用 SDK 的 `serve`；stdout 只能用于协议，日志和诊断写 stderr。
3. UI 的 `api/` 使用 `@wonderland/plugin-ui-sdk` 调用 contract 方法、订阅事件、读取主题/生命周期和请求打开 View。UI 不直接调用 Tauri 命令，也不导入 Core 的 React 状态。
4. Rust 命令入口只校验/解析输入、调用领域逻辑并映射结果。较大的功能把业务规则放在不依赖 UI 的模块中，便于单测和其他适配器复用。
5. `build-plugin.mjs` 只把 manifest、contract、编译后的 `ui/`、后端 `backend/` 和校验和组装进安装包。源代码、密钥、测试数据和开发缓存不进入安装包。

## Manifest、Contract 和 UI

- `manifestVersion` 当前必须为 `3`；ID 使用小写字母开头的字母、数字、`_` 或 `-`，发布后保持稳定。
- `hostCompatibility`、后端 protocol 和 UI bridge 兼容范围应覆盖真实测试过的 Core 版本，不要随意写宽。
- 每个面向用户的插件声明一个 Activity。侧栏工具等辅助入口声明 View，并使用 `workspace.sidebar` integration。
- `integrations` 只声明实际使用的宿主集成；`dependencies` 用 `{pluginId, versionReq, optional, methods}` 声明插件依赖，没有依赖时可省略。manifest v3 不接受旧授权和服务发现字段。
- `contract.json` 给每个后端方法定义参数、返回值和可选期限。`timeoutMs` 省略或 null 不设总期限；需要时声明正整数，父调用的较短期限仍有效。输入对象设置 `additionalProperties: false`，业务限制由插件定义；大文件与 HTTP 内容使用 SDK 字节流，不能将其聚合进单个协议帧。接口变化要同步 UI API、后端实现和测试。
- 长任务使用协议 request ID、进度事件和 `__cancel`；不要阻塞整个分派器的状态，也不要把无限制任务超时写进接口。
- UI 通过 `followHostTheme`、`onSurfaceLifecycle` 等 Bridge 方法接入宿主状态。页面按 Activity/View 拆分；业务功能增长时再按 feature 拆组件，避免所有状态和调用都堆在 `main.tsx`。
- manifest 中的 UI 命令由 Core CLI 按插件/贡献点路由；通过 UI Bridge 的 `onCommand` 处理，并把只读和有副作用的命令分别标注 `read_only` / `mutating`。这不等同于 Agent/MCP 接口。

## 宿主服务、数据和网络边界

普通宿主服务默认可用，不在 manifest 中声明或持久化授权。Core 为插件提供统一的本地与远程适配入口：

| Core 服务 | 适用场景 |
| --- | --- |
| `core.network.request` | 统一 HTTP(S) 传输，认证可选；模型协议和业务重试由插件处理 |
| `core.secrets.plugin.*` | 读写插件自己的密钥分区 |
| `core.files.pick`、`core.files.read` | 统一文件选择与读取 |
| `core.files.open_read`、`core.files.open_write`、`core.streams.*` | 显式宿主路径与分块读写；不设置固定文件总量或总期限 |
| `core.files.export` | 返回 `FileResult`：本地 `local/saved` 含真实路径；远程 `remote/ready` 含下载 ID，表示生成完成并等待下载 |
| `core.files.export_dir` | 本地返回真实导出目录；远程返回 `DIRECTORY_UNAVAILABLE`，UI 应按可选信息处理 |
| `core.files.reveal_own` | 打开插件自己的数据或导出位置，保留用户“打开导出位置”操作 |
| `core.browser.open` | 按 `{url}` 打开链接 |

插件后端以用户身份运行。文件服务提供统一管理和环境适配；插件仍负责自己的业务数据格式与正确性。远程文件回执不代表浏览器已写入用户磁盘，插件不负责发起远程下载。

- Core 通过 `WONDERLAND_PLUGIN_DATA_DIR` 提供持久数据目录，业务状态写入该目录，目录布局和格式不随宿主接口调整。
- 凭据使用插件密钥服务，普通配置不保存令牌或密码。相同 pluginId 在升级、来源替换和重装时继承数据及密钥。
- 默认卸载保留数据和密钥；用户明确选择删除数据和密钥时一起删除。插件应说明自己保留的业务数据及格式。
- contract 应区分 `FileResult` 的本地保存和远程下载就绪两种结果；UI 可以展示本地路径或远程文件名，不应构造远程主机路径。

## 插件互操作和 Agent 接入

- 插件按明确的 pluginId 调用依赖插件，在 manifest 的 `dependencies` 中声明版本要求、是否可选及所用方法；提供方在 contract 定义方法 schema。Core 将依赖缺失、版本不匹配和方法缺口作为诊断，不阻止消费者自身运行；通过 `core.plugins.call` 直接调用，实际目标、方法及 contract 决定调用是否成功。
- `dependencies` 是 Wonderland Core 的插件依赖声明，不会自动变成 Codex、PI 或其他 Agent 的 MCP 工具。
- 若功能需要直接提供给 Agent，可增加可选 `mcp/` 适配器作为独立可执行程序，复用 `domain/` 业务层并对外提供明确的只读/有副作用工具。MCP 进程和 Core 插件后端是不同协议入口，分别配置、打包和测试。
- 当前 Core manifest 没有声明或托管 MCP server 的字段；模板不会假定 Core 自动启动该适配器。需要的 Agent 客户端应由用户配置可执行文件及参数。之后 Core 若增加受管理的 MCP 集成，再更新模板。

## 仓库、依赖与验证

- 插件是独立 Git 仓库和独立版本；`plugins/<id>` 是 Core 开发布局，不表示插件并入 Core 的 Cargo/pnpm workspace，也不应在 Core 仓库里提交插件仓库文件。
- 当前 SDK 与 UI 依赖通过相对路径链接到 Core checkout，因此模板能在 Core 的 `plugins/` 下开发和 CI 构建。**当前模板不能脱离匹配版本的 Core checkout 独立编译**；将 SDK/UI 发布到版本化注册源后，才适合完全独立 clone/build。
- 改动接口时至少运行 `pnpm run validate`、`cargo fmt --all -- --check`、`cargo clippy --all-targets --locked -- -D warnings`、`cargo test --locked`、`pnpm typecheck` 和 `pnpm build`。Core 集成 CI 另外验证创建新插件、开发运行和 release package。
- 当前模板发布目标是 Windows x86_64 MSVC。新增平台要同步处理 Cargo target、manifest 平台、打包后端文件名、CI runner 和安装检查。
