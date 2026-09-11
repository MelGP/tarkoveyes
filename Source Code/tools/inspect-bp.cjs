const fs=require('fs'),path=require('path');
const sharp=require('C:/Users/lagmy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const root=path.resolve(__dirname,'../app'),maps=require('../app/data/maps.json'),bp=require('../app/data/battlepass-spawns.json');
const out=path.join(__dirname,'sources/battlepass/calibration');fs.mkdirSync(out,{recursive:true});
(async()=>{for(const m of bp.maps){
 const d=maps.find(d=>d.id===m.id),source=path.join(root,m.image),target=path.join(root,'assets',d.baseAsset.path);
 const left=await sharp(source).resize(1000,1000,{fit:'fill'}).png().toBuffer();
 let buf=fs.readFileSync(target);
 if(target.endsWith('.svg')){let s=buf.toString();s=s.replace('</svg>',`<style>${d.floors.filter(f=>f.svgLayer).map(f=>'[id="'+f.svgLayer+'"]{display:none}').join('')}</style></svg>`);buf=Buffer.from(s);}
 const right=await sharp(buf,{limitInputPixels:false}).resize(1000,1000,{fit:'fill'}).png().toBuffer();
 let grid='<svg width="2000" height="1030">';for(let side=0;side<2;side++){for(let i=100;i<1000;i+=100){grid+=`<path d="M${side*1000+i} 30v1000 M${side*1000} ${i+30}h1000" stroke="#ffea7b" stroke-opacity=".4" stroke-width="1"/><text x="${side*1000+i+2}" y="50" fill="yellow" font-size="16">${i}</text><text x="${side*1000+2}" y="${i+30}" fill="yellow" font-size="16">${i}</text>`;}}
 grid+=`<text x="10" y="22" fill="white" font-size="20">${m.id} SOURCE normalized 1000</text><text x="1010" y="22" fill="white" font-size="20">TARGET normalized 1000</text></svg>`;
 await sharp({create:{width:2000,height:1030,channels:4,background:'#182021'}}).composite([{input:left,left:0,top:30},{input:right,left:1000,top:30},{input:Buffer.from(grid)}]).png().toFile(path.join(out,m.id+'.png'));
}console.log(out)})();
