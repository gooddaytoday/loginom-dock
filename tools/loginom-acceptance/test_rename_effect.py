import copy
import unittest
import rename_effect


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

if __name__=='__main__':unittest.main()
