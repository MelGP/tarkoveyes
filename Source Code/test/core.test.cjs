const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {parseScreenshot,parseLogLine,parseQuestNotifications,scanQuestHistory,canonicalMap,worldToMap,objectiveTarget,parseTaskOcr,Store,Observer}=require('../core.cjs');
const shot='2026-09-05[16-54] _ 178.07, 2.877, 148.702_0, 0, 0, 1_18.34 (0).png';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'raidnotes-test-'));t.after(()=>{const relative=path.relative(os.tmpdir(),dir);if(relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(dir).startsWith('raidnotes-test-'))throw Error('Invalid test cleanup path');fs.rmSync(dir,{recursive:true,force:true});});return dir;}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
test('current filename yields coordinates and raw screenshot heading',()=>{assert.deepEqual(parseScreenshot(shot),{x:178.07,y:2.877,z:148.702,heading:0});});
test('position-only filename works; unrelated, invalid and huge values fail closed',()=>{
  assert.deepEqual(parseScreenshot('2024-01-02[03-04]_1, -2.5, 3.25 (0).PNG'),{x:1,y:-2.5,z:3.25,heading:null});
  for(const name of ['holiday.png','[12-23]_999999, 2, 3.png','[12-23]_NaN, 1, 2.png','[12-23]_1, 2, 3.exe'])assert.equal(parseScreenshot(name),null);
});
test('quaternion normalization is invariant to scale',()=>{assert.equal(parseScreenshot('[00-00]_1, 2, 3_0, 0.7, 0, 0.7.png').heading,parseScreenshot('[00-00]_1, 2, 3_0, 1.4, 0, 1.4.png').heading);});
test('map projection anchors and known dorm objective align',()=>{
  const a=worldToMap({x:698,z:-307}),b=worldToMap({x:-372,z:237});assert.equal(a.x,0);assert.equal(a.y,0);assert.equal(b.x,1062.4827);assert.equal(b.y,535.17401);
  const p=worldToMap({x:178.07,z:148.702});assert.ok(p.x>515&&p.x<518);assert.ok(p.y>447&&p.y<450);
});
test('Labs uses tarkov.dev orientation and places known official landmarks consistently',()=>{
  const maps=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data/maps.json'),'utf8'));
  const lab=maps.find(map=>map.id==='the-lab');
  assert.ok(lab);
  assert.equal(lab.coordinateRotation,270);
  const project=({x,z})=>{
    const radians=lab.coordinateRotation*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
    const rotate=point=>({x:point.x*cos-point.z*sin,z:point.x*sin+point.z*cos});
    const [[x1,z1],[x2,z2]]=lab.bounds;
    const corners=[{x:x1,z:z1},{x:x1,z:z2},{x:x2,z:z1},{x:x2,z:z2}].map(rotate);
    const q=rotate({x,z}),minX=Math.min(...corners.map(p=>p.x)),maxX=Math.max(...corners.map(p=>p.x)),minZ=Math.min(...corners.map(p=>p.z)),maxZ=Math.max(...corners.map(p=>p.z));
    return {x:(q.x-minX)/(maxX-minX),y:(maxZ-q.z)/(maxZ-minZ)};
  };
  const parkingGate=project({x:-231.73,z:-434.816}),hangarGate=project({x:-170.66,z:-245.94}),testRoom=project({x:-130,z:-356});
  assert.ok(parkingGate.x<.2&&parkingGate.y<.35,'Parking Gate must remain in the upper-left of the official Labs artwork');
  assert.ok(hangarGate.x>.75,'Hangar Gate must remain on the right of the official Labs artwork');
  assert.ok(testRoom.x>.35&&testRoom.x<.5&&testRoom.y>.7,'Weapon Test area must remain in its official lower-middle position');
});
test('Labs movement and facing direction follow a real screenshot sequence',()=>{
  const maps=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data/maps.json'),'utf8')),lab=maps.find(map=>map.id==='the-lab');
  const first=parseScreenshot('[20-41]_-170.16, 1.47, -414.27_-0.09282, -0.26285, 0.02531, -0.96003_6.79 (0).png');
  const second=parseScreenshot('[20-41]_-173.09, 1.48, -401.05_0.04161, -0.08166, 0.00635, 0.99577_6.79 (0).png');
  const project=position=>({x:(position.z+477)/284*720,y:(position.x+287)/207*586});
  const a=project(first),b=project(second),movementBearing=Math.atan2(b.x-a.x,-(b.y-a.y))*180/Math.PI;
  const markerBearing=((second.heading-lab.coordinateRotation)%360+360)%360;
  assert.ok(b.x>a.x&&b.y<a.y,'this verified Labs path must move up and right on the official artwork');
  assert.ok(Math.abs(markerBearing-movementBearing)<8,'the player arrow must face along the verified path');
});
test('Labs keycard legend resolves every colored-card door from bundled POIs',()=>{
  const poi=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data/poi/the-lab.json'),'utf8'));
  const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data/lab-keycards.json'),'utf8'));
  assert.equal(catalog.mapId,'the-lab');assert.equal(catalog.keycards.length,8);
  const cards=new Map(catalog.keycards.map(card=>[card.id,card])),doors=poi.pois.filter(item=>item.kind==='locked-door'&&(item.keyIds||[]).some(id=>cards.has(id)));
  assert.equal(doors.length,9);assert.equal(doors.filter(item=>item.keyIds.includes('5c1d0f4986f7744bb01837fa')).length,2);
  assert.deepEqual(new Set(catalog.keycards.map(card=>card.label)),new Set(['BLUE','GREEN','RED','VIOLET','YELLOW','BLACK','BLUE MARK','RES UNIT']));
  for(const card of catalog.keycards){assert.match(card.color,/^#[0-9a-f]{6}$/i);assert.ok(card.room);assert.equal(card.iconPath,'/items/labs-keycards/'+card.id+'.webp');const icon=path.join(__dirname,'../app/assets',card.iconPath.replace(/^\/+/,''));assert.ok(fs.existsSync(icon),card.label+' icon');const bytes=fs.readFileSync(icon);assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');assert.ok(doors.some(door=>door.keyIds.includes(card.id)),card.label+' door');}
});
test('Reserve chess landmarks match the building clusters identified by RB keys',()=>{
  const renderer=fs.readFileSync(path.join(__dirname,'../app/app.js'),'utf8'),block=renderer.match(/reserve:\s*\[(.*?)\n\s*\]/s)?.[1];assert.ok(block);
  const entries=[...block.matchAll(/\[\s*'([^']+)',\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*'([^']+)'/g)].map(match=>({name:match[1],x:Number(match[2]),z:Number(match[3]),piece:match[4]}));
  assert.deepEqual(new Set(entries.map(item=>item.name)),new Set(['WHITE QUEEN · DOME','WHITE PAWN','BLACK PAWN','BLACK BISHOP','WHITE BISHOP','WHITE KING','BLACK KNIGHT','WHITE KNIGHT']));
  assert.ok(entries.every(item=>Number.isFinite(item.x)&&Number.isFinite(item.z)&&item.piece));
  const pois=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data/poi/reserve.json'),'utf8')).pois,anchors={'WHITE QUEEN · DOME':'5da46e3886f774653b7a83fe','WHITE PAWN':'5d80ccac86f77470841ff452','BLACK PAWN':'5d80c60f86f77440373c4ece','BLACK BISHOP':'5d80c78786f774403a401e3e','WHITE BISHOP':'5d947d4e86f774447b415895','WHITE KING':'5da5cdcd86f774529238fb9b','BLACK KNIGHT':'5d80c93086f7744036212b41','WHITE KNIGHT':'5d80cbd886f77470855c26c2'};
  for(const item of entries){const anchor=pois.find(poi=>poi.keyIds?.includes(anchors[item.name]));assert.ok(anchor,item.name+' RB-key anchor');assert.ok(Math.hypot(item.x-anchor.position.x,item.z-anchor.position.z)<28,item.name+' stays on its verified building cluster');}
});
test('every profile catalog still carries the key and item data the raid kit lists',()=>{
  const renderer=fs.readFileSync(path.join(__dirname,'../app/app.js'),'utf8');
  assert.match(renderer,/function raidKit\(/,'renderer keeps the raid kit builder');
  assert.match(renderer,/function questKeyList\(/,'quest briefs build their key list from objectives');
  const carryTypes=[...renderer.matchAll(/(\w+):\s*'(?:Plant|Hand in|Use)'/g)].map(match=>match[1]);
  assert.ok(carryTypes.includes('plantItem')&&carryTypes.includes('giveItem'),'carried objective types stay mapped');
  for(const file of ['quests.json','quests-pve.json','quests-seasonal.json']){
    const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data',file),'utf8'));
    let groups=0,carried=0;
    for(const quest of catalog.quests)for(const objective of quest.objectives){
      for(const group of objective.requiredKeys||[]){
        assert.ok(Array.isArray(group)&&group.length,file+': '+quest.name+' has an empty key group');
        assert.ok(group.every(name=>typeof name==='string'&&name.trim()),file+': '+quest.name+' has a blank key name');
        groups++;
      }
      if(carryTypes.includes(objective.type)&&(objective.itemNames||[]).length)carried++;
    }
    assert.ok(groups>=50,file+' lost its objective key requirements ('+groups+')');
    assert.ok(carried>=200,file+' lost the item names of carried objectives ('+carried+')');
  }
});
test('log parser limits itself to map/lifecycle records',()=>{
  assert.deepEqual(parseLogLine('x|application|scene preset path:maps/customs_preset.bundle rcid:bigmap.scenespreset.asset'),{type:'map',map:'customs'});
  assert.deepEqual(parseLogLine('x Location: woods, state ready'),{type:'map',map:'woods'});
  assert.deepEqual(parseLogLine('x|application|GameStarted:'),{type:'start'});
  assert.deepEqual(parseLogLine('x UserMatchOver'),{type:'end'});
  assert.deepEqual(parseLogLine('x|application|Session mode: Pve'),{type:'mode',mode:'pve'});
  assert.deepEqual(parseLogLine('x|application|Session mode: Regular'),{type:'mode',mode:'pvp'});
  assert.deepEqual(parseLogLine('x|application|Session mode: PvpSeason'),{type:'mode',mode:'seasonal'});
  assert.equal(parseLogLine('quest_accepted arbitrary secret account info'),null);
});
test('log aliases resolve to every supported location id',()=>{
  const cases={bigmap:'customs',woods:'woods',factory4_day:'factory',sandbox:'ground-zero',interchange:'interchange',lighthouse:'lighthouse',rezervbase:'reserve',shoreline:'shoreline',tarkovstreets:'streets-of-tarkov',laboratory:'the-lab',labyrinth:'the-labyrinth',terminal:'terminal',icebreaker:'icebreaker'};
  for(const [alias,id] of Object.entries(cases))assert.equal(canonicalMap(alias),id);
});
test('quest notification parser accepts only identified lifecycle events',()=>{
  const prefix='2026-09-05 22:00:00.000|1.1|Info|push-notifications|Got notification | ChatMessageReceived\n';
  const completed=prefix+JSON.stringify({eventId:'event-1',message:{type:12,dt:1788552000,text:'quest started',templateId:'665eec1f5e47a79f8605565a successMessageText'}},null,2)+'\n';
  const unrelated=prefix+JSON.stringify({eventId:'event-x',message:{type:11,dt:1788552000,text:'quest started',templateId:'665eec1f5e47a79f8605565a 0'}},null,2)+'\n';
  const unidentified=prefix+JSON.stringify({eventId:'event-2',message:{type:10,dt:1788552001,text:'quest started'}},null,2)+'\n';
  assert.deepEqual(parseQuestNotifications(completed+unrelated+unidentified),[{type:'quest',id:'665eec1f5e47a79f8605565a',status:'completed',eventId:'event-1',observedAt:1788552000000}]);
  assert.deepEqual(parseQuestNotifications(prefix+'{broken json}\n'),[]);
});
test('full log refresh reads every session and keeps profiles separate',async t=>{
  const dir=fixture(t),questA='665eec1f5e47a79f8605565a',questB='665eec4a4dfc83b0ed0a9dca';
  const sessions=[
    ['01','Pvp',questA,10,100,'description'],['02','Pvp',questA,12,200,'successMessageText'],['03','PvpSeason',questA,10,300,'description'],
    ['04','PvpSeason',questB,10,400,'description'],['05','PvpSeason',questB,11,500,'failMessageText']
  ];
  for(const [name,mode,id,type,dt,suffix] of sessions){
    const folder=path.join(dir,name);fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder,'application_000.log'),'x|application|Session mode: '+mode+'\n');
    const prefix='2026-09-05 22:00:00.000|1.1|Info|push-notifications|Got notification | ChatMessageReceived\n';
    fs.writeFileSync(path.join(folder,'push-notifications_000.log'),prefix+JSON.stringify({eventId:'event-'+name,message:{type,dt,templateId:id+' '+suffix}},null,2)+'\n');
  }
  const history=await scanQuestHistory(dir);assert.equal(history.notificationFiles,5);assert.equal(history.ignoredFiles,0);assert.equal(history.events.length,5);
  const store=new Store(path.join(dir,'data')),summary=store.applyQuestHistory(history.events,600000);
  assert.equal(store.data.profiles.pvp.quests[questA],'completed');
  assert.equal(store.data.profiles.seasonal.quests[questA],'active');assert.equal(store.data.profiles.seasonal.quests[questB],'failed');
  assert.equal(summary.pvp.active,0);assert.equal(summary.pvp.completed,1);assert.equal(summary.seasonal.active,1);assert.equal(summary.seasonal.failed,1);
  assert.equal(summary.pvp.changed,1);assert.equal(summary.seasonal.changed,2);assert.equal(store.data.profiles.seasonal.questSync.lastScanAt,600000);
  assert.equal(summary.seasonal.changes.length,2);assert.equal(store.data.profiles.seasonal.questSync.history.length,2);
  const repeated=store.applyQuestHistory(history.events,700000);assert.equal(repeated.pvp.changed,0);assert.equal(repeated.seasonal.changed,0);assert.equal(store.data.profiles.pvp.questSync.lastScanAt,700000);
  assert.equal(store.data.profiles.seasonal.questSync.history.length,2);
});
test('observer skips old screenshots, reads a new filename, preserves game files',async t=>{
  const dir=fixture(t),screens=path.join(dir,'screens'),logs=path.join(dir,'logs');fs.mkdirSync(screens);fs.mkdirSync(logs);
  const old=path.join(screens,'2026-09-04[16-54]_1, 2, 3.png');fs.writeFileSync(old,'DO NOT READ OR WRITE THIS IMAGE');
  const log=path.join(logs,'application.log');fs.writeFileSync(log,'x Location: bigmap,\nx|application|GameStarted:\n');
  const before=[hash(old),hash(log)];const o=new Observer();t.after(()=>o.stop());await o.start({screenshots:screens,logs});
  assert.equal(o.state.position,null);assert.equal(o.state.map,'customs');assert.equal(o.state.connected,true);
  fs.writeFileSync(path.join(screens,shot),'not an image; filename alone is sufficient');await o.scan();
  assert.equal(o.state.position.x,178.07);assert.equal(o.state.position.map,'customs');assert.equal(o.state.screenshotCount,2);
  assert.deepEqual([hash(old),hash(log)],before);
});
test('raid end clears last position; new screenshots cannot inherit ended map',async t=>{
  const dir=fixture(t),log=path.join(dir,'application.log');fs.writeFileSync(log,'x Location: bigmap,\nx|application|GameStarted:\n');
  const o=new Observer();t.after(()=>o.stop());await o.start({screenshots:dir,logs:dir});
  fs.writeFileSync(path.join(dir,shot),'fixture');await o.scan();assert.equal(o.state.position.map,'customs');
  fs.appendFileSync(log,'x UserMatchOver\n');await o.scan();assert.equal(o.state.position,null);
  fs.writeFileSync(path.join(dir,shot.replace('(0)','(1)')),'fixture');await o.scan();assert.equal(o.state.position.map,null);
});
test('new screenshot with missing logs has no assumed map',async t=>{
  const dir=fixture(t),o=new Observer();t.after(()=>o.stop());await o.start({screenshots:dir,logs:''});fs.writeFileSync(path.join(dir,shot),'fixture');await o.scan();assert.equal(o.state.position.map,null);
});
test('incomplete log line is carried into the next read',async t=>{
  const dir=fixture(t),log=path.join(dir,'application.log');fs.writeFileSync(log,'x Location: big');const o=new Observer();t.after(()=>o.stop());await o.start({screenshots:'',logs:dir});assert.equal(o.state.map,null);
  fs.appendFileSync(log,'map,\n');await o.scan();assert.equal(o.state.map,'customs');
});
test('reconnecting skips existing images and does not retain a fix',async t=>{
  const dir=fixture(t),o=new Observer();t.after(()=>o.stop());await o.start({screenshots:dir,logs:''});fs.writeFileSync(path.join(dir,shot),'fixture');await o.scan();assert.ok(o.state.position);await o.start({screenshots:dir,logs:''});assert.equal(o.state.position,null);
});
test('deleted or unavailable folder is reported without crashing',async t=>{
  const dir=fixture(t),o=new Observer();t.after(()=>o.stop());await o.start({screenshots:path.join(dir,'missing'),logs:''});assert.equal(o.state.connected,false);assert.match(o.state.error,/unavailable/);
});
test('progress survives restart and PvP, PvE and Seasonal remain isolated',t=>{
  const dir=fixture(t),s=new Store(dir);s.data.profiles.pvp.quests.example='completed';s.write();const restarted=new Store(dir);assert.equal(restarted.data.profiles.pvp.quests.example,'completed');assert.equal(restarted.data.profiles.pve.quests.example,undefined);assert.equal(restarted.data.profiles.seasonal.quests.example,undefined);assert.equal(restarted.error,null);
});
test('log quest events persist once with their source and profile',t=>{
  const dir=fixture(t),s=new Store(dir),event={id:'665eec1f5e47a79f8605565a',status:'completed',eventId:'evt',observedAt:1788552000000};
  assert.equal(s.applyQuestEvent('pve',event),true);assert.equal(s.applyQuestEvent('pve',event),false);
  const restarted=new Store(dir);assert.equal(restarted.data.profiles.pve.quests[event.id],'completed');assert.equal(restarted.data.profiles.pve.questSources[event.id],'logs');assert.equal(restarted.data.profiles.pve.questSync.seenEvents.length,1);assert.equal(restarted.data.profiles.pve.questSync.history.length,1);assert.equal(restarted.data.profiles.pvp.quests[event.id],undefined);
});
test('quest visibility and legacy raid fields survive restart',t=>{
  const dir=fixture(t),s=new Store(dir),p=s.data.profiles.seasonal;p.raidHidden.shoreline=['quest-a'];p.raidChecklist.shoreline={'key:Room 306':true};p.raidPlans.shoreline={role:'scav',spawn:'north'};s.write();
  const restarted=new Store(dir),saved=restarted.data.profiles.seasonal;assert.deepEqual(saved.raidHidden.shoreline,['quest-a']);assert.equal(saved.raidChecklist.shoreline['key:Room 306'],true);assert.deepEqual(saved.raidPlans.shoreline,{role:'scav',spawn:'north'});assert.ok(Array.isArray(saved.questSync.history));
});
test('legacy extract-name preference migrates to PMC and Scav subcategories',t=>{
  const dir=fixture(t),s=new Store(dir);s.data.settings.mapLayers={extracts:true,scavs:false,transits:false,landmarks:true,extractNames:true};s.write();
  const restarted=new Store(dir);assert.equal(restarted.data.settings.mapLayers.pmcExtractNames,true);assert.equal(restarted.data.settings.mapLayers.scavExtractNames,true);assert.equal(restarted.data.settings.mapLayers.transitNames,false);assert.equal(restarted.data.settings.mapLayers.labsKeycards,true);assert.equal(restarted.data.settings.mapLayers.labsKeycardNames,false);
});
test('objective targets and reviewed OCR preserve partial counters',()=>{
  const objective={id:'objective-a',description:'Eliminate 3 PMCs on Shoreline',details:['Required count: 3']},quest={id:'quest-a',name:'Test Drive',objectives:[objective]};
  assert.equal(objectiveTarget(objective),3);const matches=parseTaskOcr('TEST DRIVE\nEliminate 3 PMCs on Shoreline 2 / 3',[quest],['quest-a']);assert.equal(matches.length,1);assert.deepEqual({...matches[0].objectives[0],confidence:undefined},{id:'objective-a',description:objective.description,value:2,target:3,confirmed:false,confidence:undefined});assert.ok(matches[0].objectives[0].confidence>.8);
});
test('new local profile fields and raid history survive restart',t=>{
  const dir=fixture(t),store=new Store(dir),p=store.data.profiles.pvp;assert.deepEqual(p.objectiveProgress,{});assert.deepEqual(p.customMarkers,{});assert.deepEqual(p.favorites,[]);assert.equal(store.data.settings.itemValueThreshold,15000);
  store.recordRaidEvent('pvp',{type:'start',id:'raid-1',map:'shoreline',role:'pmc',at:100,questIds:['quest-a']});store.recordRaidEvent('pvp',{type:'end',at:200,outcome:'unknown'});store.recordRaidEvent('pvp',{type:'outcome',id:'raid-1',outcome:'survived'});const restarted=new Store(dir),raid=restarted.data.profiles.pvp.raidHistory[0];assert.equal(raid.id,'raid-1');assert.equal(raid.status,'ended');assert.equal(raid.startedAt,100);assert.equal(raid.endedAt,200);assert.equal(raid.outcome,'survived');
});
test('observer emits identified quest notifications from selected logs',async t=>{
  const dir=fixture(t),appLog=path.join(dir,'application.log'),notice=path.join(dir,'push-notifications_000.log');
  fs.writeFileSync(appLog,'x|application|Session mode: Pve\n');
  fs.writeFileSync(notice,'2026-09-05 22:00:00.000|1.1|Info|push-notifications|Got notification | ChatMessageReceived\n'+JSON.stringify({eventId:'live-event',message:{type:10,dt:1788552000,templateId:'665eec1f5e47a79f8605565a startedMessageText'}},null,2)+'\n');
  const o=new Observer(),events=[];t.after(()=>o.stop());o.on('quest',event=>events.push(event));await o.start({screenshots:'',logs:dir});
  assert.equal(events.length,1);assert.equal(events[0].status,'active');assert.equal(events[0].mode,'pve');assert.equal(o.state.logsConnected,true);assert.ok(o.state.logSession);assert.ok(o.state.logFileCount>=2);
  await o.scan();assert.equal(events.length,1);
});
test('observer keeps quest notifications in their own PvP and Seasonal sessions',async t=>{
  const dir=fixture(t),quest='665eec1f5e47a79f8605565a',events=[];
  for(const [folder,mode,eventId] of [['01-pvp','Pvp','pvp-event'],['02-season','PvpSeason','season-event']]){
    const target=path.join(dir,folder);fs.mkdirSync(target);fs.writeFileSync(path.join(target,'application_000.log'),'x|application|Session mode: '+mode+'\n');
    fs.writeFileSync(path.join(target,'push-notifications_000.log'),'2026-09-05 22:00:00.000|1.1|Info|push-notifications|Got notification | ChatMessageReceived\n'+JSON.stringify({eventId,message:{type:10,dt:1788552000,templateId:quest+' startedMessageText'}},null,2)+'\n');
  }
  const observer=new Observer();t.after(()=>observer.stop());observer.on('quest',event=>events.push(event));await observer.start({screenshots:'',logs:dir});
  assert.deepEqual(events.map(event=>[event.eventId,event.mode]).sort(),[['pvp-event','pvp'],['season-event','seasonal']]);
});
test('malformed progress is preserved as a recovery file before writing',t=>{
  const dir=fixture(t);fs.writeFileSync(path.join(dir,'progress.json'),'{bad');const s=new Store(dir);assert.ok(s.error);s.write();assert.ok(fs.readdirSync(dir).some(f=>f.startsWith('progress.json.recovery-')));
});
test('packaged renderer blocks network and hover scan avoids game-process or mouse-hook APIs',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');assert.match(main,/nodeIntegration:\s*false/);assert.match(main,/contextIsolation:\s*true/);assert.match(main,/sandbox:\s*true/);assert.match(main,/cancel:\s*true/);
  assert.match(main,/refreshQuestLogs\(\)/);assert.match(main,/logRefresh/);assert.match(main,/raid-preferences/);assert.match(main,/import-catalog/);assert.match(main,/item-value-settings/);
  assert.match(main,/ITEM_HOTKEY\s*=\s*'Shift\+F8'/);assert.match(main,/desktopCapturer/);assert.match(main,/getCursorScreenPoint/);assert.match(main,/\.crop\(/);
  assert.match(main,/captureCursorRegions/);assert.match(main,/width:\s*320,\s*height:\s*220,\s*scale:\s*3/);assert.match(main,/tessedit_pageseg_mode/);assert.match(main,/clearInventoryMatch/);
  assert.doesNotMatch(main,/sendInput|OpenProcess|ReadProcessMemory|writeProcessMemory|uiohook|SetWindowsHookEx|mouse_event/i);
});
test('complete quest catalogs are bundled and the UI does not force a Customs-only list',()=>{
  for(const [file,minimum] of [['quests.json',500],['quests-pve.json',500],['quests-seasonal.json',480]]){
    const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data',file),'utf8')).quests;
    assert.ok(catalog.length>=minimum,`${file} should contain the complete snapshot`);
    assert.equal(new Set(catalog.map(q=>q.id)).size,catalog.length,`${file} quest IDs must be unique`);
    assert.ok(catalog.every(q=>q.id&&q.name&&Array.isArray(q.mapIds)&&Array.isArray(q.objectives)));
    const maps=new Set(JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data/maps.json'),'utf8')).map(map=>map.id));
    assert.ok(catalog.every(q=>q.mapIds.every(id=>maps.has(id))),`${file} map IDs must exist`);
    assert.ok(catalog.flatMap(q=>q.objectives).flatMap(o=>[...(o.zones||[]).map(z=>z.position),...(o.possibleLocations||[]).flatMap(z=>z.positions||[])]).every(p=>[p.x,p.y,p.z].every(Number.isFinite)),`${file} map coordinates must be finite`);
  }
  const renderer=fs.readFileSync(path.join(__dirname,'../app/app.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../app/index.html'),'utf8');
  assert.match(renderer,/quests\s*=\s*\[\.\.\.allData\.quests,\s*\.\.\.extras\]\.sort/);
  assert.doesNotMatch(renderer,/quests\s*=\s*allData\.quests\.filter\(q\s*=>\s*q\.mapIds\.includes\('customs'\)\)/);
  assert.match(html,/id="map-filter"/);assert.match(html,/value="open" selected/);assert.match(html,/value="story"/);const pathFilter=html.match(/<select id="path-filter"[\s\S]*?<\/select>/)[0];assert.doesNotMatch(pathFilter,/value="battlepass"/);
  assert.match(html,/RAID NOTES/);
  const sheets=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(sheets,['app.css','battlepass.css'],'the renderer loads the merged stylesheet and the Battle Pass layer, in that order');
  for(const sheet of sheets)assert.ok(fs.existsSync(path.join(__dirname,'../app',sheet)),sheet+' is bundled');
  const merged=fs.readFileSync(path.join(__dirname,'../app/app.css'),'utf8');
  assert.match(merged,/--gold:/,'app.css keeps the palette tokens');
  for(const retired of ['styles.css','v02.css','v03.css','v04.css','v05.css','field-journal.css'])
    assert.ok(!fs.existsSync(path.join(__dirname,'../app',retired)),retired+' was merged into app.css and must not come back');
  assert.match(html,/id="refresh-logs"/);assert.match(html,/id="activity-dialog"/);assert.match(html,/id="import-catalog"/);assert.match(renderer,/bridge\.refreshLogs\(\)/);assert.match(renderer,/function renderMyRaid/);assert.match(renderer,/questMarkerMeta/);assert.match(renderer,/visibleRaidQuests/);assert.match(renderer,/raidPreferences/);
  for(const id of ['loot-source-status','loot-essentials','scan-tasks','items-button','items-dialog','refresh-prices','item-search','item-hotkey-enabled','item-hotkey-status','item-value-threshold','log-diagnostics','dashboard-button','add-marker','marker-dialog','marker-form','marker-name','marker-note','save-marker','layer-custom','layer-lab-keycards','layer-lab-keycard-labels','keycard-doors','keycard-labels','path-filter','export-backup','import-backup','quick-find','command-dialog','command-search','command-results','toggle-details','focus-map'])assert.match(html,new RegExp('id="'+id+'"'));
  for(const preset of ['raid','valuables','clean'])assert.match(html,new RegExp('data-layer-preset="'+preset+'"'));
  assert.match(html,/No Inspect needed/);assert.doesNotMatch(html,/id="scan-item"|Choose screenshot/);
  assert.match(renderer,/function saveMarkerEditor/);assert.doesNotMatch(renderer,/window\.prompt/);
  assert.match(renderer,/function centeredView/);assert.doesNotMatch(renderer,/w:300,h:180/);assert.match(renderer,/function showQuestCluster/);assert.match(renderer,/function renderLogDiagnostics/);assert.match(renderer,/itemValueThreshold/);
  assert.doesNotMatch(renderer,/orderedRaidQuests|function renderRoute|routeMode|START AREA|ROUTE ORDER/);assert.match(renderer,/function renderDashboard/);assert.match(renderer,/function runItemScan/);assert.match(renderer,/objective-counter/);assert.match(renderer,/inspectCatalog/);
  for(const fn of ['commandEntries','openCommandPalette','applyLayerPreset','setMapFocus','setDetailsCollapsed','revealMapSearch'])assert.match(renderer,new RegExp('function '+fn));
  assert.match(renderer,/e\.ctrlKey\s*\|\|\s*e\.metaKey/);assert.match(renderer,/e\.key\.toLowerCase\(\)\s*===\s*['"]f['"]/);
  assert.doesNotMatch(html,/POST-RAID REVIEW|raid-review-dialog/);assert.doesNotMatch(renderer,/openRaidReview|pendingRaidReview/);
  assert.match(renderer,/function applyQuestPathFilter/);assert.match(renderer,/q\.kappaRequired/);assert.match(renderer,/q\.lightkeeperRequired/);
  assert.match(html,/class="quest-filter-panel"/);assert.match(html,/id="filter-summary"/);
});
test('EFT 1.1.5 Trust but Verify quest is bundled for Labs in every profile catalog',()=>{
  for(const file of ['quests.json','quests-pve.json','quests-seasonal.json']){
    const quest=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data',file),'utf8')).quests.find(item=>item.id==='6a880acc9216d0f5aa078305');
    assert.ok(quest,file+' quest');assert.equal(quest.name,'To the Light - Trust but Verify');assert.deepEqual(quest.mapIds,['the-lab']);assert.equal(quest.objectives.length,2);assert.ok(quest.objectives.every(objective=>objective.mapIds.includes('the-lab')));
  }
  const main=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');assert.doesNotMatch(main,/const known=history\.events\.filter/);assert.doesNotMatch(main,/if\(!ids\.has\(event\.id\)\)return/);assert.match(main,/unknownQuestIds/);
});
test('every declared map has bundled artwork, POIs and a selectable location',()=>{
  const maps=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data/maps.json'),'utf8'));
  assert.equal(maps.length,13);
  for(const map of maps){
    const assets=[map.baseAsset,...map.floors.map(floor=>floor.asset).filter(Boolean)];
    for(const asset of assets)assert.ok(fs.existsSync(path.join(__dirname,'../app/assets',asset.path.replace(/^\/+/,''))),`${map.id}: ${asset.path}`);
    assert.ok(fs.existsSync(path.join(__dirname,'../app/data/poi',map.id+'.json')),`${map.id}: POI bundle`);
  }
  const html=fs.readFileSync(path.join(__dirname,'../app/index.html'),'utf8'),renderer=fs.readFileSync(path.join(__dirname,'../app/app.js'),'utf8');
  assert.match(html,/id="location"/);assert.match(renderer,/async function switchMap/);assert.match(renderer,/state\.position\.map/);
});
test('every declared map has a validated loot layer and every marker icon is bundled',()=>{
  const maps=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data/maps.json'),'utf8')),checkedIcons=new Set();let total=0;
  for(const map of maps){
    const file=path.join(__dirname,'../app/data/loot',map.id+'.json');assert.ok(fs.existsSync(file),map.id+': loot snapshot');const loot=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(loot.schemaVersion,3);assert.equal(loot.mapId,map.id);assert.match(loot.source,/^https:\/\/json\.tarkov\.dev\/regular\/maps$/);total+=(loot.containers?.length||0)+(loot.loose?.length||0);
    const [[x1,z1],[x2,z2]]=map.bounds,minX=Math.min(x1,x2)-2,maxX=Math.max(x1,x2)+2,minZ=Math.min(z1,z2)-2,maxZ=Math.max(z1,z2)+2;
    for(const [x,y,z,type] of loot.containers||[]){assert.ok([x,y,z].every(Number.isFinite),map.id+': finite container coordinates');assert.ok(x>=minX&&x<=maxX&&z>=minZ&&z<=maxZ,map.id+': container in map bounds');const meta=loot.containerTypes[type];assert.ok(meta?.label&&meta?.icon&&loot.containerCategories[meta.category],map.id+': categorized container metadata');checkedIcons.add(path.join(__dirname,'../app/assets/loot/containers',meta.icon));}
    for(const [x,y,z,ids,categories] of loot.loose||[]){assert.ok([x,y,z].every(Number.isFinite),map.id+': finite loose-loot coordinates');assert.ok(x>=minX&&x<=maxX&&z>=minZ&&z<=maxZ,map.id+': loose loot in map bounds');assert.ok(Array.isArray(ids)&&ids.length&&Array.isArray(categories)&&categories.length,map.id+': categorized loose-loot items');for(const id of ids){assert.ok(loot.items[id]?.name&&loot.categories[loot.items[id].categoryKey],map.id+': loose-loot item metadata');assert.ok(Array.isArray(loot.items[id].categoryKeys)&&loot.items[id].categoryKeys.includes(loot.items[id].categoryKey),map.id+': primary category remains part of multi-filter metadata');checkedIcons.add(path.join(__dirname,'../app/assets/loot/items',id+'.webp'));}}
    for(const meta of Object.values(loot.categories))checkedIcons.add(path.join(__dirname,'../app/assets/loot/categories',meta.icon));
  }
  assert.ok(total>11000,'complete tarkov.dev loot snapshot');for(const icon of checkedIcons)assert.ok(fs.existsSync(icon)&&fs.statSync(icon).size>100,'bundled loot icon: '+path.basename(icon));
});
test('quest route filters have current source flags and meaningful catalog coverage',()=>{
  for(const file of ['quests.json','quests-pve.json','quests-seasonal.json']){
    const quests=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data',file),'utf8')).quests;
    assert.ok(quests.filter(q=>q.kappaRequired).length>=10,file+': Kappa flags');
    assert.ok(quests.filter(q=>q.lightkeeperRequired).length>=7,file+': Lightkeeper flags');
    assert.ok(quests.some(q=>q.traderName==='Lightkeeper'),file+': Lightkeeper quest chain');
  }
});test('story chapters and Battle Pass documents are bundled as separate tracks',()=>{
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/data/special-tracks.json'),'utf8'));
  assert.equal(data.storyChapterCount,10);assert.ok(data.storyObjectiveCount>=380);assert.ok(data.battlePassItemCount>=9);
  assert.equal(data.quests.filter(q=>q.category==='story').length,10);assert.equal(data.quests.filter(q=>q.category==='battlepass').length,1);
  assert.ok(data.quests.filter(q=>q.category==='story').every(q=>q.sourceQuestIds.length&&q.objectives.length));
});




