// Local rendering of the editable vector; no network or model calls.
const {app,BrowserWindow,nativeImage}=require('electron');
const {readFileSync,writeFileSync}=require('node:fs');
const {resolve,join}=require('node:path');
app.whenReady().then(async()=>{
  const root=resolve('apps/desktop/public/icons');
  const window=new BrowserWindow({width:256,height:256,show:false,frame:false,transparent:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html,body{margin:0;width:256px;height:256px;overflow:hidden;background:transparent}svg{display:block;width:256px;height:256px}</style>'+readFileSync(join(root,'book.svg'),'utf8')));
  const png=await window.webContents.executeJavaScript(`(async()=>{
    const svg=new XMLSerializer().serializeToString(document.querySelector('svg'));
    const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    canvas.getContext('2d').drawImage(image,0,0,256,256);return canvas.toDataURL('image/png');
  })()`);
  const source=nativeImage.createFromDataURL(png);
  const sizes=[16,24,32,48,64,128,256];
  const images=sizes.map(size=>source.resize({width:size,height:size,quality:'best'}).toPNG());
  writeFileSync(join(root,'book.png'),images.at(-1));
  writeFileSync(join(root,'book-tray.png'),images[1]);
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
  let offset=header.length;
  for(let i=0;i<sizes.length;i++){const p=6+i*16;header[p]=header[p+1]=sizes[i]%256;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(images[i].length,p+8);header.writeUInt32LE(offset,p+12);offset+=images[i].length}
  writeFileSync(join(root,'book.ico'),Buffer.concat([header,...images]));
  window.destroy();app.quit();
}).catch(error=>{console.error(error.message);app.exit(1)});
