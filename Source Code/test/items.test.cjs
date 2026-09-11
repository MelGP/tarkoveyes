const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {matchItemText,validateItemCatalog,phraseScore}=require('../items.cjs');

test('bundled item price catalogs are resolved and structurally valid',()=>{
  for(const mode of ['pvp','pve','seasonal']){
    const file=path.join(__dirname,'../app/data/items-'+mode+'.json'),catalog=validateItemCatalog(JSON.parse(fs.readFileSync(file,'utf8')));
    assert.ok(catalog.items.length>=5000);
    assert.equal(new Set(catalog.items.map(item=>item.id)).size,catalog.items.length);
    assert.ok(catalog.items.some(item=>item.name==='Graphics card'&&item.avg24hPrice>0));
    assert.ok(catalog.items.some(item=>item.bestTrader?.trader&&item.bestTrader.price>0));
    assert.ok(catalog.items.every(item=>!/[a-f0-9]{24} Name$/i.test(item.name)));
  }
});

test('item OCR matching ranks exact and mildly noisy names first',()=>{
  const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data/items-pvp.json'),'utf8'));
  const exact=matchItemText('INSPECT\nGraphics card\nWeight 0.6 kg',catalog,3);
  assert.equal(exact[0].name,'Graphics card');assert.equal(exact[0].confidence,1);
  const noisy=matchItemText('ITEM\nIntelligence foIder\nFLEA MARKET',catalog,3);
  assert.equal(noisy[0].name,'Intelligence folder');assert.ok(noisy[0].confidence>.7);
  assert.ok(phraseScore('Colt M4A1 5.56x45 assault rifle','Colt M4A1 5.56x45 assault rifle')>.99);
});
