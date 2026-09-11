const {app,BrowserWindow,ipcMain,dialog,shell,desktopCapturer,screen,globalShortcut}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {Store,Observer,scanQuestHistory,parseTaskOcr}=require('./core.cjs');
const {modeSlugs,normalizeItemPayload,validateItemCatalog,matchItemText}=require('./items.cjs');
let win,store,observer,ocrWorker,ocrWorkerPromise,priceOverlay,priceOverlayTimer;
let itemHotkeyRunning=false,itemHotkeyRegistered=false;
let ocrContext=null,ocrQueue=Promise.resolve();
const ITEM_HOTKEY='Shift+F8';
const pendingCatalogs=new Map();
const assetRoot=path.join(__dirname,'app');
const questData=JSON.parse(fs.readFileSync(path.join(assetRoot,'data/quests.json')));
const pveData=JSON.parse(fs.readFileSync(path.join(assetRoot,'data/quests-pve.json')));
const seasonalData=JSON.parse(fs.readFileSync(path.join(assetRoot,'data/quests-seasonal.json')));
const specialData=JSON.parse(fs.readFileSync(path.join(assetRoot,'data/special-tracks.json')));
const mapData=JSON.parse(fs.readFileSync(path.join(assetRoot,'data/maps.json')));
const validMapIds=new Set(mapData.map(map=>map.id));
const ids=new Set([...questData.quests,...pveData.quests,...seasonalData.quests,...specialData.quests].flatMap(q=>[q.id,...(q.sourceQuestIds||[])]));
const objectiveIds=new Set([...questData.quests,...pveData.quests,...seasonalData.quests,...specialData.quests].flatMap(q=>q.objectives.map(o=>o.id)));
app.setName('Raid Notes');
app.setPath('userData',path.join(app.getPath('appData'),'RaidNotes'));
function validateSender(event){if(event.sender!==win.webContents)throw Error('Unknown caller');}
function register(name,fn){ipcMain.handle(name,(event,...args)=>{validateSender(event);return fn(...args);});}
function validateMode(mode){if(!['pve','pvp','seasonal'].includes(mode))throw Error('Invalid profile');return mode;}
function catalogReport(doc){
  const questIds=new Set(),objectiveIdsFound=new Set(),names=new Map();let mapPoints=0,unmappedObjectives=0,objectives=0,sharedObjectiveIds=0;
  if(!doc||!Array.isArray(doc.quests)||!doc.quests.length||doc.quests.length>2000)throw Error('The file is not a supported quest catalog.');
  for(const quest of doc.quests){
    if(typeof quest.id!=='string'||quest.id.length<4||quest.id.length>100||typeof quest.name!=='string'||!quest.name.trim()||!Array.isArray(quest.mapIds)||!Array.isArray(quest.objectives))throw Error('The quest catalog contains an invalid quest.');
    if(questIds.has(quest.id))throw Error('The quest catalog contains a duplicate quest ID.');questIds.add(quest.id);
    if(quest.mapIds.some(id=>!validMapIds.has(id)))throw Error('The quest catalog contains an unsupported map.');
    names.set(quest.name,(names.get(quest.name)||0)+1);
    const questObjectiveIds=new Set();for(const objective of quest.objectives){
      if(!objective||typeof objective.id!=='string'||!objective.id||typeof objective.description!=='string')throw Error('The quest catalog contains an invalid objective.');
      if(questObjectiveIds.has(objective.id))throw Error('A quest contains a duplicate objective ID.');questObjectiveIds.add(objective.id);objectives++;
      if(objectiveIdsFound.has(objective.id))sharedObjectiveIds++;objectiveIdsFound.add(objective.id);
      const points=[...(objective.zones||[]),...(objective.possibleLocations||[])];
      if(!points.length)unmappedObjectives++;
      for(const zone of points){
        if(zone.mapId&&!validMapIds.has(zone.mapId))throw Error('A quest point uses an unsupported map.');
        const positions=zone.positions||[zone.position].filter(Boolean);mapPoints+=positions.length;
        if(positions.some(p=>![p?.x,p?.y,p?.z].every(Number.isFinite)))throw Error('The quest catalog contains invalid map coordinates.');
      }
    }
  }
  return {quests:doc.quests.length,objectives,mapPoints,unmappedObjectives,duplicateQuestIds:0,sharedObjectiveIds,duplicateNames:[...names.values()].filter(count=>count>1).length};
}
function registerCatalog(doc){for(const quest of doc.quests){ids.add(quest.id);for(const objective of quest.objectives)objectiveIds.add(objective.id);}}
function customCatalogFile(mode){return path.join(path.dirname(store.file),'quest-catalog-'+mode+'.json');}
function loadCatalog(mode){
  validateMode(mode);const file=customCatalogFile(mode);let doc=mode==='pve'?pveData:mode==='seasonal'?seasonalData:questData,localOverride=false;
  if(fs.existsSync(file)){try{const custom=JSON.parse(fs.readFileSync(file,'utf8'));catalogReport(custom);doc=custom;localOverride=true;}catch{}}
  const integrity=catalogReport(doc);registerCatalog(doc);return {...doc,integrity,localOverride};
}
function itemCatalogFile(mode){return path.join(path.dirname(store.file),'items-'+mode+'.json');}
function bundledItemCatalogFile(mode){return path.join(assetRoot,'data','items-'+mode+'.json');}
function loadItemCatalog(mode){
  validateMode(mode);for(const file of [itemCatalogFile(mode),bundledItemCatalogFile(mode)]){try{return validateItemCatalog(JSON.parse(fs.readFileSync(file,'utf8')));}catch{}}
  throw Error('The item price catalog is unavailable.');
}
async function fetchItemJson(pathname){
  const response=await fetch('https://json.tarkov.dev/'+pathname,{headers:{accept:'application/json','user-agent':'RaidNotes item price updater'},signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('tarkov.dev returned HTTP '+response.status);const text=await response.text();if(text.length>100*1024*1024)throw Error('The price response is too large.');return JSON.parse(text);
}
async function updateItemCatalog(mode){
  validateMode(mode);const slug=modeSlugs[mode],[items,english,traders,traderEnglish]=await Promise.all([fetchItemJson(slug+'/items'),fetchItemJson(slug+'/items_en'),fetchItemJson(slug+'/traders'),fetchItemJson(slug+'/traders_en')]),catalog=normalizeItemPayload(items,english,traders,traderEnglish,mode),target=itemCatalogFile(mode),tmp=target+'.tmp';await fs.promises.mkdir(path.dirname(target),{recursive:true});await fs.promises.writeFile(tmp,JSON.stringify(catalog));await fs.promises.rename(tmp,target);return catalog;
}
async function ensureOcrWorker(){
  if(!ocrWorkerPromise)ocrWorkerPromise=(async()=>{const {createWorker,OEM}=require('tesseract.js'),language=require('@tesseract.js-data/eng');const worker=await createWorker('eng',OEM.LSTM_ONLY,{langPath:language.langPath,workerPath:require.resolve('tesseract.js/src/worker-script/node/index.js'),corePath:path.dirname(require.resolve('tesseract.js-core/tesseract-core.wasm.js')),cachePath:path.join(app.getPath('userData'),'ocr-cache'),logger:progress=>{if(!win?.isDestroyed())win.webContents.send('ocr-progress',{status:progress.status,progress:progress.progress||0,context:ocrContext});}});await worker.setParameters({preserve_interword_spaces:'1'});ocrWorker=worker;return worker;})().catch(error=>{ocrWorkerPromise=null;throw error;});
  return ocrWorkerPromise;
}
function recognizeWithOcr(image,context){const job=ocrQueue.then(async()=>{const worker=await ensureOcrWorker();ocrContext=context;try{await worker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:context==='hotkey'?'11':'3'});return await worker.recognize(image);}finally{ocrContext=null;}});ocrQueue=job.catch(()=>{});return job;}
async function pickScreenshot(title){const picked=await dialog.showOpenDialog(win,{title,properties:['openFile'],filters:[{name:'Screenshot image',extensions:['png','jpg','jpeg','webp','bmp']}]});if(picked.canceled)return null;const file=await fs.promises.realpath(picked.filePaths[0]),stat=await fs.promises.stat(file);if(!stat.isFile()||stat.size>30*1024*1024)throw Error('Choose a screenshot smaller than 30 MB.');return file;}
async function recognizeTasks(mode){
  validateMode(mode);const file=await pickScreenshot('Scan Tarkov Tasks screenshot');if(!file)return null;const result=await recognizeWithOcr(file,'tasks'),catalog=loadCatalog(mode),activeIds=Object.entries(store.data.profiles[mode].quests).filter(([,value])=>value==='active').map(([id])=>id);
  return {file:path.basename(file),confidence:Math.round(result.data.confidence||0),matches:parseTaskOcr(result.data.text,catalog.quests,activeIds),textPreview:String(result.data.text||'').slice(0,12000)};
}
async function recognizeItem(mode){
  validateMode(mode);const file=await pickScreenshot('Scan Tarkov item screenshot');if(!file)return null;const result=await recognizeWithOcr(file,'item'),catalog=loadItemCatalog(mode);return {file:path.basename(file),confidence:Math.round(result.data.confidence||0),matches:matchItemText(result.data.text,catalog),textPreview:String(result.data.text||'').slice(0,8000),catalog:{generatedAt:catalog.generatedAt,pricesUpdatedAt:catalog.pricesUpdatedAt,source:catalog.source,count:catalog.items.length}};
}
function rubles(value){return Number.isFinite(value)&&value>0?new Intl.NumberFormat('en-US').format(Math.round(value))+' ₽':'—';}
function overlayPosition(cursor){const display=screen.getDisplayNearestPoint(cursor),area=display.workArea,width=360,height=152;let x=cursor.x+22,y=cursor.y+22;if(x+width>area.x+area.width)x=cursor.x-width-22;if(y+height>area.y+area.height)y=cursor.y-height-22;return {x:Math.max(area.x,Math.min(x,area.x+area.width-width)),y:Math.max(area.y,Math.min(y,area.y+area.height-height)),width,height};}
async function showPriceOverlay(payload,cursor){
  clearTimeout(priceOverlayTimer);if(priceOverlay?.isDestroyed())priceOverlay=null;const bounds=overlayPosition(cursor);
  if(!priceOverlay){priceOverlay=new BrowserWindow({...bounds,frame:false,transparent:true,resizable:false,movable:false,show:false,skipTaskbar:true,alwaysOnTop:true,focusable:false,hasShadow:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});priceOverlay.setIgnoreMouseEvents(true,{forward:true});priceOverlay.on('closed',()=>{priceOverlay=null;});}else priceOverlay.setBounds(bounds);
  const state=JSON.stringify(payload);await priceOverlay.loadFile(path.join(assetRoot,'price-overlay.html'),{query:{state}});priceOverlay.setAlwaysOnTop(true,'screen-saver');priceOverlay.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});priceOverlay.showInactive();if(payload.state!=='loading')priceOverlayTimer=setTimeout(()=>priceOverlay&&!priceOverlay.isDestroyed()&&priceOverlay.hide(),7000);
}
async function captureCursorRegions(cursor,specs){
  const display=screen.getDisplayNearestPoint(cursor),requested={width:Math.max(1,Math.round(display.size.width*display.scaleFactor)),height:Math.max(1,Math.round(display.size.height*display.scaleFactor))},sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:requested,fetchWindowIcons:false}),index=screen.getAllDisplays().findIndex(item=>item.id===display.id),source=sources.find(item=>item.display_id===String(display.id))||sources[index]||sources[0];if(!source||source.thumbnail.isEmpty())throw Error('Screen capture is unavailable. Use borderless display mode and try again.');
  const size=source.thumbnail.getSize(),sx=size.width/display.bounds.width,sy=size.height/display.bounds.height,centerX=(cursor.x-display.bounds.x)*sx,centerY=(cursor.y-display.bounds.y)*sy;
  return specs.map(spec=>{const regionWidth=Math.min(spec.width,display.bounds.width),regionHeight=Math.min(spec.height,display.bounds.height),width=Math.max(1,Math.round(regionWidth*sx)),height=Math.max(1,Math.round(regionHeight*sy)),x=Math.max(0,Math.min(Math.round(centerX-width/2),size.width-width)),y=Math.max(0,Math.min(Math.round(centerY-height/2),size.height-height)),crop=source.thumbnail.crop({x,y,width,height}),scale=Math.max(1,Number(spec.scale)||1);return scale>1?crop.resize({width:Math.min(1800,Math.round(width*scale)),height:Math.min(1400,Math.round(height*scale)),quality:'best'}).toPNG():crop.toPNG();});
}
async function captureCursorRegion(cursor,requestedWidth=760,requestedHeight=460,scale=1){return (await captureCursorRegions(cursor,[{width:requestedWidth,height:requestedHeight,scale}]))[0];}
function clearInventoryMatch(matches){if(!matches[0]||matches[0].confidence<.76)return false;return !matches[1]||matches[0].confidence-matches[1].confidence>=.05;}
async function scanHoveredItem(){
  if(itemHotkeyRunning||!store?.data?.settings?.itemHotkeyEnabled)return;itemHotkeyRunning=true;const cursor=screen.getCursorScreenPoint();try{if(priceOverlay&&!priceOverlay.isDestroyed())priceOverlay.hide();const catalog=loadItemCatalog(store.data.mode),[tile,nearby,wide]=await captureCursorRegions(cursor,[{width:320,height:220,scale:3},{width:720,height:460,scale:2},{width:1100,height:760,scale:1.5}]);await showPriceOverlay({state:'loading',shortcut:ITEM_HOTKEY},cursor);const first=await recognizeWithOcr(tile,'hotkey');let text=String(first.data.text||''),matches=matchItemText(text,catalog,5),scanArea='inventory tile';if(!clearInventoryMatch(matches)){const fallback=await recognizeWithOcr(nearby,'hotkey');text+='\n'+String(fallback.data.text||'');matches=matchItemText(text,catalog,5);scanArea='nearby inventory';}if(!matches[0]){const fallback=await recognizeWithOcr(wide,'hotkey');text+='\n'+String(fallback.data.text||'');matches=matchItemText(text,catalog,5);scanArea='expanded inventory';}const item=matches[0];if(item){const closeMatches=matches.filter(match=>item.confidence-match.confidence<.04).length,noFlea=item.types?.includes('noFlea'),flea=!noFlea&&item.avg24hPrice>0?item.avg24hPrice:!noFlea&&item.lastLowPrice>0?item.lastLowPrice:null,trader=item.bestTrader?.price>0?item.bestTrader.price:null,best=Math.max(flea||0,trader||0),slots=Math.max(1,(item.width||1)*(item.height||1)),perSlot=best?best/slots:0,threshold=Number(store.data.settings.itemValueThreshold)||0,grade=closeMatches===1&&threshold&&perSlot>=threshold?'great':closeMatches===1&&threshold&&perSlot>=threshold*.6?'good':'';await showPriceOverlay({state:'result',name:item.name,shortName:item.shortName,match:Math.round(item.confidence*100),possible:closeMatches,scanArea,flea:rubles(flea),trader:rubles(trader),traderName:item.bestTrader?.trader||'No trader price',perSlot:rubles(perSlot||null),bestSource:best?(flea!==null&&flea>=trader?'Flea':'Trader'):'No price',grade},cursor);}else await showPriceOverlay({state:'empty',message:'No inventory item found',hint:'Keep the cursor on the item tile and press '+ITEM_HOTKEY+' again.'},cursor);if(!win?.isDestroyed())win.webContents.send('item-hotkey-result',{matches,textPreview:text.slice(0,8000)});
  }catch(error){await showPriceOverlay({state:'error',message:'Could not read this item',hint:error.message},cursor).catch(()=>{});}finally{itemHotkeyRunning=false;}
}
function configureItemHotkey(){
  if(itemHotkeyRegistered){globalShortcut.unregister(ITEM_HOTKEY);itemHotkeyRegistered=false;}if(store?.data?.settings?.itemHotkeyEnabled)itemHotkeyRegistered=globalShortcut.register(ITEM_HOTKEY,()=>scanHoveredItem());const status={enabled:!!store?.data?.settings?.itemHotkeyEnabled,registered:itemHotkeyRegistered,accelerator:ITEM_HOTKEY};if(win&&!win.isDestroyed()&&!win.webContents.isLoading())win.webContents.send('item-hotkey-status',status);return status;
}
function normalizeBackup(doc){
  const source=doc?.data||doc;if(!source||source.version!==1||!source.profiles?.pvp||!source.profiles?.pve)throw Error('This is not a Raid Notes backup.');
  source.profiles.seasonal||={};for(const mode of ['pvp','pve','seasonal']){const p=source.profiles[mode]||={};p.quests||={};p.objectives||={};p.objectiveProgress||={};p.questSources||={};p.questSync||={seenEvents:[],lastEventAt:null,lastScanAt:null,history:[]};p.questSync.history||=[];p.raidHidden||={};p.raidChecklist||={};p.raidPlans||={};p.raidHistory=Array.isArray(p.raidHistory)?p.raidHistory.slice(0,100):[];p.customMarkers||={};p.questNotes||={};p.favorites=Array.isArray(p.favorites)?p.favorites:[];}
  source.mode=['pvp','pve','seasonal'].includes(source.mode)?source.mode:'pvp';return source;
}
async function refreshQuestLogs(){
  const history=await scanQuestHistory(store.data.settings.logs),scannedAt=Date.now();
  const unknownQuestIds=[...new Set(history.events.filter(event=>!ids.has(event.id)).map(event=>event.id))];
  const summary=store.applyQuestHistory(history.events,scannedAt);
  return {data:store.data,summary,unknownQuestIds,notificationFiles:history.notificationFiles,ignoredFiles:history.ignoredFiles,scannedAt};
}
app.whenReady().then(()=>{
  app.setName('Raid Notes');
  // App-owned directory only. Never store anything under the game folders.
  store=new Store(path.join(app.getPath('userData'),'local-data'));
  observer=new Observer();
  win=new BrowserWindow({width:1480,height:940,minWidth:1050,minHeight:700,backgroundColor:'#101517',title:'Raid Notes',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  // Renderer traffic is blocked. The main process contacts only json.tarkov.dev when the user explicitly refreshes item prices.
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_d,cb)=>cb({cancel:true}));
  register('bootstrap',async()=>{
    for(const mode of ['pvp','pve','seasonal'])loadCatalog(mode);
    let logRefresh=null;
    if(store.data.settings.logs){try{logRefresh=await refreshQuestLogs();}catch(error){logRefresh={error:error.message};}}
    return {data:store.data,observer:observer.state,storageError:store.error,desktop:true,logRefresh,itemHotkey:{enabled:!!store.data.settings.itemHotkeyEnabled,registered:itemHotkeyRegistered,accelerator:ITEM_HOTKEY}};
  });
  register('pick-folder',async kind=>{
    if(!['screenshots','logs'].includes(kind))throw Error('Invalid folder type');
    const result=await dialog.showOpenDialog(win,{title:kind==='screenshots'?'Choose Tarkov Screenshots folder':'Choose EFT Logs folder',properties:['openDirectory']});
    if(result.canceled)return null;
    return result.filePaths[0];
  });
  register('settings',async input=>{
    for(const key of ['screenshots','logs']) {
      if(typeof input[key]!=='string'||input[key].length>2000)throw Error('Invalid folder');
      if(input[key]){
        if(!path.isAbsolute(input[key]))throw Error('Choose an absolute folder path');
        const folder=await fs.promises.realpath(input[key]);
        if(!(await fs.promises.stat(folder)).isDirectory())throw Error('Choose a folder');
        // Do not allow the observer source to overlap the app-owned storage.
        const dataDir=path.dirname(store.file);
        const rel=path.relative(folder,dataDir);
        if(!rel || (!rel.startsWith('..')&&!path.isAbsolute(rel)))throw Error('Select the game screenshots/logs folder, not an app or drive root');
      }
    }
    store.data.settings={...store.data.settings,screenshots:input.screenshots,logs:input.logs,autoFollow:!!input.autoFollow};store.write();await observer.start(store.data.settings);return store.data.settings;
  });
  register('map-layers',layers=>{
    const keys=['extracts','pmcExtractNames','scavs','scavExtractNames','transits','transitNames','containerMedical','containerRations','containerTechnical','containerWeapons','containerValuables','containerCaches','looseValuables','looseBattlepass','looseMedical','looseProvisions','looseTechnical','looseKeys','looseWeapons','looseGear','looseTask','looseOther','labsKeycards','labsKeycardNames','landmarks','customMarkers'];
    if(!layers||keys.some(key=>typeof layers[key]!=='boolean'))throw Error('Invalid map layers');
    store.data.settings.mapLayers=Object.fromEntries(keys.map(key=>[key,layers[key]]));store.write();return store.data.settings.mapLayers;
  });
  register('progress',change=>{
    validateMode(change.mode);
    if(change.type==='quest') {
      if(!ids.has(change.id)||!['untracked','active','failed','completed'].includes(change.value))throw Error('Invalid quest');
      store.data.profiles[change.mode].quests[change.id]=change.value;
      if(change.value==='untracked')delete store.data.profiles[change.mode].questSources[change.id];else store.data.profiles[change.mode].questSources[change.id]='manual';
    }else if(change.type==='objective'){
      if(!objectiveIds.has(change.id)||typeof change.value!=='boolean')throw Error('Invalid objective');
      store.data.profiles[change.mode].objectives[change.id]=change.value;
    }else if(change.type==='objective-counter'){
      if(!objectiveIds.has(change.id)||!Number.isInteger(change.value)||!Number.isInteger(change.target)||change.value<0||change.target<1||change.value>change.target||change.target>9999||typeof change.confirmed!=='boolean')throw Error('Invalid objective counter');
      store.data.profiles[change.mode].objectiveProgress[change.id]={value:change.value,target:change.target,confirmed:change.confirmed,source:change.source==='ocr'?'ocr':'manual',updatedAt:Date.now()};
      store.data.profiles[change.mode].objectives[change.id]=change.confirmed&&change.value>=change.target;
    }else throw Error('Invalid progress');
    store.write();return true;
  });
  register('raid-preferences',input=>{
    const mode=validateMode(input?.mode),map=String(input?.map||'');if(!validMapIds.has(map))throw Error('Invalid map');
    if(!Array.isArray(input.hidden)||input.hidden.length>200||input.hidden.some(id=>typeof id!=='string'||!ids.has(id)))throw Error('Invalid hidden quests');
    const profile=store.data.profiles[mode];profile.raidHidden[map]=[...new Set(input.hidden)];store.write();return true;
  });
  register('quest-meta',input=>{const mode=validateMode(input?.mode),id=String(input?.id||''),hasNote=typeof input?.note==='string',hasFavorite=typeof input?.favorite==='boolean';if(!ids.has(id)||(!hasNote&&!hasFavorite)||(hasNote&&input.note.length>2000))throw Error('Invalid quest metadata');const p=store.data.profiles[mode];if(hasNote){if(input.note.trim())p.questNotes[id]=input.note.trim();else delete p.questNotes[id];}if(hasFavorite){const favorites=new Set(p.favorites);if(input.favorite)favorites.add(id);else favorites.delete(id);p.favorites=[...favorites];}store.write();return true;});
  register('custom-markers',input=>{const mode=validateMode(input?.mode),map=String(input?.map||'');if(!validMapIds.has(map)||!Array.isArray(input.markers)||input.markers.length>200)throw Error('Invalid custom markers');for(const marker of input.markers){if(typeof marker.id!=='string'||marker.id.length>80||typeof marker.name!=='string'||!marker.name.trim()||marker.name.length>80||typeof marker.note!=='string'||marker.note.length>500||![marker.position?.x,marker.position?.y,marker.position?.z].every(Number.isFinite))throw Error('Invalid custom marker');}store.data.profiles[mode].customMarkers[map]=input.markers;store.write();return true;});
  register('raid-event',input=>{const mode=validateMode(input?.mode);if(!['start','end','outcome'].includes(input?.type)||input.map&&!validMapIds.has(input.map)||input.type==='outcome'&&typeof input.id!=='string')throw Error('Invalid raid event');return store.recordRaidEvent(mode,input);});
  register('scan-task-screenshot',recognizeTasks);
  register('scan-item-screenshot',recognizeItem);
  register('load-items',mode=>loadItemCatalog(mode));
  register('refresh-item-prices',updateItemCatalog);
  register('item-hotkey-settings',enabled=>{if(typeof enabled!=='boolean')throw Error('Invalid item shortcut setting');store.data.settings.itemHotkeyEnabled=enabled;store.write();return configureItemHotkey();});
  register('item-value-settings',value=>{if(!Number.isFinite(value)||value<0||value>1000000)throw Error('Invalid item value threshold');store.data.settings.itemValueThreshold=Math.round(value);store.write();return store.data.settings.itemValueThreshold;});
  register('export-backup',async()=>{const result=await dialog.showSaveDialog(win,{title:'Export Raid Notes backup',defaultPath:'RaidNotes-backup-'+new Date().toISOString().slice(0,10)+'.json',filters:[{name:'Raid Notes backup',extensions:['json']}]});if(result.canceled)return null;await fs.promises.writeFile(result.filePath,JSON.stringify({format:'raid-notes-backup',exportedAt:new Date().toISOString(),appVersion:app.getVersion(),data:store.data},null,2));return result.filePath;});
  register('import-backup',async()=>{const result=await dialog.showOpenDialog(win,{title:'Import Raid Notes backup',properties:['openFile'],filters:[{name:'Raid Notes backup',extensions:['json']}]});if(result.canceled)return null;const raw=await fs.promises.readFile(result.filePaths[0],'utf8');if(raw.length>30*1024*1024)throw Error('The backup is too large.');const next=normalizeBackup(JSON.parse(raw));if(fs.existsSync(store.file))fs.copyFileSync(store.file,store.file+'.before-import-'+Date.now());store.data=next;store.write();return store.data;});
  register('load-catalog',mode=>loadCatalog(mode));
  register('import-catalog',async mode=>{
    validateMode(mode);const result=await dialog.showOpenDialog(win,{title:'Import Raid Notes quest data',properties:['openFile'],filters:[{name:'Quest catalog',extensions:['json']}]});
    if(result.canceled)return null;
    const raw=await fs.promises.readFile(result.filePaths[0],'utf8');if(raw.length>50*1024*1024)throw Error('The catalog is too large.');
    const doc=JSON.parse(raw),integrity=catalogReport(doc),target=customCatalogFile(mode),tmp=target+'.tmp';await fs.promises.mkdir(path.dirname(target),{recursive:true});await fs.promises.writeFile(tmp,JSON.stringify(doc));await fs.promises.rename(tmp,target);registerCatalog(doc);return {...doc,integrity,localOverride:true};
  });
  register('inspect-catalog',async mode=>{validateMode(mode);const result=await dialog.showOpenDialog(win,{title:'Preview Raid Notes quest data update',properties:['openFile'],filters:[{name:'Quest catalog',extensions:['json']}]});if(result.canceled)return null;const raw=await fs.promises.readFile(result.filePaths[0],'utf8');if(raw.length>50*1024*1024)throw Error('The catalog is too large.');const doc=JSON.parse(raw),integrity=catalogReport(doc),token=require('node:crypto').randomUUID();pendingCatalogs.set(token,{mode,doc});setTimeout(()=>pendingCatalogs.delete(token),10*60*1000).unref?.();return {token,integrity,generatedAt:doc.generatedAt||null};});
  register('apply-catalog',async input=>{const pending=pendingCatalogs.get(input?.token);if(!pending||pending.mode!==input?.mode)throw Error('The catalog preview expired. Choose the file again.');const target=customCatalogFile(pending.mode),tmp=target+'.tmp';await fs.promises.mkdir(path.dirname(target),{recursive:true});await fs.promises.writeFile(tmp,JSON.stringify(pending.doc));await fs.promises.rename(tmp,target);registerCatalog(pending.doc);pendingCatalogs.delete(input.token);return loadCatalog(pending.mode);});
  register('mode',mode=>{validateMode(mode);store.data.mode=mode;store.write();return true;});
  register('refresh-logs',refreshQuestLogs);
  register('open-data',()=>shell.openPath(path.dirname(store.file)));
  observer.on('state',state=>{if(!win.isDestroyed())win.webContents.send('observer',state);});
  observer.on('quest',event=>{
    const mode=['pvp','pve','seasonal'].includes(event.mode)?event.mode:store.data.mode;
    if(store.applyQuestEvent(mode,event)&&!win.isDestroyed())win.webContents.send('quest-progress',{...event,mode,source:'logs',catalogKnown:ids.has(event.id)});
  });
  configureItemHotkey();
  win.loadFile(path.join(assetRoot,'index.html'));
  win.on('closed',()=>{clearTimeout(priceOverlayTimer);if(priceOverlay&&!priceOverlay.isDestroyed())priceOverlay.destroy();app.quit();});
  observer.start(store.data.settings).catch(()=>{});
});
app.on('will-quit',()=>globalShortcut.unregisterAll());
app.on('window-all-closed',async()=>{observer?.stop();clearTimeout(priceOverlayTimer);try{await ocrWorker?.terminate();}catch{}app.quit();});
