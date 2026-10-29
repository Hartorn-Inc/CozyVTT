# Spécification Technique et Fonctionnelle : Nettoyage documentaire, démantèlement du backlog statique et normalisation des TODOs

## 1. Contexte et Problématique

Le dépôt CozyVTT comportait historiquement un fichier `docs/FUTURE_FEATURES.md` servant de réceptacle mixte pour des rapports de bugs, des idées de conception non formalisées, des éléments classés « Won't Do » et des fonctionnalités futures envisagées pour des versions antérieures (v1.5.4). Ce fichier et d'autres références dans le `README.md` créent une divergence avec la gouvernance définie par l'ADR 0003 (*« GitHub surface is Issues only »*), selon laquelle le backlog et les anomalies actives doivent vivre exclusivement dans les Issues GitHub, tandis que l'historique des changements est tracé dans `CHANGELOG.md`.

En parallèle, le code source applicatif (`backend/src/` et `frontend/src/`) contient des commentaires `TODO` et `FIXME` flottants, sans référence d'issue de suivi, ce qui empêche une visibilité claire sur la dette technique réelle et son ordonnancement.

Cette spécification définit le cadre méthodologique, l'outillage automatisé et les garde-fous nécessaires pour :
1. Auditer, trier et migrer le contenu de `docs/FUTURE_FEATURES.md` et des `TODO` du code directement vers les Issues GitHub (`#152` à `#182`), sans conserver de catalogue Markdown statique permanent conformément à l'ADR-0003.
2. Supprimer définitivement `docs/FUTURE_FEATURES.md` et mettre à jour tous les documents référents sans créer de dossier d'archive.
3. Auditer et normaliser les commentaires `TODO`/`FIXME` du code source sous le format strict `// TODO(#<issue_id>): <description>` sans aucune altération de la logique fonctionnelle.
4. Mettre en place des scripts Python de vérification d'intégrité (liens Markdown et détection de TODOs orphelins) intégrés dans les tests de garde du dépôt.

---

## 2. Objectifs et Non-Objectifs

### 2.1 Objectifs
- **Conformité ADR-0003** : Éliminer la surface de backlog statique en supprimant `docs/FUTURE_FEATURES.md` et en consignant les éléments retenus dans un format standardisé d'Issues GitHub.
- **Zéro lien brisé** : Garantir par script automatisé que l'ensemble des liens Markdown internes (chemins de fichiers et ancres `#slug`) du dépôt sont valides.
- **Traçabilité de la dette de code** : Éliminer les TODOs obsolètes du code et normaliser les TODOs actifs avec une référence d'issue GitHub valide.
- **Pérennité CI** : Intégrer les vérifications de liens et de TODOs orphelins dans la suite de tests automatisés (`scripts/tests/test_doc_checks.py`).
- **Neutralité d'exécution** : Conserver 100% de la logique applicative et de la couverture de tests Jest existante.

### 2.2 Non-Objectifs
- Créer un sous-dossier `docs/archive/` (proscrit pour éviter une documentation morte).
- Résoudre ou implémenter les fonctionnalités ou correctifs extraits lors de ce chantier (ceux-ci feront l'objet de tickets dédiés post-migration).
- Modifier les fichiers tiers ou générés (`node_modules`, `dist`, `coverage`, `.git`).
- Valider les liens externes (`http://`, `https://`, `mailto:`) nécessitant un accès réseau lors des vérifications de liens.

---

## 3. Matrice de Triage et Règles de Classification

Chaque entrée issue de `docs/FUTURE_FEATURES.md` est soumise à une règle de triage déterministe :

| Catégorie Source | Action Retenue | Justification | Traitement |
| :--- | :--- | :--- | :--- |
| **Won't Do** | **Supprimer** | Décision d'abandon déjà actée ou non alignée avec la vision CozyVTT. | Suppression pure et simple, aucune issue créée. |
| **Bug résolu / Déjà implémenté** | **Supprimer** | Comportement déjà corrigé dans les versions courantes (1.5.2+). | Suppression sans création d'issue. |
| **Anomalies mineures UI / Retours ciblés** | **Regrouper & Extraire** | Petits bugs d'affichage ou réglages UI de même domaine (ex. Fiche de perso, Fog/Tokens). | Consolidés dans une issue thématique unique avec le label `scope:extracted-feature`. |
| **Évolution majeure / Chantier technique** | **Extraire unitaire** | Chantiers d'envergure (ex. multi-piste audio, migration Tailwind, mathjs). | Fiche d'issue dédiée avec description complète, contexte d'origine et label `scope:extracted-feature`. |
| **Dette de code résolue** | **Supprimer** | Commentaire `// TODO` dans le code dont l'implémentation est achevée. | Suppression du commentaire dans le fichier source. |
| **Dette de code persistante** | **Normaliser** | Tâche encore pertinente dans le code applicatif. | Réécriture : `// TODO(#<ref>): <description>`. |

---

## 4. Spécification des Outils d'Audit et de Vérification

### 4.1 Script d'Audit et de Contrôle des TODO : `scripts/audit-backlog-todos.py`

- **Rôle** : Parcourt les documents Markdown ciblés et l'arborescence de code TypeScript/JavaScript (`backend/src/` et `frontend/src/`).
- **Options CLI** :
  - `--output <path>` : Génère une matrice d'audit Markdown structurée (Colonnes : `ID`, `Type`, `Fichier`, `Ligne`, `Extrait`, `Statut / Action`).
  - `--check-unreferenced` : Mode garde-fou CI. Vérifie que tous les commentaires `TODO`/`FIXME` dans `backend/src/` et `frontend/src/` respectent le motif `TODO\(#[0-9a-zA-Z_-]+\)`. Si un commentaire sans référence est trouvé, le script écrit la liste des violations sur `sys.stderr` et termine avec un code de sortie `1`.
  - `--help` : Affiche l'aide.
- **Règles de filtrage des répertoires** : Ignore obligatoirement `node_modules`, `dist`, `coverage`, `.git`, `.cursor`, `build`.
- **Motifs recherchés** : `(?i)\b(?:TODO|FIXME|XXX)\b`.
- **Motif valide en mode strict** : `\bTODO\(#[A-Za-z0-9_-]+\):?\s+`.

### 4.2 Script de Vérification des Liens Markdown : `scripts/check-markdown-links.py`

- **Rôle** : Parcourt tous les fichiers `.md` du dépôt CozyVTT et valide la cohérence des liens relatifs internes et des ancres de titres.
- **Algorithme** :
  1. Analyse syntaxique des liens Markdown du type `[texte](cible)` (en excluant les blocs de code markdown ``` et `inline code`).
  2. Si la cible commence par `http://`, `https://` ou `mailto:`, le lien est ignoré.
  3. Si la cible est une ancre locale `#ancre`, vérifie que l'ancre existe dans le document courant.
  4. Si la cible contient un chemin relatif `fichier.md` ou `fichier.md#ancre` :
     - Résout le chemin absolu sur le système de fichiers par rapport au dossier du fichier Markdown source.
     - Vérifie l'existence effective du fichier ciblé.
     - Si une ancre `#ancre` est présente, charge le fichier cible, en extrait tous les titres Markdown (`#`, `##`, etc.), génère les slugs correspondants (minuscules, suppression des caractères spéciaux, remplacement des espaces par `-`) et valide la présence de l'ancre.
- **Code de sortie** : `0` si tous les liens internes sont résolus, `1` si au moins un lien ou une ancre est manquant, avec affichage détaillé (Fichier source, Numéro de ligne, Cible erronée, Raison de l'erreur).

### 4.3 Intégration CI : `scripts/tests/test_doc_checks.py`

- **Rôle** : Fichier de tests pytest dans `scripts/tests/` appelant :
  - Le test unitaire des fonctions de `audit-backlog-todos.py`.
  - Le test unitaire des fonctions de `check-markdown-links.py`.
  - L'exécution de `scripts/check-markdown-links.py` sur l'ensemble du dépôt pour bloquer tout commit introduisant un lien brisé.
  - L'exécution de `scripts/audit-backlog-todos.py --check-unreferenced` pour bloquer tout commit introduisant un TODO non référencé.

---

## 5. Spécification des Issues Extraites vers GitHub Issues (`#152` à `#182`)

Après une phase transitoire de staging documentaire, les 31 issues retenues (`#152` à `#182`, issues de `docs/FUTURE_FEATURES.md` et des `Referenced TODOs` du code) sont créées directement dans GitHub Issues (sans conserver de fichier statique `docs/reports/` conformément à l'ADR-0003 et à l'ADR-0020) avec :
- **Titre** : Titre conventionnel explicite (`fix(...)`, `refactor(...)`, `feat(...)`)
- **Labels** : `scope:extracted-feature`, `bug` / `tech-debt` / `enhancement`, `interest:high|medium|low`, `complexity:S|M|L|XL`
- **Fichier d'origine** : Chemin et section source dans `docs/FUTURE_FEATURES.md` ou fichier de code
- **Description & Contexte** : Explication détaillée du besoin ou de l'anomalie
- **Critères d'acceptation** : Liste à cocher vérifiable

---

## 6. Nettoyage de la Documentation et du Code

### 6.1 Documentation
- **Suppression** : `git rm docs/FUTURE_FEATURES.md`
- **Mise à jour de `README.md`** : Retrait des liens pointant vers `docs/FUTURE_FEATURES.md` (remplacement par la référence aux GitHub Issues selon ADR-0003).
- **Vérification** : Validation par `python3 scripts/check-markdown-links.py`.

### 6.2 Code Applicatif (`backend/src/` et `frontend/src/`)
- Audit complet des occurrences de `TODO` et `FIXME`.
- Suppression des commentaires pour les tâches obsolètes ou déjà résolues.
- Remplacement des commentaires maintenus par la syntaxe `// TODO(#<id_ou_ref>): <description>`.
- Validation par `python3 scripts/audit-backlog-todos.py --check-unreferenced`.
- Vérification de non-régression via `npm run test` et `npm run build` côté backend et frontend.
- Respect strict de `backend/src/__tests__/testMarkers.test.ts` (aucun marqueur de test résiduel).

---

## 7. Matrice de Traçabilité des Exigences

| Réf Exigence | Description | Ticket Associé | Vérification CI / Test |
| :--- | :--- | :--- | :--- |
| **REQ-DOC-01** | Script d'inventaire et d'audit des TODOs avec support `--check-unreferenced` | Ticket 1 | `pytest scripts/tests/test_audit_backlog_todos.py` |
| **REQ-DOC-02** | Script de vérification locale d'intégrité des liens Markdown et ancres | Ticket 2 | `pytest scripts/tests/test_check_markdown_links.py` (Validé) |
| **REQ-DOC-03** | Triage exhaustif de FUTURE_FEATURES.md, suppression du fichier et catalogue d'issues extraites | Ticket 3 | `scripts/check-markdown-links.py` et validation humaine |
| **REQ-DOC-04** | Nettoyage et normalisation des TODOs dans le code source applicatif | Ticket 4 | `python3 scripts/audit-backlog-todos.py --check-unreferenced` + `npm test` |
| **REQ-DOC-05** | Intégration des contrôles dans les tests de garde CI | Ticket 5 | `pytest scripts/tests/test_doc_checks.py` |
