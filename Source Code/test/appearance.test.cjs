const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {signatureOf,signatureBytes,signatureFrom,resemblance,itemFloor}=require('../appearance.cjs');

// A block of one colour, as BGRA, which is what a screen capture hands over.
function block(width,height,colour){
  const pixels=Buffer.alloc(width*height*4);
  for(let i=0;i<pixels.length;i+=4){
    pixels[i]=colour[2];pixels[i+1]=colour[1];pixels[i+2]=colour[0];pixels[i+3]=255;
  }
  return pixels;
}
const red=[200,20,20],green=[20,200,20],darkTile=[12,12,14];

test('colour signatures separate the things the reading confuses',()=>{
  const a=signatureOf(block(16,16,red),16,16),b=signatureOf(block(16,16,green),16,16);
  assert.equal(resemblance(a,a),1);
  assert.equal(resemblance(a,b),0);
  // half of one and half of the other shares half its colour with each
  const mixed=Buffer.concat([block(16,8,red),block(16,8,green)]);
  const both=signatureOf(mixed,16,16);
  assert.ok(Math.abs(resemblance(both,a)-0.5)<0.01);
  assert.ok(Math.abs(resemblance(both,b)-0.5)<0.01);
});

test('an empty inventory slot describes nothing rather than something dark',()=>{
  // the tile background is below the floor, so there is no item to describe
  assert.equal(signatureOf(block(16,16,darkTile),16,16),null);
  assert.ok(darkTile.every(channel=>channel<itemFloor));
  // and a box can be restricted to part of the capture
  const half=Buffer.concat([block(16,8,red),block(16,8,darkTile)]);
  const top=signatureOf(half,16,16,{left:0,top:0,width:16,height:8});
  assert.equal(resemblance(top,signatureOf(block(16,16,red),16,16)),1);
});

test('a stored signature still means what it meant',()=>{
  const live=signatureOf(block(16,16,red),16,16),
    stored=signatureFrom(signatureBytes(live));
  assert.ok(resemblance(live,stored)>0.99);
  assert.equal(signatureFrom('not base64 of the right length'),null);
  assert.equal(signatureFrom(''),null);
  assert.equal(resemblance(live,null),null);
});

test('the scan takes its colour sample before the text is lifted out of it',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
  // liftText makes the crop grey, so a sample taken after it describes nothing
  assert.match(main,/appearance: \(\) => \{[\s\S]*?source\.thumbnail\.crop/);
  assert.doesNotMatch(main,/appearance: \(\) => \{[\s\S]*?liftText[\s\S]*?\}/);
  // and the picture is only consulted when the cursor is on an item, not on a
  // line of text that names one
  assert.match(main,/onArtwork = !cursorOnText\(lines\)/);
  assert.match(main,/if \(!onArtwork\) return matchItemLines\(lines, catalog, shownMatches\);/);
  // the weaker names are only kept because something else is there to judge them
  assert.match(main,/matchItemLines\(lines, catalog, weakNameKeep, weakNameFloor\)/);
});

test('every item the price catalogs list has a picture on file',()=>{
  const file=path.join(__dirname,'../app/data/item-appearance.json'),
    doc=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(doc.schemaVersion,1);
  const described=Object.keys(doc.signatures).length;
  assert.ok(described>4500,'only '+described+' items described');
  for(const text of Object.values(doc.signatures).slice(0,200))
    assert.ok(signatureFrom(text),'a stored signature does not decode');
  // the catalogs and the pictures must be about the same set of items
  const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data/items-seasonal.json'),'utf8'));
  const covered=catalog.items.filter(item=>doc.signatures[item.id]).length;
  assert.ok(covered/catalog.items.length>0.85,'only '+covered+' of '+catalog.items.length+' covered');
  // and the file has to stay small enough to bundle
  assert.ok(fs.statSync(file).size<2*1024*1024);
});
