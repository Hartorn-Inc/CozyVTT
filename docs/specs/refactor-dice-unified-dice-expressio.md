# Spécification Technique & Fonctionnelle : Refactorisation de l'Architecture du Parseur de Dés Unifié

## 1. Contexte & Problématique

Le moteur de lancer de dés de CozyVTT (`backend/src/utils/dice-parser.ts`) est utilisé à travers l'ensemble de l'application : feuilles de personnages, initiative de combat, websocket de chat en temps réel et macros de dés. Historiquement, le parseur présentait plusieurs défauts architecturaux majeurs :

1. **Validation par exécution fantôme** : La fonction de validation `parseDiceExpression` exécutait `rollDice` en générant de véritables tirages aléatoires (`Math.random()`) pour ensuite jeter le résultat. Cette approche masquait l'absence d'un arbre syntaxique unifié et introduisait des effets de bord inutiles.
2. **Incohérences grammaticales** : Le support des majuscules (`1D20`), des formes abrégées (`d20`, `d%`), du modificateur Drop Highest (`dh`) et la gestion des divisions par zéro (`TODO(#155)`) étaient disparates ou incomplets.
3. **Désynchronisation Frontend/Backend** : La validation côté client (`frontend/src/utils/diceExpression.ts`) reposait sur une regex permissive acceptant des expressions invalides comme `2d6+` ou `///`.
4. **Absence de test de parité continue** : Aucune assertion dans `backend/src/__tests__/keepInStep.test.ts` ne garantissait l'alignement strict des expressions acceptées et rejetées entre l'interface utilisateur et le serveur.

## 2. Objectifs & Exigences Architecturales

- **Parseur AST pur et déterministe** : Création d'une fonction `parseDiceAST(expression: string): DiceAST` sans effet de bord, sans génération aléatoire et sans dépendance externe lourde.
- **Évaluation découplée** : `rollDice` évalue l'arbre AST en acceptant un générateur pseudo-aléatoire (RNG) injectable, facilitant les tests déterministes.
- **Validation pure** : `parseDiceExpression` valide la syntaxe et les invariants métiers via `parseDiceAST` sans tirage aléatoire.
- **Rétrocompatibilité totale** : Conservation exacte des types et signatures existants (`RollResult`, `DiceRoll`, `DiceParserError`, `rollDice`, `parseDiceExpression`).
- **Résolution des dettes techniques** : Prise en charge explicite de `d%`, `d20`, `dh`, et rejet de la division par zéro avec `DiceParserError` (clôture du `TODO(#155)`).
- **Parité Frontend/Backend** : Synchronisation de `frontend/src/utils/diceExpression.ts` et verrouillage par un test de cohérence dans `keepInStep.test.ts`.

## 3. Grammaire Formelle des Expressions de Dés

La grammaire supportée s'exprime en notation EBNF canonique insensible à la casse :

```ebnf
Expression    ::= AdditiveExpr
AdditiveExpr  ::= MultiplicativeExpr ( ( '+' | '-' ) MultiplicativeExpr )*
MultiplicativeExpr ::= Term ( ( '*' | '/' ) Term )*
Term          ::= DiceTerm | ModifierTerm | ShorthandTerm | '(' Expression ')'
DiceTerm      ::= [ Count ] ( 'd' | 'D' ) ( Sides | '%' ) [ SelectionMod ]
Count         ::= PositiveInteger
Sides         ::= PositiveInteger
SelectionMod  ::= ( 'kh' | 'kl' | 'dh' | 'dl' ) PositiveInteger
ModifierTerm  ::= Integer
ShorthandTerm ::= 'adv' | 'dis'
```

### Règles de normalisation :
1. **Shorthands** :
   - `adv` est normalisé syntaxiquement en `2d20kh1`.
   - `dis` est normalisé syntaxiquement en `2d20kl1`.
   - `d%` (ou `<count>d%`) est normalisé en `<count>d100` (count valant 1 par défaut).
   - `d<N>` sans multiplicateur explicite (`d20`, `d6`) équivaut à `1d<N>`.
2. **Insensibilité à la casse** : Toutes les lettres de notation (`d`, `D`, `kh`, `KH`, `kl`, `dh`, `dl`, `adv`, `dis`) sont traitées uniformément en minuscules.
3. **Gestion des espaces** : Les espaces blancs sont ignorés entre les opérateurs et les termes.

## 4. Invariants Métiers & Anti-Abus

Le parseur valide immédiatement les limites suivantes :
- **Longueur maximale de l'expression** : 200 caractères au total.
- **Nombre maximum de dés** : 100 dés maximum cumulés par expression.
- **Taille maximale de dé** : `d1000` (ou `d%` qui équivaut à `d100`). Le dé minimum est `d1`.
- **Constante numérique maximale** : Modificateurs entiers compris entre `-9999` et `+9999`.
- **Invariants des modificateurs de sélection** :
  - Pour `kh` (Keep Highest) et `kl` (Keep Lowest) : $1 \le N \le count$. Exemple : `4d6kh5` lève `DiceParserError`.
  - Pour `dh` (Drop Highest) et `dl` (Drop Lowest) : $1 \le N < count$. Exemple : `4d6dl4` lève `DiceParserError` (on ne peut pas écarter la totalité des dés).
- **Division arithmétique** : Les divisions par zéro (littéral `/ 0` ou sous-expression s'évaluant à zéro) sont détectées et lèvent `DiceParserError('Division by zero')`.

## 5. Structure de Données (AST)

```typescript
export type NodeType = 'dice' | 'modifier' | 'binary_op';

export interface BaseNode {
  type: NodeType;
}

export interface DiceNode extends BaseNode {
  type: 'dice';
  raw: string;
  count: number;
  sides: number;
  modifier?: 'kh' | 'kl' | 'dh' | 'dl';
  modifierCount?: number;
}

export interface ModifierNode extends BaseNode {
  type: 'modifier';
  value: number;
}

export interface BinaryOpNode extends BaseNode {
  type: 'binary_op';
  operator: '+' | '-' | '*' | '/';
  left: ASTNode;
  right: ASTNode;
}

export type ASTNode = DiceNode | ModifierNode | BinaryOpNode;

export interface DiceAST {
  root: ASTNode;
  diceCount: number;
  diceNodes: DiceNode[];
  rawExpression: string;
}
```

## 6. Algorithme de Parsing et Évaluation

### 6.1 Tokenizer & Parseur AST (`parseDiceAST`)
- **Tokenisation** : Découpage de l'expression nettoyée en flux de tokens (`NUMBER`, `DICE`, `OP`, `LPAREN`, `RPAREN`).
- **Analyse syntaxique** : Algorithme Shunting-Yard ou descente récursive respectant la priorité des opérateurs (`*`, `/` prioritaires sur `+`, `-`).
- **Validation des invariants** : Calcul dynamique du nombre de dés totaux (rejet si $> 100$) et validation des paramètres `kh`/`kl`/`dh`/`dl`.

### 6.2 Évaluateur AST (`evaluateAST` / `rollDice`)
- Fonction pure d'évaluation avec paramètre de RNG optionnel : `rng: (sides: number) => number = defaultRng`.
- Pour chaque `DiceNode` :
  1. Lancer $count$ fois le dé de taille $sides$ via `rng(sides)`.
  2. Appliquer la sélection :
     - `kh N` : tri descendant, conserver les $N$ premiers.
     - `kl N` : tri ascendant, conserver les $N$ premiers.
     - `dl N` : tri ascendant, éliminer les $N$ premiers.
     - `dh N` : tri descendant, éliminer les $N$ premiers.
  3. Sommer les dés conservés.
- Assembler les résultats intermédiaires dans la liste `rolls: DiceRoll[]`.
- Calculer le résultat arithmétique final en arrondissant à l'entier inférieur (`Math.floor`) pour maintenir la compatibilité avec l'existant CozyVTT.

## 7. Rétrocompatibilité des APIs et Types

Les exports suivants de `backend/src/utils/dice-parser.ts` restent rigoureusement stables :

```typescript
export interface DiceRoll {
  type: 'dice' | 'modifier';
  notation?: string;
  count?: number;
  sides?: number;
  results?: number[];
  kept?: number[];
  total?: number;
  value?: number;
  modifier?: 'kh' | 'kl' | 'dh' | 'dl';
  modifierCount?: number;
}

export interface RollResult {
  expression: string;
  rolls: DiceRoll[];
  total: number;
  formula: string;
}

export class DiceParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceParserError';
  }
}

export function rollDice(expression: string, rng?: (sides: number) => number): RollResult;
export function parseDiceExpression(expression: string): boolean;
export function parseDiceAST(expression: string): DiceAST;
```

## 8. Alignement Frontend & Test de Parité (`keepInStep`)

### 8.1 Frontend (`frontend/src/utils/diceExpression.ts`)
`isValidDiceExpression(expr: string): boolean` est mis à jour pour exécuter le même parseur léger en TypeScript pur ou un vérificateur de grammaire isomorphe. Les expressions syntaxiquement bancales (`2d6+`, `+`, `///`, `4d6kh10`) retournent immédiatement `false` sans soumission au backend.

### 8.2 Test de Parité (`backend/src/__tests__/keepInStep.test.ts`)
Un bloc de test dédié `dice expression parser parity` vérifie que pour une liste de test de référence (valides et invalides) :
- Toutes les expressions valides sont acceptées par le frontend (`isValidDiceExpression === true`) ET par le backend (`parseDiceExpression === true`).
- Toutes les expressions invalides sont rejetées par le frontend (`isValidDiceExpression === false`) ET lèvent une `DiceParserError` sur le backend.

## 9. Plan de Tests & Critères d'Acceptation

1. **Tests unitaires du parser (`dice-parser.test.ts`)** :
   - Cas valides : `1d20`, `d20`, `2D6+3`, `d%`, `1d%`, `4d6kh3`, `4d6dl1`, `2d20kl1`, `3d6dh1`, `adv`, `dis`, `1d4 + 2d6 * 2`.
   - Cas invalides : chaîne vide, longueur $> 200$, $> 100$ dés, dé $> d1000$, $d0$, modifier $> 9999$, `4d6kh5`, `2d6dl2`, `10 / 0`, `2d6+`, `*2d6`.
   - Déterminisme : vérification des résultats avec un faux générateur RNG fixe.
2. **Tests de validation pure** :
   - Garantir que `parseDiceExpression` n'appelle aucun RNG et ne lance aucun dé.
3. **Tests keepInStep (`keepInStep.test.ts`)** :
   - Parité absolue entre frontend et backend sur le corpus de test.
