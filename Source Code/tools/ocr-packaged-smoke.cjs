const fs=require('node:fs'),path=require('node:path');
const appRoot=path.resolve(__dirname,'../dist/RaidNotes-win32-x64/resources/app'),fromApp=name=>require.resolve(name,{paths:[appRoot]});
const {createWorker,OEM}=require(fromApp('tesseract.js')),language=require(fromApp('@tesseract.js-data/eng'));
(async()=>{
  const directory=process.argv[2],file=fs.readdirSync(directory).filter(name=>/\.(?:png|jpe?g|webp|bmp)$/i.test(name)).map(name=>({name,time:fs.statSync(path.join(directory,name)).mtimeMs})).sort((a,b)=>b.time-a.time)[0];if(!file)throw Error('No image found');
  const worker=await createWorker('eng',OEM.LSTM_ONLY,{langPath:language.langPath,workerPath:fromApp('tesseract.js/src/worker-script/node/index.js'),corePath:path.dirname(fromApp('tesseract.js-core/tesseract-core.wasm.js')),cachePath:path.join(__dirname,'../.ocr-smoke-cache')});const result=await worker.recognize(path.join(directory,file.name));await worker.terminate();console.log(JSON.stringify({packaged:true,confidence:result.data.confidence,textLength:result.data.text.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
