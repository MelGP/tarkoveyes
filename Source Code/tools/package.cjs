const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'node_modules/electron/dist'),out=path.join(root,'dist/RaidNotes-win32-x64');
if(!fs.existsSync(path.join(runtime,'electron.exe')))throw Error('Install Electron before packaging');
const outRelative=path.relative(root,out);if(!outRelative||outRelative.startsWith('..')||path.isAbsolute(outRelative))throw Error('Invalid package output path');
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
for(const entry of fs.readdirSync(runtime)){
  const dest=entry==='electron.exe'?'RaidNotes.exe':entry;
  fs.cpSync(path.join(runtime,entry),path.join(out,dest),{recursive:true});
}
const app=path.join(out,'resources/app');fs.mkdirSync(app,{recursive:true});
for(const item of ['app','main.cjs','preload.cjs','core.cjs','items.cjs','imaging.cjs','appearance.cjs','templates.cjs','licenses','LICENSE','THIRD-PARTY.md'])fs.cpSync(path.join(root,item),path.join(app,item),{recursive:true});
const manifest=require('../package.json'),lock=require('../package-lock.json');
for(const [relative,metadata] of Object.entries(lock.packages||{})){
  if(!relative.startsWith('node_modules/')||metadata.dev)continue;
  const source=path.join(root,relative),destination=path.join(app,relative);if(fs.existsSync(source)){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.cpSync(source,destination,{recursive:true});}
}
fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:manifest.name,version:manifest.version,main:manifest.main,description:manifest.description,dependencies:manifest.dependencies},null,2));
const hashes={};
function inventory(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name),relative=path.relative(out,p).replaceAll('\\','/');if(entry.isDirectory())inventory(p);else if(relative!=='debug.log')hashes[relative]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}}
inventory(out);fs.writeFileSync(path.join(root,'dist/SHA256.json'),JSON.stringify(hashes,null,2));
console.log('Packaged '+manifest.version+' with Electron '+require('electron/package.json').version+' at '+out);
console.log(Object.keys(hashes).length+' files recorded in dist/SHA256.json');
