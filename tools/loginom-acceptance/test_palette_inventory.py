import copy
import unittest
import audit


class PaletteInventoryTest(unittest.TestCase):
    def fixture(self):
        group='MF;TF;ModelForm;colVendors_Компоненты>Импорт;TreeExpander'
        component='MF;TF;ModelForm;colVendors_Компоненты>Импорт>Текстовый_файл;TreeText'
        snapshot={'nodes':[],'links':[],'observation_id':'obs','ui':{'truncated':{'nodes':False,'ports':False,'links':False},'elements':[
            {'ref':'group','tid':group,'label':''},{'ref':'component','tid':component,'label':'Текстовый файл'}]}}
        return {'tools':[{'row':1,'result':{'output':snapshot}}, {'row':3,'result':{'output':copy.deepcopy(snapshot)}}],
                'calls':[{'row':2,'tool':audit.PREFIX+'dock_ui_action','arguments':{
                    'observation_id':'obs','action':{'verb':'click','ref':'group'}}}]}

    def test_observed_names_are_preserved_without_claiming_completeness(self):
        result=audit.palette_inventory(self.fixture(),[])
        self.assertTrue(result['all_assertions_passed'])
        self.assertFalse(result['inventory']['complete'])
        self.assertEqual(result['inventory']['components'][0]['label'],'Текстовый файл')

    def test_outside_group_mutations_and_nonempty_graph_are_rejected(self):
        for mutate in [lambda d:d['calls'][0].update(tool=audit.PREFIX+'dock_action_run'),
                       lambda d:d['calls'][0]['arguments']['action'].update(ref='component'),
                       lambda d:d['calls'][0]['arguments'].update(observation_id='unknown'),
                       lambda d:d['tools'][0]['result']['output']['nodes'].append({'label':'Created'})]:
            data=self.fixture();mutate(data)
            self.assertFalse(audit.palette_inventory(data,[])['all_assertions_passed'])

    def test_palette_scope_does_not_prove_empty_graph(self):
        for key in ('nodes','ports','links'):
            data=self.fixture()
            for item in data['tools']:item['result']['output']['ui']['truncated'][key]=True
            self.assertFalse(audit.palette_inventory(data,[])['all_assertions_passed'])
        data=self.fixture();data['tools'].pop()
        self.assertFalse(audit.palette_inventory(data,[])['all_assertions_passed'])

    def test_target_can_be_delivered_on_a_later_page_but_not_after_action(self):
        data=self.fixture();first=data['tools'][0]['result']['output']
        first.update(page={'scope':'all'},observation_revision='a'*64)
        second=copy.deepcopy(first);second['ui']['elements']=[first['ui']['elements'].pop(0)]
        data['tools'].insert(1,{'row':1.5,'result':{'output':second}})
        self.assertTrue(audit.palette_inventory(data,[])['all_assertions_passed'])
        second['observation_revision']='b'*64
        self.assertFalse(audit.palette_inventory(data,[])['all_assertions_passed'])
        second['observation_revision']='a'*64;data['tools'][1]['row']=2.5
        # The final observation is also after the action, so it cannot supply its ref.
        self.assertFalse(audit.palette_inventory(data,[])['all_assertions_passed'])

    def test_prior_mutation_invalidates_previously_delivered_refs(self):
        data=self.fixture();data['calls'].append(copy.deepcopy(data['calls'][0]))
        data['calls'][1]['row']=2.5
        self.assertFalse(audit.palette_inventory(data,[])['all_assertions_passed'])


if __name__=='__main__':unittest.main()
