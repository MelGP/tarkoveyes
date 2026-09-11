const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const raw=JSON.parse(fs.readFileSync(path.join(root,'fresh-items.json'))).data;
const english=JSON.parse(fs.readFileSync(path.join(root,'fresh-items_en.json'))).data;
const definitions=[
  ['Battle Pass documents','6a35427afc3f27b15905a876'],['Valuables','5b47574386f77428ca22b2f1'],
  ['Medication','5b47574386f77428ca22b344'],['Medical supplies','5b47574386f77428ca22b2f3'],
  ['Food & drinks','5b47574386f77428ca22b340'],['Keys','5b47574386f77428ca22b342'],
  ['Weapons','5b5f78dc86f77409407a7f8e'],['Ammo','5b47574386f77428ca22b346'],
  ['Weapon parts','5b5f71a686f77447ed5636ab'],['Gear','5b47574386f77428ca22b33f'],
  ['Quest items','5b5f740a86f77447ec5d7706'],['Info items','5b47574386f77428ca22b341'],
  ['Special equipment','5b47574386f77428ca22b345'],['Barter items','5b47574386f77428ca22b33e']
];
function metadata(item){
  const ids=new Set(item.handbookCategories||[]);
  for(const id of [...ids]){let current=raw.handbookCategories[id];while(current?.parent&&!ids.has(current.parent)){ids.add(current.parent);current=raw.handbookCategories[current.parent];}}
  return {category:definitions.find(([,id])=>ids.has(id))?.[0]||'Other',handbookCategories:[...(item.handbookCategories||[])]};
}
for(const mode of ['pvp','pve','seasonal']){
  const target=path.join(root,'app/data/items-'+mode+'.json'),doc=JSON.parse(fs.readFileSync(target)),byId=new Map(doc.items.map(item=>[item.id,item]));
  for(const item of Object.values(raw.items)){
    const meta=metadata(item),existing=byId.get(item.id);
    if(existing)Object.assign(existing,meta);
    else byId.set(item.id,{id:item.id,name:english[item.name]||item.normalizedName,shortName:english[item.shortName]||english[item.name]||item.normalizedName,normalizedName:item.normalizedName||'',updated:item.updated||null,width:Math.max(1,Number(item.width)||1),height:Math.max(1,Number(item.height)||1),avg24hPrice:Number.isFinite(item.avg24hPrice)?item.avg24hPrice:null,low24hPrice:Number.isFinite(item.low24hPrice)?item.low24hPrice:null,high24hPrice:Number.isFinite(item.high24hPrice)?item.high24hPrice:null,lastLowPrice:Number.isFinite(item.lastLowPrice)?item.lastLowPrice:null,changeLast48hPercent:Number.isFinite(item.changeLast48hPercent)?item.changeLast48hPercent:null,minLevelForFlea:Number.isFinite(item.minLevelForFlea)?item.minLevelForFlea:null,types:Array.isArray(item.types)?item.types:[],bestTrader:null,...meta});
  }
  doc.generatedAt=new Date().toISOString();doc.items=[...byId.values()].sort((a,b)=>a.name.localeCompare(b.name));fs.writeFileSync(target,JSON.stringify(doc));console.log(mode+': '+doc.items.length+' categorized items');
}
