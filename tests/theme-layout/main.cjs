const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));
app.on('window-all-closed',()=>undefined);
const timeout=setTimeout(()=>{console.error('THEME_LAYOUT_TIMEOUT');app.exit(1);},60000);
const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
const themes=['github','newsprint','night','pixyll','whitey'];
const table='| 文档 | 用途 |\n| --- | --- |\n| [项目介绍（中文）](../README.zh-CN.md) / [English](../README.md) | 使用、截图、安装与开发入口 |\n| [Windows 安装与卸载](Windows-安装与卸载.md) | 安装包、右键打开、卸载边界与隔离验证 |\n| [产品需求文档](OpenTypora-产品需求文档.md) | 产品定位、完整需求、交互规则、错误处理、配置、数据模型和完成标准 |';
const aligned='| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| 中文 😀 | `a\\|b` | 123 |\n| | **正文** | [链接](https://example.com) |';
const html='<table>\n<thead>\n<tr><th>A</th><th>B</th></tr>\n</thead>\n<tbody>\n<tr><td>HTML 正文</td><td>第二列内容内容</td></tr>\n<tr><td>更多内容</td><td>最后一行</td></tr>\n</tbody>\n</table>';
const wide=Array.from({length:12},(_,i)=>`列 ${i+1}`);
const tables=[table,table.replace(/\n/g,'\r\n'),aligned,html,`| A | B |\n| --- | --- |\n| ${'https://example.com/'+ 'long'.repeat(50)} | ${'中文😀'.repeat(35)} |`,[wide.join(' | '),wide.map(()=>'---').join(' | '),wide.map((_,i)=>`宽表格单元格 ${i}`).join(' | ')].map(row=>'| '+row+' |').join('\n')];
const blocks=[
  ['paragraph','中文  保留空格 😀 **粗体** `a  b`\n第二行'],
  ['list','- 父项\n  - 子项\n    - [ ] 任务\n\n  后续段落\n- 末项'],
  ['quote','> 引用第一行\n>\n> - 列表一\n> - 列表二'],
  ['alert','> [!WARNING]\n> 检查主题下的提示样式'],
  ['code','```js\nconst first = "a  b";\n  const second = 2;\n```'],
  ['html','<h2 align="center">HTML 标题</h2>\n<p align="center">嵌入的 <strong>HTML</strong> 正文</p>'],
  ['math','$$\nx^2 + y^2 = z^2\n$$']
];
const metrics=`(()=>{
  const table=document.querySelector('.ot-preview-block table'),block=table.closest('.ot-preview-block'),head=table.querySelector('thead'),body=table.querySelector('tbody');
  const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
  const headers=[...head.rows[0].cells].map(rect),rows=[...body.rows].map(row=>[...row.cells].map(rect));
  const blanks=[...table.childNodes,...head.childNodes,...body.childNodes].filter(n=>n.nodeType===3&&!n.textContent.trim()).map(n=>{const range=document.createRange();range.selectNodeContents(n);return rect(range)});
  const scroll=table.closest('.ot-table-scroll'),editor=document.querySelector('.cm-scroller');
  return {whiteSpace:getComputedStyle(block).whiteSpace,tableWhiteSpace:getComputedStyle(table).whiteSpace,tableDisplay:getComputedStyle(table).display,table:rect(table),head:rect(head),body:rect(body),headers,rows,blankHeights:blanks.map(r=>r.height),scroll:scroll&&{client:scroll.clientWidth,width:scroll.scrollWidth},editor:{client:editor.clientWidth,width:editor.scrollWidth}};
})()`;
app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:1000,height:760,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const run=code=>window.webContents.executeJavaScript(code);
  const load=async(text,theme,width=900,settings={})=>{await run(`testEditor.load(${JSON.stringify(text)},false,${width},${JSON.stringify(theme)},${JSON.stringify(settings)})`);await pause();};
  const wait=async(condition)=>{for(let attempt=0;attempt<150;attempt++){if(await run(condition))return;await pause();}throw new Error(`Rendering timed out: ${condition}`);};
  let cases=0;
  try {
    await window.loadFile(path.join(__dirname,'index.html'));await pause();
    assert.equal(await run('document.compatMode'),'CSS1Compat','use the same standards mode as the production app');
    for(const theme of themes)for(const width of [900,360]){
      for(const [index,source] of tables.entries()){
        await load(source,theme,width);const result=await run(metrics),label=`${theme}/${width}/table${index}`;
        for(const row of result.rows)for(let column=0;column<row.length;column++){
          assert.ok(Math.abs(row[column].left-result.headers[column].left)<1,`${label}: column ${column} left edge misaligned`);
          assert.ok(Math.abs(row[column].right-result.headers[column].right)<1,`${label}: column ${column} right edge misaligned`);
        }
        assert.ok(Math.abs(result.head.bottom-result.body.top)<1,`${label}: whitespace splits header from body`);
        assert.ok(result.blankHeights.every(height=>height===0),`${label}: formatting newlines create visual rows`);
        assert.ok(result.editor.width<=result.editor.client+1,`${label}: wide table overflows the document instead of its container`);
        if(index===5&&width===360)assert.ok(result.scroll.width>result.scroll.client,`${label}: wide table should scroll inside its container`);
        if(index===2)assert.deepEqual(await run('[...document.querySelectorAll("thead th")].map(cell=>getComputedStyle(cell).textAlign)'),['left','center','right']);
        assert.equal((await run('testEditor.state()')).text,source);cases++;
      }
      for(const [kind,source] of blocks){
        await load(source,theme,width);if(kind==='math')await wait('!!document.querySelector(".math-svg[data-hydrated=true] svg")');
        const result=await run(`(()=>{const block=document.querySelector('.ot-preview-block'),range=document.createRange();return {height:block.getBoundingClientRect().height,blanks:[...block.childNodes].filter(n=>n.nodeType===3&&!n.textContent.trim()).map(n=>{range.selectNodeContents(n);return range.getBoundingClientRect().height}),errors:[...document.querySelectorAll('.ot-render-error')].map(n=>n.textContent),editorOverflow:document.querySelector('.cm-scroller').scrollWidth-document.querySelector('.cm-scroller').clientWidth}})()`);
        assert.ok(result.height>0,`${theme}/${width}/${kind}: block disappeared`);
        assert.ok(result.blanks.every(height=>height===0),`${theme}/${width}/${kind}: generated whitespace adds an empty text line`);
        assert.deepEqual(result.errors,[],`${theme}/${width}/${kind}: rendering error`);
        assert.ok(result.editorOverflow<=1,`${theme}/${width}/${kind}: block overflows the editor`);
        if(kind==='code')assert.equal(await run('document.querySelector("pre code").textContent'),'const first = "a  b";\n  const second = 2;\n');
        if(kind==='list')assert.equal(await run('document.querySelectorAll("li").length'),4);
        assert.equal((await run('testEditor.state()')).text,source);cases++;
      }
      // Preserving user whitespace remains independent from generated HTML whitespace.
      for(const preserve of [true,false]){
        await load('a  b `c  d`',theme,width,{'text.preserveSpaces':preserve});
        const result=await run(`(()=>{const measure=node=>{const range=document.createRange();const start=node.textContent.indexOf('  ');range.setStart(node,start);range.setEnd(node,start+2);return range.getBoundingClientRect().width};const p=document.querySelector('.ot-preview-block p'),code=p.querySelector('code');return {p:measure(p.firstChild),code:measure(code.firstChild),pWhiteSpace:getComputedStyle(p).whiteSpace}})()`);
        assert.ok(result.code>8,`${theme}: inline code lost its literal spaces`);
        assert.ok(preserve?result.p>8:result.p<8,`${theme}: preserveSpaces setting ignored`);cases++;
      }
      // One grid also covers HTML colspan/rowspan and nested tables.
      await load('<table>\n<thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>\n<tbody><tr><td colspan="2">合并列</td><td rowspan="2">合并行</td></tr><tr><td>一</td><td>二</td></tr></tbody>\n</table>',theme,width);
      const spans=await run(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}};return {head:[...document.querySelectorAll('th')].map(rect),rows:[...document.querySelector('tbody').rows].map(row=>[...row.cells].map(rect))}})()`);
      assert.ok(Math.abs(spans.rows[0][0].left-spans.head[0].left)<1&&Math.abs(spans.rows[0][0].right-spans.head[1].right)<1);
      assert.ok(Math.abs(spans.rows[0][1].right-spans.head[2].right)<1&&Math.abs(spans.rows[1][1].right-spans.head[1].right)<1);cases++;
      await load('<table><thead><tr><th>外表</th><th>内容</th></tr></thead><tbody><tr><td>正文</td><td><table><tr><td>内表</td><td>数值</td></tr></table></td></tr></tbody></table>',theme,width);
      assert.equal(await run('document.querySelectorAll(".ot-table-scroll").length'),1);assert.equal(await run('document.querySelectorAll("table").length'),2);cases++;
      // Editing and changing mode must retain the same source and undo history.
      await load(table.replace(/\n/g,'\r\n'),theme,width);
      const before=await run('testEditor.state()');await run(`testEditor.select(${before.text.indexOf('使用')})`);await pause();
      assert.equal(await run('document.querySelectorAll(".ot-preview-table").length'),0);
      await run('testEditor.mode(true)');await pause();await run('testEditor.mode(false)');await pause();
      assert.equal((await run('testEditor.state()')).text,before.text);assert.equal((await run('testEditor.state()')).version,before.version);
      assert.equal(await run('document.querySelectorAll(".ot-preview-table").length'),1);cases++;
    }
    for(const theme of themes){
      await load('```mermaid\nflowchart LR\nA-->B\n```\n\n```sequence\nA->B: hello\n```\n\n```flow\na=>start: Start\nb=>end: End\na->b\n```',theme,900);
      await wait('document.querySelectorAll("[data-diagram][data-hydrated=true] svg").length===3');
      assert.equal(await run('document.querySelectorAll(".render-error").length'),0);cases++;
    }
    console.log(JSON.stringify({themeLayout:true,themes:themes.length,widths:2,cases,tablesAligned:true,wideTableScroll:true,htmlSpans:true,blockWhitespace:true,preserveSpaces:true,codeMathDiagrams:true,sourceUnchanged:true}));clearTimeout(timeout);app.exit(0);
  }catch(error){console.error(error);console.error(await run(metrics).catch(()=>null));clearTimeout(timeout);app.exit(1);}
});
