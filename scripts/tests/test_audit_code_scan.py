"""
Verification test ensuring audit-backlog-todos --check-unreferenced passes on the live repository code.
"""

import importlib.util
import io
import os
import unittest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(SCRIPTS)
spec = importlib.util.spec_from_file_location(
    'audit_backlog_todos', os.path.join(SCRIPTS, 'audit-backlog-todos.py')
)
abt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(abt)


class TestLiveCodeAuditCompliance(unittest.TestCase):
    def test_check_unreferenced_returns_zero_on_live_codebase(self):
        stderr = io.StringIO()
        exit_code = abt.main(['audit-backlog-todos.py', '--root', ROOT, '--check-unreferenced'], stderr=stderr)
        err_msg = stderr.getvalue().strip()
        self.assertEqual(exit_code, 0, f"Unreferenced TODOs detected in live codebase:\n{err_msg}")


if __name__ == '__main__':
    unittest.main()
