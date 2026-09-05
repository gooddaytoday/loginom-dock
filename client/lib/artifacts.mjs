// Host-only admission. Never expose sourcePath or this API as a model tool.
import {mkdir, open, lstat, realpath, unlink, chmod, rmdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join, resolve, isAbsolute} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const validName = name => typeof name==='string' && name.length>0 && name.length<=200
  && !/[\\/:<>"|?*\x00-\x1f\x7f]/.test(name) && !/[. ]$/.test(name)
  && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);

// Explicit host startup arguments, never accepted from an MCP/model request.
// Validate the complete batch before copying any file. A failed copy aborts
// startup, so partially admitted batches are never exposed to an agent.
export async function admitStartupArtifacts(store, requests) {
  if (!Array.isArray(requests) || requests.length>8) throw new Error('Invalid input artifact batch');
  const names=new Set();let total=0;
  for (const request of requests) {
    if (!request || typeof request!=='object' || Array.isArray(request)
        || Object.keys(request).sort().join(',')!=='bytes,name,sha256,sourcePath'
        || typeof request.sourcePath!=='string' || !isAbsolute(request.sourcePath)
        || !validName(request.name) || !Number.isSafeInteger(request.bytes)
        || request.bytes<0 || request.bytes>16*1024*1024
        || typeof request.sha256!=='string' || !/^[a-f0-9]{64}$/.test(request.sha256)) throw new Error('Invalid input artifact request');
    const name=request.name.normalize('NFC').toLowerCase();
    if (names.has(name)) throw new Error('Input artifact names must be distinct');
    names.add(name);total+=request.bytes;
  }
  if (total>64*1024*1024) throw new Error('Input artifact batch exceeds its byte limit');
  const admitted=[];
  for (const request of requests) admitted.push(await store.admit(request));
  return admitted;
}

async function readVerified(path, expected, maxBytes) {
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes<0 || expected.bytes>maxBytes
      || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw new Error('Invalid artifact identity');
  const info=await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Artifact must be a regular file');
  const file=await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat=await file.stat();
    if (!stat.isFile() || stat.size!==expected.bytes || stat.ino!==info.ino || stat.dev!==info.dev) throw new Error('Artifact changed before reading');
    // Bounded even if another process grows the file after stat().
    const bytes=Buffer.alloc(expected.bytes+1);let offset=0;
    while(offset<bytes.length) {
      const result=await file.read(bytes,offset,bytes.length-offset,offset);
      if (!result.bytesRead) break;
      offset+=result.bytesRead;
    }
    const result=bytes.subarray(0,offset);
    if (offset!==expected.bytes || sha(result)!==expected.sha256) throw new Error('Artifact size or SHA does not match the admitted identity');
    return result;
  } finally {await file.close();}
}

export async function createArtifactStore({directory,maxBytes=16*1024*1024}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>64*1024*1024) throw new Error('Invalid artifact limit');
  await mkdir(directory,{recursive:true,mode:0o700});
  const info=await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Artifact directory must be a real directory');
  const root=await realpath(resolve(directory)),entries=new Map(),transfers=new Set();
  const pendingStages=new Set();let closing=false;
  const stageUpload=async artifactId => {
      const descriptor=entries.get(artifactId);
      if (!descriptor) throw new Error('Artifact was not admitted in this session');
      const buffer=await readVerified(join(root,artifactId),descriptor,maxBytes);
      const directory=join(root,'transfer-'+randomUUID()),path=join(directory,descriptor.name);
      await mkdir(directory,{mode:0o700});
      const owner=await lstat(directory);
      let file;
      try {
        file=await open(path,'wx',0o600);
        await file.writeFile(buffer);await file.sync();await file.close();file=null;
        await chmod(path,0o400);await chmod(directory,0o500);
      } catch(error) {
        await file?.close();await chmod(directory,0o700);
        await unlink(path).catch(()=>{});await rmdir(directory);throw error;
      }
      let released=false,releasing;
      const assertOwner=async()=>{
        if (released) throw new Error('Upload transfer was released');
        const current=await lstat(directory);
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev!==owner.dev || current.ino!==owner.ino)
          throw new Error('Upload transfer directory was replaced');
      };
      const lease=Object.freeze({
        path,descriptor:Object.freeze(structuredClone(descriptor)),
        async verify() {await assertOwner();await readVerified(path,descriptor,maxBytes);return structuredClone(descriptor);},
        async release() {
          if (released) return;
          releasing ??= (async()=>{
            await assertOwner();await chmod(directory,0o700);
            await chmod(path,0o600);await unlink(path);await rmdir(directory);
            released=true;transfers.delete(lease);
          })();
          return releasing;
        },
      });
      transfers.add(lease);
      return lease;
  };
  return {
    async admit({sourcePath,name,bytes,sha256}) {
      if (!validName(name)) throw new Error('Invalid artifact display name');
      const payload=await readVerified(sourcePath,{bytes,sha256},maxBytes);
      const artifactId=randomUUID(),path=join(root,artifactId);
      const file=await open(path,'wx',0o600);
      try {await file.writeFile(payload);await file.sync();}
      catch(error) {await file.close();await unlink(path);throw error;}
      await file.close();
      const descriptor={artifact_id:artifactId,name,bytes,sha256};
      entries.set(artifactId,descriptor);
      return structuredClone(descriptor);
    },
    list() {return [...entries.values()].map(value=>structuredClone(value));},
    async resolve(artifactId) {
      const descriptor=entries.get(artifactId);
      if (!descriptor) throw new Error('Artifact was not admitted in this session');
      const buffer=await readVerified(join(root,artifactId),descriptor,maxBytes);
      // Private upload adapter gets the verified bytes, never a mutable source path.
      return {descriptor:structuredClone(descriptor),buffer};
    },
    // Private browser adapter only. Native setInputFiles accepts a path and
    // preserves its basename; no payload needs to be embedded in browser code.
    // A transport timeout does NOT release this lease. The adapter must confirm
    // completion (or close the browser) before releasing it.
    async stageUpload(artifactId) {
      if (closing) throw new Error('Upload staging is closed');
      if (transfers.size+pendingStages.size>=8) throw new Error('Too many unresolved upload transfers');
      const pending=stageUpload(artifactId);pendingStages.add(pending);
      pending.then(()=>pendingStages.delete(pending),()=>pendingStages.delete(pending));
      return pending;
    },
    // Call only after the browser transport has confirmed shutdown.
    async releaseUploads() {
      closing=true;
      await Promise.allSettled([...pendingStages]);
      return Promise.allSettled([...transfers].map(lease=>lease.release()));
    },
  };
}
