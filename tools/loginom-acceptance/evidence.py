"""Export only tool replies and function-call metadata; never copy model prose."""
import json
import re
import sqlite3

PREFIX = "mcp__loginom_dock__"
LOCAL_TOOLS = {PREFIX + name for name in ("dock_prepare", "dock_action_describe", "dock_action_run",
    "dock_workspace_observe", "dock_ui_action", "dock_operation_inspect", "dock_operation_recover", "dock_diagnostics")}
KNOWLEDGE_TOOLS = {PREFIX + name for name in ("find", "search", "read", "grep", "glob", "list", "tree")}

def clean(value, secrets):
    if isinstance(value, list): return [clean(x, secrets) for x in value]
    if isinstance(value, dict):
        return {k: ('[redacted]' if re.search(r'api.?key|password|token|secret|authorization|cookie', k, re.I) else clean(v,secrets))
                for k,v in value.items() if k.lower() not in ['reasoning','reasoning_content','reasoning_details','system_prompt']}
    if not isinstance(value, str): return value
    for secret in sorted((s for s in secrets if isinstance(s,str) and len(s)>3),key=len,reverse=True):
        value=value.replace(secret,'[redacted]')
    value=re.sub(r'\b(?:Bearer|Basic)\s+\S+', '[redacted]', value, flags=re.I)
    value=re.sub(r'(?i)([?&](?:token|key|api_key|access_token|password)=)[^&#\s]+', r'\1[redacted]', value)
    value=re.sub(r'(https?://)[^/@\s]+:[^/@\s]+@', r'\1[redacted]@', value)
    return value

def unwrap(value, depth=0):
    """Decode transport envelopes only; never reinterpret domain string fields."""
    if depth>=16: return value
    if isinstance(value,str):
        if value.startswith('<untrusted_tool_result'):
            start=value.find('\n\n'); end=value.rfind('\n</untrusted_tool_result>')
            if start>=0 and end>start:return unwrap(value[start+2:end],depth+1)
        try: decoded=json.loads(value)
        except (ValueError,TypeError):
            # dock_prepare combines a JSON receipt and the skill in one string.
            try:decoded=json.loads(value.split('\n',1)[0])
            except (ValueError,TypeError):return value
        return unwrap(decoded,depth+1) if decoded!=value else value
    if isinstance(value,list):return [unwrap(item,depth+1) for item in value]
    if isinstance(value,dict) and set(value)=={'result'}:return unwrap(value['result'],depth+1)
    if isinstance(value,dict) and set(value)=={'Ok'}:return unwrap(value['Ok'],depth+1)
    if isinstance(value,dict) and set(value)=={'error'}:return {'isError':True,'error':unwrap(value['error'],depth+1)}
    if isinstance(value,dict) and isinstance(value.get('content'),list):
        parts=[unwrap(item.get('text'),depth+1) for item in value['content'] if isinstance(item,dict) and item.get('type')=='text']
        if value.get('isError'):
            return {'isError':True,'content':parts}
        if parts and isinstance(parts[0],dict) and ('prepared' in parts[0] or
            all(key in parts[0] for key in ('status', 'action_key', 'operation_id'))):return parts[0]
        return parts[0] if len(parts)==1 else parts
    if isinstance(value,dict) and value.get('type')=='text' and 'text' in value:return unwrap(value['text'],depth+1)
    return value

def transport_documents(value, kind, depth=0):
    if depth > 16:
        return []
    if isinstance(value, str):
        if value.startswith('<untrusted_tool_result'):
            start=value.find('\n\n'); end=value.rfind('\n</untrusted_tool_result>')
            if start>=0 and end>start:
                return transport_documents(value[start+2:end],kind,depth+1)
        try:
            decoded=json.loads(value)
        except ValueError:
            found=[]
            for line in value.splitlines():
                try: decoded=json.loads(line)
                except ValueError: continue
                found.extend(transport_documents(decoded,kind,depth+1))
            return found
        return transport_documents(decoded,kind,depth+1)
    if isinstance(value,list):
        return [context for part in value for context in transport_documents(part,kind,depth+1)]
    if isinstance(value,dict):
        if value.get('kind') == kind:
            return [value]
        return [context for key in ('result','Ok','content','text') if key in value
                for context in transport_documents(value[key],kind,depth+1)]
    return []


def recovery_contexts(value, depth=0):
    return transport_documents(value, 'dock_recovery_context', depth)


def export_history(home, secrets):
    """Keep execution occurrences distinct; document proven compaction copies.

    Hermes replace_messages archives rows and persists the retained conversation
    with its original timestamps. Only exact copies (or the exact generic tool
    summary) across a recorded compression boundary can alias earlier evidence.
    No assistant body, compressed summary body or reasoning column is read.
    """
    path=home/'state.db'
    if not path.exists():return [],[]
    db=sqlite3.connect(f'file:{path}?mode=ro',uri=True)
    try:
        db.execute('BEGIN')
        columns={r[1] for r in db.execute('PRAGMA table_info(messages)')}
        timestamp='timestamp' if 'timestamp' in columns else 'NULL'
        active='active' if 'active' in columns else 'NULL'
        boundaries={}
        if '_compressed_summary' in columns:
            for row,session in db.execute("SELECT id,session_id FROM messages WHERE _compressed_summary=1"):
                boundaries.setdefault(session,[]).append(row)
        def copied(original,row,session,stamp):
            return (stamp is not None and original['timestamp']==stamp and original['active']==0
                    and any(original['row']<b<row for b in boundaries.get(session,[])))
        calls=[];dispatch=[]
        rows=db.execute(f"SELECT id,session_id,tool_calls,{timestamp},{active} FROM messages WHERE role='assistant' AND tool_calls IS NOT NULL ORDER BY id")
        for row,session,serialized,stamp,is_active in rows:
            decoded=json.loads(serialized)
            for index,item in enumerate(decoded if isinstance(decoded,list) else []):
                function=item.get('function',{});arguments=function.get('arguments',{})
                if isinstance(arguments,str):
                    try:arguments=json.loads(arguments)
                    except ValueError:pass
                raw_args=arguments;transport=function.get('name');name=transport
                if name=='tool_call' and isinstance(arguments,dict) and isinstance(arguments.get('name'),str):
                    name=arguments['name'];arguments=arguments.get('arguments',{})
                raw_id=item.get('id') or item.get('call_id')
                originals=[d for d in dispatch if d['session']==session and d['raw_id']==raw_id
                           and d['function']==function and copied(d,row,session,stamp)]
                if originals:
                    record=originals[0]['record']
                    record.setdefault('storage_copies',[]).append({'row':row,'timestamp':stamp,'kind':'identical_call_after_compression'})
                else:
                    record={'row':row,'session_id':session,'tool_call_id':f'{raw_id}@{row}:{index}',
                            'provider_tool_call_id':raw_id,'tool':name,'arguments':arguments,
                            **({'transport_tool':transport} if transport!=name else {})}
                    calls.append(record)
                dispatch.append({'row':row,'session':session,'raw_id':raw_id,'record':record,'function':function,
                                 'raw_args':raw_args,'transport':transport,'timestamp':stamp,'active':is_active})
        tools=[];originals=[]
        rows=db.execute(f"SELECT id,session_id,tool_call_id,tool_name,content,{timestamp},{active} FROM messages WHERE role='tool' ORDER BY id")
        for row,session,raw_id,name,content,stamp,is_active in rows:
            candidates=[d for d in dispatch if d['session']==session and d['raw_id']==raw_id and d['row']<row]
            latest=max((d['row'] for d in candidates),default=-1)
            candidates=[d for d in candidates if d['row']==latest]
            call=candidates[0] if len(candidates)==1 else None
            transport=name
            if name=='tool_call' and call:name=call['record']['tool']
            if name not in LOCAL_TOOLS | KNOWLEDGE_TOOLS:
                # Unmatched routed replies must not disappear from the audit.
                if transport!='tool_call':continue
            identifier=call['record']['tool_call_id'] if call else f'unmatched@{row}'
            prior=[t for t in originals if t['session']==session and t['identifier']==identifier and copied(t,row,session,stamp)]
            alias=None;kind=None
            for old in prior:
                if old['content']==content:alias=old;kind='identical_reply_after_compression';break
                if call and isinstance(call['raw_args'],dict):
                    first=''.join(f' {k}={str(v)[:40]}' for k,v in list(call['raw_args'].items())[:2])
                    stub=f"[{call['transport']}]{first} ({len(old['content']):,} chars result)"
                    if content==stub:alias=old;kind='exact_generic_summary_after_compression';break
            if alias:
                alias['record'].setdefault('storage_copies',[]).append({'row':row,'timestamp':stamp,'kind':kind,
                    'summary':content if kind=='exact_generic_summary_after_compression' else None})
                continue
            record={'row':row,'session_id':session,'tool_call_id':identifier,'provider_tool_call_id':raw_id,'tool':name,
                    **({'transport_tool':transport} if transport!=name else {}),'result':unwrap(content),
                    **({'pairing_error':'missing_or_ambiguous_call'} if not call else {}),
                    **({'recovery_contexts':recovery_contexts(content),
                        'verifications':transport_documents(content,'dock_outcome_verification')} if name in LOCAL_TOOLS else {})}
            tools.append(record)
            originals.append({'row':row,'session':session,'identifier':identifier,'content':content,'timestamp':stamp,'active':is_active,'record':record})
        return clean(calls,secrets),clean(tools,secrets)
    finally:db.close()


def tool_evidence(home, secrets):
    return export_history(home,secrets)[1]


def call_evidence(home, secrets):
    return export_history(home,secrets)[0]
