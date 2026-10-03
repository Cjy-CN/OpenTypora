<h1 align="center">OpenTypora</h1>
<p align="center">A local Markdown workspace for writing, reading and publishing.</p>
<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center">
  <img alt="Windows x64" src="https://img.shields.io/badge/platform-Windows%20x64-0078D4">
  <img alt="Electron 44" src="https://img.shields.io/badge/Electron-44-47848F">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
</p>
<p align="center"><a href="#features">Features</a> · <a href="#installation">Installation</a> · <a href="#development">Development</a> · <a href="docs/README.md">Documentation</a> · <a href="https://github.com/Cjy-CN/OpenTypora/issues">Issues</a></p>

![OpenTypora live editor with file navigation, tables, code and mathematics](docs/images/workspace.png)

OpenTypora brings your Markdown files, outline and editing tools into one desktop window. Live editing and source mode share the same text and undo history. Your documents remain ordinary files in folders you control.

The project is under active development. The [product requirements](docs/OpenTypora-产品需求文档.md) and [acceptance suite](docs/OpenTypora-验收用例.md) track the full intended scope; a menu entry does not certify every acceptance case.

## Features

| Area | What you can do |
| --- | --- |
| Writing | Edit headings, emphasis, quotes, lists, tasks, tables, links, images and fenced code. Switch between live editing and source mode. |
| Navigation | Browse files or an outline. Opening a Markdown file automatically shows its folder; filter filenames at the top of the File panel. |
| Search | Find and replace in the complete source with case/word/regex options, or search across the current folder. |
| Technical documents | Render mathematics, Mermaid diagrams, traditional sequence diagrams and flowcharts, with errors shown beside invalid source. |
| Appearance | Choose built-in themes, custom document CSS, focus mode, typewriter mode and zoom. |
| File safety | Save recovery drafts, detect external changes and keep source/undo history consistent across view changes. |
| Publishing | Export HTML, rendered PDF and images; manage independent profiles for Pandoc and custom converters. |
| Windows integration | Use the installed application's Markdown context-menu entry and Open with registration; uninstall through Windows Settings. |
| Interface language | Follow the system language, or select Simplified Chinese or English. |

### One source, two editing views

Use live editing for everyday writing and source mode for precise Markdown changes. Switching views does not create a second document. File and outline navigation stay available beside the editor.

![OpenTypora source mode](docs/images/source-mode.png)

### Diagrams and mathematics

Keep diagrams in fenced Markdown blocks. Mermaid, traditional sequence/flow diagrams and mathematical expressions are rendered locally. The Markdown source remains editable.

![Mermaid, sequence diagram and mathematics in OpenTypora](docs/images/diagrams.png)

### Export profiles

File → Export lists available output profiles in a submenu. Customize page size, margins, style and converter options in Preferences → Export.

![OpenTypora export submenu](docs/images/export-menu.png)

HTML, rendered PDF and image exports use the built-in desktop renderer. Word, OpenDocument, RTF, Epub, LaTeX and other conversion formats require **Pandoc**; LaTeX PDF also requires a compatible **TeX engine**. Missing dependencies produce actionable errors.

## Installation

### Windows installer

Use `OpenTypora-Setup-<version>-x64.exe` from a published [release](https://github.com/Cjy-CN/OpenTypora/releases), or build it from source below. Release access follows repository permissions.

1. Run setup and choose an installation folder. It installs for the current Windows user.
2. Launch OpenTypora from the Start menu, desktop shortcut or installation folder.
3. Right-click an `.md` file and choose **Open with OpenTypora**. On Windows 11, it may appear under **Show more options**. OpenTypora is also registered as an **Open with** candidate.

Installation keeps your existing default Markdown editor. To make OpenTypora the default, select it through Windows **Open with → Choose another app**.

**Uninstall:** open Windows **Settings → Apps → Installed apps**, select OpenTypora, and choose Uninstall. You can also run `Uninstall OpenTypora.exe` in the installation folder. Uninstall removes the application, shortcuts and its file-opening registrations; documents, settings and recovery data are retained.

### Portable build

`OpenTypora-Portable-<version>-x64.exe` runs without an installation wizard. It does not automatically add the installer context-menu entry or an uninstall program. Remove the portable EXE when no longer needed. Portable packaging does not imply that settings are stored beside the EXE.

## Getting started

1. Open Markdown with **Ctrl+O**, or start a document with **Ctrl+N**.
2. **File** shows the current folder. Filter filenames to find another document, or select **Outline** to navigate headings.
3. Write and press **Ctrl+S** to save. Use **Ctrl+/** to inspect or edit source.
4. Choose a theme, adjust preferences, or use **File → Export**.

| Shortcut | Action |
| --- | --- |
| Ctrl+N / Ctrl+Shift+N | New document / new window |
| Ctrl+O / Ctrl+S / Ctrl+Shift+S | Open / save / save as |
| Ctrl+P | Quick-open a document |
| Ctrl+F / Ctrl+H | Find / replace |
| Ctrl+Shift+F | Search file contents in the folder |
| Ctrl+/ | Toggle source mode |
| Ctrl+, | Preferences |
| F8 / F9 | Focus mode / typewriter mode |

## Configuration

Preferences group options into Files, Editor, Images, Markdown, Export, Appearance and General. Search settings, reset them individually, or edit advanced JSON using the same validation rules.

- **Language:** General → Interface language defaults to **Follow system** for new configurations. Chinese system languages use Simplified Chinese; other languages fall back to English. Existing manual selections are retained. Some export profile names and errors remain Chinese.
- **Images:** choose no processing, copying into an assets folder or a configured upload adapter. Uploads require a supported service or executable.
- **Themes:** select a built-in theme or provide CSS scoped to the document.
- **Converters:** configure Pandoc/TeX executables and the export profiles you use.
- **Recovery:** recovery drafts and automatic overwriting of original files are separate options.

## Development

Requirements: **Windows x64**, **Node.js 24** and npm. Native integration, installer and desktop checks run on Windows.

```powershell
git clone https://github.com/Cjy-CN/OpenTypora.git
cd OpenTypora
npm ci
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the desktop development application |
| `npm run dev:web` | Run the browser UI without privileged desktop services |
| `npm test` | Unit and integration tests |
| `npm run typecheck` | Check TypeScript types |
| `npm run build` | Build renderer and Electron entries |
| `npm run test:desktop` | Real desktop tests with hidden windows and isolated data |
| `node electron/services/run-render-smoke.mjs` | Verify rendering and desktop services |
| `npm run package` | Build the Windows x64 installer in `release/` |
| `npm run package:portable` | Build the optional Windows x64 portable EXE |
| `npm run test:installer` | After packaging, test install/uninstall in an isolated registry tree and temporary folder |

Production signing is not configured in this repository. Configure your signing identity for distribution. See [Windows packaging and integration](docs/Windows-安装与卸载.md) for implementation and validation details.

### Project structure

```text
src/core/          Document transactions, source positions and commands
src/editor/        Live editing, source mode and editing operations
src/render/        Markdown, mathematics and diagram rendering
src/ui/            Workspace, menus, preferences and translations
src/platform/      Desktop bridge consumers and file/session coordination
src/shared/        Shared contracts, settings and command definitions
electron/          Main process, preload and privileged services
build/             Windows installer integration
scripts/           Development, build and installer validation tools
tests/             Cross-module regression tests
docs/              Product, engineering and acceptance documentation
```

Document source is one Markdown string. Positions use UTF-16 offsets and edits go through `DocumentStore` transactions. Privileged operations go through `DesktopBridge`; document HTML has no Node access or arbitrary IPC surface.

## Contributing

Read [AGENTS.md](AGENTS.md), the [engineering contracts](docs/工程基线与协作契约.md) and relevant requirements before making changes. Include reproduction steps and a minimal Markdown sample in bug reports. Keep fixes focused, preserve source/undo behavior and run the checks relevant to the affected workflow.

Use [Issues](https://github.com/Cjy-CN/OpenTypora/issues) for reproducible problems and proposals. Do not include credentials or private documents in reports or screenshots.

## License

This repository has not declared an open-source license. Use and distribution are governed by the repository owner's authorization. Third-party components retain their respective licenses; their notices are included in packaged builds.
