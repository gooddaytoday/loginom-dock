"""Read-only origin binding from preparation and native browser observations.

A requested URL or a target profile without browser observations is not evidence.
The UI document epoch and the prepared graph document have different identifiers;
prepared_node_context is the observed bridge between those identities.
"""
from urllib.parse import urlsplit

PROFILE = dict(profile_id='loginom-7.4.2-macos-chromium-ru', loginom_build='7.4.2', platform='macos', browser='chromium')
ORIGIN = 'http://logi-test-plan.bg.local'

def canonical_origin(value):
    assert isinstance(value, str), 'Missing observed origin'
    u = urlsplit(value)
    assert u.scheme in ('http', 'https') and u.netloc and not u.username and not u.password
    assert u.path in ('', '/') and not u.query and not u.fragment, 'Origin is not an origin URL'
    return u.scheme + '://' + u.netloc

def observed_origin(events, operation, node, runtime=None, session=None):
    own = [(i,e) for i,e in enumerate(events) if e.get('operation_id') == operation]
    assert own, 'Missing operation evidence'
    sid = own[0][1]['session_id']; revision = own[0][1]['runtime_revision']
    assert session is None or sid == session
    assert runtime is None or revision == runtime
    def profile(e):
        assert e['session_id'] == sid and e['runtime_revision'] == revision, 'Foreign session/runtime'
        assert {k:e['target'].get(k) for k in PROFILE} == PROFILE, 'Foreign/incomplete target profile'
        if 'origin' in e['target']: assert canonical_origin(e['target']['origin']) == ORIGIN, 'Conflicting target origin'
    preparations = [(i,e) for i,e in enumerate(events) if e.get('event') == 'workspace_prepared' and e.get('session_id') == sid]
    assert len(preparations) == 1, 'Missing/ambiguous session preparation'
    pi, prepared = preparations[0]; profile(prepared); state = prepared['state']
    assert pi < own[0][0] and state['status'] == 'READY' and state['authenticated'] is True
    assert state['ownership_verified'] is True and state['target_verified'] is True
    assert state['session_id'] == sid and state['document_id'] == node['document_id'] and state['workflow_ref']['workflow_id'] == node['workflow_id'], 'Foreign prepared document'
    assert state['target'] == prepared['target'], 'Preparation profile conflict'
    wf = {k:state['workflow_ref'][k] for k in ('tab_tid','prefix')}
    terminal = [i for i,e in own if e.get('phase') == 'completed']; assert len(terminal) == 1
    observations = []; bound = []
    for i,e in own:
        profile(e)
        o = e.get('outcome',{}).get('output',{})
        if not isinstance(o,dict): continue
        if e.get('phase') == 'node_observation_completed':
            assert 'origin' in o, 'Missing native origin observation'
        if 'origin' not in o: continue
        assert pi < i < terminal[0], 'Stale/out-of-order browser observation'
        origin = canonical_origin(o['origin']); assert origin == ORIGIN, 'Foreign observed origin'
        assert o.get('authenticated') is True and o.get('loginom_build') == PROFILE['loginom_build']
        epoch = o.get('dom_epoch',{}).get('document'); assert isinstance(epoch,str) and epoch, 'Missing UI document epoch'
        observations.append((origin,epoch))
        context = o.get('prepared_node_context')
        if context is not None:
            assert context.get('verified') is True and all(context.get(k) == v for k,v in node.items()), 'Foreign observed node document'
            assert {k:o['workflow_ref'].get(k) for k in wf} == wf, 'Foreign observed workflow owner'
            if e.get('phase') == 'node_observation_completed': bound.append((origin,epoch))
    assert bound and observations and len(set(observations)) == 1 and set(bound) == set(observations), 'Missing/conflicting document origin evidence'
    return bound[0][0]
