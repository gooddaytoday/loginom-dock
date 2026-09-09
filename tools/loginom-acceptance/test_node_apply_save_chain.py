import copy
import unittest

from node_apply_save_chain import verify_save_chain
import test_saved_import_evidence as saved_fixtures


class SaveChainTests(unittest.TestCase):
    def setUp(self):
        final = saved_fixtures.SavedPackageTransitionTests(); final.setUp()
        intermediate = saved_fixtures.IntermediateSavedPackageTests(); intermediate.setUp()
        self.path, self.seed = final.path, final.seed
        draft = self.path + '.draft.lgp'
        self.events = [copy.deepcopy(final.events[0])]
        # Reuse independent observed-contract fixtures, not verifier output.
        def replace(value):
            if isinstance(value, str):
                return draft if value == self.path else ('checkpoint' if value == 'save' else value)
            if isinstance(value, dict):
                return {k: replace(v) for k, v in value.items()}
            if isinstance(value, list):
                return [replace(v) for v in value]
            return value
        self.events.extend(replace(e) for e in intermediate.events[1:3])
        for e in copy.deepcopy(final.events[1:3]):
            e['checkpoint']['package_identity']['path'] = draft
            self.events.append(e)
        for e in self.events[1:]:
            e['action_revision'] = '2'
        self.revisions = {'package.save_checkpoint': '2', 'package.save_as': '2'}

    def audit(self):
        return verify_save_chain(self.events, self.seed, self.path, self.revisions)

    def test_two_distinct_saves_without_false_full_acceptance(self):
        result = self.audit()
        self.assertTrue(result['passed'], result)
        self.assertEqual(result['save_operation_ids'], ['checkpoint', 'save'])
        self.assertFalse(result['settings_persistence_verified'])
        self.assertFalse(result['hermes_acceptance_verified'])

    def test_missing_duplicate_and_reordered_saves_rejected(self):
        original = copy.deepcopy(self.events)
        for i in range(len(original)):
            for duplicate in (False, True):
                with self.subTest(index=i, duplicate=duplicate):
                    self.events = copy.deepcopy(original)
                    if duplicate:
                        self.events.insert(i, copy.deepcopy(self.events[i]))
                    else:
                        self.events.pop(i)
                    self.assertFalse(self.audit()['passed'])
        self.events = [original[0], *original[3:5], *original[1:3]]
        self.assertFalse(self.audit()['passed'])

    def test_declared_replace_without_actual_conflict_is_valid(self):
        for event in self.events[1:]:
            event['parameters']['conflict_policy'] = 'replace'
        self.assertTrue(self.audit()['passed'])
        # A real overwrite still requires separate conflict/persistence proof.
        self.events[4]['outcome']['trace'].append(dict(event='overwrite_confirmed'))
        self.assertFalse(self.audit()['passed'])

    def test_invalid_or_inconsistent_policy_rejected(self):
        original = copy.deepcopy(self.events)
        for policy in ('ignore', '', None, True):
            self.events = copy.deepcopy(original)
            for event in self.events[1:]:
                event['parameters']['conflict_policy'] = policy
            self.assertFalse(self.audit()['passed'])
        self.events = copy.deepcopy(original)
        self.events[1]['parameters']['conflict_policy'] = 'replace'
        self.assertFalse(self.audit()['passed'])

    def test_changed_path_graph_revision_and_premature_reopen_rejected(self):
        changes = [
            lambda e: e[3]['checkpoint']['package_identity'].update(path=''),
            lambda e: e[2]['outcome']['output'].update(reopened=True),
            lambda e: e[2]['outcome']['output'].update(workflow_preserved=False),
            lambda e: e[2]['outcome']['trace'].append(dict(event='saved_package_closed')),
            lambda e: e[4]['outcome']['trace'][3].update(actual_path='/other.lgp'),
            lambda e: e[4]['outcome']['trace'][3]['graph'].update(nodes=[]),
            lambda e: e[4].update(action_revision='1'),
            lambda e: e[3].update(session_id='another'),
            lambda e: e[4]['outcome'].update(status='AMBIGUOUS'),
            lambda e: e[4]['outcome'].update(cleanup_complete=False),
            lambda e: e[4]['outcome']['trace'].append(dict(event='overwrite_confirmed')),
            lambda e: e[1]['parameters'].update(conflict_policy='replace'),
        ]
        original = copy.deepcopy(self.events)
        for i, change in enumerate(changes):
            with self.subTest(index=i):
                self.events = copy.deepcopy(original)
                change(self.events)
                self.assertFalse(self.audit()['passed'])

    def test_catalog_revision_is_required_not_guessed(self):
        self.revisions.pop('package.save_checkpoint')
        self.assertFalse(self.audit()['passed'])


if __name__ == '__main__':
    unittest.main()
