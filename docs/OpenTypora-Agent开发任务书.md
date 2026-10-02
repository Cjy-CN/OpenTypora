# OpenTypora Agent 开发任务书

版本：1.0 · 日期：2026-10-02 · 目标：一次交付本次调查到的 Typora 1.12.4 Windows 完整功能。

本文件供实际开发时使用，不是本次已经执行的开发记录。与 [PRD](OpenTypora-产品需求文档.md)、[参考观察](Typora-功能观察记录.md)、[验收用例](OpenTypora-验收用例.md) 一起作为输入。功能拆分用于分工和接口协调，所有任务包均必须完成。

## 1. 可直接交给开发 agent 的总任务

> 在当前OpenTypora项目中实现完整Windows桌面Markdown查看与编辑器。以配套PRD全部需求为范围，以参考观察清单为功能发现依据，以验收用例为完成标准。交付包含即时编辑、源码一致性、全部Markdown元素及扩展、文件与恢复、导航检索、图片管理与四类上传适配、全部导入导出模板与打印、五类内置主题及定制、七类设置、快捷键、Windows集成、帮助更新与高级配置。不得把公式、图表、上传、多格式转换、主题定制或系统功能改为延期项目。先检查项目实际状态并选定技术栈，按统一文档模型和命令契约实现；需要分工时按本任务书模块边界协调。输出可运行发行物、依赖说明、兼容矩阵、完整测试报告。界面入口、服务、失败处理和集成验证缺一项都不能标完成。

## 2. 开发中必须保持的约束

- 原始Markdown文本是唯一内容事实来源。渲染树可重建，不能作为保存原文的唯一来源。
- 所有正文修改经过同一事务/历史系统；菜单、右键、键盘、粘贴、任务勾选、图片回写共用命令。
- 文档版本、保存版本、查询版本、渲染版本和导出快照显式区分，禁止旧异步结果覆盖新内容。
- 中文IME组合输入、跨块选区、无操作往返、保存恢复是整个产品的约束，每个模块必须兼容。
- 本机当前配置和参考默认值区分；产品新增规则记为D，参考待验证记为C。不能制造“已实测”证据。
- 不把依赖缺失伪装为功能未实现：实现适配、检测、配置和诊断，同时在有依赖环境验证成功路径。
- 不交付空按钮、模拟上传成功、只改后缀的导出、硬编码文件列表或无法回写Markdown的排版页。
- 第三方组件与主题资源采用可用授权的实现；OpenTypora使用自身发行和服务信息。

## 3. 共享模型和接口契约（语言无关）

### 3.1 文档会话

| 字段 | 含义/要求 |
| --- | --- |
| documentId | 会话稳定ID，未命名文档也具备 |
| path | 规范化路径，可空；显示路径与比较路径分开 |
| text | 原始Markdown文本，未知语法和空白保留 |
| encoding / bom / lineEnding | 读取及保存策略；混合换行需有明确处理 |
| version / savedVersion | 递增内容版本、最后成功写入版本；不能以界面是否更新代替 |
| diskFingerprint | 外部变更检测依据，不单靠内存脏状态 |
| dirty / readonly / saveState | 由版本和实际写入结果推导，错误状态可恢复 |
| selection | anchor/head源码位置，方向保留；组合输入单独标记 |
| history | 原子事务及逆操作，跨模式共享 |
| recoveryId / assetSessionId | 草稿和未保存资源关联 |
| rootDirectory / documentOverrides | 导航范围及文档级配置来源 |

文本位置统一采用一种可序列化单位，例如UTF-16偏移；实现团队必须声明单位、换行计数和组合字符规则。跨进程/跨语言不得一端用字节、一端用字符而不转换。

### 3.2 文本事务与命令

事务包含：`transactionId`、`documentId`、`baseVersion`、按源码范围描述的替换集合、修改后选区、`origin`、`historyGroup`、资源关联操作。提交时检查版本，合法后生成新版本；撤销恢复对应文本和选区。磁盘文件删除和远端资源删除不自动跟随正文撤销。

命令定义包含：`commandId`、标签、菜单路径、默认快捷键、上下文可用条件、执行器、是否修改正文、历史分组、配置依赖。系统操作/文件保存返回结果，不伪造编辑事务。所有入口订阅同一可用状态。

### 3.3 解析与渲染

解析输出每个块/行内节点的类型、原始范围、子结构、诊断和稳定标识。渲染适配输出可编辑节点及位置映射；双向映射至少满足源码范围→视觉位置、光标位置→源码范围、跨块选区→源码范围。未知语法节点保存原文。

图表和公式异步任务包含文档ID、版本、节点ID和输入哈希，返回结果必须仍对应当前输入才能挂载。错误以节点诊断显示，不替换源码。

### 3.4 文件与恢复

文件服务提供打开、保存快照、另存、全部保存、移动、删除、属性、系统定位和外部监听。保存返回实际写入版本及新磁盘指纹。恢复服务独立于覆盖式自动保存，按来源路径和版本保存草稿及临时资源清单。

文件状态事件至少包含`opened`、`modified`、`saveStarted`、`saveSucceeded`、`saveFailed`、`externalChanged`、`conflict`、`pathChanged`、`deleted`、`recoveryAvailable`。事件订阅方不可直接修改正文绕开事务。

### 3.5 资源与上传

资源记录包含引用节点ID、原地址、解析后的本地/网络地址、文档基目录、资源根覆盖、临时文件、内容哈希及加载状态。批量操作按资源去重，同时保留一对多引用映射。

上传适配统一提供能力检测、配置校验、测试、单张/批量上传、取消及结果解析。结果逐项包含原资源ID、成功URL或错误。回写前检查文档版本/节点当前地址；冲突时提示或保持结果可手动应用，不能覆盖用户刚改的地址。

### 3.6 搜索

文内查询包含关键词、大小写/全词/正则、文档版本及范围；结果返回源码起止位置及当前索引。跨文件查询包含根目录、queryId、过滤器和取消标识；结果按文件路径和源码位置分组。替换产生普通文本事务。

### 3.7 导入导出

导出配置包含稳定ID、名称、类型、输出后缀、引擎/转换器、参数、主题/样式、排版设置、YAML覆盖白名单和后置动作。导出快照包含版本、原文本、解析结构、资源解析结果及有效配置；不得读取正在变化的DOM充当冻结内容。

导出结果区分生成成功、资源/格式损失警告、后置动作失败和完全失败。各模板登记依赖、支持元素、损失映射和诊断。导入返回Markdown、资源集合和损失报告，创建新会话，不覆盖输入文件。

### 3.8 配置、主题和错误

配置键统一登记类型、范围、默认值、作用域、生效时机、迁移和说明。设置页、菜单开关、文档覆盖和高级文件调用同一配置服务。主题作用域覆盖编辑/源码/导航/浮层和导出；导出使用单独排版入口。

统一错误结构：错误码、用户可读原因、操作/对象、是否可重试、可恢复动作和技术诊断。正文/凭据不默认进入日志。UI不直接展示整段栈作为唯一说明。

## 4. 完整任务包

| 包ID | 负责内容 | 输入/依赖 | 必交产物 | 需求/验收 |
| --- | --- | --- | --- | --- |
| W-01 | 工程、桌面壳、命令注册、窗口与发布 | 共享契约 | 可运行壳、菜单/快捷键/上下文、安装与窗口生命周期 | DOC-01、SYS-01、APP-01；T-DOC/T-SYS/T-APP |
| W-02 | 文档模型、事务、历史、位置映射、IME | W-01契约 | 同一文本会话、即时/源码同步、跨块操作、输入回归 | EDIT-01～04、COMP-01；T-EDIT/T-COMP |
| W-03 | 基础Markdown、列表任务、表格、代码、行内格式 | W-02命令/映射 | 全元素可编辑、序列化保留、代码工具/表格操作 | MD-01～05；T-MD-001～020 |
| W-04 | 公式、三类图表、脚注、TOC、YAML、警告框/扩展 | W-02/03解析契约 | 完整扩展渲染编辑、开关、错误、兼容矩阵 | MD-06～07；T-MD-021～032 |
| W-05 | 文件、外部变更、自动保存、恢复、属性/移动/历史 | W-01/02会话 | 持久化闭环、所有失败路径、恢复资源协调 | DOC-02～04；T-DOC-005～023 |
| W-06 | 大纲、树/列表、快速打开、文内/跨文件搜索替换 | W-02位置、W-05目录 | 全部导航检索与替换、异步取消 | NAV、SEARCH；T-NAV/T-SEARCH |
| W-07 | 图片加载、插入/根目录、单张/批量管理及上传 | W-02事务、W-05路径 | 资源生命周期与四种真实上传适配 | ASSET；T-ASSET |
| W-08 | 导入、全部导出、模板管理、转换器、打印/后置动作 | W-03/04语法、W-07资源、快照 | 全格式成功样例、损失与依赖矩阵、打印布局 | EXPORT、IMPORT；T-EXPORT/T-IMPORT |
| W-09 | 五类主题/自定义CSS、窗口样式、写作模式和统计 | W-01/02/04视图与位置 | 完整主题/深色、专注/打字机、缩放与统计 | VIEW、STAT；T-VIEW/T-STAT |
| W-10 | 七类设置、输入辅助、快捷键、高级配置和Windows集成 | 统一配置/命令服务 | 每项真实生效、搜索、重置/迁移、系统注册 | PREF、EDIT-05、SYS；T-PREF/T-EDIT-016～024/T-SYS |
| W-11 | 帮助、关于、更新、发行服务、调试和诊断 | W-01发行/配置 | 完整文档、更新流程、自有服务映射及日志 | APP；T-APP |
| W-12 | 集成、完整覆盖、性能/兼容和发行验证 | 所有任务包 | 覆盖台账、验收报告、发行物/依赖说明 | 全需求；T-INT/T-PERF/T-COMP及全部用例 |

依赖关系用于统一接口和集成，不允许W-04、W-07、W-08等被取消或改为下一版。各任务可以在契约确定后同时推进；集成责任始终存在，不能只汇总独立演示。

## 5. 命令与设置覆盖台账

实际开发需维护机器可读台账。建议字段：`requirementId`、`observationId`、`commandId/settingsKey`、`entryPoints`、`implementation`、`caseIds`、`referenceEvidence`、`status`、`dependency`、`difference`。

台账至少覆盖以下命令族，内部动作逐项登记，不能仅登记一个父菜单：

| 命令族 | 逐项覆盖内容 |
| --- | --- |
| file.* | new/newWindow/open/openFolder/quickOpen/recent/save/saveAs/move/saveAll/properties/reveal/revealInSidebar/delete/import/export/print/preferences/close |
| edit.* | undo/redo/cut/copy/copyImage/paste/copyPlain/copyMarkdown/copyHTML/copySimplified/pastePlain |
| selection.* | all/block/lineOrSentence/formatted/word/documentStart/selection/documentEnd/lineStart/lineEnd |
| range.* | moveLineUp/moveLineDown/delete/deleteBlock/deleteLineOrSentence/deleteFormatted/deleteWord |
| text.* | smartPunctuationMode/quotes/dashes/unicode/LF/CRLF/finalNewline/firstIndent/br/softBreak/spelling/emoji |
| paragraph.* | heading1～6/plain/promote/demote/quote/ordered/unordered/task/taskState/indent/outdent/insertBefore/insertAfter/reference/footnote/hr/toc/yaml |
| table.* | create/rowBefore/rowAfter/columnBefore/columnAfter/moveRowUp/moveRowDown/moveColumnLeft/moveColumnRight/deleteRow/deleteColumn/copy/formatSource/delete/alignment |
| code/math/diagram.* | createCode/language/copy/indentSelection/indentBlock/mathBlock/refreshAll/mathSettings/diagramRender和各扩展开关 |
| format.* | bold/italic/underline/code/strike/comment/link/linkActions/clear/highlight/sub/sup |
| image.* | insert/insertLocal/reveal/copy/scale/convertSyntax/deleteFile/copyTo/moveOrRename/upload/copyAll/moveAll/uploadAll/reloadAll/insertStrategy/root/settings |
| navigation/search.* | sidebar/outline/fileList/fileTree/sidebarSearch/find/next/previous/replace/replaceAll/quickOpen |
| view.* | source/focus/typewriter/statusBar/statistics/fullscreen/alwaysOnTop/actualSize/zoomIn/zoomOut/switchWindow/devtools/windowStyle |
| theme.* | 五类内置、自定义加载、目录、主题获取、独立深色 |
| export.* | 所有格式、模板添加/编辑/删除/排序、依赖、快照、取消和后置动作 |
| app.* | help系列/about/changelog/credits/privacy/feedback/site/update/diagnostics/advanced/reset/WindowsNewItem/releaseLicense/serviceSource |

菜单未展开的链接操作、任务状态、图片缩放/语法转换细节登记为参考待验证，但开发仍提供对应可用动作及兼容说明。为当前命令选择OpenTypora合理语义后，不冒充参考实测。

七类配置逐项从观察记录第4节登记，包括禁用项的依赖条件。所有UI选项必须能追溯到配置键及实际消费者；没有消费者的开关不算实现。

## 6. 集成责任和交付文件

每个任务包提交接口说明、命令/配置登记、成功/失败样例、测试结果和依赖版本。接口变动先更新共享契约与消费者；同一字段不能在多个模块私自定义不同含义。

整体交付需包含：

1. Windows可运行发行物及可复现构建说明。
2. 全部功能覆盖台账，没有未实现但标完成的行。
3. Markdown、公式、图表兼容矩阵，含版本和输入/导出样例。
4. 每种导出和导入的结果及损失矩阵；每种上传适配的配置与成功/失败验证。
5. 中文帮助、快捷键、自定义主题、高级配置、恢复、转换器/上传依赖说明。
6. 全部验收用例的真实执行记录及已修复缺陷；参考差异清单。
7. 设置/草稿/资源数据位置与迁移说明，卸载/更新对用户内容的影响说明。

验收按PRD完整范围进行，开发内部的任务先后顺序不会形成缩减发行版。若存在参考未测细节，记录差异并按已定义产品行为交付；若存在实际实现失败，保留未完成状态并修复，不能将其改写成“不在范围”。
