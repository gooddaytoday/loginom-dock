import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { admitStartupArtifacts } from './artifacts.mjs';

// The model can carry only an opaque ticket. Paths and digests originate in the
// native host's user-input hook, never in MCP arguments chosen by the model.
export function createHostArtifactAdmission(config, session) {
  const admitted = new Map();
  const pending = new Map();
  const admit = async token => {
    if (token === undefined) return [];
    if (config.agent !== 'hermes' || config.resultProfile !== 'user-v1' || !/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid host artifact ticket');
    if (admitted.has(token)) return admitted.get(token);
    const directory = join(config.stateDir, 'host-inputs');
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw Error('Invalid host input directory');
    const path = join(directory, token + '.json');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let request;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 65536 || (stat.mode & 0o077)) throw Error('Invalid host ticket file');
      request = JSON.parse(await handle.readFile('utf8'));
    } finally { await handle.close(); }
    if (request.version !== 1 || typeof request.session_id !== 'string' || !request.session_id
      || !Number.isFinite(request.created_at) || Date.now() - request.created_at > 86400000
      || request.created_at > Date.now() + 60000) throw Error('Expired or invalid host artifact ticket');
    const claimPath = join(directory, token + '.claim');
    let claim;
    try { claim = await open(claimPath, 'wx', 0o600); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const previous = await open(claimPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { if (await previous.readFile('utf8') !== session.metadata.sessionId) throw Error('Host ticket belongs to another Dock session'); }
      finally { await previous.close(); }
    }
    if (claim) { try { await claim.writeFile(session.metadata.sessionId); await claim.sync(); } finally { await claim.close(); } }
    const result = await admitStartupArtifacts(session.artifactStore, request.files);
    admitted.set(token, result);
    return result;
  };
  return token => {
    if (pending.has(token)) return pending.get(token);
    const work = admit(token);
    pending.set(token, work);
    work.then(() => pending.delete(token), () => pending.delete(token));
    return work;
  };
}
