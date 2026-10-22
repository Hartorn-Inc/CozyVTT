"""
scripts/ci/codex_pr_review.py maps CozyVTT paths to a small reviewer set,
resolves trusted /review triggers, and assembles advisory markdown from
untrusted reviewer JSON. No network.

    python3 -m unittest discover -s scripts/tests
"""

import importlib.util
import json
import os
import tempfile
import unittest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(SCRIPTS)
spec = importlib.util.spec_from_file_location(
    'codex_pr_review', os.path.join(SCRIPTS, 'ci', 'codex_pr_review.py')
)
cpr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cpr)


def names(files):
    return [item['name'] for item in cpr.select_reviewers(files)]


class SelectReviewers(unittest.TestCase):
    def test_backend_routes_select_the_backend_reviewer(self):
        selected = names(['backend/src/routes/campaigns.ts'])
        self.assertEqual(selected, ['backend-reviewer'])

    def test_frontend_pages_include_accessibility(self):
        selected = names(['frontend/src/pages/Campaigns.tsx'])
        self.assertEqual(selected, ['frontend-reviewer', 'accessibility-reviewer'])

    def test_websocket_selects_realtime_security_parity_and_architecture(self):
        selected = names(['backend/src/websocket/index.ts'])
        self.assertEqual(
            selected,
            [
                'realtime-reviewer',
                'security-reviewer',
                'spec-parity-reviewer',
                'architecture-reviewer',
            ],
        )

    def test_socket_service_is_realtime_not_ordinary_frontend(self):
        selected = names(['frontend/src/services/socket.ts'])
        self.assertIn('realtime-reviewer', selected)
        self.assertNotIn('frontend-reviewer', selected)

    def test_ordinary_frontend_service_is_not_realtime(self):
        selected = names(['frontend/src/services/api.ts'])
        self.assertEqual(selected, ['frontend-reviewer', 'accessibility-reviewer'])

    def test_game_systems_include_spec_parity(self):
        selected = names(['backend/src/game-systems/index.ts'])
        self.assertEqual(selected, ['game-systems-reviewer', 'spec-parity-reviewer'])

    def test_character_sheet_ui_includes_frontend_and_accessibility(self):
        selected = names(['frontend/src/components/character-sheets/CoCSheet.tsx'])
        self.assertEqual(
            selected,
            [
                'frontend-reviewer',
                'game-systems-reviewer',
                'accessibility-reviewer',
                'spec-parity-reviewer',
            ],
        )

    def test_compose_file_selects_infra(self):
        selected = names(['docker-compose.yml'])
        self.assertEqual(selected, ['infra-reviewer'])

    def test_cursor_cloud_helpers_are_infra(self):
        self.assertEqual(names(['.cursor/environment.json']), ['infra-reviewer'])
        self.assertEqual(names(['.cursor/install.sh']), ['infra-reviewer'])
        self.assertEqual(names(['.cursor/start.sh']), ['infra-reviewer'])

    def test_raycasting_selects_realtime_parity_and_security(self):
        selected = names(['backend/src/utils/raycasting.ts'])
        self.assertIn('realtime-reviewer', selected)
        self.assertIn('spec-parity-reviewer', selected)
        self.assertIn('security-reviewer', selected)

    def test_frontend_visibility_utils_are_realtime(self):
        selected = names(['frontend/src/utils/visibilityRule.ts'])
        self.assertIn('realtime-reviewer', selected)
        self.assertIn('spec-parity-reviewer', selected)
        self.assertIn('security-reviewer', selected)

    def test_vision_parity_test_file_is_realtime(self):
        selected = names(['backend/src/utils/__tests__/visionParity.test.ts'])
        self.assertIn('realtime-reviewer', selected)
        self.assertIn('spec-parity-reviewer', selected)

    def test_github_workflows_include_security(self):
        selected = names(['.github/workflows/ci.yml'])
        self.assertEqual(selected, ['infra-reviewer', 'security-reviewer'])

    def test_dot_github_is_not_stripped_to_github(self):
        self.assertTrue(cpr.is_infra_path('.github/workflows/ci.yml'))
        self.assertTrue(cpr.is_security_sensitive_path('.github/workflows/ci.yml'))

    def test_docs_include_standards_and_spec_parity(self):
        selected = names(['docs/ARCHITECTURE.md'])
        self.assertEqual(selected, ['spec-parity-reviewer', 'standards-reviewer'])

    def test_auth_middleware_includes_security(self):
        selected = names(['backend/src/middleware/auth.ts'])
        self.assertEqual(selected, ['backend-reviewer', 'security-reviewer'])

    def test_upload_path_includes_security(self):
        selected = names(['backend/src/services/uploadService.ts'])
        self.assertIn('security-reviewer', selected)
        self.assertIn('backend-reviewer', selected)

    def test_session_path_includes_security(self):
        selected = names(['backend/src/config/session.ts'])
        self.assertEqual(selected, ['backend-reviewer', 'security-reviewer'])

    def test_author_filename_is_not_treated_as_auth(self):
        selected = names(['backend/src/routes/authors.ts'])
        self.assertEqual(selected, ['backend-reviewer'])

    def test_caps_at_four_reviewers(self):
        selected = names(
            [
                'backend/src/routes/campaigns.ts',
                'frontend/src/pages/Campaigns.tsx',
                'backend/src/websocket/index.ts',
                'docker-compose.yml',
                'docs/ARCHITECTURE.md',
            ]
        )
        self.assertEqual(len(selected), 4)
        self.assertEqual(
            selected,
            [
                'backend-reviewer',
                'frontend-reviewer',
                'realtime-reviewer',
                'infra-reviewer',
            ],
        )

    def test_drops_architecture_before_security_when_capping(self):
        selected = names(
            [
                'backend/src/routes/campaigns.ts',
                'frontend/src/pages/Campaigns.tsx',
                'backend/src/websocket/index.ts',
            ]
        )
        self.assertEqual(len(selected), 4)
        self.assertIn('security-reviewer', selected)
        self.assertNotIn('architecture-reviewer', selected)

    def test_prompt_files_stay_in_the_agent_roster(self):
        for item in cpr.select_reviewers(['frontend/src/pages/Home.tsx', 'nginx/nginx.conf']):
            self.assertEqual(item['prompt_file'], f".cursor/agents/{item['name']}.md")
            self.assertIn(item['name'], cpr.ALLOWED_REVIEWERS)

    def test_unknown_path_falls_back_to_standards(self):
        self.assertEqual(names(['LICENSE']), ['standards-reviewer'])

    def test_does_not_select_design_or_user_advocate(self):
        selected = names(
            [
                'frontend/src/pages/Campaigns.tsx',
                'backend/src/routes/campaigns.ts',
                'docs/ARCHITECTURE.md',
            ]
        )
        self.assertNotIn('design-reviewer', selected)
        self.assertNotIn('user-advocate', selected)


class TrustedTriggers(unittest.TestCase):
    def test_trusted_associations(self):
        self.assertEqual(cpr.TRUSTED_ASSOCIATIONS, {'OWNER', 'MEMBER', 'COLLABORATOR'})

    def test_trusted_review_comment_resolves_the_pr(self):
        event = {
            'action': 'created',
            'issue': {'number': 12, 'pull_request': {}},
            'comment': {'body': '/review', 'author_association': 'COLLABORATOR'},
        }
        self.assertEqual(cpr.resolve_pr_number(event, 'issue_comment'), 12)

    def test_contributor_review_comment_is_silent(self):
        event = {
            'action': 'created',
            'issue': {'number': 12, 'pull_request': {}},
            'comment': {'body': '/review', 'author_association': 'CONTRIBUTOR'},
        }
        self.assertIsNone(cpr.resolve_pr_number(event, 'issue_comment'))

    def test_first_timer_review_comment_is_silent(self):
        event = {
            'action': 'created',
            'issue': {'number': 12, 'pull_request': {}},
            'comment': {'body': '/review', 'author_association': 'FIRST_TIMER'},
        }
        self.assertIsNone(cpr.resolve_pr_number(event, 'issue_comment'))

    def test_codex_assess_comment_is_silent(self):
        event = {
            'action': 'created',
            'issue': {'number': 9, 'pull_request': {}},
            'comment': {'body': '/codex-assess', 'author_association': 'OWNER'},
        }
        self.assertIsNone(cpr.resolve_pr_number(event, 'issue_comment'))

    def test_workflow_run_reads_the_request_pr_number(self):
        event = {
            'workflow_run': {
                'conclusion': 'success',
                'event': 'pull_request',
                'pull_requests': [{'number': 44}],
                'head_sha': 'abc',
            }
        }
        self.assertEqual(cpr.resolve_pr_number(event, 'workflow_run'), 44)

    def test_failed_workflow_run_is_silent(self):
        event = {
            'workflow_run': {
                'conclusion': 'failure',
                'event': 'pull_request',
                'pull_requests': [{'number': 44}],
            }
        }
        self.assertIsNone(cpr.resolve_pr_number(event, 'workflow_run'))

    def test_skipped_workflow_run_is_silent(self):
        event = {
            'workflow_run': {
                'conclusion': 'skipped',
                'event': 'pull_request',
                'pull_requests': [{'number': 44}],
            }
        }
        self.assertIsNone(cpr.resolve_pr_number(event, 'workflow_run'))

    def test_workflow_run_falls_back_to_head_sha_lookup(self):
        event = {
            'workflow_run': {
                'conclusion': 'success',
                'event': 'pull_request',
                'pull_requests': [],
                'head_sha': 'deadbeef',
            }
        }
        self.assertEqual(
            cpr.resolve_pr_number(
                event,
                'workflow_run',
                fetch_prs_for_sha=lambda sha: [{'number': 21}] if sha == 'deadbeef' else [],
            ),
            21,
        )

    def test_outsider_review_comment_is_silent(self):
        event = {
            'action': 'created',
            'issue': {'number': 12, 'pull_request': {}},
            'comment': {'body': '/review', 'author_association': 'NONE'},
        }
        self.assertIsNone(cpr.resolve_pr_number(event, 'issue_comment'))

    def test_plain_issue_comment_is_silent(self):
        event = {
            'action': 'created',
            'issue': {'number': 12},
            'comment': {'body': '/review', 'author_association': 'OWNER'},
        }
        self.assertIsNone(cpr.resolve_pr_number(event, 'issue_comment'))

    def test_pull_request_event_uses_the_number(self):
        event = {'pull_request': {'number': 7}}
        self.assertEqual(cpr.resolve_pr_number(event, 'pull_request'), 7)

    def test_fork_pr_does_not_run(self):
        event = {'pull_request': {'number': 7}}
        pr = {
            'state': 'open',
            'head': {'sha': 'abc', 'repo': {'full_name': 'fork/CozyVTT'}},
            'base': {'sha': 'def', 'repo': {'full_name': 'Hartorn-Inc/CozyVTT'}},
        }
        outputs = cpr.resolve_outputs(event, 'pull_request', pr, {'CODEX_ASSESS_REQUIRE_SAME_REPO': 'true'})
        self.assertEqual(outputs['should_run'], 'false')

    def test_same_repo_open_pr_runs(self):
        event = {'pull_request': {'number': 7}}
        pr = {
            'state': 'open',
            'head': {'sha': 'abc', 'repo': {'full_name': 'Hartorn-Inc/CozyVTT'}},
            'base': {'sha': 'def', 'repo': {'full_name': 'Hartorn-Inc/CozyVTT'}},
        }
        outputs = cpr.resolve_outputs(event, 'pull_request', pr)
        self.assertEqual(outputs['should_run'], 'true')
        self.assertEqual(outputs['head_sha'], 'abc')

    def _same_repo_pr(self, labels=None):
        return {
            'state': 'open',
            'labels': labels or [],
            'head': {'sha': 'abc', 'repo': {'full_name': 'Hartorn-Inc/CozyVTT'}},
            'base': {'sha': 'def', 'repo': {'full_name': 'Hartorn-Inc/CozyVTT'}},
        }

    def test_workflow_run_without_label_does_not_run(self):
        event = {
            'workflow_run': {
                'conclusion': 'success',
                'event': 'pull_request',
                'pull_requests': [{'number': 7}],
            }
        }
        outputs = cpr.resolve_outputs(event, 'workflow_run', self._same_repo_pr())
        self.assertEqual(outputs['should_run'], 'false')
        self.assertEqual(outputs['pr_number'], '7')

    def test_workflow_run_with_codex_review_label_runs(self):
        event = {
            'workflow_run': {
                'conclusion': 'success',
                'event': 'pull_request',
                'pull_requests': [{'number': 7}],
            }
        }
        pr = self._same_repo_pr(labels=[{'name': 'codex-review'}])
        outputs = cpr.resolve_outputs(event, 'workflow_run', pr)
        self.assertEqual(outputs['should_run'], 'true')
        self.assertEqual(outputs['head_sha'], 'abc')

    def test_review_comment_does_not_require_the_label(self):
        event = {
            'action': 'created',
            'issue': {'number': 7, 'pull_request': {}},
            'comment': {'body': '/review', 'author_association': 'OWNER'},
        }
        outputs = cpr.resolve_outputs(event, 'issue_comment', self._same_repo_pr())
        self.assertEqual(outputs['should_run'], 'true')

    def test_workflow_dispatch_does_not_require_the_label(self):
        event = {'inputs': {'pr_number': '7'}}
        outputs = cpr.resolve_outputs(event, 'workflow_dispatch', self._same_repo_pr())
        self.assertEqual(outputs['should_run'], 'true')


class AssembleReview(unittest.TestCase):
    def test_prefixes_advisory_codex_luna_header(self):
        body = cpr.assemble_review(
            [
                {
                    'reviewer': 'backend-reviewer',
                    'summary': 'Looks fine.',
                    'findings': [],
                }
            ]
        )
        self.assertTrue(body.startswith('## Advisory Codex review (GPT-6 Luna Flex)'))
        self.assertIn('not a required GitHub check', body)
        self.assertIn('### backend-reviewer', body)

    def test_redacts_secrets_and_defangs_mentions(self):
        body = cpr.assemble_review(
            [
                cpr.parse_reviewer_json(
                    json.dumps(
                        {
                            'reviewer': 'injected',
                            'summary': 'OPENROUTER_API_KEY=sk-live-not-a-real-key @cursor',
                            'findings': [
                                {
                                    'category': 'must_fix',
                                    'severity': 'high',
                                    'path': 'backend/src/routes/auth.ts',
                                    'line': 4,
                                    'title': 'See https://evil.example/hook',
                                    'rationale': 'bearer SUPERSECRETTOKENVALUE1',
                                    'suggested_action': 'ping @everyone',
                                    'extra': 'drop me',
                                }
                            ],
                        }
                    ),
                    'backend-reviewer',
                )
            ]
        )
        self.assertIn('backend-reviewer', body)
        self.assertNotIn('sk-live-not-a-real-key', body)
        self.assertNotIn('SUPERSECRETTOKENVALUE1', body)
        self.assertIn('[redacted]', body)
        self.assertIn('(at)cursor', body)
        self.assertIn('(at)everyone', body)
        self.assertIn('[external-link-removed]', body)
        self.assertNotIn('drop me', body)

    def test_malformed_json_becomes_a_placeholder(self):
        review = cpr.parse_reviewer_json('not json', 'frontend-reviewer')
        self.assertEqual(review['reviewer'], 'frontend-reviewer')
        self.assertEqual(review['findings'][0]['title'], 'Reviewer pass failed')

    def test_unknown_reviewer_filename_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, 'nested'))
            with open(os.path.join(tmp, 'nested', 'reviewer-output-evil.json'), 'w', encoding='utf-8') as handle:
                handle.write('{"reviewer":"evil","summary":"x","findings":[]}\n')
            with open(
                os.path.join(tmp, 'nested', 'reviewer-output-infra-reviewer.json'),
                'w',
                encoding='utf-8',
            ) as handle:
                handle.write('{"reviewer":"infra-reviewer","summary":"ok","findings":[]}\n')
            reviews = cpr.load_reviewer_outputs(tmp)
        self.assertEqual([item['reviewer'] for item in reviews], ['infra-reviewer'])

    def test_limits_assembled_size(self):
        review = {
            'reviewer': 'standards-reviewer',
            'summary': 'x' * (cpr.MAX_REVIEW_BODY_CHARS + 50),
            'findings': [],
        }
        body = cpr.assemble_review([review])
        self.assertLessEqual(len(body), cpr.MAX_REVIEW_BODY_CHARS + 40)
        self.assertIn('Advisory Codex review', body)


class Sanitize(unittest.TestCase):
    def test_redacts_github_tokens(self):
        text = cpr.redact_secret_references('token ghp_abcdefghijklmnopqrstuv')
        self.assertIn('[redacted]', text)
        self.assertNotIn('ghp_abcdefghijklmnopqrstuv', text)


class PostReview(unittest.TestCase):
    def test_post_review_uses_comment_event(self):
        captured = {}

        def fake_run(command, check=True, stdin=None):
            captured['stdin'] = stdin
            captured['command'] = command
            return ''

        original = cpr.run_text
        cpr.run_text = fake_run
        try:
            cpr.post_review('Hartorn-Inc/CozyVTT', 3, '## Advisory Codex review\n')
        finally:
            cpr.run_text = original
        payload = json.loads(captured['stdin'])
        self.assertEqual(payload['event'], 'COMMENT')
        self.assertNotEqual(payload['event'], 'APPROVE')
        self.assertNotEqual(payload['event'], 'REQUEST_CHANGES')


class CodexPrReviewWorkflow(unittest.TestCase):
    def test_reviewer_job_runs_codex_as_an_unprivileged_unix_user(self):
        path = os.path.join(ROOT, '.github', 'workflows', 'codex-pr-review.yml')
        with open(path, encoding='utf-8') as handle:
            text = handle.read()
        self.assertIn('safety-strategy: unprivileged-user', text)
        self.assertNotIn('safety-strategy: drop-sudo', text)
        self.assertNotIn('safety-strategy: unsafe', text)
        self.assertNotIn('safety-strategy: read-only', text)
        self.assertIn('codex-user:', text)
        user = None
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith('codex-user:'):
                user = stripped.split(':', 1)[1].strip()
                break
        self.assertTrue(user)
        self.assertIn('useradd --system --create-home ' + user, text)
        self.assertNotIn('usermod', text)
        self.assertNotIn('gpasswd', text)
        self.assertNotIn('-G sudo', text)
        self.assertNotIn('adduser', text)


if __name__ == '__main__':
    unittest.main()
