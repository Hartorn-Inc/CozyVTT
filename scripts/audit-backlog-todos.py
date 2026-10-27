#!/usr/bin/env python3
"""
Audit and inventory backlog items and TODO/FIXME/XXX code comments.

Two complementary modes:
1. Inventory mode (default or with --output <path>):
   Scans specified Markdown files (docs/FUTURE_FEATURES.md by default)
   and TypeScript/JavaScript source trees (backend/src/ and frontend/src/)
   to locate TODO, FIXME, and XXX comments and backlog items.
   When invoked with --output <path>, generates a Markdown tabular report:
   | ID | Type | Fichier | Ligne | Extrait | Action proposée |

2. CI safeguard mode (--check-unreferenced):
   Verifies that all TODO/FIXME comments in backend/src/ and frontend/src/
   follow the normalized syntax:
     // TODO(#<issue_id>): <texte>
     /* TODO(#<issue_id>): <texte> */
     // FIXME(#<issue_id>): <texte>
     /* FIXME(#<issue_id>): <texte> */
   If unreferenced or orphan comments are found, writes occurrences with file
   and line number to sys.stderr and exits with code 1. Exits with 0 if clean.

Always ignores: node_modules, dist, coverage, .git, .cursor, build.
"""

import argparse
import io
import os
import re
import sys

# Configure stdout and stderr encoding for environments with non-UTF-8 defaults
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

IGNORED_DIRS = frozenset({'node_modules', 'dist', 'coverage', '.git', '.cursor', 'build'})
CODE_EXTENSIONS = frozenset({'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'})
DOC_EXTENSIONS = frozenset({'.md', '.markdown'})

# Normalized syntax: // TODO(#<id>): <text> or /* TODO(#<id>): <text> */
# Also accepts FIXME(#<id>): <text>
COMPLIANT_RE = re.compile(
    r'^(?:TODO|FIXME)\s*\(#(\d+)\)\s*:(?:\s*(.*))?$',
    re.DOTALL
)

MARKER_START_RE = re.compile(
    r'^(?:\[\s*)?(?:@)?(TODO|FIXME|XXX)(?:\])?(?:\s*\([^)]*\))?(?:\s*:|\s+|$)',
    re.IGNORECASE
)

MARKER_INLINE_RE = re.compile(
    r'\b(TODO|FIXME|XXX)\s*(?:\([^)]*\))?\s*:',
    re.IGNORECASE
)


class TodoItem:
    """Represents a detected TODO, FIXME, or XXX item."""

    def __init__(self, id_num, item_type, file_path, line_number, snippet, proposed_action, is_compliant=False, issue_id=None):
        self.id_num = id_num
        self.item_type = item_type
        self.file_path = file_path.replace('\\', '/')
        self.line_number = line_number
        self.snippet = snippet
        self.proposed_action = proposed_action
        self.is_compliant = is_compliant
        self.issue_id = issue_id

    def __repr__(self):
        return (
            f"<TodoItem {self.item_type} {self.file_path}:{self.line_number} "
            f"compliant={self.is_compliant} issue={self.issue_id}>"
        )


def propose_action(item_type, is_compliant, issue_id, is_doc):
    """Suggest an action based on context, compliance, and item type."""
    if is_compliant and issue_id is not None:
        return f"Lié à l'issue #{issue_id}"
    if is_doc:
        return "Créer issue GitHub ou supprimer du backlog"
    if item_type == 'TODO':
        return "Créer issue GitHub ou lier via TODO(#<id>)"
    if item_type == 'FIXME':
        return "Corriger le bug ou créer issue GitHub"
    if item_type == 'XXX':
        return "Clarifier ou refactoriser"
    return "Arbitrer : créer issue ou supprimer"


def is_ignored_path(path):
    """Check if any path component belongs to IGNORED_DIRS."""
    normalized = os.path.normpath(path)
    parts = set(normalized.split(os.sep))
    return bool(parts & IGNORED_DIRS)


def literal_end(text, i):
    """Where the comment or string literal starting at text[i] ends; None if none does."""
    if text.startswith('//', i):
        end = text.find('\n', i)
        return len(text) if end == -1 else end
    if text.startswith('/*', i):
        end = text.find('*/', i + 2)
        return len(text) if end == -1 else end + 2
    quote = text[i]
    if quote not in '\'"`':
        return None
    j = i + 1
    while j < len(text) and text[j] != quote:
        if text[j] == '\\':
            j += 2
        elif quote == '`' and text.startswith('${', j):
            j = interpolation_end(text, j + 2)
        elif text[j] == '\n' and quote != '`':
            return j
        else:
            j += 1
    return min(j + 1, len(text))


def interpolation_end(text, i):
    """From just inside a template literal's `${`, the position after its `}`."""
    depth = 0
    while i < len(text):
        end = literal_end(text, i)
        if end is not None:
            i = end
            continue
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            if depth == 0:
                return i + 1
            depth -= 1
        i += 1
    return len(text)


def extract_code_todos(content, rel_path):
    """Extracts TODO/FIXME/XXX comments from TypeScript or JavaScript source code."""
    items = []
    i = 0
    n = len(content)

    while i < n:
        if content.startswith('//', i):
            end = content.find('\n', i)
            if end == -1:
                end = n
            comment_text = content[i:end]
            line_no = content.count('\n', 0, i) + 1
            raw_line = content[content.rfind('\n', 0, i) + 1:end].strip()

            after_slash = comment_text[2:].strip()
            clean = after_slash.lstrip('@[').strip()

            marker_match = MARKER_START_RE.match(clean) or MARKER_INLINE_RE.search(comment_text)
            if marker_match:
                tag = marker_match.group(1).upper()
                comp_match = COMPLIANT_RE.match(clean)
                is_comp = comp_match is not None
                issue_id = int(comp_match.group(1)) if comp_match and comp_match.group(1) else None
                action = propose_action(tag, is_comp, issue_id, is_doc=False)
                items.append(TodoItem(
                    id_num=0,
                    item_type=tag,
                    file_path=rel_path,
                    line_number=line_no,
                    snippet=raw_line,
                    proposed_action=action,
                    is_compliant=is_comp,
                    issue_id=issue_id
                ))
            i = end
        elif content.startswith('/*', i):
            end = content.find('*/', i + 2)
            if end == -1:
                end = n
                block_content = content[i + 2:]
            else:
                block_content = content[i + 2:end]
                end += 2

            block_lines = block_content.split('\n')
            start_line = content.count('\n', 0, i) + 1

            for offset, bline in enumerate(block_lines):
                current_line_no = start_line + offset
                clean_bline = bline.strip().lstrip('/*').rstrip('*/').strip()
                clean = clean_bline.lstrip('@[').strip()
                if not clean:
                    continue
                marker_match = MARKER_START_RE.match(clean) or MARKER_INLINE_RE.search(clean_bline)
                if marker_match:
                    tag = marker_match.group(1).upper()
                    comp_match = COMPLIANT_RE.match(clean)
                    is_comp = comp_match is not None
                    issue_id = int(comp_match.group(1)) if comp_match and comp_match.group(1) else None
                    action = propose_action(tag, is_comp, issue_id, is_doc=False)
                    snippet = bline.strip()
                    if len(block_lines) == 1 and not snippet.startswith('/*'):
                        snippet = f"/* {snippet} */"
                    items.append(TodoItem(
                        id_num=0,
                        item_type=tag,
                        file_path=rel_path,
                        line_number=current_line_no,
                        snippet=snippet,
                        proposed_action=action,
                        is_compliant=is_comp,
                        issue_id=issue_id
                    ))
            i = end
        elif content[i] in ("'", '"', '`'):
            end = literal_end(content, i)
            i = end if end is not None and end > i else i + 1
        else:
            i += 1
    return items


def extract_markdown_todos(content, rel_path):
    """Extracts TODO/FIXME/XXX comments and list items from Markdown content."""
    items = []
    lines = content.split('\n')
    for line_idx, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped:
            continue

        # Check HTML comment e.g. <!-- TODO: ... -->
        html_comment_match = re.search(r'<!--\s*(.*?)\s*-->', stripped)
        if html_comment_match:
            comment_inner = html_comment_match.group(1).strip()
            marker_match = MARKER_START_RE.match(comment_inner) or MARKER_INLINE_RE.search(comment_inner)
            if marker_match:
                tag = marker_match.group(1).upper()
                comp_match = COMPLIANT_RE.match(comment_inner)
                is_comp = comp_match is not None
                issue_id = int(comp_match.group(1)) if comp_match and comp_match.group(1) else None
                action = propose_action(tag, is_comp, issue_id, is_doc=True)
                items.append(TodoItem(
                    id_num=0,
                    item_type=tag,
                    file_path=rel_path,
                    line_number=line_idx,
                    snippet=stripped,
                    proposed_action=action,
                    is_compliant=is_comp,
                    issue_id=issue_id
                ))
                continue

        # Check Markdown lines (bullets, checkboxes, headers)
        clean_line = re.sub(r'^(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?', '', stripped).strip()
        clean_line = re.sub(r'^#+\s+', '', clean_line).strip()
        marker_match = MARKER_START_RE.match(clean_line) or MARKER_INLINE_RE.search(clean_line)
        if marker_match:
            tag = marker_match.group(1).upper()
            comp_match = COMPLIANT_RE.match(clean_line)
            is_comp = comp_match is not None
            issue_id = int(comp_match.group(1)) if comp_match and comp_match.group(1) else None
            action = propose_action(tag, is_comp, issue_id, is_doc=True)
            items.append(TodoItem(
                id_num=0,
                item_type=tag,
                file_path=rel_path,
                line_number=line_idx,
                snippet=stripped,
                proposed_action=action,
                is_compliant=is_comp,
                issue_id=issue_id
            ))
    return items


def find_files(base_dir, extensions):
    """Finds all files with matching extensions, ignoring IGNORED_DIRS."""
    matched = []
    if not os.path.exists(base_dir):
        return matched
    for dirpath, dirnames, filenames in os.walk(base_dir):
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]
        if is_ignored_path(dirpath):
            continue
        for fname in sorted(filenames):
            ext = os.path.splitext(fname)[1].lower()
            if ext in extensions:
                matched.append(os.path.join(dirpath, fname))
    return matched


def scan_code(root_dir, code_dirs=None):
    """Scans code files under root_dir and extracts TODO/FIXME/XXX items."""
    if code_dirs is None:
        code_dirs = ['backend/src', 'frontend/src']

    target_dirs = []
    for d in code_dirs:
        full_d = os.path.join(root_dir, d) if not os.path.isabs(d) else d
        if os.path.exists(full_d):
            target_dirs.append(full_d)

    if not target_dirs and os.path.exists(root_dir):
        target_dirs.append(root_dir)

    code_files = []
    for d in target_dirs:
        code_files.extend(find_files(d, CODE_EXTENSIONS))

    seen = set()
    unique_files = []
    for f in code_files:
        norm = os.path.normcase(os.path.normpath(f))
        if norm not in seen:
            seen.add(norm)
            unique_files.append(f)

    items = []
    for file_path in sorted(unique_files):
        rel = os.path.relpath(file_path, root_dir).replace(os.sep, '/')
        try:
            with io.open(file_path, encoding='utf-8', errors='replace') as f:
                content = f.read()
        except OSError:
            continue
        items.extend(extract_code_todos(content, rel))
    return items


def scan_markdown(root_dir, doc_files=None):
    """Scans specified Markdown files and extracts backlog and TODO items."""
    if doc_files is None:
        doc_files = ['docs/FUTURE_FEATURES.md']

    target_files = []
    for p in doc_files:
        full_p = os.path.join(root_dir, p) if not os.path.isabs(p) else p
        if os.path.isfile(full_p) and not is_ignored_path(full_p):
            target_files.append(full_p)

    items = []
    for file_path in sorted(target_files):
        rel = os.path.relpath(file_path, root_dir).replace(os.sep, '/')
        try:
            with io.open(file_path, encoding='utf-8', errors='replace') as f:
                content = f.read()
        except OSError:
            continue
        items.extend(extract_markdown_todos(content, rel))
    return items


def escape_markdown_table_cell(text):
    """Sanitizes text for inclusion in a Markdown table cell."""
    clean = text.replace('\r\n', ' ').replace('\n', ' ').replace('\r', ' ')
    clean = clean.replace('|', '\\|').strip()
    return clean


def generate_markdown_report(items):
    """Generates a Markdown tabular report for the audited items."""
    lines = [
        "# Audit du backlog et des commentaires TODO",
        "",
        "| ID | Type | Fichier | Ligne | Extrait | Action proposée |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for idx, item in enumerate(items, 1):
        item.id_num = idx
        snippet = escape_markdown_table_cell(item.snippet)
        lines.append(
            f"| {idx} | {item.item_type} | {item.file_path} | {item.line_number} | {snippet} | {item.proposed_action} |"
        )
    return '\n'.join(lines) + '\n'


def check_unreferenced(code_items, stderr=None):
    """
    Checks that all code TODO/FIXME items are compliant with normalized syntax.
    Outputs unreferenced occurrences to stderr and returns False if violations exist.
    """
    err = sys.stderr if stderr is None else stderr
    unreferenced = [item for item in code_items if not item.is_compliant]
    if not unreferenced:
        return True

    for item in unreferenced:
        err.write(f"{item.file_path}:{item.line_number}: {item.snippet}\n")

    err.write(
        f"\nErreur : {len(unreferenced)} commentaire(s) TODO/FIXME non référencé(s) détecté(s).\n"
        f"Syntaxe normalisée obligatoire : // TODO(#<issue_id>): <texte> ou /* TODO(#<issue_id>): <texte> */\n"
    )
    return False


def main(argv=None, stdout=None, stderr=None):
    """CLI entry point for audit and inventory script."""
    out = sys.stdout if stdout is None else stdout
    err = sys.stderr if stderr is None else stderr

    parser = argparse.ArgumentParser(
        description="Audit et inventaire du backlog et des commentaires TODO/FIXME/XXX."
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="Chemin du fichier Markdown où écrire le rapport d'inventaire tabulaire."
    )
    parser.add_argument(
        "--check-unreferenced",
        action="store_true",
        help="Mode garde-fou CI : échoue (exit 1) si des TODO/FIXME non référencés sont présents dans le code."
    )
    parser.add_argument(
        "--root",
        type=str,
        default=None,
        help="Répertoire racine du projet (par défaut : racine du dépôt)."
    )
    parser.add_argument(
        "--markdown-files",
        nargs="*",
        default=None,
        help="Fichiers Markdown spécifiques à analyser en mode inventaire."
    )

    args = parser.parse_args(argv[1:] if argv is not None else None)

    root_dir = os.path.abspath(args.root) if args.root else ROOT

    code_items = scan_code(root_dir)

    if args.check_unreferenced:
        if args.output:
            doc_items = scan_markdown(root_dir, args.markdown_files)
            all_items = code_items + doc_items
            all_items.sort(key=lambda x: (x.file_path, x.line_number))
            report = generate_markdown_report(all_items)
            out_path = os.path.join(root_dir, args.output) if not os.path.isabs(args.output) else args.output
            parent_dir = os.path.dirname(os.path.abspath(out_path))
            if parent_dir:
                os.makedirs(parent_dir, exist_ok=True)
            with io.open(out_path, 'w', encoding='utf-8') as f:
                f.write(report)
            out.write(f"Rapport d'audit généré dans {out_path} ({len(all_items)} occurrences).\n")

        ok = check_unreferenced(code_items, stderr=err)
        return 0 if ok else 1

    # Inventory mode (default)
    doc_items = scan_markdown(root_dir, args.markdown_files)
    all_items = code_items + doc_items
    all_items.sort(key=lambda x: (x.file_path, x.line_number))
    report = generate_markdown_report(all_items)

    if args.output:
        out_path = os.path.join(root_dir, args.output) if not os.path.isabs(args.output) else args.output
        parent_dir = os.path.dirname(os.path.abspath(out_path))
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
        with io.open(out_path, 'w', encoding='utf-8') as f:
            f.write(report)
        out.write(f"Rapport d'audit généré dans {out_path} ({len(all_items)} occurrences).\n")
    else:
        out.write(report)

    return 0


if __name__ == '__main__':
    sys.exit(main())
