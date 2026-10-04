const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));
app.on('window-all-closed',()=>undefined);
const timeout=setTimeout(()=>{console.error('DIALOG_APPEARANCE_TIMEOUT');app.exit(1);},60000);
app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:1000,height:760,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const run=code=>window.webContents.executeJavaScript(code);
  const wait=async(condition)=>{for(let i=0;i<100;i++){if(await run(condition))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(`Timed out: ${condition}`);};
  const palettes={github:'rgb(255, 255, 255)',newsprint:'rgb(250, 248, 239)',night:'rgb(32, 37, 45)',pixyll:'rgb(255, 255, 255)',whitey:'rgb(255, 255, 255)',custom:'rgb(255, 255, 255)',independentDark:'rgb(32, 37, 45)'};
  const evidence=[];
  const verify=async(theme,selector='.workspace-dialog')=>{
    const result=await run(`dialogAppearance.inspect(${JSON.stringify(selector)})`);
    assert(result?.scoped,`${theme}: dialog outside the theme container`);
    assert.equal(result.background,palettes[theme],`${theme}: background`);
    assert.equal(result.opacity,'1');assert.equal(result.border,'1px');assert(result.controlsInside,`${theme}: controls overflow`);
    assert(result.rect.width>300&&result.rect.height>80);
    assert(result.rect.x>=0&&result.rect.y>=0&&result.rect.x+result.rect.width<=result.viewport.width&&result.rect.y+result.rect.height<=result.viewport.height);
    if(selector==='.workspace-dialog')assert.equal(result.font,'13px');
    assert(!result.color.includes('rgba(0, 0, 0, 0)'));
    evidence.push({theme,title:result.title,background:result.background});
  };
  const close=async()=>{await run('dialogAppearance.close()');await wait('!document.querySelector(".workspace-dialog")');};
  const show=async(command)=>{await run(`dialogAppearance.command(${JSON.stringify(command)})`);await wait('!!document.querySelector(".workspace-dialog")');};
  const assertSource=async()=>{
    await run('dialogAppearance.command("view.source")');await wait('!!document.querySelector(".ot-source-mode")');
    assert.equal(await run('dialogAppearance.source()'),await run('dialogAppearance.text'));
    await run('dialogAppearance.command("view.source")');await wait('!!document.querySelector(".ot-live-mode")');
  };
  try{
    for(const theme of Object.keys(palettes)){
      await window.loadFile(path.join(__dirname,'index.html'),{query:{theme:theme==='independentDark'?'github':theme,...(theme==='independentDark'?{dark:'1'}:{})}});
      await wait('!!window.dialogAppearance && !!document.querySelector(".app-prompt-actions")');
      await verify(theme);
      assert.equal(await run('dialogAppearance.inspect().title'),'恢复草稿');
      assert.equal(await run('document.querySelectorAll(".app-prompt-actions button").length'),9);
      assert((await run('dialogAppearance.inspect().buttons')).slice(1).every(button=>button.font==='13px'));
      await window.setContentSize(720,480);await verify(theme);await window.setContentSize(1000,760);
      await run('dialogAppearance.restore()');await wait('!document.querySelector(".workspace-dialog")');await assertSource();
      for(const command of ['file.new','file.save','file.move','file.delete','file.properties','app.windowsNewItem','app.update','file.preferences','file.quickOpen','file.recent','view.statistics','app.about','app.markdownHelp']){
        await show(command);await verify(theme);await close();await assertSource();
      }
      await run('dialogAppearance.command("format.link")');await wait('!!document.querySelector("dialog[open]")');await verify(theme,'.ot-editor-dialog');
      await run('document.querySelector("dialog").dispatchEvent(new Event("cancel",{cancelable:true}))');await wait('!document.querySelector("dialog[open]")');await assertSource();
    }
    // Shared Dialog also has an opaque fallback outside a theme scope.
    await show('app.about');
    const fallback=await run('const d=document.querySelector(".workspace-modal-backdrop");document.body.append(d);({background:getComputedStyle(d.firstElementChild).backgroundColor,color:getComputedStyle(d.firstElementChild).color})');
    assert.equal(fallback.background,'rgb(255, 255, 255)');assert.equal(fallback.color,'rgb(41, 50, 57)');
    console.log(JSON.stringify({dialogAppearance:true,themes:7,appearanceChecks:evidence.length,recoveryButtons:9,narrowViewport:true,cancelPreservesSource:true,standaloneFallback:true,evidence}));
    clearTimeout(timeout);app.exit(0);
  }catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}
});
