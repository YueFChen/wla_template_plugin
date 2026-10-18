# Wonderland Plugin Template

这是 Wonderland 动态插件的公开起步模板仓库。模板包含最小可运行的 Rust 后端、React UI、严格接口契约、校验与打包工具。插件源码和 Git 历史独立于 Core；模板不预设业务配置和插件依赖。

## 创建插件仓库

将本模板仓库检出到 Core checkout 的 `plugins/template_plugin`。在 Core 根目录运行创建命令，它会复制模板到 `plugins/<plugin-id>`，同步插件元数据、安装依赖、校验结构并初始化一个新的 Git 仓库。源模板不会被修改，Core 也不会把新插件加入自身的 Cargo 或 pnpm workspace。

```powershell
pnpm run create:plugin -- --id my_plugin --name "我的插件" --author "作者名"
```

如果模板仓库没有放在默认路径，可以指定本地目录或 Git 仓库地址：

```powershell
pnpm run create:plugin -- --template .\path\to\template --id my_plugin --name "我的插件" --author "作者名"
pnpm run create:plugin -- --template "https://github.com/<owner>/<repo>.git" --id my_plugin --name "我的插件" --author "作者名"
```

创建命令不会提交初始 Git commit 或配置远端。确认生成内容后，在新插件目录自行提交并按需添加远端。

## 开发与调试

创建成功后，插件仓库位于 `plugins/my_plugin`。以下命令从 Core 根目录执行：

```powershell
pnpm --dir .\plugins\my_plugin run validate
pnpm --dir .\plugins\my_plugin run debug
```

`debug` 会构建 UI 和后端，再启动 Core 开发版。Core 只在 debug 构建读取开发包路径；安装时仍校验 manifest、contract、兼容性和包文件，并自动启用开发插件，实际打开或调用时才启动后端。请先关闭现有 Core 开发版。修改后端代码后重新运行调试命令；UI 调试入口沿用现有开发工具。

本模板使用配套 Core 0.2.0 SDK，清单支持范围为 `>=0.2.0, <0.3.0`。`pnpm debug` 使用隔离 iframe 插件 UI；`debug:ui` 保留为旧命令别名。

## 目录与接口

- `package/manifest.json` 使用 manifest v3，声明插件身份、兼容范围、UI 入口、贡献点和插件依赖。manifest 使用严格 schema，不要添加未定义字段。
- `package/contract.json` 声明 UI 可调用的后端方法和数据结构；修改接口时同步更新 Rust 实现。
- `src/` 是独立 Rust 后端，通过 `wonderland-plugin-sdk` 接入 Core。标准输出只写协议帧，诊断写到标准错误。
- `src/commands.rs` 按 contract 分派方法，业务增多后再按领域拆分模块。
- `ui/` 是独立 React 应用：`App.tsx` 负责宿主生命周期，`api/` 封装 UI Bridge，`pages/` 放页面。不要直接调用 Tauri 命令。
- Activity 是 Workspace 主工作区入口；View 是 Core 承载的辅助视图。入口和容器均由 Core 管理。
- 普通 Core 服务默认可用，文件服务统一适配本地与远程环境。插件后端仍以当前用户身份运行；安装者应审阅插件代码。

详见 [PLUGIN_STRUCTURE.md](PLUGIN_STRUCTURE.md)，其中说明目录职责、manifest/contract、宿主服务、用户数据、插件依赖以及可选 Agent/MCP 适配器的边界。

## HTTP、文件与可选期限

HTTP 请求统一通过 `HostClient::http_request`／`http_request_bytes`，响应保留状态、重复响应头和最终 URL。非 2xx 由插件解释，Core 不自动重试。认证可以省略；需要密钥时使用自身插件的密钥引用，不继承 Core 账号或分发凭据。

```rust
use wonderland_plugin_sdk::HttpRequestParams;

let request = HttpRequestParams::get(url);
let (response, bytes) = host.http_request_bytes(&request)?;
// 由插件检查 response.status、response.headers 和业务内容。
let file = host.export_bytes("report.bin", &bytes)?;
```

大响应可使用 `http_request` 后逐次 `stream_read`，不必聚合整段字节；提前停止时使用 `stream_close`。上传、导出和显式宿主文件读写复用字节流，不能把总文件内容塞进一个 NDJSON 帧。`export_bytes` 按块传输并返回本地文件或远程待下载回执；`read_file`／`write_file` 的显式路径指运行 Core 的宿主，访问设备文件选择仍由 Core 适配。

contract 方法的 `timeoutMs` 省略或 `null` 表示不设总期限；正整数代表明确期限，父调用较短的期限仍有效。模板 `get_info` 不默认添加等待上限。需要请求期限时设置 `HttpRequestParams.timeout_ms` 或使用 `call_core_with_timeout`；取消及关闭流仍应处理。

## 按需启动与后台工作

模板使用 `backend.activation: "on_demand"`。启用只表示允许使用；打开页面或调用方法才启动后端，关闭页面不会立即停止进程。不要在初始化时同步调用其他插件的业务方法；`serve_with_startup` 的回调用于绑定宿主和登记恢复需求，宿主响应的接收循环已就绪。

普通 RPC 的工作由 Core 自动跟踪。工作需要在 RPC 返回后继续执行时，先登记活动，再将 guard 移到任务中；登记失败就不要启动该工作：

```rust
let activity = host.begin_activity("生成报告")?;
std::thread::spawn(move || {
    // 完成业务写入及资源清理后再释放活动。
    // 执行耗时工作……
    drop(activity);
});
```

需要下次桌面启动恢复持久业务时，改用 `background_restore`。首次运行读取自己的业务配置后调用 `host.set_background_restore(required)?`；开启恢复业务须先上报 `true` 并等待成功，再保存业务配置；关闭则先保存配置和清理任务，再上报 `false`。Core 只保存布尔需求，不读取插件的业务文件。无后台恢复需要的插件无需上报或改动业务存储。

## 构建与发布

环境要求：Windows x86_64 MSVC、Node.js 24、pnpm 11、Rust 1.98.1，以及位于 Core checkout `plugins/<plugin-id>` 下的插件仓库。模板当前只构建 Windows x86_64 插件。

```powershell
pnpm typecheck
pnpm build
pnpm run package:plugin
```

- `pnpm build` 生成 `target/dev-package`，供 Core 插件管理中的手动安装使用。
- `pnpm run package:plugin` 生成优化后的 `.wplug` 与 SHA-256 校验清单。
- `pnpm run validate` 检查 manifest、contract、Cargo/npm 元数据、UI Bridge 身份和标准目录的一致性。

本地开发保留当前版本号；在线发行才准备未占用的新版本。SHA-256 清单用于检查包完整性。作者资料保存在 manifest v3 并与 Cargo/npm、`NOTICE.md` 保持一致；正式发布使用 `pnpm run package:release`，由作者工具使用原身份完成包内签名，缺钥失败。本地开发包可以未签名。分发管理端只验签和发布，线上同版本内容不可覆盖。

UI 示例使用共享 `@wonderland/ui/plugin.css`，自动跟随 Core 主题；控件、面板和弹窗沿用 Core 规范，不重复绘制宿主页头或品牌标记。Vite 对 React 与 ReactDOM 去重，避免链接共享 UI 包时加载两份运行时。

模板内容采用 Apache-2.0 许可。生成插件后请按需要更新插件许可证，并保留模板材料的署名通知。

## CI

CI 会先做独立的元数据检查，再从公开的 `YueFChen/Wonderland_Assistant` 仓库检出 Core，在 Windows 的 `plugins/template_plugin` 布局中构建和检查插件。需要测试其他 Core 仓库时，将仓库变量 `WONDERLAND_CORE_REPOSITORY` 设为其 `owner/name`；私有 Core 仓库还需配置可读取它的 `WONDERLAND_CORE_CHECKOUT_TOKEN` Secret。

## Core 0.2.0 与远程访问

见 [CORE-COMPATIBILITY.md](CORE-COMPATIBILITY.md)，包括最低版本、远程声明和发布顺序。
