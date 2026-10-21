"""
Advisory Codex PR review helper for GitHub Actions.

Resolve the pull request, collect review-only context, select a small CozyVTT
reviewer set from changed paths, assemble one markdown comment from untrusted
reviewer JSON, and post it as an advisory GitHub review (COMMENT, not a
required check). No network in the tests.

    python3 scripts/ci/codex_pr_review.py resolve --output "$GITHUB_OUTPUT"
    python3 scripts/ci/codex_pr_review.py select --context assessment/review-context.json --output assessment/reviewers.json --github-output "$GITHUB_OUTPUT"
    python3 -m unittest discover -s scripts/tests
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

TRUSTED_ASSOCIATIONS = frozenset({'OWNER', 'MEMBER', 'COLLABORATOR'})
COMMENT_COMMANDS_DEFAULT = '/review'
DIFF_PATCH_LIMIT = 120_000
MAX_REVIEW_BODY_CHARS = 60_000
MAX_FINDINGS = 20
MAX_FIELD_CHARS = 2_000
MAX_REVIEWERS = 4
ALLOWED_LINK_HOSTS = frozenset({'github.com', 'www.github.com'})
REVIEWER_PROMPT_ROOT = '.cursor/agents'

# Matching reviewers first, then the cross-cutting set. Cap keeps this order.
REVIEWER_PRIORITY = (
    'backend-reviewer',
    'frontend-reviewer',
    'realtime-reviewer',
    'game-systems-reviewer',
    'infra-reviewer',
    'security-reviewer',
    'accessibility-reviewer',
    'spec-parity-reviewer',
    'standards-reviewer',
    # Dropped first when capping, so security-reviewer is kept instead.
    'architecture-reviewer',
)
ALLOWED_REVIEWERS = frozenset(REVIEWER_PRIORITY)
FINDING_CATEGORIES = frozenset({'must_fix', 'no_action', 'informational'})
FINDING_SEVERITIES = frozenset({'critical', 'high', 'medium', 'low', 'info'})
SECURITY_PATH = re.compile(
    r'(^|/)(auth|authentication|session|sessions|mfa|rbac|upload|uploads|permission|permissions|ownership)([A-Z._/-]|$)'
)
SECRET_PATTERNS = (
    r'(?i)([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY_ID|SECRET_ACCESS_KEY|CLIENT_SECRET)[A-Z0-9_]*\s*[:=]\s*)\S+',
    r'(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{16,}',
    r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----',
    r'sk-[A-Za-z0-9_-]{12,}',
    r'\bgithub_pat_[A-Za-z0-9_]{20,}\b',
    r'\bgh[opsu]_[A-Za-z0-9_]{20,}\b',
    r'\bAKIA[0-9A-Z]{16}\b',
    r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b',
)


def normalize_path(path):
    path = str(path or '').replace('\\', '/')
    while path.startswith('./'):
        path = path[2:]
    return path


def load_json(path):
    with Path(path).open(encoding='utf-8') as handle:
        return json.load(handle)


def write_json(path, data):
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('w', encoding='utf-8') as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write('\n')


def append_github_output(path, values):
    with Path(path).open('a', encoding='utf-8') as handle:
        for key, value in values.items():
            handle.write(f"{key}={str(value).replace(chr(13), '').replace(chr(10), '')}\n")


def trim_text(text, limit):
    text = str(text or '')
    if len(text) <= limit:
        return text
    return text[:limit] + '\n...[truncated]'


SECRET_GATE = re.compile(
    r'(?i)API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY|CLIENT_SECRET|'
    r'bearer|BEGIN [A-Z ]*PRIVATE KEY|sk-|github_pat_|gh[opsu]_|AKIA|eyJ'
)


def redact_secret_references(text):
    result = str(text or '')
    if not result or not SECRET_GATE.search(result):
        return result
    for pattern in SECRET_PATTERNS:
        result = re.sub(
            pattern,
            lambda match: (match.group(1) + '[redacted]' if match.lastindex else '[redacted]'),
            result,
        )
    return result


def strip_untrusted_links(text):
    def replace_url(match):
        url = match.group(0)
        try:
            host = re.sub(r'^https?://', '', url).split('/', 1)[0].split('@')[-1].split(':')[0].lower()
        except ValueError:
            return '[external-link-removed]'
        if host in ALLOWED_LINK_HOSTS:
            return url
        return '[external-link-removed]'

    return re.sub(r'https?://[^\s)>\]]+', replace_url, text)


def defang_mentions(text):
    return re.sub(
        r'(?<![\w.])@([A-Za-z0-9][A-Za-z0-9-]{0,38}(?:/[A-Za-z0-9_.-]+)?)',
        r'(at)\1',
        text,
    )


def sanitize_text(text, limit=MAX_FIELD_CHARS):
    text = ''.join(char for char in str(text or '') if char in '\n\t' or ord(char) >= 32)
    text = redact_secret_references(text)
    text = strip_untrusted_links(text)
    text = defang_mentions(text)
    return trim_text(text.strip(), limit)


def reviewer_prompt_file(name):
    return f'{REVIEWER_PROMPT_ROOT}/{name}.md'


def reviewer_entry(name):
    return {'name': name, 'prompt_file': reviewer_prompt_file(name)}


def is_backend_path(path):
    path = normalize_path(path)
    return path.startswith(
        (
            'backend/src/routes/',
            'backend/src/services/',
            'backend/src/middleware/',
            'backend/src/validators/',
            'backend/src/config/',
        )
    ) or (
        path.startswith('backend/')
        and ('prisma' in path.lower() or path.endswith('schema.prisma'))
    )


def is_map_ui_path(path):
    return '/components/campaign/map' in normalize_path(path)


def is_sheet_ui_path(path):
    return '/components/character-sheets/' in normalize_path(path)


def is_frontend_ui_path(path):
    path = normalize_path(path)
    if is_map_ui_path(path) or is_sheet_ui_path(path):
        return False
    if path == 'frontend/src/services/socket.ts' or path.startswith('frontend/src/services/socket.'):
        return False
    return path.startswith(
        (
            'frontend/src/pages/',
            'frontend/src/components/',
            'frontend/src/contexts/',
            'frontend/src/hooks/',
            'frontend/src/services/',
            'frontend/src/lib/',
        )
    )


VISION_PARITY_STEMS = (
    'raycasting',
    'spatialIndex',
    'tokenMask',
    'vibeAudio',
    'visibilityRule',
    'styleAllowlists',
)


def is_vision_parity_util_path(path):
    path = normalize_path(path)
    if not (path.startswith('backend/src/utils/') or path.startswith('frontend/src/utils/')):
        return False
    if 'parity' in path.lower():
        return True
    name = path.rsplit('/', 1)[-1]
    for stem in VISION_PARITY_STEMS:
        if name == f'{stem}.ts' or name.startswith(f'{stem}.'):
            return True
    return False


def is_realtime_path(path):
    path = normalize_path(path)
    return (
        path.startswith('backend/src/websocket/')
        or path.startswith('frontend/src/stores/gameStore')
        or is_map_ui_path(path)
        or path == 'frontend/src/services/socket.ts'
        or path.startswith('frontend/src/services/socket.')
        or is_vision_parity_util_path(path)
    )


def is_game_systems_path(path):
    path = normalize_path(path)
    return (
        path.startswith('backend/src/game-systems/')
        or path.startswith('backend/src/validators/game-systems/')
        or path.startswith('frontend/src/types/game-systems/')
        or path.startswith('frontend/src/components/character-sheets/')
        or path.endswith('/game-systems.ts')
        or path.endswith('/sheetLimits.ts')
    )


def is_infra_path(path):
    path = normalize_path(path)
    name = path.rsplit('/', 1)[-1]
    return (
        path.startswith(('.cursor/', 'nginx/', 'scripts/', '.github/'))
        or name.startswith('docker-compose')
        or name.startswith('Dockerfile')
        or name in {'package-lock.json', 'THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_LICENSES.md'}
        or path.endswith('/package-lock.json')
    )


def is_docs_path(path):
    path = normalize_path(path)
    return path.startswith('docs/') or path in {'README.md', 'AGENTS.md', 'GLOSSARY.md'}


def is_parity_path(path):
    path = normalize_path(path)
    lowered = path.lower()
    return (
        'parity' in lowered
        or 'routeinventory' in lowered
        or path.startswith('backend/docs/')
        or path.endswith('API_REFERENCE.md')
        or path.endswith('WEBSOCKET_DOCUMENTATION.md')
        or path.endswith('/sheetLimits.ts')
    )


def is_security_sensitive_path(path):
    path = normalize_path(path)
    if SECURITY_PATH.search(path):
        return True
    if path.startswith('backend/src/middleware/'):
        return True
    if is_realtime_path(path):
        return True
    if path.startswith('.github/'):
        return True
    return False


def matching_domains(path):
    domains = []
    if is_backend_path(path):
        domains.append('backend')
    if is_frontend_ui_path(path):
        domains.append('frontend')
    if is_realtime_path(path):
        domains.append('realtime')
    if is_game_systems_path(path):
        domains.append('game-systems')
    if is_infra_path(path):
        domains.append('infra')
    return domains


def select_reviewers(changed_files):
    """Map changed paths to a small CozyVTT reviewer set (typically 1–4)."""
    selected = set()
    domains = set()
    files = [normalize_path(path) for path in changed_files if normalize_path(path)]
    for path in files:
        domains.update(matching_domains(path))
        if is_backend_path(path):
            selected.add('backend-reviewer')
        if is_frontend_ui_path(path):
            selected.add('frontend-reviewer')
            selected.add('accessibility-reviewer')
        if is_realtime_path(path):
            selected.add('realtime-reviewer')
            selected.add('architecture-reviewer')
            selected.add('security-reviewer')
            selected.add('spec-parity-reviewer')
            if is_map_ui_path(path):
                selected.add('accessibility-reviewer')
        if is_game_systems_path(path):
            selected.add('game-systems-reviewer')
            selected.add('spec-parity-reviewer')
            if is_sheet_ui_path(path):
                selected.add('frontend-reviewer')
                selected.add('accessibility-reviewer')
        if is_infra_path(path):
            selected.add('infra-reviewer')
        if is_docs_path(path) or is_parity_path(path):
            selected.add('standards-reviewer')
            selected.add('spec-parity-reviewer')
        if is_security_sensitive_path(path):
            selected.add('security-reviewer')
    if len(domains) > 1:
        selected.add('architecture-reviewer')
    if not selected and files:
        selected.add('standards-reviewer')
    ordered = [name for name in REVIEWER_PRIORITY if name in selected][:MAX_REVIEWERS]
    return [reviewer_entry(name) for name in ordered]


def is_ignored_author(author):
    if not author:
        return True
    login = str(author.get('login') or '').lower()
    author_type = str(author.get('type') or author.get('__typename') or '').lower()
    return author_type == 'bot' or login.endswith('[bot]') or login == 'github-actions'


def comment_commands(env=None):
    env = os.environ if env is None else env
    raw = env.get('CODEX_ASSESS_COMMENT_COMMANDS', COMMENT_COMMANDS_DEFAULT)
    return {item.strip() for item in raw.split(',') if item.strip()}


def is_trusted_comment_event(event, commands=None):
    if event.get('action') != 'created':
        return False
    issue = event.get('issue') or {}
    if 'pull_request' not in issue:
        return False
    comment = event.get('comment') or {}
    allowed = comment_commands() if commands is None else set(commands)
    if str(comment.get('body') or '').strip() not in allowed:
        return False
    return str(comment.get('author_association') or '') in TRUSTED_ASSOCIATIONS


REVIEW_REQUEST_LABEL = 'codex-review'


def resolve_workflow_run_pr_number(event, fetch_prs_for_sha=None):
    workflow_run = event.get('workflow_run') or {}
    # Skipped request jobs (no label) must not resolve a PR. GitHub may still
    # report the parent workflow as success; the label check in resolve_outputs
    # is the other gate.
    if workflow_run.get('conclusion') in {'skipped', 'failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure'}:
        return None
    if workflow_run.get('conclusion') not in {None, 'success'}:
        return None
    if workflow_run.get('event') not in {None, 'pull_request'}:
        return None
    pull_requests = workflow_run.get('pull_requests') or []
    if pull_requests and pull_requests[0].get('number'):
        return int(pull_requests[0]['number'])
    head_sha = workflow_run.get('head_sha')
    if not head_sha or fetch_prs_for_sha is None:
        return None
    prs = fetch_prs_for_sha(head_sha)
    if isinstance(prs, list) and prs and prs[0].get('number'):
        return int(prs[0]['number'])
    return None


def resolve_pr_number(event, event_name, env=None, fetch_prs_for_sha=None):
    env = os.environ if env is None else env
    if event_name == 'workflow_dispatch':
        pr_number = (event.get('inputs') or {}).get('pr_number')
        return int(pr_number) if pr_number else None
    if event_name == 'pull_request':
        pull_request = event.get('pull_request') or {}
        return int(pull_request['number']) if pull_request.get('number') else None
    if event_name == 'issue_comment':
        if not is_trusted_comment_event(event, comment_commands(env)):
            return None
        return int(event['issue']['number'])
    if event_name == 'workflow_run':
        return resolve_workflow_run_pr_number(event, fetch_prs_for_sha)
    return None


def is_same_repo_pr(pr):
    return ((pr.get('head') or {}).get('repo') or {}).get('full_name') == (
        (pr.get('base') or {}).get('repo') or {}
    ).get('full_name')


def require_same_repo(env=None):
    env = os.environ if env is None else env
    return env.get('CODEX_ASSESS_REQUIRE_SAME_REPO', 'true') == 'true'


def pr_has_label(pr, name):
    labels = pr.get('labels') or []
    return any(str(label.get('name') or '') == name for label in labels)


def resolve_outputs(event, event_name, pr, env=None, fetch_prs_for_sha=None):
    outputs = {'should_run': 'false'}
    pr_number = resolve_pr_number(event, event_name, env, fetch_prs_for_sha)
    if pr_number is None or not pr:
        return outputs
    should_run = pr.get('state') == 'open'
    if should_run and require_same_repo(env):
        should_run = is_same_repo_pr(pr)
    if should_run and event_name == 'workflow_run':
        should_run = pr_has_label(pr, REVIEW_REQUEST_LABEL)
    if not should_run:
        return {'should_run': 'false', 'pr_number': str(pr_number)}
    return {
        'should_run': 'true',
        'pr_number': str(pr_number),
        'head_sha': pr['head']['sha'],
        'base_sha': pr['base']['sha'],
    }


def run_text(command, check=True, stdin=None):
    completed = subprocess.run(
        command,
        check=check,
        input=stdin,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return completed.stdout


def gh_json(args, check=True):
    output = run_text(['gh', *args], check=check)
    if not output.strip():
        return None
    return json.loads(output)


def repo_full_name(env=None):
    env = os.environ if env is None else env
    return env['GITHUB_REPOSITORY']


def collect_paginated(endpoint):
    data = gh_json(['api', '--paginate', '--slurp', endpoint])
    if data is None:
        return []
    if isinstance(data, list):
        if data and all(isinstance(item, list) for item in data):
            flattened = []
            for page in data:
                flattened.extend(page)
            return flattened
        return data
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, list):
                return value
    return []


def get_pr(repo, pr_number):
    return gh_json(['api', f'repos/{repo}/pulls/{pr_number}'])


def collect_pr_files(repo, pr_number):
    files = collect_paginated(f'repos/{repo}/pulls/{pr_number}/files')
    result = []
    for item in files:
        result.append(
            {
                'filename': item.get('filename'),
                'status': item.get('status'),
                'additions': item.get('additions'),
                'deletions': item.get('deletions'),
                'changes': item.get('changes'),
                'patch': trim_text(
                    redact_secret_references(str(item.get('patch') or '')),
                    DIFF_PATCH_LIMIT,
                ),
            }
        )
    return result


def collect_human_comments(items, body_commands):
    result = []
    for comment in items:
        if is_ignored_author(comment.get('user')):
            continue
        body = str(comment.get('body') or '')
        if body.strip() in body_commands:
            continue
        result.append(
            {
                'id': comment.get('id'),
                'author': (comment.get('user') or {}).get('login'),
                'created_at': comment.get('created_at') or comment.get('createdAt'),
                'path': comment.get('path'),
                'line': comment.get('line'),
                'body': redact_secret_references(body),
                'url': comment.get('html_url') or comment.get('url'),
            }
        )
    return result


def collect_prior_codex_reviews(repo, pr_number):
    reviews = collect_paginated(f'repos/{repo}/pulls/{pr_number}/reviews')
    result = []
    for review in reviews:
        body = str(review.get('body') or '')
        if 'Advisory Codex review' not in body and not body.startswith('## Advisory Codex review'):
            continue
        author = review.get('user') or {}
        login = str(author.get('login') or '')
        if login not in {'github-actions', 'github-actions[bot]'}:
            continue
        result.append(
            {
                'id': review.get('id'),
                'author': login,
                'submitted_at': review.get('submitted_at'),
                'commit_id': review.get('commit_id'),
                'state': review.get('state'),
                'body': trim_text(redact_secret_references(body), 20_000),
                'url': review.get('html_url'),
            }
        )
    return result


def collect_review_context(pr_number, env=None):
    env = os.environ if env is None else env
    repo = repo_full_name(env)
    pr = get_pr(repo, pr_number)
    commands = comment_commands(env)
    return {
        'repository': repo,
        'pr': {
            'number': pr_number,
            'title': pr.get('title'),
            'state': pr.get('state'),
            'draft': pr.get('draft'),
            'base_ref': pr['base']['ref'],
            'base_sha': pr['base']['sha'],
            'head_ref': pr['head']['ref'],
            'head_sha': pr['head']['sha'],
            'url': pr.get('html_url'),
            'author': (pr.get('user') or {}).get('login'),
        },
        'files': collect_pr_files(repo, pr_number),
        'comments': collect_human_comments(
            collect_paginated(f'repos/{repo}/issues/{pr_number}/comments'),
            commands,
        ),
        'review_comments': collect_human_comments(
            collect_paginated(f'repos/{repo}/pulls/{pr_number}/comments'),
            commands,
        ),
        'prior_codex_reviews': collect_prior_codex_reviews(repo, pr_number),
    }


def placeholder_review(name):
    return {
        'reviewer': name,
        'summary': 'Reviewer pass failed before producing output.',
        'findings': [
            {
                'category': 'informational',
                'severity': 'info',
                'path': None,
                'line': None,
                'title': 'Reviewer pass failed',
                'rationale': 'Codex did not produce a reviewer output for this pass.',
                'suggested_action': 'Inspect this workflow run if the missing reviewer output matters.',
            }
        ],
    }


def parse_reviewer_json(raw, expected_name):
    text = str(raw or '').strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'\s*```$', '', text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return placeholder_review(expected_name)
    if not isinstance(data, dict):
        return placeholder_review(expected_name)
    name = expected_name if expected_name in ALLOWED_REVIEWERS else 'unknown-reviewer'
    summary = sanitize_text(data.get('summary'), MAX_FIELD_CHARS)
    findings = []
    raw_findings = data.get('findings')
    if isinstance(raw_findings, list):
        for item in raw_findings[:MAX_FINDINGS]:
            if not isinstance(item, dict):
                continue
            category = str(item.get('category') or 'informational')
            severity = str(item.get('severity') or 'info')
            if category not in FINDING_CATEGORIES:
                category = 'informational'
            if severity not in FINDING_SEVERITIES:
                severity = 'info'
            path = item.get('path')
            line = item.get('line')
            findings.append(
                {
                    'category': category,
                    'severity': severity,
                    'path': sanitize_text(path, 500) if path else None,
                    'line': line if isinstance(line, int) else None,
                    'title': sanitize_text(item.get('title'), 300),
                    'rationale': sanitize_text(item.get('rationale'), MAX_FIELD_CHARS),
                    'suggested_action': sanitize_text(item.get('suggested_action'), MAX_FIELD_CHARS),
                }
            )
    return {'reviewer': name, 'summary': summary or 'No summary.', 'findings': findings}


def reviewer_name_from_path(path):
    match = re.fullmatch(r'reviewer-output-([a-z0-9-]+)\.json', Path(path).name)
    if not match:
        return None
    name = match.group(1)
    return name if name in ALLOWED_REVIEWERS else None


def load_reviewer_outputs(outputs_dir):
    reviews = []
    root = Path(outputs_dir)
    if not root.exists():
        return reviews
    for path in sorted(root.rglob('reviewer-output-*.json')):
        name = reviewer_name_from_path(path)
        if not name:
            continue
        reviews.append(parse_reviewer_json(path.read_text(encoding='utf-8'), name))
    return reviews


def advisory_header():
    return (
        '## Advisory Codex review (GPT-6 Luna Flex)\n\n'
        'This comment is **advisory**. It is not a required GitHub check and does '
        'not approve or block merge. A collaborator can opt in again with the '
        '`codex-review` label or `/review`.\n'
    )


def format_finding(finding):
    location = finding.get('path') or '(no path)'
    if finding.get('line') is not None:
        location = f"{location}:{finding['line']}"
    title = finding.get('title') or '(untitled)'
    lines = [
        f"- **{finding['category']}** (`{finding['severity']}`) `{location}` — {title}",
    ]
    if finding.get('rationale'):
        lines.append(f"  {finding['rationale']}")
    if finding.get('suggested_action'):
        lines.append(f"  Suggested: {finding['suggested_action']}")
    return '\n'.join(lines)


def assemble_review(reviews):
    parts = [advisory_header()]
    if not reviews:
        parts.append('No reviewer output was produced.\n')
    for review in reviews:
        name = review.get('reviewer') or 'reviewer'
        parts.append(f"### {name}\n")
        parts.append(f"{review.get('summary') or 'No summary.'}\n")
        findings = review.get('findings') or []
        if not findings:
            parts.append('No findings.\n')
            continue
        parts.append('\n'.join(format_finding(item) for item in findings))
        parts.append('')
    body = '\n'.join(parts).strip() + '\n'
    if len(body) > MAX_REVIEW_BODY_CHARS:
        body = body[:MAX_REVIEW_BODY_CHARS]
    body = sanitize_text(body, MAX_REVIEW_BODY_CHARS)
    if not body.startswith('## Advisory Codex review'):
        body = advisory_header() + '\n' + body
        if len(body) > MAX_REVIEW_BODY_CHARS:
            body = body[:MAX_REVIEW_BODY_CHARS] + '\n\n...[truncated]\n'
    elif len(body) > MAX_REVIEW_BODY_CHARS:
        body = body[:MAX_REVIEW_BODY_CHARS] + '\n\n...[truncated]\n'
    return body


def post_review(repo, pr_number, body):
    payload = json.dumps({'event': 'COMMENT', 'body': body})
    run_text(
        [
            'gh',
            'api',
            f'repos/{repo}/pulls/{pr_number}/reviews',
            '-X',
            'POST',
            '--input',
            '-',
        ],
        check=True,
        stdin=payload,
    )


def fetch_prs_for_sha(head_sha):
    return gh_json(
        [
            'api',
            f'repos/{repo_full_name()}/commits/{head_sha}/pulls',
            '-H',
            'Accept: application/vnd.github+json',
        ],
        check=False,
    )


def main_resolve(args):
    event_path = args.event_path or os.environ.get('GITHUB_EVENT_PATH')
    if not event_path:
        raise SystemExit('--event-path is required when GITHUB_EVENT_PATH is unset')
    event = load_json(event_path)
    event_name = os.environ.get('GITHUB_EVENT_NAME', '')
    pr_number = resolve_pr_number(event, event_name, fetch_prs_for_sha=fetch_prs_for_sha)
    pr = get_pr(repo_full_name(), pr_number) if pr_number is not None else None
    outputs = resolve_outputs(event, event_name, pr, fetch_prs_for_sha=fetch_prs_for_sha)
    if args.output:
        append_github_output(args.output, outputs)
    print(json.dumps(outputs, sort_keys=True))
    return 0


def main_collect_review(args):
    write_json(args.output, collect_review_context(args.pr_number))
    return 0


def main_select(args):
    context = load_json(args.context)
    changed_files = [item['filename'] for item in context.get('files', []) if item.get('filename')]
    reviewers = select_reviewers(changed_files)
    payload = {'reviewers': reviewers}
    write_json(args.output, payload)
    if args.github_output:
        append_github_output(
            args.github_output,
            {
                'has_reviewers': 'true' if reviewers else 'false',
                'matrix': json.dumps({'include': reviewers}, separators=(',', ':')),
            },
        )
    print(json.dumps(payload, sort_keys=True))
    return 0


def main_placeholder(args):
    name = args.name
    if name not in ALLOWED_REVIEWERS:
        raise SystemExit(f'unknown reviewer: {name}')
    write_json(args.output, placeholder_review(name))
    return 0


def main_assemble_review(args):
    reviews = load_reviewer_outputs(args.outputs_dir)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(assemble_review(reviews), encoding='utf-8')
    return 0


def main_post_review(args):
    body = Path(args.body_file).read_text(encoding='utf-8')
    if 'Advisory Codex review' not in body:
        body = assemble_review([])
    post_review(repo_full_name(), args.pr_number, body)
    return 0


def build_parser():
    parser = argparse.ArgumentParser(description='Advisory Codex PR review CI helper')
    subparsers = parser.add_subparsers(dest='command', required=True)

    resolve = subparsers.add_parser('resolve')
    resolve.add_argument('--event-path', default=os.environ.get('GITHUB_EVENT_PATH'))
    resolve.add_argument('--output')
    resolve.set_defaults(func=main_resolve)

    collect = subparsers.add_parser('collect-review')
    collect.add_argument('--pr-number', required=True, type=int)
    collect.add_argument('--output', required=True)
    collect.set_defaults(func=main_collect_review)

    select = subparsers.add_parser('select')
    select.add_argument('--context', required=True)
    select.add_argument('--output', required=True)
    select.add_argument('--github-output')
    select.set_defaults(func=main_select)

    placeholder = subparsers.add_parser('placeholder')
    placeholder.add_argument('--name', required=True)
    placeholder.add_argument('--output', required=True)
    placeholder.set_defaults(func=main_placeholder)

    assemble = subparsers.add_parser('assemble-review')
    assemble.add_argument('--outputs-dir', required=True)
    assemble.add_argument('--output', required=True)
    assemble.set_defaults(func=main_assemble_review)

    post = subparsers.add_parser('post-review')
    post.add_argument('--pr-number', required=True, type=int)
    post.add_argument('--body-file', required=True)
    post.set_defaults(func=main_post_review)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
