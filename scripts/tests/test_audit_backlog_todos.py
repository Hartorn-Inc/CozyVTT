"""
Unit tests for scripts/audit-backlog-todos.py.

Verifies:
- Code comments extraction (line and block comments, line numbers, snippet preservation)
- Discarding comments inside strings or template literals
- Conformance to normalized syntax // TODO(#<id>): <text> and /* TODO(#<id>): <text> */
- Markdown backlog and comment extraction (HTML comments, bullet lists)
- Exclusion of ignored directories (node_modules, dist, coverage, .git, .cursor, build)
- CI safeguard mode (--check-unreferenced) returning 0 on compliant code and 1 on orphan comments
- Markdown report generation with all required columns
- CLI invocation and compatibility with pytest and unittest

    python3 -m unittest discover -s scripts/tests
    pytest scripts/tests/test_audit_backlog_todos.py
"""

import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    'audit_backlog_todos', os.path.join(SCRIPTS, 'audit-backlog-todos.py')
)
abt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(abt)


class TestCodeCommentExtraction(unittest.TestCase):
    """Tests extraction of TODO, FIXME, and XXX comments from code files."""

    def test_extracts_single_line_compliant_todo(self):
        code = "const a = 1; // TODO(#123): fix calculation\nconst b = 2;"
        items = abt.extract_code_todos(code, 'src/math.ts')
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item.item_type, 'TODO')
        self.assertEqual(item.line_number, 1)
        self.assertTrue(item.is_compliant)
        self.assertEqual(item.issue_id, 123)
        self.assertEqual(item.proposed_action, "Lié à l'issue #123")
        self.assertIn('TODO(#123): fix calculation', item.snippet)

    def test_extracts_single_line_unreferenced_todo(self):
        code = "// TODO: unreferenced work\nfunction run() {}"
        items = abt.extract_code_todos(code, 'src/app.ts')
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item.item_type, 'TODO')
        self.assertEqual(item.line_number, 1)
        self.assertFalse(item.is_compliant)
        self.assertIsNone(item.issue_id)
        self.assertEqual(item.proposed_action, "Créer issue GitHub ou lier via TODO(#<id>)")

    def test_extracts_area_tagged_todo_as_unreferenced(self):
        code = "// TODO(restore): stopping unzipper stream\nawait cleanup();"
        items = abt.extract_code_todos(code, 'src/archive.ts')
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item.item_type, 'TODO')
        self.assertFalse(item.is_compliant)
        self.assertIsNone(item.issue_id)

    def test_extracts_single_line_block_comment(self):
        code = "/* TODO(#456): inline block comment */\nexport default {};"
        items = abt.extract_code_todos(code, 'src/index.ts')
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item.item_type, 'TODO')
        self.assertEqual(item.line_number, 1)
        self.assertTrue(item.is_compliant)
        self.assertEqual(item.issue_id, 456)

    def test_extracts_multiline_block_comment_with_exact_line_numbers(self):
        code = textwrap.dedent('''
            /**
             * Service helper documentation
             * TODO(#101): add caching layer
             * FIXME: check memory usage
             */
            export function helper() {}
        ''').strip()
        items = abt.extract_code_todos(code, 'src/service.ts')
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].item_type, 'TODO')
        self.assertEqual(items[0].line_number, 3)
        self.assertTrue(items[0].is_compliant)
        self.assertEqual(items[0].issue_id, 101)

        self.assertEqual(items[1].item_type, 'FIXME')
        self.assertEqual(items[1].line_number, 4)
        self.assertFalse(items[1].is_compliant)
        self.assertEqual(items[1].proposed_action, "Corriger le bug ou créer issue GitHub")

    def test_extracts_fixme_and_xxx(self):
        code = textwrap.dedent('''
            // FIXME(#789): edge case in tokenizer
            // FIXME: unreferenced bug
            // XXX: investigate performance bottleneck
        ''').strip()
        items = abt.extract_code_todos(code, 'src/parser.ts')
        self.assertEqual(len(items), 3)
        self.assertEqual(items[0].item_type, 'FIXME')
        self.assertTrue(items[0].is_compliant)
        self.assertEqual(items[0].issue_id, 789)

        self.assertEqual(items[1].item_type, 'FIXME')
        self.assertFalse(items[1].is_compliant)

        self.assertEqual(items[2].item_type, 'XXX')
        self.assertFalse(items[2].is_compliant)
        self.assertEqual(items[2].proposed_action, "Clarifier ou refactoriser")

    def test_ignores_todos_inside_strings_and_templates(self):
        code = textwrap.dedent('''
            const a = "// TODO: inside double quotes";
            const b = '// FIXME: inside single quotes';
            const c = `TODO(#999): inside template literal`;
            const regex = /TODO/;
        ''').strip()
        items = abt.extract_code_todos(code, 'src/constants.ts')
        self.assertEqual(items, [])

    def test_ignores_casual_english_sentences_mentioning_todo(self):
        code = textwrap.dedent('''
            /**
             * No test file carries a TODO marker for the test area.
             * This function returns true when enabled.
             */
            export function check() { return true; }
        ''').strip()
        items = abt.extract_code_todos(code, 'src/rules.ts')
        self.assertEqual(items, [])

    def test_enforces_case_sensitivity_for_compliance(self):
        # lowercase todo is detected as a marker but rejected as non-compliant
        code = "// todo(#123): lowercase keyword"
        items = abt.extract_code_todos(code, 'src/example.ts')
        self.assertEqual(len(items), 1)
        self.assertFalse(items[0].is_compliant)


class TestMarkdownExtraction(unittest.TestCase):
    """Tests extraction from Markdown files (HTML comments, list items, headers)."""

    def test_extracts_html_comments(self):
        md = textwrap.dedent('''
            # Documentation
            <!-- TODO(#201): update architecture diagram -->
            <!-- FIXME: broken link to api reference -->
        ''').strip()
        items = abt.extract_markdown_todos(md, 'docs/DESIGN.md')
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].item_type, 'TODO')
        self.assertEqual(items[0].line_number, 2)
        self.assertTrue(items[0].is_compliant)
        self.assertEqual(items[0].issue_id, 201)

        self.assertEqual(items[1].item_type, 'FIXME')
        self.assertEqual(items[1].line_number, 3)
        self.assertFalse(items[1].is_compliant)
        self.assertEqual(items[1].proposed_action, "Créer issue GitHub ou supprimer du backlog")

    def test_extracts_markdown_bullet_points_and_checkboxes(self):
        md = textwrap.dedent('''
            ## Backlog
            - TODO(#301): Add sound effects support
            - [ ] TODO: Support animated WebP maps
            * XXX: Review database migration strategy
        ''').strip()
        items = abt.extract_markdown_todos(md, 'docs/FUTURE_FEATURES.md')
        self.assertEqual(len(items), 3)
        self.assertTrue(items[0].is_compliant)
        self.assertEqual(items[0].issue_id, 301)

        self.assertFalse(items[1].is_compliant)
        self.assertEqual(items[1].proposed_action, "Créer issue GitHub ou supprimer du backlog")

        self.assertEqual(items[2].item_type, 'XXX')
        self.assertFalse(items[2].is_compliant)


class TestDirectoryFiltering(unittest.TestCase):
    """Verifies that ignored directories are never scanned."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = self.temp_dir.name

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write_file(self, rel_path, content):
        full_path = os.path.join(self.root, rel_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)

    def test_systematically_ignores_specified_directories(self):
        # Put orphan TODOs in all ignored directories
        for ignored in ['node_modules', 'dist', 'coverage', '.git', '.cursor', 'build']:
            self._write_file(f'backend/src/{ignored}/leak.ts', '// TODO: ignored violation\n')
            self._write_file(f'{ignored}/standalone.ts', '// TODO: ignored root violation\n')

        # Put a compliant TODO in legitimate code
        self._write_file('backend/src/valid.ts', '// TODO(#42): legitimate work\n')

        items = abt.scan_code(self.root)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].file_path, 'backend/src/valid.ts')
        self.assertTrue(items[0].is_compliant)


class TestCheckUnreferencedMode(unittest.TestCase):
    """Tests the CI safeguard mode (--check-unreferenced)."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = self.temp_dir.name

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write_file(self, rel_path, content):
        full_path = os.path.join(self.root, rel_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)

    def test_returns_0_when_all_code_todos_are_compliant(self):
        self._write_file('backend/src/api.ts', '// TODO(#10): first\n/* FIXME(#20): second */\n')
        self._write_file('frontend/src/ui.tsx', '// TODO(#30): frontend work\n')

        stderr = io.StringIO()
        exit_code = abt.main(['audit-backlog-todos.py', '--root', self.root, '--check-unreferenced'], stderr=stderr)
        self.assertEqual(exit_code, 0)
        self.assertEqual(stderr.getvalue().strip(), '')

    def test_returns_0_when_no_todos_exist(self):
        self._write_file('backend/src/clean.ts', 'export const port = 4000;\n')
        stderr = io.StringIO()
        exit_code = abt.main(['audit-backlog-todos.py', '--root', self.root, '--check-unreferenced'], stderr=stderr)
        self.assertEqual(exit_code, 0)
        self.assertEqual(stderr.getvalue().strip(), '')

    def test_returns_1_and_writes_to_stderr_when_orphan_todo_found(self):
        self._write_file('backend/src/orphan.ts', 'const a = 1;\n// TODO: orphan task\nconst b = 2;')
        stderr = io.StringIO()
        exit_code = abt.main(['audit-backlog-todos.py', '--root', self.root, '--check-unreferenced'], stderr=stderr)
        self.assertEqual(exit_code, 1)
        err_out = stderr.getvalue()
        self.assertIn('backend/src/orphan.ts:2', err_out)
        self.assertIn('// TODO: orphan task', err_out)
        self.assertIn('Syntaxe normalisée obligatoire', err_out)

    def test_returns_1_for_area_tagged_todo(self):
        self._write_file('backend/src/archive.ts', '// TODO(restore): stopping stream leaves fd open\n')
        stderr = io.StringIO()
        exit_code = abt.main(['audit-backlog-todos.py', '--root', self.root, '--check-unreferenced'], stderr=stderr)
        self.assertEqual(exit_code, 1)
        self.assertIn('backend/src/archive.ts:1', stderr.getvalue())

    def test_returns_1_for_unreferenced_fixme(self):
        self._write_file('frontend/src/bug.ts', '// FIXME: fix this now\n')
        stderr = io.StringIO()
        exit_code = abt.main(['audit-backlog-todos.py', '--root', self.root, '--check-unreferenced'], stderr=stderr)
        self.assertEqual(exit_code, 1)
        self.assertIn('frontend/src/bug.ts:1', stderr.getvalue())

    def test_check_unreferenced_does_not_fail_on_markdown_backlog(self):
        # Code is 100% compliant
        self._write_file('backend/src/ok.ts', '// TODO(#101): valid\n')
        # Markdown has unreferenced ideas, which is normal in backlog docs
        self._write_file('docs/FUTURE_FEATURES.md', '- TODO: future idea\n')

        stderr = io.StringIO()
        exit_code = abt.main(['audit-backlog-todos.py', '--root', self.root, '--check-unreferenced'], stderr=stderr)
        self.assertEqual(exit_code, 0)
        self.assertEqual(stderr.getvalue().strip(), '')


class TestInventoryReportGeneration(unittest.TestCase):
    """Tests Markdown table report generation and CLI options."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = self.temp_dir.name

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write_file(self, rel_path, content):
        full_path = os.path.join(self.root, rel_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)

    def test_generates_markdown_table_with_required_columns(self):
        self._write_file('backend/src/calc.ts', '// TODO(#55): support floats\n')
        self._write_file('docs/FUTURE_FEATURES.md', '<!-- TODO: write guide -->\n')

        out_report = os.path.join(self.root, 'report.md')
        stdout = io.StringIO()
        exit_code = abt.main(['audit-backlog-todos.py', '--root', self.root, '--output', out_report], stdout=stdout)
        self.assertEqual(exit_code, 0)
        self.assertTrue(os.path.isfile(out_report))

        with open(out_report, 'r', encoding='utf-8') as f:
            content = f.read()

        self.assertIn('| ID | Type | Fichier | Ligne | Extrait | Action proposée |', content)
        self.assertIn('| --- | --- | --- | --- | --- | --- |', content)
        self.assertIn('| 1 | TODO | backend/src/calc.ts | 1 | // TODO(#55): support floats | Lié à l\'issue #55 |', content)
        self.assertIn('| 2 | TODO | docs/FUTURE_FEATURES.md | 1 | <!-- TODO: write guide --> | Créer issue GitHub ou supprimer du backlog |', content)

    def test_escapes_pipe_characters_in_snippets(self):
        self._write_file('backend/src/logic.ts', '// TODO(#77): handle a || b | c\n')
        out_report = os.path.join(self.root, 'report.md')
        abt.main(['audit-backlog-todos.py', '--root', self.root, '--output', out_report])

        with open(out_report, 'r', encoding='utf-8') as f:
            content = f.read()
        self.assertIn(r'a \|\| b \| c', content)

    def test_creates_output_parent_directories_if_missing(self):
        self._write_file('backend/src/a.ts', '// TODO(#1): test\n')
        nested_output = os.path.join(self.root, 'nested', 'sub', 'report.md')
        exit_code = abt.main(['audit-backlog-todos.py', '--root', self.root, '--output', nested_output])
        self.assertEqual(exit_code, 0)
        self.assertTrue(os.path.isfile(nested_output))

    def test_prints_to_stdout_when_no_output_flag(self):
        self._write_file('backend/src/a.ts', '// TODO(#1): test\n')
        stdout = io.StringIO()
        exit_code = abt.main(['audit-backlog-todos.py', '--root', self.root], stdout=stdout)
        self.assertEqual(exit_code, 0)
        self.assertIn('| ID | Type | Fichier | Ligne | Extrait | Action proposée |', stdout.getvalue())


class TestCliSubprocess(unittest.TestCase):
    """Tests invoking the script via python subprocess to confirm CLI arguments and exit codes."""

    def test_cli_help(self):
        script_path = os.path.join(SCRIPTS, 'audit-backlog-todos.py')
        res = subprocess.run([sys.executable, script_path, '--help'], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn('--output', res.stdout)
        self.assertIn('--check-unreferenced', res.stdout)

    def test_cli_subprocess_check_unreferenced(self):
        with tempfile.TemporaryDirectory() as tmp:
            good_dir = os.path.join(tmp, 'backend', 'src')
            os.makedirs(good_dir, exist_ok=True)
            with open(os.path.join(good_dir, 'a.ts'), 'w') as f:
                f.write('// TODO(#123): valid todo\n')

            script_path = os.path.join(SCRIPTS, 'audit-backlog-todos.py')
            res_good = subprocess.run(
                [sys.executable, script_path, '--root', tmp, '--check-unreferenced'],
                capture_output=True,
                text=True
            )
            self.assertEqual(res_good.returncode, 0)

            with open(os.path.join(good_dir, 'bad.ts'), 'w') as f:
                f.write('// TODO: bad todo\n')

            res_bad = subprocess.run(
                [sys.executable, script_path, '--root', tmp, '--check-unreferenced'],
                capture_output=True,
                text=True
            )
            self.assertEqual(res_bad.returncode, 1)
            self.assertIn('bad.ts:1', res_bad.stderr)


if __name__ == '__main__':
    unittest.main()
