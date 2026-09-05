import test from 'node:test';
import assert from 'node:assert/strict';
import {Page,build} from './support/executor-fixture.mjs';
import {makeArtifactDownloadCode} from '../lib/executor.mjs';

function fixture() {
  const page=new Page(),elements=page.elements.bind(page),snapshot=page.uiSnapshot.bind(page);
  const name='sales.csv',tid=page.prefix+';FileStorageForm;colName_'+name;
  page.elements=()=>[...elements(),page.element(tid,{label:name,kind:'file'})];
  page.directory='/test';
  page.uiSnapshot=()=>({...snapshot(),file_storage:{status:'observed',directory:page.directory,listing_complete:false}});
  const observed=page.uiSnapshot(),file=observed.ui.elements.find(item=>item.tid===tid);
  const artifact={artifact_id:'a',name,bytes:3,sha256:'a'.repeat(64),upload:{grant_id:'g',directory:'/test',destination:'/test/'+name}};
  const options={artifact,snapshot:observed,file_ref:file.ref,observation_id:'read',operation_id:'download',upload_operation_id:'upload',
    expected_origin:'https://loginom.invalid',expected_build:build,download_path:'/private/new-download/sales.csv'};
  const calls=[];let resolveDownload;
  const download={url:()=> 'https://loginom.invalid/download?private=not-for-output',suggestedFilename:()=>name,
    saveAs:async path=>{assert.equal(path,options.download_path);calls.push('save');},failure:async()=>null,cancel:async()=>{calls.push('cancel');}};
  page.waitForEvent=async type=>{assert.equal(type,'download');calls.push('listen');return new Promise(resolve=>{resolveDownload=resolve;});};
  const click=page.mouse.click;
  page.mouse.click=async(...args)=>{calls.push('click');await click(...args);resolveDownload?.(download);};
  return {page,options,download,calls,run:()=>page.execute(makeArtifactDownloadCode(options))};
}

test('download binds the checked file gesture to its page event and exact private save destination',async()=>{
  const f=fixture(),result=await f.run();
  assert.equal(result.status,'SUCCEEDED');assert.equal(result.cleanup_complete,true);
  assert.deepEqual(f.calls,['listen','click','save']);
  assert.equal(result.output.destination,'/test/sales.csv');
  assert.equal(result.output.upload_operation_id,'upload');
  assert.equal(result.output.bytes_verification_required,true);
  assert.ok(!JSON.stringify(result).includes('/private/'));
  assert.ok(!JSON.stringify(result).includes('not-for-output'));
});

test('download refuses a different file label, formatted-name collision or package before the browser',()=>{
  for(const change of [f=>{f.options.artifact.name='other.csv';},f=>{f.options.artifact.name='sales.lgp';},
    f=>{f.options.snapshot.ui.elements.find(item=>item.ref===f.options.file_ref).label='sale,s.csv';},
    f=>{f.options.file_ref='unissued';}]) {
    const f=fixture();change(f);assert.throws(()=>makeArtifactDownloadCode(f.options),/exact observed authorized CSV/);
    assert.deepEqual(f.calls,[]);
  }
});

test('changed directory or epoch prevents the download gesture',async()=>{
  for(const kind of ['directory','epoch']) {
    const f=fixture();
    if(kind==='directory')f.page.directory='/other';
    else {const before=f.page.uiSnapshot.bind(f.page);f.page.uiSnapshot=()=>({...before(),dom_epoch:{document:'new',revision:1}});}
    const result=await f.run();assert.equal(result.status,'NOT_APPLIED');assert.equal(result.effect_possible,false);
    assert.deepEqual(f.calls,[]);
  }
});

test('wrong filename or foreign origin cancels instead of persisting the download',async()=>{
  for(const kind of ['filename','origin']) {
    const f=fixture();
    if(kind==='filename')f.download.suggestedFilename=()=> 'sales.zip';
    else f.download.url=()=> 'https://loginom.invalid.evil.test/download';
    const result=await f.run();assert.equal(result.status,'AMBIGUOUS');assert.equal(result.cleanup_complete,true);
    assert.deepEqual(f.calls,['listen','click','cancel']);assert.equal(result.output.download_completed,undefined);
  }
});

test('failed gesture drains and cancels the captured download',async()=>{
  const f=fixture(),click=f.page.mouse.click;
  f.page.mouse.click=async(...args)=>{await click(...args);throw new Error('private click failure');};
  const result=await f.run();assert.equal(result.status,'AMBIGUOUS');
  assert.equal(result.error.code,'DOWNLOAD_GESTURE_NOT_CONFIRMED');
  assert.deepEqual(f.calls,['listen','click','cancel']);
});

test('missing event and post-download context change cannot claim a verified copy',async()=>{
  const missing=fixture();missing.page.waitForEvent=()=>Promise.reject(new Error('timeout'));
  const absent=await missing.run();assert.equal(absent.status,'AMBIGUOUS');assert.equal(absent.cleanup_complete,false);
  assert.equal(absent.error.code,'DOWNLOAD_EVENT_MISSING');
  const changed=fixture(),save=changed.download.saveAs;
  changed.download.saveAs=async path=>{await save(path);changed.page.directory='/other';};
  const result=await changed.run();assert.equal(result.error.code,'DOWNLOAD_CONTEXT_CHANGED');
  assert.equal(result.status,'AMBIGUOUS');assert.equal(result.output.download_completed,undefined);
});
