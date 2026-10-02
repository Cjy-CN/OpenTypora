# 桌面服务契约与验证

`createPlatform(window)` 完整提供 `BRIDGE_METHODS` 中24个处理器。主进程将原始结果包裹为 `Result`，异常保留错误码/诊断；服务不再次包裹Result。工厂使用WeakMap缓存，窗口关闭时清理监听与任务。`windowAction(new/close)` 的窗口创建/脏状态保护由main统一处理。

## 文件与配置

- `files.ts`：严格UTF-8识别、UTF-8/UTF-16 BOM、明确编码读取、iconv编码的无损写入校验、保留原始混合换行、同路径保存串行化、指纹冲突及同目录原子替换。非法编码返回 `ENCODING_REQUIRED`；UI可调用 `systemAction('file.readEncoding',{path,encoding})` 选择编码。
- `file.stat({path})`：绝对路径/realpath校验后只检查磁盘元数据，不读取/解码正文、不授权资源；返回 `{path,isDirectory,isFile,size,modifiedAt,readonly}`。`folder.open({path})` 与目录选择器共用真实目录校验、资源目录授权、folder历史与文件变更监听，返回实际path；文件/相对路径拒绝。
- `storage.ts`：设置同源Schema校验、备份、高级配置、最近历史、恢复草稿版本与时间保护。草稿与历史更新串行化。损坏草稿不删除；`RECOVERY_CORRUPT.detail` 包含可恢复项和损坏项。
- `access.ts`：已打开/选择的真实目录和单个图像授权。`resolveAuthorizedAsset(value)` 支持绝对路径、file URL及 `opentypora-asset://local/<encodedAbsolutePath>`，realpath检查阻止越界/符号链接逃逸。主进程使用此函数供协议读取。

## 图像、上传、搜索

- `insertImage(documentPath,'none'|'copy'|'upload'|'clipboard')`：选择本地图像或读取剪贴板PNG；未保存文档资源暂存。路径选项应用相对路径、`./`、URL转义。
- `manageAssets('copy'|'move',paths,destinationDirectory)` 按目标目录去重/唯一命名，不覆盖不同内容；`rename`/`moveOrRename` 只接受单项与绝对新文件路径；`delete` 调用系统回收站；各项返回 `{path,url,error?}`。
- `assets.stage` 参数 `{path,documentPath,strategy}`，返回 `AssetResult`。`assets.materialize` 参数 `{documentPath:新路径,paths:旧绝对资源路径[]}`，返回 `{sourcePath,path,url,error?}[]`；仅复制资源，正文引用由root一次DocumentStore事务更新并保存，服务不改原文。
- `assets.resolve` 参数 `{url,documentPath}` 返回 `{path?,url}`；本地URL转换为授权应用协议，远程返回原URL。
- 图像URL返回URI，不包含Markdown括号。关闭URL转义时，相对路径保留空格；renderer插入需使用 `![alt](<url>)` 保持目的地有效。实际Markdown解析已验证空格/未配对右括号相对路径在尖括号中可用；默认file URI可由服务解析，但Markdown-it默认拒绝file协议，renderer需在授权资源策略内明确处理该协议。
- PicGo/PicList使用官方本地HTTP接口 `POST /upload {list:[absolutePath]}`；Core与自定义程序通过无shell子进程真实执行、退出码/超时/取消和输出解析。URL数量不符作为失败；批量逐项错误保留。识别标准npm Windows shim并直接执行其Node入口；其他`.cmd/.bat`不隐式开启shell，需配置`node.exe`+CLI脚本参数或真实exe。
- 搜索仅在给定根目录内，忽略符号链接、`.git`和`node_modules`；支持Unicode全词、大小写、正则（多行锚点）、UTF-16位置、取消和逐项失败诊断。正则匹配在独立Worker执行，单文件超过1秒即终止，不阻塞主进程；16MB单文件/50000文件/20000命中限制有明确提示。

## 导入导出

导出克隆冻结Snapshot；内置HTML/PDF/图片使用其HTML，Pandoc结构转换使用其原始Markdown，均不修改原文件。HTML内嵌授权本地图像、保留SVG并禁用脚本；远程图片通过实际HTTP下载内嵌，失败保留原URL并报告离线风险，支持超时/大小限制/取消。PDF支持页面/边距/页首页尾/H1分页、中文作者标题增量元数据；PNG/JPEG支持宽度与质量，超过16000px分段并返回警告。

Pandoc真实转换：docx、odt、rtf、epub、latex、mediawiki、rst、textile、opml、Markdown方言、native、通用格式。LaTeX PDF独立调用指定TeX引擎；缺依赖准确报错。自定义转换和后置命令使用程序+参数列表以及 `${input}`/`${output}`/`${resourceDir}`/`${title}` 变量，无shell拼接。输出先暂存、成功后原子落盘；后置失败保留生成成功结果。

导出options兼容UI键：pageSize/margins/theme/pageBreakH1/header/footer/author/extraHtml/yamlOverride/retainOutline/head/body/width/quality/fontSize/referenceDoc/executable/args/outputFormat，以及服务规范键 h1PageBreak/headHtml/bodyHtml/yamlOverrides/imageWidth/imageQuality/themeCss/path/pandocPath/template/inputFormat/pdfEngine。YAML只允许排版白名单，不允许执行程序/参数/后置命令。

导入支持注册的HTML、docx、odt、rtf、epub、latex、mediawiki、rst、textile、opml、markdown/native/json，调用Pandoc `--extract-media`，资源留在应用imports目录并授权；原文件不修改。PDF不宣称支持语义导入。

## 系统动作白名单

`file.stat/properties/readEncoding`、`folder.open`、`spellcheck.configure/status`、`history.list/clear`、`config.open/reload/reset`、`warnings.reset`、`themes.open`、`exportProfiles.load/save`、`updates.check/download/install/cancel`、`shellNew.add/remove`、`telemetry.status/send`、`diagnostics/log`、`clipboard.read/write/image`（兼容clipboardRead/Write）、`assets.resolve/stage/materialize`、`tasks.cancel`、`watcher.start`、`print.snapshot`。

`spellcheck.configure({language})` 真实调用当前窗口Session的 `setSpellCheckerLanguages` / `setSpellCheckerEnabled`；`off` 关闭并保留语言列表，`auto` 将 `app.getPreferredSystemLanguages()` 逐项映射到可用词典（精确、基础语言、区域回退），没有匹配时采用可用en-US。显式语言仅接受可用词典代码（大小写/下划线归一）；未知语言返回 `SPELLCHECK_LANGUAGE_UNAVAILABLE` 和可用清单，保留现有状态。configure与status都返回实际 `{enabled,languages,availableLanguages}`。全局设置持久化、跨窗口同步和拼写建议菜单由主进程集成。

`clipboard.read`返回 `{text,html,image?:PNGDataURL,files?:fileURL[]}`；write接受 `{text?,html?,image?:PNG/JPEG/WebPDataURL}`，MIME白名单固定，不接受原始OS格式。`clipboard.image({path})` 复制授权图像到剪贴板；没有path时读取并暂存剪贴板图片。`openExternal(fileURL)`只允许已授权真实文件。`print.snapshot` **只接受 `{snapshot:ExportSnapshot}`**，新建无Node/preload的隐藏打印窗口；`windowAction('print')`仅通知renderer冻结快照，不要从file.print再次调用同一windowAction。

更新只读检查不退出程序，显式下载校验发行源资产，安装只打开已下载发行物；关闭脏文档与重启保护由root协调。请求失败重试127.0.0.1:7897。私有发行源401/404提供镜像/访问说明。系统注册检测其他应用既有ShellNew项、拒绝覆盖，仅移除本应用owner标记项；原来没有文件关联时才建立自有ProgID，移除时检查关联仍属于本应用。遥测仅当独立开关开启且配置接收端时发送固定字段event/version/platform，不接受正文、路径或任意payload，缺端点明确报错。

## 已执行验证

- `npm run typecheck`、`npm test`、`npm run build`、`npm run test:desktop`：通过。
- 设置 `OPENTYPORA_TEST_PANDOC=<pandoc绝对路径>` 后 `npm test`：51项通过（当时共同基线16项+服务35项），其中11种真实Pandoc 3.12格式导出/再次读取及通用JSON，缺TeX错误路径。
- `node electron/services/run-render-smoke.mjs`：实际Electron44隐藏窗口PDF/640px PNG/JPEG/长图2段、24方法、平台缓存、实际文件变更监听通过；测试数据与生产数据隔离，进程结束后清理。
- PDF用独立pdfminer解析器确认1页、中文正文、作者/标题UTF-16元数据。
- 合并共享/编辑器/工作区共同提交后，再执行含真实Pandoc的npm test：113项通过，其中新增遥测真实HTTP测试证明额外正文/路径/凭据不出现在请求中。
- 追加npm shim直连CLI及远程图片下载/404诊断后：115项通过。
- 追加真实正则Worker与灾难性回溯响应性/超时验证后：116项通过；typecheck/build与真实渲染smoke再次通过。
- 追加元数据/目录拖入/拼写Session配置后：含真实Pandoc的全套测试120项通过；真实Electron44隐藏smoke验证二进制stat、junction真实目录、folder历史/资源授权/监听、拼写关闭/显式语言/auto/未知语言状态保护，Bridge仍为24方法。此记录验证Session配置行为，不把配置成功等同于词典下载、正文拼写建议菜单或跨窗口集成全部验收通过。

PicGo/PicList适配测试连接真实本地协议测试服务器；Core/自定义适配测试执行真实Node子进程，未声称已连接实际云存储。当前机器没有PicGo/TeX生产工具或云凭据；上传真实云成功、TeX PDF成功、系统打印机、资源管理器注册及更新安装需要对应环境验收，缺依赖/失败路径已验证。下载的Pandoc仅存在系统临时测试运行时，未提交二进制。

依据：[Electron44剪贴板](https://www.electronjs.org/docs/latest/api/clipboard-item)、[Electron Session拼写API](https://www.electronjs.org/docs/latest/api/session#sessetspellcheckerlanguageslanguages)、[Electron系统偏好语言](https://www.electronjs.org/docs/latest/api/app#appgetpreferredsystemlanguages)、[Pandoc手册](https://pandoc.org/MANUAL.html)、[PicGo接口](https://docs.picgo.app/gui/guide/advance)、[Microsoft ShellNew](https://learn.microsoft.com/en-us/windows/win32/shell/context)。
