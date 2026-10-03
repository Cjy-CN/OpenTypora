# Windows 安装与卸载

## 发布产物

- `npm run package`：NSIS 安装包 `release/OpenTypora-Setup-<version>-x64.exe`。
- `npm run package:portable`：免安装 EXE `release/OpenTypora-Portable-<version>-x64.exe`。
- 安装版为当前用户安装，可选目录，创建桌面/开始菜单快捷方式、Windows 应用卸载记录与 `Uninstall OpenTypora.exe`。
- 便携版不执行安装注册，没有安装版自动右键入口和卸载程序。

## Markdown 文件打开注册

`build/installer.nsh` 的 `customInstall` 向 `HKCU\Software\Classes` 写入：

| 注册位置 | 用途 |
| --- | --- |
| `SystemFileAssociations\.md\shell\OpenTypora` | `.md` 静态右键入口；命令为 `"<安装目录>\OpenTypora.exe" "%1"` |
| `Applications\OpenTypora.exe` | “打开方式”的名称、支持的 `.md` 类型与命令 |
| `OpenTypora.Markdown` | 独立 ProgID、图标与打开命令 |
| `.md\OpenWithProgids` 的 `OpenTypora.Markdown` 值 | 候选编辑器 |

不改写 `.md` 默认值或 `UserChoice`。中文与空格路径按完整参数传递，启动解析由 `launchDocument` 处理。Windows 11 的传统静态入口可能位于“显示更多选项”；当前实现不是现代菜单的 COM 扩展。

## 卸载边界

标准 NSIS 卸载器删除应用文件、快捷方式及卸载记录。`customUnInstall` 仅在注册命令仍指向本次安装路径时移除对应菜单、应用注册、ProgID 和本应用的 OpenWith 值，避免旧卸载器清除其他安装拥有的命令。

`deleteAppDataOnUninstall=false`，默认保留设置、恢复数据和文档。不递归清理用户文档目录。现有“资源管理器集成”命令管理的 ShellNew 新建项是独立功能，不在安装时启用。

## 验证

打包后执行 `npm run test:installer`。复用同一 NSIS 宏，但将 Classes 定向至随机 ID 的 `HKCU\Software\OpenTyporaInstallerSmoke\<ID>\Classes`；使用独立应用 GUID 和临时目录，不创建用户桌面/开始菜单快捷方式。

验证实际安装文件、卸载 EXE、Windows 卸载记录、右键与 OpenWith 命令、中文/空格路径、默认编辑器、其他 OpenWith 候选及文档保留。安装后的 EXE 再运行隐藏窗口桌面测试，使用隔离数据。第二轮验证旧卸载器保留指向新安装的命令。结束时卸载测试应用并清理本次目录与注册表树。

依据：[electron-builder v26 NSIS](https://www.electron.build/v26/docs/nsis/)、[Microsoft 应用注册](https://learn.microsoft.com/en-us/windows/win32/shell/app-registration)、[Windows 11 上下文菜单](https://blogs.windows.com/windowsdeveloper/2021/07/19/extending-the-context-menu-and-share-dialog-in-windows-11/)。
