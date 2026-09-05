import copy
import unittest
import audit


class PaletteInventoryTest(unittest.TestCase):
    def fixture(self):
        group='MF;TF;ModelForm;colVendors_Компоненты>Импорт;TreeExpander'
        component='MF;TF;ModelForm;colVendors_Компоненты>Импорт>Текстовый_файл;TreeText'
        snapshot={'nodes':[],'links':[],'observation_id':'obs','ui':{'elements':[
            {'ref':'group','tid':group,'label':''},{'ref':'component','tid':component,'label':'Текстовый файл'}]}}
        return {'tools':[{'row':1,'result':{'output':snapshot}}],
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


if __name__=='__main__':unittest.main()
