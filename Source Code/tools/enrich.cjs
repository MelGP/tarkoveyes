// Development-time data refresh only. Not included in packaged application.
const fs=require('node:fs');
async function json(url){const r=await fetch(url);if(!r.ok)throw Error(url+' '+r.status);return JSON.parse(await r.text());}
async function run(){
  const names=(await json('https://json.tarkov.dev/regular/items_en')).data;
  for(const [mode,file] of [['regular','quests'],['pve','quests-pve']]){
    const raw=(await json('https://json.tarkov.dev/'+mode+'/tasks')).data.tasks;
    const doc=JSON.parse(fs.readFileSync('app/data/'+file+'.json'));
    for(const q of doc.quests){
      const task=raw[q.id];if(!task)continue;
      q.neededKeys=(task.neededKeys||[]).filter(g=>g.map==='56f40101d2720b2a4d8b45d6').flatMap(g=>g.keys).map(id=>({id,name:names[id+' Name']||names[id+' name']||id}));
      q.neededKeys=q.neededKeys.filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);
      for(const o of q.objectives){const item=task.objectives.find(x=>x.id===o.id);if(!item)continue;
        o.requiredKeys=(item.requiredKeys||[]).map(group=>group.map(id=>names[id+' Name']||id));
        o.itemNames=(item.items||[]).slice(0,12).map(id=>names[id+' Name']||id);
      }
    }
    doc.requirementsUpdatedAt=new Date().toISOString();
    fs.writeFileSync('app/data/'+file+'.json',JSON.stringify(doc));
    console.log(mode+': enriched '+doc.quests.filter(q=>q.neededKeys?.length).length+' quests with Customs keys.');
  }
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
