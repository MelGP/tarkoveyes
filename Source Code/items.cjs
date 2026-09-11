const modeSlugs={pvp:'regular',pve:'pve',seasonal:'pvp-season'};

function translate(dictionary,value){return typeof value==='string'?(dictionary[value]||value):'';}
function finitePrice(value){return Number.isFinite(Number(value))&&Number(value)>=0?Math.round(Number(value)):null;}
function itemCategory(raw,categories,english){
  const ids=new Set(raw?.handbookCategories||[]);for(const id of [...ids]){let current=categories[id];while(current?.parent&&!ids.has(current.parent)){ids.add(current.parent);current=categories[current.parent];}}
  const choices=[['Battle Pass documents','6a35427afc3f27b15905a876'],['Valuables','5b47574386f77428ca22b2f1'],['Medication','5b47574386f77428ca22b344'],['Medical supplies','5b47574386f77428ca22b2f3'],['Food & drinks','5b47574386f77428ca22b340'],['Keys','5b47574386f77428ca22b342'],['Weapons','5b5f78dc86f77409407a7f8e'],['Ammo','5b47574386f77428ca22b346'],['Weapon parts','5b5f71a686f77447ed5636ab'],['Gear','5b47574386f77428ca22b33f'],['Quest items','5b5f740a86f77447ec5d7706'],['Info items','5b47574386f77428ca22b341'],['Special equipment','5b47574386f77428ca22b345'],['Barter items','5b47574386f77428ca22b33e']];
  const match=choices.find(([,id])=>ids.has(id)),leaf=(raw?.handbookCategories||[])[0];
  return {category:match?.[0]||(leaf?english[leaf]||categories[leaf]?.normalizedName:'Other'),handbookCategories:[...(raw?.handbookCategories||[])]};
}

function normalizeItemPayload(itemEnvelope,englishEnvelope,traderEnvelope,traderEnglishEnvelope,mode){
  if(!modeSlugs[mode])throw Error('Invalid item catalog mode');
  const rawItems=itemEnvelope?.data?.items,english=englishEnvelope?.data,handbookCategories=itemEnvelope?.data?.handbookCategories||{},rawTraders=traderEnvelope?.data,traderEnglish=traderEnglishEnvelope?.data;
  if(!rawItems||typeof rawItems!=='object'||!english||typeof english!=='object'||!rawTraders||typeof rawTraders!=='object'||!traderEnglish||typeof traderEnglish!=='object')throw Error('Invalid tarkov.dev item response');
  const traderNames={};
  for(const [id,trader] of Object.entries(rawTraders)){const key=trader?.nickname||trader?.name;traderNames[id]=translate(traderEnglish,key)||id;}
  const items=[];
  for(const [id,raw] of Object.entries(rawItems)){
    const name=translate(english,raw?.name),shortName=translate(english,raw?.shortName);
    if(!name||name===raw?.name||/^[a-f0-9]{24} Name$/i.test(name))continue;
    const traderOffers=(raw.sellToTrader||[]).map(offer=>({trader:traderNames[offer.trader]||'Trader',price:finitePrice(offer.priceRUB??offer.price)})).filter(offer=>offer.price!==null).sort((a,b)=>b.price-a.price);
    items.push({id:String(raw.id||id),name:name.slice(0,180),shortName:(shortName||name).slice(0,80),normalizedName:String(raw.normalizedName||''),updated:raw.updated||raw.lastScan||null,width:Math.max(1,Number(raw.width)||1),height:Math.max(1,Number(raw.height)||1),avg24hPrice:finitePrice(raw.avg24hPrice),low24hPrice:finitePrice(raw.low24hPrice),high24hPrice:finitePrice(raw.high24hPrice),lastLowPrice:finitePrice(raw.lastLowPrice),changeLast48hPercent:Number.isFinite(Number(raw.changeLast48hPercent))?Number(raw.changeLast48hPercent):null,minLevelForFlea:finitePrice(raw.minLevelForFlea),types:Array.isArray(raw.types)?raw.types.filter(type=>typeof type==='string').slice(0,12):[],bestTrader:traderOffers[0]||null,...itemCategory(raw,handbookCategories,english)});
  }
  const newest=items.map(item=>Date.parse(item.updated)).filter(Number.isFinite).sort((a,b)=>b-a)[0];
  return validateItemCatalog({format:'raid-notes-items-v1',mode,source:'tarkov.dev',generatedAt:new Date().toISOString(),pricesUpdatedAt:newest?new Date(newest).toISOString():null,items:items.sort((a,b)=>a.name.localeCompare(b.name))});
}

function validateItemCatalog(doc){
  if(!doc||doc.format!=='raid-notes-items-v1'||!modeSlugs[doc.mode]||!Array.isArray(doc.items)||doc.items.length<1000||doc.items.length>7000)throw Error('Invalid item catalog');
  const ids=new Set();
  for(const item of doc.items){if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>180||typeof item.shortName!=='string'||item.shortName.length>80||!Number.isFinite(item.width)||!Number.isFinite(item.height))throw Error('Invalid item entry');ids.add(item.id);}
  return doc;
}

function normalizeText(value){return String(value||'').toLowerCase().replace(/[|]/g,'i').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function dice(a,b){if(a===b)return 1;if(a.length<2||b.length<2)return 0;const grams=new Map();for(let i=0;i<a.length-1;i++){const g=a.slice(i,i+2);grams.set(g,(grams.get(g)||0)+1);}let hits=0;for(let i=0;i<b.length-1;i++){const g=b.slice(i,i+2),n=grams.get(g)||0;if(n){hits++;grams.set(g,n-1);}}return 2*hits/(a.length+b.length-2);}
function phraseScore(expected,actual){
  const a=normalizeText(expected),b=normalizeText(actual);if(!a||!b)return 0;if(a===b)return 1;
  if(a.length>=5&&b.includes(a))return .9+.1*Math.min(1,a.length/b.length);
  if(b.length>=5&&a.includes(b))return .72+.16*Math.min(1,b.length/a.length);
  const aw=a.split(' ').filter(Boolean),bw=new Set(b.split(' ').filter(Boolean)),coverage=aw.filter(word=>bw.has(word)).length/aw.length;
  return coverage*.62+dice(a,b)*.38;
}
function matchItemText(text,catalog,limit=6){
  validateItemCatalog(catalog);const rawLines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(line=>normalizeText(line).length>=3),phrases=[...rawLines];
  for(let i=0;i<rawLines.length-1;i++)phrases.push(rawLines[i]+' '+rawLines[i+1]);
  const all=normalizeText(text),results=[];
  for(const item of catalog.items){let score=0,matched='';for(const phrase of phrases){let current=phraseScore(item.name,phrase);const short=normalizeText(item.shortName);if(short.length>=4)current=Math.max(current,phraseScore(item.shortName,phrase)*.94);else if(short.length>=3&&new RegExp('(?:^| )'+short.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?: |$)').test(normalizeText(phrase)))current=Math.max(current,.82);if(current>score){score=current;matched=phrase;}}const fullName=normalizeText(item.name);if(fullName.length>=5&&all.includes(fullName))score=Math.max(score,.99);if(score>=.43)results.push({...item,confidence:Number(score.toFixed(2)),matchedText:matched});}
  return results.sort((a,b)=>b.confidence-a.confidence||(b.avg24hPrice||0)-(a.avg24hPrice||0)||a.name.localeCompare(b.name)).slice(0,Math.max(1,Math.min(10,limit)));
}

module.exports={modeSlugs,normalizeItemPayload,validateItemCatalog,matchItemText,normalizeText,phraseScore};
