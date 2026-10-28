"""
Unit tests for scripts/check-markdown-links.py.

Verifies:
- Parsing of Markdown links [text](target) while ignoring code blocks and comments
- Slug generation conforming to GitHub Flavored Markdown heading rules
- Offline ignoring of external protocols (http://, https://, mailto:, etc.)
- Resolution of internal relative paths (files, directories, non-markdown resources)
- Verification of local #slug anchors
- Verification of cross-file relative markdown anchors path/doc.md#slug
- Detection of missing target files and missing anchors with line numbers
- Exclusion of ignored directories (node_modules, dist, coverage, .git, .cursor, build)
- CLI behavior returning 0 on success and 1 on broken links

    python3 -m unittest discover -s scripts/tests
    pytest scripts/tests/test_check_markdown_links.py
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
    'check_markdown_links', os.path.join(SCRIPTS, 'check-markdown-links.py')
)
cml = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cml)


class TestSlugGeneration(unittest.TestCase):
    """Tests heading slugification conforming to GitHub Markdown standards."""

    def test_basic_heading(self):
        self.assertEqual(cml.slugify_heading('Basic Heading'), 'basic-heading')

    def test_strips_punctuation_and_emojis(self):
        self.assertEqual(cml.slugify_heading('⚠️ Self-Hosted Reality Check'), 'self-hosted-reality-check')
        self.assertEqual(cml.slugify_heading("SSL/TLS with Let's Encrypt"), 'ssltls-with-lets-encrypt')
        self.assertEqual(cml.slugify_heading('5. Serve with Nginx'), '5-serve-with-nginx')

    def test_handles_ampersand_spacing(self):
        # & stripped leaves surrounding spaces, which convert to hyphens
        self.assertEqual(cml.slugify_heading('Appearance & Theming'), 'appearance--theming')

    def test_strips_inline_code_and_formatting(self):
        self.assertEqual(cml.slugify_heading("Updating after you've edited `docker-compose.yml`"), 'updating-after-youve-edited-docker-composeyml')
        self.assertEqual(cml.slugify_heading('**Bold** and *Italic* Heading'), 'bold-and-italic-heading')

    def test_duplicate_headings_in_document(self):
        doc = textwrap.dedent('''
            # Overview
            ## Section
            Some text.
            ## Section
            More text.
            ## Section
        ''')
        headings = cml.extract_headings_and_anchors(doc)
        self.assertIn('overview', headings)
        self.assertIn('section', headings)
        self.assertIn('section-1', headings)
        self.assertIn('section-2', headings)

    def test_extracts_html_anchors(self):
        doc = '<a id="custom-anchor"></a>\n<a name="named-target"></a>'
        headings = cml.extract_headings_and_anchors(doc)
        self.assertIn('custom-anchor', headings)
        self.assertIn('named-target', headings)


class TestCodeBlockMasking(unittest.TestCase):
    """Verifies that links inside code blocks or comments are never extracted."""

    def test_ignores_links_inside_fenced_code_blocks(self):
        content = textwrap.dedent('''
            # Guide
            ```markdown
            [fake link](broken-target.md)
            ```
            [real link](actual.md)
        ''').strip()
        links = cml.extract_links_from_content(content, 'docs/guide.md')
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].clean_target, 'actual.md')
        self.assertEqual(links[0].line_number, 5)

    def test_ignores_links_inside_tilde_code_blocks(self):
        content = textwrap.dedent('''
            ~~~bash
            curl [dummy](fake.sh)
            ~~~
            [valid](valid.md)
        ''').strip()
        links = cml.extract_links_from_content(content, 'docs/run.md')
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].clean_target, 'valid.md')

    def test_ignores_links_inside_inline_code(self):
        content = 'Refer to `[sample](missing.md)` for syntax, or click [real](real.md).'
        links = cml.extract_links_from_content(content, 'docs/inline.md')
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].clean_target, 'real.md')

    def test_ignores_links_inside_html_comments(self):
        content = textwrap.dedent('''
            <!-- [comment link](nonexistent.md) -->
            [live link](live.md)
        ''').strip()
        links = cml.extract_links_from_content(content, 'docs/comment.md')
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].clean_target, 'live.md')


class TestLinkValidation(unittest.TestCase):
    """Tests relative path and anchor verification rules."""

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

    def test_validates_local_anchor_successfully(self):
        self._write_file('README.md', textwrap.dedent('''
            # Project
            Jump to [Installation](#installation) guide.
            ## Installation
            Install instructions here.
        '''))
        errors, count = cml.validate_markdown_links(self.root)
        self.assertEqual(errors, [])
        self.assertEqual(count, 1)

    def test_detects_missing_local_anchor(self):
        self._write_file('README.md', textwrap.dedent('''
            # Project
            Jump to [Missing](#non-existent) section.
        '''))
        errors, count = cml.validate_markdown_links(self.root)
        self.assertEqual(len(errors), 1)
        self.assertIn('README.md:3', errors[0])
        self.assertIn("Ancre introuvable '#non-existent'", errors[0])

    def test_validates_relative_file_and_heading_anchor(self):
        self._write_file('docs/index.md', '[Setup Guide](setup.md#quick-start)\n')
        self._write_file('docs/setup.md', '# Setup\n## Quick Start\nRun make up.\n')
        errors, count = cml.validate_markdown_links(self.root)
        self.assertEqual(errors, [])
        self.assertEqual(count, 1)

    def test_detects_missing_relative_file(self):
        self._write_file('docs/index.md', 'See [Missing](does-not-exist.md).\n')
        errors, count = cml.validate_markdown_links(self.root)
        self.assertEqual(len(errors), 1)
        self.assertIn('docs/index.md:1', errors[0])
        self.assertIn('Chemin cible introuvable', errors[0])

    def test_detects_missing_anchor_in_existing_file(self):
        self._write_file('docs/index.md', 'See [Wrong Section](setup.md#missing-heading).\n')
        self._write_file('docs/setup.md', '# Setup\n## Existing Section\n')
        errors, count = cml.validate_markdown_links(self.root)
        self.assertEqual(len(errors), 1)
        self.assertIn('docs/index.md:1', errors[0])
        self.assertIn("Ancre introuvable '#missing-heading'", errors[0])

    def test_ignores_external_schemes_without_network_call(self):
        self._write_file('README.md', textwrap.dedent('''
            [Website](https://cozyvtt.com)
            [Insecure](http://insecure.example.com/api)
            [Mail](mailto:support@example.com)
            [Tel](tel:+123456789)
            [Protocol relative](//cdn.example.com/lib.js)
        '''))
        errors, count = cml.validate_markdown_links(self.root)
        self.assertEqual(errors, [])
        self.assertEqual(count, 0)

    def test_validates_non_markdown_and_directory_targets(self):
        self._write_file('README.md', 'See [License](LICENSE) and [Assets](assets/).\n')
        self._write_file('LICENSE', 'AGPL-3.0')
        os.makedirs(os.path.join(self.root, 'assets'), exist_ok=True)
        errors, count = cml.validate_markdown_links(self.root)
        self.assertEqual(errors, [])
        self.assertEqual(count, 2)

    def test_systematically_ignores_excluded_directories(self):
        for ignored in ['node_modules', 'dist', 'coverage', '.git', '.cursor', 'build']:
            self._write_file(f'{ignored}/leaked.md', '[Broken](broken.md)\n')
            self._write_file(f'backend/{ignored}/sub.md', '[Broken](broken.md)\n')

        self._write_file('docs/valid.md', '# Title\n[Self](#title)\n')
        errors, count = cml.validate_markdown_links(self.root)
        self.assertEqual(errors, [])
        self.assertEqual(count, 1)


class TestCliExecution(unittest.TestCase):
    """Tests main() entry point and CLI exit codes."""

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

    def test_main_returns_0_when_links_are_valid(self):
        self._write_file('README.md', '# Heading\n[Self](#heading)\n')
        stdout = io.StringIO()
        stderr = io.StringIO()
        exit_code = cml.main(['check-markdown-links.py', '--root', self.root], stdout=stdout, stderr=stderr)
        self.assertEqual(exit_code, 0)
        self.assertIn('Succès', stdout.getvalue())
        self.assertEqual(stderr.getvalue(), '')

    def test_main_returns_1_when_broken_link_found(self):
        self._write_file('README.md', '# Heading\n[Bad](#bad-heading)\n')
        stdout = io.StringIO()
        stderr = io.StringIO()
        exit_code = cml.main(['check-markdown-links.py', '--root', self.root], stdout=stdout, stderr=stderr)
        self.assertEqual(exit_code, 1)
        self.assertIn('README.md:2', stderr.getvalue())

    def test_subprocess_cli(self):
        self._write_file('README.md', '# Heading\n[Good](#heading)\n')
        script_path = os.path.join(SCRIPTS, 'check-markdown-links.py')
        res = subprocess.run([sys.executable, script_path, '--root', self.root], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn('Succès', res.stdout)


if __name__ == '__main__':
    unittest.main()
