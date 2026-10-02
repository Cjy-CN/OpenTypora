# 编辑器模块集成说明

`MarkdownEditor.tsx` 导出 `MarkdownEditor`（`forwardRef<EditorHandle, EditorProps>`）、`EDITOR_COMMAND_IDS` 和 `canExecuteEditorCommand(store, id)`。命令注册表由主应用装配，编辑器不修改共享命令 ID 或配置契约。

## 唯一正文与历史

正文始终属于传入的 `DocumentStore`。CodeMirror 显示 LF 投影，`SourceProjection` 映射到原始 UTF-16 偏移；未修改的 CRLF、LF、混合换行、单 CR、空白和未知语法保留。视图装饰、主题、模式、滚动与搜索不提交正文事务。CodeMirror 不建立第二条撤销历史。

所有输入、结构命令、任务勾选和表格续行通过 Store 事务。事务中的修改相对同一版本；外部撤销、恢复、载入和替换同步到视图。IME 期间暂停自动配对、标点和结构命令；组合提交仍使用同一正文。

即时模式为未编辑块显示统一渲染服务的 HTML；当前块和跨块选区保持 CodeMirror 可编辑文本。公式和图表由主应用 `src/render/markdown.ts` 的 `hydrateDiagrams` 接口填充。YAML 激活块使用普通源码样式，避免 Markdown Setext 标题的视觉误判。

## EditorHandle

- `execute(id, argument?)`：处理成功返回 `true`，不支持、上下文不适用、取消/失败返回 `false`。错误显示在正文提示中；参数对话框打开代表动作已接管，确认前不修改源文档。
- `focus()`：调用方显式把焦点交给正文。
- `scrollTo(position)`：按原文 UTF-16 位置滚动，不改变选区、不抢查找输入框焦点。

正文命令、快捷键与右键菜单共用 `execute`。根窗口快捷键应先检查 `event.defaultPrevented`。所有包含文件的拖放由 App 捕获阶段路由，普通正文选区拖动保留 CodeMirror 行为。

## 参数约定

| 命令 | 参数 |
| --- | --- |
| `table.create` | `{ rows: number, columns: number }`，行数含表头，范围分别为 1～200、1～100 |
| `table.alignment` | `left / center / right / default` 字符串，或 `{ alignment }` |
| `code.language` | 语言字符串，或 `{ language }`；空字符串为纯文本 |
| `code.indentSelection`、`code.indentBlock` | 可选 `{ outdent: true }` |
| `format.link`、`format.linkActions` | `{ url?, label?, title?, remove? }` |
| `image.insert` | URL 字符串，或 `{ url, alt? }` |
| `image.scale` | 像素宽度数字，或 `{ width?, height? }`；保存为 HTML 图像语法 |
| `image.convertSyntax` | 可选 `markdown`；否则从当前语法切换 |
| `selection.lineOrSentence`、`range.deleteLineOrSentence` | 可选 `{ line: true }`；组件根据源码/即时模式提供行/句口径 |

创建表格、链接、插入图片、缩放、代码语言和对齐在无参数时显示可取消的组件内对话框。行列命令、格式、警告框、脚注、目录、YAML 和公式创建无需额外参数。

`imageReferences(text)` 和 `imageAt(text, position)` 来自 `src/core/formatting.ts`，返回原文范围、URL 范围、实际 URL、替代文本及语法类型；批量资源服务只修改 URL 范围，保留其他字段。引用式图片的 URL 范围指向共享定义，消费者应去重更新。

## 特权服务与搜索

剪贴板使用 `DesktopBridge.systemAction('clipboard.read' / 'clipboard.write')`。剪切只有成功写入剪贴板才删除原文；版本变化时保留正文。粘贴读取期间文档或选区变化时拒绝迟到结果。图片粘贴调用 `insertImage(documentPath, 'clipboard')`，不直接访问 Node。

本地链接经 `assets.resolve` 解析到授权路径；Markdown/文本调用 `onCommand('file.open', absolutePath)`，其他文件通过服务打开。普通点击编辑链接，修饰键点击打开；浏览器默认锚点导航被阻止。内部标题和脚注定位在同一源文档完成。

根应用负责本地图片选择、单张/批量管理、上传、图片设置、所有文档与窗口命令、全局文本设置切换、公式设置/刷新和原生拼写服务。编辑器不为未实现的特权行为报告成功。

搜索监听 `window` 的 `opentypora:search`，detail 为 `{ documentId, matches: [{ from, to, text }], currentIndex }`，可带查询和选项。范围使用原文偏移；不匹配文档忽略，关闭传入空数组。源码与激活块显示范围装饰，未编辑块显示实际文字命中以及块命中提示。

## 验证口径

模块测试包含源投影、Unicode、混合换行、格式/嵌套/跨段落、所有适用正文命令、表格导航/行列/撤销、图片范围、IME 护栏、跨模式历史、只读、剪贴板失败/迟到、搜索焦点、参数取消、右键、脚注和本地链接。测试在 `src/editor/*.test.ts`。

jsdom 的组合事件测试不能代替真实 Windows 中文输入法验收；原生拼写字典与建议、屏幕像素间距、长文输入延迟和浏览器光标命中仍需整机集成记录。构建通过也不代表全部产品用例通过。
