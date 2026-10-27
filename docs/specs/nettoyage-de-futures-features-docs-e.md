# Spécification Technique & Fonctionnelle : Nettoyage des Futures Features, Docs et Commentaires TODO

## 1. Contexte et Objectifs

Le projet CozyVTT dispose de documentation informative (`docs/FUTURE_FEATURES.md`, guides, ADRs) ainsi que de commentaires disséminés dans le code source applicatif (`backend/src/`, `frontend/src/`). Conformément à l'ADR 0003, la gestion de projet et le backlog d'équipe doivent résider exclusivement dans les GitHub Issues.

L'objectif de cette opération est de :
1. Auditer de manière exhaustive les propositions, listes d'idées, bogues connus et dettes techniques documentés dans `docs/` et dans le code source.
2. Éliminer définitivement les éléments obsolètes, abandonnés ou déjà réalisés (sans dossier d'archive, l'historique Git assurant la conservation).
3. Extraire les éléments pertinents sous forme de spécifications prêtes à être converties en GitHub Issues identifiées par le label `scope:extracted-feature`.
4. Normaliser les commentaires de tâche du code source selon la convention `// TODO(#<issue_id>): <description>` ou les supprimer s'ils sont caducs, sans impacter la logique fonctionnelle.
5. Valider l'intégrité référentielle de la documentation markdown restante via un outillage automatisé de vérification de liens internes.

---

## 2. Périmètre d'Audit et Règles de Triage

### 2.1 Périmètre

- **Documentation Markdown** :
  - Fichier principal : `docs/FUTURE_FEATURES.md`.
  - Documents associés : `docs/*.md` (`USER_GUIDE.md`, `DM_GUIDE.md`, `DEVELOPMENT.md`, etc.), `backend/docs/*.md`.
  - Fichiers exclus de la suppression : ADRs validés (`docs/adr/`), `GLOSSARY.md`, spécifications approuvées (`docs/specs/`).
- **Code Source Applicatif** :
  - `backend/src/**/*.{ts,js,json}`.
  - `frontend/src/**/*.{ts,tsx,js,jsx,css}`.
  - Exclusions strictes : `node_modules/`, `dist/`, `coverage/`, `.git/`, builds statiques.

### 2.2 Règles de Décision (Triage Matrix)

Chaque item recensé reçoit l'un des trois statuts :

| Statut | Description | Action appliquée |
| :--- | :--- | :--- |
| `DELETE` | Fonctionnalité abandonnée ("Won't Do"), idée obsolète, ou fonctionnalité déjà livrée et fonctionnelle dans le code. | Suppression immédiate du document ou du commentaire dans le code. |
| `EXTRACT` | Fonctionnalité, optimisation ou bogue confirmé pertinent à intégrer au backlog officiel CozyVTT. | Création d'une fiche d'extraction avec contexte et métadonnées GitHub Issue (`scope:extracted-feature`). |
| `RETAIN` | Documentation technique active, avertissement de conception ou commentaire `TODO(#<issue_id>)` déjà convenablement indexé. | Conservation intacte avec vérification de non-régression. |

---

## 3. Matrice d'Inventaire et Fiches d'Extraction

### 3.1 Structure du Registre d'Inventaire (`docs/reports/backlog-audit-inventory.md`)

Le script d'analyse génère un rapport markdown sous la forme :

```markdown
# Rapport d'Audit du Backlog et des Commentaires TODO

| ID | Type | Source (Fichier:Ligne) | Extrait / Titre | Action Proposée | Justification |
|---|---|---|---|---|---|
| AUD-001 | DOC | docs/FUTURE_FEATURES.md:25 | D&D 5e: naming the spellcasting ability... | EXTRACT | Bug confirmé à tracker en issue |
| AUD-002 | CODE | backend/src/services/map.ts:84 | // TODO: cache grid computations | EXTRACT | Dette technique pertinente |
| AUD-003 | DOC | docs/FUTURE_FEATURES.md:310 | Won't do: Flash player support | DELETE | Abandonné |
```

### 3.2 Format Standardisé d'une Issue GitHub Extraite

Chaque entrée à extraire génère une entrée au format structuré conforme à ADR 0003 :

```markdown
### [Extracted] <Titre clair et concis>

- **Labels** : `scope:extracted-feature`, `type:<feature|bug|debt>`
- **Origine** : `<chemin/vers/fichier>:<ligne>`
- **Commit de référence** : `<commit_sha_or_branch>`

#### Description et Contexte d'Origine
<Texte extrait du document ou du commentaire de code>

#### Comportement Attendu / Spécifications
<Clarification des attentes et critères d'acceptation>
```

---

## 4. Normalisation des Commentaires de Code

1. **Syntaxe cible** :
   - Valide : `// TODO(#123): Expliciter la gestion des déconnexions WebSocket`
   - Valide : `/* TODO(#123): Refactoriser le calcul de champ de vision */`
   - Interdit : `// TODO: à faire plus tard`, `// FIXME`, `/* HACK */` sans issue rattachée.
2. **Règles d'intégrité du code** :
   - Aucune modification de code exécutable, d'import, de type ou d'expression logique.
   - Ne jamais introduire de marqueurs de tests exclus (`test.skip`, `it.only`, etc.) couverts par `backend/src/__tests__/testMarkers.test.ts`.
   - Préservation stricte de la compilation TypeScript (`tsc --noEmit`) sur backend et frontend.

---

## 5. Outillage de Validation et Intégrité Référentielle

Deux scripts autonomes et testés unitairement sont introduits dans `scripts/` :

1. `scripts/audit-backlog-todos.py` :
   - Scanne `docs/FUTURE_FEATURES.md`, `docs/*.md`, `backend/src/`, `frontend/src/`.
   - Détecte les regex `(?:TODO|FIXME|XXX)(?:\([^)]+\))?:?\s*(.*)`.
   - Détecte les puces de backlog dans `docs/FUTURE_FEATURES.md`.
   - Génère la matrice markdown et le fichier de propositions d'issues.
   - Peut être exécuté en mode `--check` pour échouer en présence de `TODO` non référencés par un ID d'issue (`#\d+`).

2. `scripts/check-markdown-links.py` :
   - Scanne l'ensemble des fichiers markdown du dépôt.
   - Analyse les liens locaux relatifs `[texte](chemin/relatif.md)` et ancres `[texte](#mon-ancre)`.
   - Valide l'existence du fichier cible et de l'ancre markdown correspondante.
   - Retourne un code d'erreur `1` en cas de lien cassé.

---

## 6. Séquencement des Travaux (Plan d'Exécution TDD)

1. **Ticket 1** : Implémentation du script d'audit et d'inventaire (`scripts/audit-backlog-todos.py`) avec tests unitaires pytest associés.
2. **Ticket 2** : Implémentation du script de vérification d'intégrité des liens Markdown (`scripts/check-markdown-links.py`) avec tests unitaires pytest.
3. **Ticket 3** : Exécution de l'audit documentaire : triage de `docs/FUTURE_FEATURES.md`, suppression des éléments obsolètes/livrés, et génération du catalogue des issues extraites (`docs/reports/extracted-issues-backlog.md`).
4. **Ticket 4** : Traitement et normalisation des commentaires `TODO`/`FIXME` dans le code source (`backend/src/`, `frontend/src/`) en liant les éléments retenus ou en purgeant le superflu.
5. **Ticket 5** : Intégration du contrôle d'intégrité dans la suite de tests doc (`scripts/tests/test_doc_checks.py`), vérification globale des liens et validation finale.
