"""Prove a committed in-place UI rename, independently of the domain goal."""
import copy
import re


def journal_equal(record, reply):
    # retainObservation adds an opaque observation ID and canonicalizes origin
    # after the immutable UI receipt is journaled. No graph/effect is rewritten.
    def normalized(value):
        value=copy.deepcopy(value)
        output=value.get('output',{})
        output.pop('observation_id',None)
        origin=output.get('origin')
        if isinstance(origin,str) and re.fullmatch(r'https?://[^/?#]+/?',origin):
            output['origin']=origin.rstrip('/')
        return value
    return normalized(record)==normalized(reply)


def prove(tools, calls, events, after_row, expected):
    observations={t.get('result',{}).get('output',{}).get('observation_id'):t
                  for t in tools if isinstance(t.get('result'),dict)}
    replies={t['tool_call_id']:t for t in tools}
    def bound(call):
        reply=replies.get(call['tool_call_id'],{});r=reply.get('result',{})
        args=call.get('arguments',{});action=args.get('action',{})
        observed=observations.get(args.get('observation_id'),{});s=observed.get('result',{}).get('output',{})
        elements=[e for e in s.get('ui',{}).get('elements',[]) if e.get('ref')==action.get('ref')]
        if (len(elements)!=1 or observed.get('row',10**12)>=call['row'] or r.get('status')!='SUCCEEDED'
            or r.get('cleanup_complete') is not True
            or not any(e.get('event')=='ui_preconditions_verified' and e.get('refs')==[action.get('ref')]
                       and e.get('verb')==action.get('verb') for e in r.get('trace',[]))
            or not any(e.get('event')=='ui_gesture_applied' and e.get('verb')==action.get('verb') for e in r.get('trace',[]))
            or not any(e.get('phase')=='completed' and e.get('operation_id')==r.get('operation_id')
                       and journal_equal(e.get('outcome',{}),r) for e in events)):
            return None
        element=elements[0]
        return reply,s,element
    def structure(s):
        if len(s.get('nodes',[]))!=1 or s.get('links')!=[]:return None
        if any(s.get('ui',{}).get('truncated',{}).get(k) is not False for k in ('nodes','ports','links')):return None
        n=s['nodes'][0];label=n['node_ref']['node_label']
        tids=[p['tid'].split(';')[-1] for p in n['ports']]
        if not tids or len(tids)!=len(set(tids)):return None
        return label,sorted(tids),s.get('workflow_ref')
    fills=[]
    for call in sorted(calls,key=lambda c:c['row']):
        if call['row']<=after_row or not call['tool'].endswith('dock_ui_action'):continue
        action=call.get('arguments',{}).get('action',{});match=bound(call)
        if not match:continue
        reply,before,element=match
        prefix=(before.get('workflow_ref') or {}).get('prefix')
        if not prefix or element.get('signature',{}).get('tag')!='textarea' or element.get('identity',{}).get('anchor_tid')!=prefix+';ModelForm;cmpDiagram':continue
        if action.get('verb')=='fill' and action.get('text')==expected:
            fills.append((call,reply,before));continue
        if action.get('verb')!='press' or action.get('key')!='Enter' or element.get('value')!=expected:continue
        after=reply['result'].get('output',{})
        for fill,filled,initial in reversed(fills):
            if filled['row']>=call['row'] or fill['arguments']['action']['ref']!=action.get('ref'):continue
            intervening=[c for c in calls if filled['row']<c['row']<call['row'] and c['tool'].endswith(('dock_action_run','dock_ui_action','dock_operation_recover'))]
            if any(not (replies.get(c['tool_call_id'],{}).get('result',{}).get('request_rejected') is True
                        and replies[c['tool_call_id']]['result'].get('effect_possible') is False) for c in intervening):continue
            baselines=[t for t in tools if after_row<t.get('row',0)<fill['row']
                       and isinstance(t.get('result'),dict) and structure(t['result'].get('output',{}))]
            for baseline in sorted(baselines,key=lambda t:t['row'],reverse=True):
                old=structure(baseline['result']['output']);new=structure(after)
                if not old or not new or old[0]==expected or new[0]!=expected or old[1:]!=new[1:]:continue
                if initial.get('workflow_ref')!=old[2] or before.get('workflow_ref')!=old[2]:continue
                safe=True
                for c in calls:
                    if not baseline['row']<c['row']<fill['row'] or not c['tool'].endswith(('dock_action_run','dock_ui_action','dock_operation_recover')):continue
                    r=replies.get(c['tool_call_id'],{}).get('result',{})
                    if r.get('request_rejected') is True and r.get('effect_possible') is False:continue
                    checked=bound(c) if c['tool'].endswith('dock_ui_action') else None
                    if not checked:safe=False;break
                    a=c['arguments']['action'];el=checked[2]
                    anchor=el.get('identity',{}).get('anchor_tid')
                    node=old[2]['prefix']+';Graph;'+old[0]
                    if anchor not in (node,node+';Label;Label') or not (a.get('verb') in ('click','double_click') or a.get('verb')=='press' and a.get('key')=='F2'):
                        safe=False;break
                if safe:return {'fill_call_row':fill['row'],'commit_call_row':call['row'],'after_row':reply['row']}

    return None
