"""Node16 preparation/admission. No credentials, network, browser or model calls."""
import hashlib,json,re,shutil
from pathlib import Path
from destinations import storage_segments
from preflight import runtime_pin
WORK=Path(__file__).resolve().parent;ROOT=WORK.parents[1]
KIT=WORK/'collapse/acceptance-kit'
GOAL_ID='collapse-node-complete'
SOURCE='77385e36a969e61ade03ab072678b8fb6f00a27d'
RUNTIME='db6d957169c50bcd5cb169db80d744fd846b8ffa4eee683178619c001fb22bab'
# There is no admitted retained-byte observer. A receipt document cannot opt in.
READONLY_PRODUCER=None

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def frozen():
    m=json.loads((KIT/'manifest.json').read_text())
    for name,digest in m['kit_files'].items():
        path=(KIT/name).resolve()
        if not path.is_relative_to(KIT.resolve()) or sha(path)!=digest:raise ValueError('Collapse frozen kit changed: '+name)
    if (WORK/'goals/collapse-node-complete.txt').read_bytes()!=(KIT/'hermes-goal.md').read_bytes():raise ValueError('Collapse goal changed')
    return json.loads((KIT/'goal.json').read_text())
def harness_pins():
    paths=[*WORK.glob('*.py'),*WORK.glob('*.mjs'),WORK/'goals/collapse-node-complete.txt']
    paths += [KIT.parent/'exact-wiring/public-audit.py',KIT.parent/'review-fix/provenance.json',KIT.parent/'runner-integration/readonly-source.schema.json']
    paths += [p for p in KIT.rglob('*') if p.is_file() and '__pycache__' not in p.parts]
    return {p.relative_to(WORK).as_posix():sha(p) for p in sorted(paths)}
def fixtures(run_id,directory):
    frozen();storage_segments(directory)
    if not re.fullmatch(r'\d{8}-\d{6}-[a-f0-9]{8}',run_id):raise ValueError('Invalid Collapse run identity')
    return [dict(name='Dock-collapse-'+run_id+'-'+p.name,bytes=p.stat().st_size,sha256=sha(p),upload=dict(directory=directory,overwrite='replace')) for p in sorted((KIT/'fixtures').glob('*.csv'))]
def fixture_paths():return sorted((KIT/'fixtures').glob('*.csv'))
def prompt(package,directory,run_id):
    text=(KIT/'hermes-goal.md').read_text()
    for p,a in zip(fixture_paths(),fixtures(run_id,directory)):text=text.replace(p.name,a['name'])
    text+='\nИдентификаторы итоговых операций: '+', '.join(run_id+':'+k for k in json.loads((KIT/'expected.json').read_text()))+'. Отдельные операции: '+', '.join(run_id+':'+k for k in ['done','close','negative-conflict','negative-missing','negative-empty','loss'])+'. Для отрицательного отсутствующего поля используйте __MissingField__. При потере ответа сохраняйте исходную операцию.\n'
    return text+'\nКаталог: '+directory+'\nОсновной пакет: '+package+'\nRun ID: '+run_id+'\nНачинайте operation_id с '+run_id+'; каждому действию — новый суффикс.\n'
def admission(args):
    errors=[]
    try:g=frozen();gates={k:v for k,v in g['gates'].items() if k!='autonomous-audit'}
    except (OSError,ValueError,KeyError) as e:gates={'freeze':'OPEN'};errors.append(str(e))
    gates['runner-collapse-goal-integration']='IMPLEMENTED_NOT_ADMITTED'
    gates['new-session-readonly-source-proof']='OPEN_NO_PRODUCER'
    gates['candidate-stage-and-readback']='OPEN_NO_ADMITTED_ATTESTATION'
    gates['candidate-source-rehearsal']='OPEN'
    gates['independent-topology-readback-producers']='OPEN'
    gates['loss-native-evidence-bridge']='OPEN'
    gates['coordinator-hermes-slot']='OPEN'
    free=shutil.disk_usage(ROOT).free
    # Space alone never grants a slot/resource reservation across active streams.
    gates['resource']='OPEN_RESERVATION_REQUIRED' if free>=10*1024**3 else 'OPEN_INSUFFICIENT_10_GIB'
    try:
        pin=runtime_pin(ROOT)
        if pin['client_revision']!=RUNTIME:gates['source-runtime']='OPEN_MISMATCH'
    except (OSError,ValueError):gates['source-runtime']='OPEN_UNVERIFIED'
    return dict(goal_id=GOAL_ID,status='BLOCKED',ready=False,model_started=False,source_sha=SOURCE,runtime=RUNTIME,
                provider='openai-codex',model='gpt-5.6-sol',reasoning_effort='low',fallback_allowed=False,
                gates=gates,errors=errors,free_bytes=free,minimum_hermes_free_bytes=10*1024**3,
                readonly_producer=READONLY_PRODUCER,harness_inputs=harness_pins())
def require_admission(args):
    result=admission(args)
    if not result['ready']:raise ValueError('Collapse admission blocked: '+', '.join(result['gates']))
    return result
