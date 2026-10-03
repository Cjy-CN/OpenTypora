const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));
app.on('window-all-closed',()=>undefined);
const timeout=setTimeout(()=>{console.error('EDITOR_INPUT_TIMEOUT');app.exit(1);},45000);
const pause=()=>new Promise(resolve=>setTimeout(resolve,60));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:1000,height:760,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const run=code=>window.webContents.executeJavaScript(code),state=()=>run('testEditor.state()');
  const load=async(text,sourceMode=false,width=640,theme='github')=>{await run(`testEditor.load(${JSON.stringify(text)},${sourceMode},${width},${JSON.stringify(theme)})`);await pause();};
  const point=(needle,offset=0)=>run(`testEditor.point(${JSON.stringify(needle)},${offset})`);
  const mouse=async(type,position,extra={})=>{await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:{mouseDown:'mousePressed',mouseUp:'mouseReleased',mouseMove:'mouseMoved'}[type],...position,button:extra.button??'none',buttons:type==='mouseUp'?0:1,clickCount:extra.clickCount??0});await pause();};
  const click=async(position)=>{await mouse('mouseDown',position,{button:'left',clickCount:1});await mouse('mouseUp',position,{button:'left',clickCount:1});};
  const key=async(keyCode,modifiers=[])=>{window.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});window.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await pause();};
  try {
    await window.loadFile(path.join(__dirname,'index.html'));window.webContents.debugger.attach('1.3');await pause();
    const text='第一段 中文😀 **粗体文字** 与 [链接文字](https://example.com) 末尾。\r\n\r\n## 第二段标题\r\n\r\n第三段 可选择的文字。\r\n\r\n- 列表第一项\r\n- 列表第二项\r\n\r\n| 表头 | 另一列 |\r\n| --- | --- |\r\n| 表格正文 | 数值 |\r\n\r\n```js\r\nconst first = 1;\r\nconst second = 2;\r\n```\r\n\r\n<h2>HTML 标题</h2>\r\n<p>HTML 正文</p>';
    await load(text);assert.equal((await state()).previews,7);
    const start=await point('第一段',3),end=await point('第三段',6),initialLayout=await run('testEditor.layout()');
    await mouse('mouseDown',start,{button:'left',clickCount:1});
    await mouse('mouseMove',end,{modifiers:['leftButtonDown']});
    let snapshot=await state();assert.equal(snapshot.selecting,true);assert.equal(snapshot.selection.anchor,text.indexOf('第一段')+3);assert.equal(snapshot.selection.head,text.indexOf('第三段')+6);
    assert.deepEqual(await run('testEditor.layout()'),initialLayout,'selection reflowed its hit targets before mouseup');
    await mouse('mouseUp',end,{button:'left',clickCount:1});snapshot=await state();assert.equal(snapshot.selecting,false);assert.equal(snapshot.text,text);assert.equal(snapshot.version,0);
    for(const [needle,offset] of [['第二段标题',2],['列表第二项',3],['表格正文',2],['const second',7],['HTML 正文',6]]){
      await load(text);const a=await point('粗体文字',1),b=await point(needle,offset),layout=await run('testEditor.layout()');
      await mouse('mouseDown',a,{button:'left',clickCount:1});await mouse('mouseMove',b);snapshot=await state();assert.equal(snapshot.selection.head,text.indexOf(needle)+offset,`drag to ${needle}`);assert.deepEqual(await run('testEditor.layout()'),layout);assert.ok(await run('document.querySelectorAll(".ot-pointer-highlight").length>0'),'drag selection must be visible');await mouse('mouseUp',b,{button:'left',clickCount:1});assert.equal((await state()).text,text);
    }
    await load(text);const reverseStart=await point('列表第二项',3),reverseEnd=await point('粗体文字',2);
    await mouse('mouseDown',reverseStart,{button:'left',clickCount:1});await mouse('mouseMove',reverseEnd,{modifiers:['leftButtonDown']});snapshot=await state();assert.equal(snapshot.selection.anchor,text.indexOf('列表第二项')+3);assert.equal(snapshot.selection.head,text.indexOf('粗体文字')+2);await mouse('mouseUp',reverseEnd,{button:'left',clickCount:1});
    await load(text);await click(await point('链接文字',2));snapshot=await state();assert.equal(snapshot.selection.head,text.indexOf('链接文字')+2);assert.equal(snapshot.text,text);assert.equal(snapshot.previews,6);
    window.webContents.sendInputEvent({type:'char',keyCode:'新'});await pause();assert.equal((await state()).text,text.slice(0,snapshot.selection.head)+'新'+text.slice(snapshot.selection.head));await run('testEditor.undo()');assert.equal((await state()).text,text);
    const activeStart=await point('粗体文字',1),activeEnd=await point('链接文字',3),activeLayout=await run('testEditor.layout()');await mouse('mouseDown',activeStart,{button:'left',clickCount:1});await mouse('mouseMove',activeEnd);assert.equal((await state()).selection.head,text.indexOf('链接文字')+3);assert.deepEqual(await run('testEditor.layout()'),activeLayout);await mouse('mouseUp',activeEnd,{button:'left',clickCount:1});
    const wrapped='这是自动换行的中文段落，包含 😀 表情和 **粗体**，用于检查鼠标与键盘的坐标。'.repeat(5)+'\r\n\r\n## 下一个标题\r\n\r\n下一段第一行\r\n下一段第二行\r\n下一段第三行';
    await load(wrapped,false,420);await click(await point('这是自动换行',5));let before=await state();const column=before.caret.x;
    for(let i=0;i<4;i++){await key('Down');const after=await state();assert.ok(after.selection.head>before.selection.head,'ArrowDown must advance');assert.ok(after.caret.top>before.caret.top,'ArrowDown must move visually down');assert.ok(Math.abs(after.caret.x-column)<22,'ArrowDown must preserve the visual column');before=after;}
    for(let i=0;i<4;i++){await key('Up');const after=await state();assert.ok(after.selection.head<before.selection.head,'ArrowUp must go backwards');assert.ok(after.caret.top<before.caret.top,'ArrowUp must move visually up');before=after;}
    assert.equal((await state()).text,wrapped);assert.equal((await state()).version,0);
    const lines='第一段 第一行\n第一段 第二行\n\n第二段 第一行\n第二段 第二行\n\n第三段 第一行\n第三段 第二行';
    await load(lines);await click(await point('第一段 第二行',3));const positions=[];
    for(let i=0;i<5;i++){await key('Down');positions.push((await state()).selection.head);}
    assert.ok(positions.some(p=>p>=lines.indexOf('第二段 第一行')&&p<=lines.indexOf('第二段 第一行')+8),'ArrowDown skipped the first line of a preview paragraph');
    assert.ok(positions.some(p=>p>=lines.indexOf('第二段 第二行')&&p<=lines.indexOf('第二段 第二行')+8),'ArrowDown skipped the second line of a preview paragraph');
    await run(`testEditor.select(${lines.indexOf('第三段 第二行')+3})`);const upwards=[];for(let i=0;i<5;i++){await key('Up');upwards.push((await state()).selection.head);}assert.ok(upwards.some(p=>p>=lines.indexOf('第二段 第二行')&&p<lines.indexOf('第二段 第二行')+8),'ArrowUp skipped a preview paragraph');
    await run('testEditor.select(3)');await key('Down',['shift']);snapshot=await state();assert.equal(snapshot.selection.anchor,3);assert.ok(snapshot.selection.head>3);await key('Up',['shift']);assert.equal((await state()).selection.anchor,3);
    await load(lines,true);await click(await point('第一段 第一行',2));const raw=await state();await key('Down');assert.equal((await state()).viewSelection.head,raw.viewSelection.head+8);
    for(const theme of ['github','newsprint','night','pixyll','whitey']){
      await load(lines,false,640,theme);await click(await point('第三段 第二行',3));for(const line of await run('testEditor.geometry()'))assert.ok(Math.abs(line.expected-line.actual)<2,`${theme}: editor height map disagrees with rendered lines: ${JSON.stringify(line)}`);
      const before=await state();await key('Up');snapshot=await state();assert.ok(snapshot.selection.head<before.selection.head&&snapshot.selection.head>=lines.indexOf('第三段 第一行'),`${theme}: ArrowUp skipped a text line`);await key('Down');assert.equal((await state()).selection.head,before.selection.head);
    }
    console.log(JSON.stringify({editorInteraction:true,previewOnOpen:true,forwardDrag:true,reverseDrag:true,richBlockDrag:true,activeParagraphDrag:true,visibleSelection:true,clickAndUndo:true,wrappedVerticalMovement:true,crossBlockMovement:true,shiftArrowSelection:true,sourceMode:true,themes:5,heightMapMatchesDOM:true}));clearTimeout(timeout);app.exit(0);
  }catch(error){console.error(error);console.error(await state().catch(()=>null));console.error(await run('testEditor.layout()').catch(()=>null));clearTimeout(timeout);app.exit(1);}
});
