"""
scripts/conventional-commit-title.py accepts a conventional commit title
and refuses anything else. Pull request titles and squash commits use this
form; CI runs the script with TITLE from the PR.

    python3 -m unittest discover -s scripts/tests
"""

import importlib.util
import io
import os
import unittest
from contextlib import redirect_stderr

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    'conventional_commit_title', os.path.join(SCRIPTS, 'conventional-commit-title.py')
)
cct = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cct)


class ConventionalCommitTitle(unittest.TestCase):
    def accept(self, title):
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(cct.main(['conventional-commit-title.py', title]), 0, err.getvalue())

    def refuse(self, title):
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(cct.main(['conventional-commit-title.py', title]), 1)
        self.assertTrue(err.getvalue().strip())

    def test_accepts_a_type_and_description(self):
        self.accept('feat: add maps')

    def test_accepts_a_scope_and_a_breaking_change(self):
        self.accept('fix(api)!: reject empty body')

    def test_accepts_renovate_dependency_titles(self):
        self.accept('chore(deps): pin nginx')

    def test_refuses_a_sentence_with_no_type(self):
        self.refuse('Pin nginx Docker tag')

    def test_refuses_a_capitalised_type(self):
        self.refuse('Feat: x')

    def test_refuses_an_empty_description(self):
        self.refuse('chore: ')

    def test_refuses_an_unknown_type(self):
        self.refuse('wip: x')

    def test_refuses_a_missing_space_after_the_colon(self):
        self.refuse('feat:x')

    def test_reads_the_title_from_title(self):
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(cct.main(['conventional-commit-title.py'], {'TITLE': 'feat: add maps'}), 0)
            self.assertEqual(cct.main(['conventional-commit-title.py'], {}), 1)
        self.assertIn('no title', err.getvalue())


if __name__ == '__main__':
    unittest.main()
