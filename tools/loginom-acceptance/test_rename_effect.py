import copy
import unittest
import rename_effect
import json
from pathlib import Path
import subprocess


def fixture():
    def state(obs,label,value):
        return {'observation_id':obs,'workflow_ref':{'prefix':'MF;TF-1'},'links':[],
                'nodes':[{'node_ref':{'node_label':label},'ports':[{'tid':'MF;TF-1;Graph;'+label+';Output_Data-0'}]}],
                'ui':{'truncated':dict(nodes=False,ports=False,links=False),'elements':[
                    {'ref':'editor','value':value,'signature':{'tag':'textarea'},'identity':{'anchor_tid':'MF;TF-1;ModelForm;cmpDiagram'}}]}}
    tools=[{'row':10,'tool_call_id':'observe','result':{'output':state('before','Текстовый_файл','Текстовый файл')}}]
    calls=[];events=[]
    for row,verb,obs,out in [(11,'fill','before',state('filled','Текстовый_файл','Источник')),(13,'press','filled',state('after','Источник','Источник'))]:
        action={'ref':'editor','verb':verb,**({'text':'Источник'} if verb=='fill' else {'key':'Enter'})}
        calls.append({'row':row,'tool':'dock_ui_action','tool_call_id':str(row),'arguments':{'observation_id':obs,'action':action}})
        result={'operation_id':str(row),'status':'SUCCEEDED','cleanup_complete':True,'output':out,
                'trace':[{'event':'ui_preconditions_verified','verb':verb,'refs':['editor']},{'event':'ui_gesture_applied','verb':verb}]}
        tools.append({'row':row+1,'tool_call_id':str(row),'result':result})
        events.append({'phase':'completed','operation_id':str(row),'outcome':copy.deepcopy(result)})
    return tools,calls,events

class RenameEffect(unittest.TestCase):
    def proof(self,data):return rename_effect.prove(*data,8,'Источник')
    def test_real_fill_and_commit_receipts(self):self.assertIsNotNone(self.proof(fixture()))
    def test_host_observation_metadata_does_not_change_journal_effect(self):
        data=fixture()
        for e in data[2]:
            e['outcome']['output'].pop('observation_id')
            e['outcome']['output']['origin']='https://fixture.invalid/'
        for t in data[0][1:]:t['result']['output']['origin']='https://fixture.invalid'
        self.assertIsNotNone(self.proof(data))
        data[2][-1]['outcome']['output']['nodes'][0]['node_ref']['node_label']='Other'
        self.assertIsNone(self.proof(data))

    def test_hidden_label_during_edit_uses_last_full_snapshot(self):
        data=fixture();baseline=copy.deepcopy(data[0][0]);baseline.update(row=9,tool_call_id='baseline')
        baseline['result']['output']['observation_id']='baseline'
        data[0].insert(0,baseline)
        data[0][1]['result']['output']['nodes']=[]
        data[0][2]['result']['output']['nodes']=[]
        data[2][0]['outcome']=copy.deepcopy(data[0][2]['result'])
        self.assertIsNotNone(self.proof(data))
        data[0][0]['result']['output']['nodes'][0]['ports']=[]
        self.assertIsNone(self.proof(data))

    def test_missing_gesture_journal_and_wrong_editor_fail(self):
        for case in ('trace','journal','editor','path','value'):
            data=fixture()
            if case=='trace':data[0][1]['result']['trace']=[]
            elif case=='journal':data[2].pop()
            elif case=='editor':data[1][1]['arguments']['action']['ref']='other'
            elif case=='path':data[0][0]['result']['output']['ui']['elements'][0]['identity']['anchor_tid']='other'
            else:data[0][1]['result']['output']['ui']['elements'][0]['value']='other'
            self.assertIsNone(self.proof(data))
    def test_changed_ports_and_incomplete_graph_fail(self):
        for case in ('ports','truncated'):
            data=fixture();out=data[0][-1]['result']['output']
            if case=='ports':out['nodes'][0]['ports']=[]
            else:out['ui']['truncated']['nodes']=True
            data[2][-1]['outcome']=copy.deepcopy(data[0][-1]['result'])
            self.assertIsNone(self.proof(data))

    def test_actual_runtime_projection_matches_journal_but_changed_effects_do_not(self):
        data=fixture()
        root=Path(__file__).resolve().parents[2]
        # Exercise actual JS serialization; the verifier is independent Python.
        script="""import { createObservationPages } from './client/lib/observation-pages.mjs';
let text=''; for await (const part of process.stdin) text+=part;
const values=JSON.parse(text); console.log(JSON.stringify(values.map(value=>createObservationPages().retain(value))));"""
        raw=[copy.deepcopy(t['result']) for t in data[0]]
        for value in raw:
            value['output'].pop('observation_id',None)
            value['output']['wizard']={'status':'observed','title':'Настройка форматов импорта','stage':'text_import_format','controls':{'btnNext':{'status':'observed','enabled':True}}}
            value['output']['ui']['elements'][0]['signature']['large']='x'*1000
            value['output']['ui']['table_cells']=[{'text':'  value  ','data_cell':{'view_key':'v','column_key':'Comment','row_index':0,'display_text':'  value  ','text_complete':True,'null_marker_present':False,'header_observed':True,'redacted':False}}]
        result=subprocess.run(['node','--input-type=module','-e',script],cwd=root,input=json.dumps(raw),text=True,capture_output=True,check=True)
        projected=json.loads(result.stdout)
        for source,reply in zip(raw,projected):self.assertTrue(rename_effect.journal_equal(source,reply))
        for mutate in [lambda r:r['output']['nodes'][0]['node_ref'].update(node_label='Different'),
                       lambda r:r['output']['ui']['elements'][0].update(value='Different'),
                       lambda r:r['output']['ui']['truncated'].update(nodes=True),
                       lambda r:r['output']['page'].update(total_records=999),
                       lambda r:r['output']['page'].update(full_dom_complete=True),
                       lambda r:r['output']['ui']['table_cells'][0]['data_cell'].update(null_marker_present=True),
                       lambda r:r['output']['ui']['table_cells'][0]['data_cell'].update(row_index=1),
                       lambda r:r['output']['wizard'].update(title='Wrong title'),
                       lambda r:r['output']['wizard'].update(stage='done'),
                       lambda r:r['output'].pop('wizard'),
                       lambda r:r.update(status='AMBIGUOUS')]:
            bad=copy.deepcopy(projected[-1]);mutate(bad)
            self.assertFalse(rename_effect.journal_equal(raw[-1],bad))

if __name__=='__main__':unittest.main()

class ContinuationProjection(unittest.TestCase):
    def test_all_pages_match_their_native_receipt_and_reject_changed_offset_content(self):
        root=Path(__file__).resolve().parents[2]
        raw={'status':'SUCCEEDED','operation_id':'read','output':{'nodes':[],'links':[],
          'file_storage':{'status':'observed','directory':'/test'},
          'ui':{'elements':[{'ref':f'ui-{i}','label':f'cell {i}','signature':{'tag':'td','private':'hidden'}} for i in range(70)],
                'dialogs':[],'masks':[],'messages':[],'table_cells':[], 'truncated':{}}}}
        script="""import {createObservationPages} from './client/lib/observation-pages.mjs';
let text='';for await(const part of process.stdin)text+=part;
const raw=JSON.parse(text),pages=createObservationPages(),out=[];
let page=pages.retain(structuredClone(raw));out.push(page);
while(page.output.page.next_cursor){page=pages.next(page.output.page.next_cursor,structuredClone(raw));out.push(page);}
console.log(JSON.stringify(out));"""
        result=subprocess.run(['node','--input-type=module','-e',script],cwd=root,input=json.dumps(raw),text=True,capture_output=True,check=True)
        pages=json.loads(result.stdout)
        self.assertEqual([p['output']['page']['offset'] for p in pages],[0,32,64])
        for reply in pages:
            self.assertTrue(rename_effect.journal_equal(raw,reply))
            for mutate in [lambda r:r['output']['page'].update(offset=True),
                           lambda r:r['output']['page'].update(offset=-1),
                           lambda r:r['output']['page'].update(offset=999),
                           lambda r:r['output']['page'].update(offset=r['output']['page']['offset']+1),
                           lambda r:r['output']['ui']['elements'][0].update(label='changed'),
                           lambda r:r['output']['file_storage'].update(directory='/wrong')]:
                changed=copy.deepcopy(reply);mutate(changed)
                self.assertFalse(rename_effect.journal_equal(raw,changed))
        changed=copy.deepcopy(pages[-1]);changed['output']['page']['captured_snapshot_complete']=True
        self.assertFalse(rename_effect.journal_equal(raw,changed))
        changed=copy.deepcopy(pages[-1]);changed['output']['ui']['truncated']['elements']=False
        self.assertFalse(rename_effect.journal_equal(raw,changed))
