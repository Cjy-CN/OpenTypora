const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));
app.on('window-all-closed',()=>undefined);
const timeout=setTimeout(()=>{console.error('SIDEBAR_LAYOUT_TIMEOUT');app.exit(1);},60000);
app.whenReady().then(async()=>{
 const window=new BrowserWindow({width:1100,height:760,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 const run=code=>window.webContents.executeJavaScript(code);
 const wait=async(condition)=>{for(let i=0;i<100;i++){if(await run(condition))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Timed out: '+condition);};
 let cases=0;
 const verify=async()=>{
  const cards=await run('sidebarTest.inspect()');assert.ok(cards.length>0&&cards.length<120,'List must remain virtualized');
  for(const card of cards){
   assert.equal(card.card.height,148);
   for(let i=0;i<card.children.length;i++){
    const child=card.children[i];
    assert.ok(child.height>=child.lineHeight-.5,`${card.name}: clipped ${child.tag}: ${JSON.stringify(child)}`);
    assert.ok(child.top>=card.card.top&&child.bottom<=card.card.bottom,`${card.name}: child outside its row`);
    assert.ok(child.left>=card.card.left&&child.right<=card.card.right,`${card.name}: horizontal overflow`);
    if(i)assert.ok(child.top>=card.children[i-1].bottom,`${card.name}: overlapping text`);
   }
   const title=card.children.find(child=>child.tag==='STRONG'),summary=card.children.find(child=>child.tag==='SPAN'),location=card.children.find(child=>child.tag==='SMALL');
   assert.ok(title.height<=title.lineHeight*2+.5,`${card.name}: title exceeds two lines`);
   assert.ok(!location||location.text!==card.name,`${card.name}: duplicate filename in path`);
   assert.ok(summary.height>=summary.lineHeight*2-.5,`${card.name}: insufficient space for two summary lines`);
  }
  const ordered=cards.toSorted((a,b)=>a.card.top-b.card.top);for(let i=1;i<ordered.length;i++)assert.ok(ordered[i].card.top>=ordered[i-1].card.bottom);
  assert.equal(await run('sidebarTest.source()'),'# Unchanged document\n');cases++;
 };
 try{
  for(const language of ['zh-CN','en'])for(const theme of ['github','newsprint','night','pixyll','whitey','custom'])for(const width of [168,264,400]){
   await window.loadFile(path.join(__dirname,'index.html'),{query:{theme,language,width:String(width)}});
   const listSelector=`[aria-label="${language==='en'?'Document list':'摘要列表'}"]`;
   await wait(`!!window.sidebarTest && !!document.querySelector(${JSON.stringify(listSelector)})`);
   await run('sidebarTest.command("view.fileList")');await wait('document.querySelectorAll(".file-summary").length>0');
   await wait('document.querySelector(".file-summary>span").textContent.startsWith("树包助手")');
   await run('document.fonts.ready');await verify();
   const labels=language==='en'?['File tree','Document list','Search file contents','Refresh folder']:['树形视图','摘要列表','搜索文件内容','刷新目录'];
   assert.deepEqual(await run('[...document.querySelectorAll(".sidebar-section-heading>div button")].map(button=>[button.getAttribute("aria-label"),button.title])'),labels.map(label=>[label,label]));
   const controls=await run(`(()=>{const sidebar=document.querySelector('.workspace-sidebar').getBoundingClientRect();const buttons=[...document.querySelectorAll('.sidebar-view-actions button,.sidebar-footer button')].map(button=>{const r=button.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,icon:getComputedStyle(button.querySelector('svg')).width};});const status=document.querySelector('.workspace-status-bar');return {sidebar:{left:sidebar.left,right:sidebar.right},buttons,folderFont:getComputedStyle(document.querySelector('.root-directory')).fontSize,statusHeight:status.getBoundingClientRect().height,statusFont:getComputedStyle(status).fontSize,statusButtons:[...status.querySelectorAll('button')].map(button=>button.getBoundingClientRect().height),filterHeight:document.querySelector('.sidebar-file-filter input').getBoundingClientRect().height}})()`);
   assert(controls.buttons.every(button=>button.width>=32&&button.height>=32&&button.left>=controls.sidebar.left&&button.right<=controls.sidebar.right),'Sidebar controls must remain usable and inside the sidebar');
   assert(controls.buttons.every(button=>button.icon==='18px'));assert.equal(controls.folderFont,'14px');assert.equal(controls.statusHeight,36);assert.equal(controls.statusFont,'12px');assert(controls.statusButtons.every(height=>height>=32));assert.equal(controls.filterHeight,40);
   for(const top of [40*148,100*148,0]){
    await run(`sidebarTest.scroll(${top})`);await wait(`document.querySelector('.virtual-file-list').scrollTop===${top}`);
    await wait(`Number(document.querySelector('.virtual-summary-row').id.replace('summary-row-',''))===${Math.max(0,Math.floor(top/148)-8)}`);await verify();
   }
   await run('document.querySelector(".file-summary").click()');assert.equal(await run('sidebarTest.opened()'),await run('document.querySelector(".file-summary").title'));
  }
  console.log(JSON.stringify({sidebarLayout:true,scheme:'A',themes:6,languages:2,widths:3,cases,longNames:true,fullTextLines:true,noOverlap:true,noDuplicateRootFilename:true,localizedTooltips:true,virtualScroll:true,minimumButtonSize:32,statusBarHeight:36,sourceUnchanged:true}));clearTimeout(timeout);app.exit(0);
 }catch(error){console.error(error);console.error(JSON.stringify(await run('sidebarTest.inspect()').catch(()=>null)));clearTimeout(timeout);app.exit(1);}
});
