#!/usr/bin/env python3
"""
Validation locale d'intégrité des liens Markdown et des ancres internes.

Ce script parcourt les fichiers Markdown du dépôt pour :
1. Extraire les liens [texte](cible) en excluant les blocs de code (``` et ~~~),
   le code inline (`...`) et les commentaires HTML (<!-- ... -->).
2. Ignorer les protocoles externes (http://, https://, mailto:, etc.) sans appel réseau.
3. Valider les ancres locales (#ancre) dans le document courant.
4. Valider les chemins relatifs (fichier.md ou fichier.md#ancre) :
   - Résolution du chemin relatif par rapport au fichier source.
   - Vérification de l'existence du fichier ou dossier ciblé.
   - Si une ancre est présente sur un fichier Markdown, vérification de la présence
     du titre correspondant via génération de slug normalisé.

Code de sortie :
  0 si tous les liens internes et ancres sont valides.
  1 si au moins un lien ou une ancre est manquant.
"""

import argparse
import io
import os
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

IGNORED_DIRS = frozenset({'node_modules', 'dist', 'coverage', '.git', '.cursor', '.agents', 'build'})
DOC_EXTENSIONS = frozenset({'.md', '.markdown'})

EXTERNAL_SCHEMES = ('http://', 'https://', 'mailto:', 'tel:', 'ftp://', '//')


def is_ignored_path(path, root_dir=None):
    """Vérifie si un chemin traverse un des répertoires exclus."""
    if root_dir is not None:
        try:
            rel = os.path.relpath(path, root_dir)
            parts = set(os.path.normpath(rel).split(os.sep))
            return bool(parts & IGNORED_DIRS)
        except ValueError:
            pass
    normalized = os.path.normpath(path)
    parts = set(normalized.split(os.sep))
    return bool(parts & IGNORED_DIRS)


def mask_code_blocks(content, mask_inline=True):
    """
    Masque les blocs de code et commentaires en conservant la numérotation des lignes.
    Remplace le contenu des blocs par des espaces tout en préservant les sauts de ligne.
    """
    def mask_fenced(match):
        text = match.group(0)
        return ''.join('\n' if c == '\n' else ' ' for c in text)

    # Fenced code blocks
    content = re.sub(r'(?ms)^([ \t]*)(`{3,}|~{3,})[^\n]*\n.*?\n\1\2[ \t]*', mask_fenced, content)

    # HTML comments <!-- ... -->
    content = re.sub(r'(?s)<!--.*?-->', mask_fenced, content)

    # Inline code `...` (mono ou multi-lignes sans saut de paragraphe)
    if mask_inline:
        content = re.sub(r'`[^`\n]+`', lambda m: ' ' * len(m.group(0)), content)

    return content


def slugify_heading(title):
    """
    Génère un slug GitHub Flavored Markdown à partir d'un titre de section.
    - Suppression des balises HTML et du formatage Markdown inline.
    - Passage en minuscules.
    - Suppression de la ponctuation et caractères spéciaux non alphanumériques.
    - Retrait des espaces en début/fin (ex. après retrait d'un emoji en tête).
    - Remplacement de chaque espace par un tiret (en préservant les espaces multiples
      résiduels comme dans 'Appearance & Theming' -> 'appearance--theming').
    """
    # Retirer balises HTML
    s = re.sub(r'<[^>]+>', '', title)
    # Retirer le formatage de lien [texte](cible) en conservant le texte
    s = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', s)
    # Retirer les backticks et étoiles/underscores de style
    s = re.sub(r'[`*_~]', '', s)
    # Minuscule
    s = s.lower()
    # Supprimer les caractères qui ne sont ni lettres, chiffres, tirets, underscores ou espaces
    s = re.sub(r'[^\w\s\-]', '', s)
    # Retirer les espaces en début et fin de chaîne
    s = s.strip()
    # Remplacer chaque espace par un tiret
    s = re.sub(r'\s', '-', s)
    return s


def extract_headings_and_anchors(content):
    """
    Extrait l'ensemble des slugs d'ancres valides d'un document Markdown.
    Prend en compte la gestion des doublons (slug, slug-1, slug-2, etc.)
    ainsi que les éventuelles balises <a id="..."> ou <a name="...">.
    """
    masked = mask_code_blocks(content, mask_inline=False)
    slugs = set()
    slug_counts = {}

    # 1. Titres Markdown ATX (^#+ Titre)
    for line in masked.split('\n'):
        line_stripped = line.strip()
        m = re.match(r'^(#{1,6})\s+(.+?)(?:\s+#+)?$', line_stripped)
        if m:
            raw_title = m.group(2).strip()
            base_slug = slugify_heading(raw_title)
            if not base_slug:
                continue
            if base_slug not in slug_counts:
                slug_counts[base_slug] = 0
                slugs.add(base_slug)
            else:
                slug_counts[base_slug] += 1
                slugs.add(f"{base_slug}-{slug_counts[base_slug]}")

            # Gestion des ancres GitHub commençant par un tiret (ex: #-become-a-collaborator pour '### 🤝 Become a Collaborator')
            clean_raw = re.sub(r'<[^>]+>', '', raw_title)
            clean_raw = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', clean_raw)
            clean_raw = re.sub(r'[`*_~]', '', clean_raw).lower()
            clean_raw = re.sub(r'[^\w\s\-]', '', clean_raw)
            leading_hyphen_slug = re.sub(r'\s', '-', clean_raw.rstrip())
            if leading_hyphen_slug.startswith('-') and leading_hyphen_slug.lstrip('-') == base_slug:
                slugs.add(leading_hyphen_slug)

    # 2. Balises HTML explicites <a id="..." ou name="...">
    for m in re.finditer(r'<[a-zA-Z][^>]*\b(?:id|name)=["\"]([^"\"]+)["\"]', content):
        slugs.add(m.group(1))

    return slugs


class LinkOccurrence:
    """Représente une occurrence de lien Markdown extrait d'un fichier."""

    def __init__(self, source_file, line_number, raw_target, clean_target, anchor):
        self.source_file = source_file.replace('\\', '/')
        self.line_number = line_number
        self.raw_target = raw_target
        self.clean_target = clean_target
        self.anchor = anchor

    def __repr__(self):
        return f"<Link {self.source_file}:{self.line_number} -> {self.raw_target}>"


def extract_links_from_content(content, source_rel_path):
    """
    Extrait tous les liens [texte](cible) d'un contenu Markdown en excluant le code.
    """
    masked = mask_code_blocks(content)
    links = []

    link_pattern = re.compile(r'\[([^\]]*)\]\(([^)]+)\)')

    lines = masked.split('\n')
    for line_idx, line in enumerate(lines, 1):
        for match in link_pattern.finditer(line):
            raw_target = match.group(2).strip()
            if not raw_target:
                continue

            target = raw_target
            if ' ' in target:
                parts = target.split(None, 1)
                if len(parts) == 2 and (parts[1].startswith('"') or parts[1].startswith("'")):
                    target = parts[0]

            if target.startswith('<') and target.endswith('>'):
                target = target[1:-1].strip()

            path_part, sep, anchor_part = target.partition('#')
            clean_target = path_part.split('?')[0].strip() if path_part else ''
            anchor = anchor_part.strip() if sep else None

            links.append(LinkOccurrence(
                source_file=source_rel_path,
                line_number=line_idx,
                raw_target=raw_target,
                clean_target=clean_target,
                anchor=anchor
            ))

    return links


def find_markdown_files(root_dir, specific_files=None):
    """Recherche tous les fichiers .md du projet, en respectant IGNORED_DIRS."""
    if specific_files:
        matched = []
        for f in specific_files:
            full = os.path.join(root_dir, f) if not os.path.isabs(f) else f
            if os.path.isfile(full) and not is_ignored_path(full, root_dir):
                matched.append(full)
        return sorted(matched)

    matched = []
    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]
        if is_ignored_path(dirpath, root_dir):
            continue
        for fname in sorted(filenames):
            ext = os.path.splitext(fname)[1].lower()
            if ext in DOC_EXTENSIONS:
                matched.append(os.path.join(dirpath, fname))
    return sorted(matched)


def validate_markdown_links(root_dir, specific_files=None):
    """
    Valide l'intégrité de tous les liens Markdown internes et ancres.
    Retourne (errors, total_links_checked).
    """
    files = find_markdown_files(root_dir, specific_files)
    file_contents = {}
    file_headings = {}

    for fpath in files:
        rel = os.path.relpath(fpath, root_dir).replace(os.sep, '/')
        try:
            with io.open(fpath, encoding='utf-8', errors='replace') as f:
                content = f.read()
            file_contents[rel] = content
            file_headings[rel] = extract_headings_and_anchors(content)
        except OSError:
            continue

    errors = []
    total_checked = 0

    for rel_path, content in file_contents.items():
        links = extract_links_from_content(content, rel_path)
        source_abs_dir = os.path.dirname(os.path.join(root_dir, rel_path))

        for link in links:
            raw = link.raw_target

            if any(raw.lower().startswith(scheme) for scheme in EXTERNAL_SCHEMES):
                continue

            total_checked += 1

            # Cas 1 : Ancre locale (#ancre)
            if not link.clean_target and link.anchor is not None:
                curr_headings = file_headings.get(rel_path, set())
                if link.anchor not in curr_headings:
                    errors.append(
                        f"{link.source_file}:{link.line_number}: [{raw}] - "
                        f"Ancre introuvable '#{link.anchor}' dans {link.source_file}"
                    )
                continue

            # Cas 2 : Chemin relatif (avec ou sans ancre)
            if link.clean_target.startswith('/'):
                target_abs = os.path.normpath(os.path.join(root_dir, link.clean_target.lstrip('/')))
            else:
                target_abs = os.path.normpath(os.path.join(source_abs_dir, link.clean_target))
            target_rel = os.path.relpath(target_abs, root_dir).replace(os.sep, '/')

            if not os.path.exists(target_abs):
                errors.append(
                    f"{link.source_file}:{link.line_number}: [{raw}] - "
                    f"Chemin cible introuvable: {target_rel}"
                )
                continue

            if link.anchor is not None and os.path.isfile(target_abs):
                ext = os.path.splitext(target_abs)[1].lower()
                if ext in DOC_EXTENSIONS:
                    if target_rel not in file_headings:
                        try:
                            with io.open(target_abs, encoding='utf-8', errors='replace') as f:
                                file_headings[target_rel] = extract_headings_and_anchors(f.read())
                        except OSError:
                            file_headings[target_rel] = set()

                    target_headings = file_headings.get(target_rel, set())
                    if link.anchor not in target_headings:
                        errors.append(
                            f"{link.source_file}:{link.line_number}: [{raw}] - "
                            f"Ancre introuvable '#{link.anchor}' dans {target_rel}"
                        )

    return errors, total_checked


def main(argv=None, stdout=None, stderr=None):
    """Point d'entrée CLI pour la vérification des liens Markdown."""
    out = sys.stdout if stdout is None else stdout
    err = sys.stderr if stderr is None else stderr

    parser = argparse.ArgumentParser(
        description="Validation locale d'intégrité des liens Markdown et ancres internes."
    )
    parser.add_argument(
        "--root",
        type=str,
        default=None,
        help="Répertoire racine du projet (par défaut : racine du dépôt)."
    )
    parser.add_argument(
        "--files",
        nargs="*",
        default=None,
        help="Fichiers Markdown spécifiques à vérifier."
    )

    args = parser.parse_args(argv[1:] if argv is not None else None)
    root_dir = os.path.abspath(args.root) if args.root else ROOT

    errors, count = validate_markdown_links(root_dir, args.files)

    if errors:
        for e in errors:
            err.write(f"{e}\n")
        err.write(f"\nErreur : {len(errors)} lien(s) Markdown ou ancre(s) brisé(s) détecté(s).\n")
        return 1

    out.write(f"Succès : {count} lien(s) Markdown vérifié(s) avec succès (zéro lien brisé).\n")
    return 0


if __name__ == '__main__':
    sys.exit(main())
