const {app,BrowserWindow}=require('electron');
const {join}=require('node:path');
app.setPath('userData',join(__dirname,'isolated-user-data'));
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:1000,height:720,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 try{
  await window.loadFile(join(__dirname,'index.html'));
  const report=await window.webContents.executeJavaScript('runAnalysisAudit()');
  console.log(JSON.stringify({...report,rows:report.rows.map(row=>({...row,jobs:row.jobs.map(({samples,...job})=>job)}))}));app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
