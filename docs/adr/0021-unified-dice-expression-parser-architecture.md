# 0021. Unified Dice Expression Parser Architecture

Date: 2025-05-18

## Status

Accepted

## Context

Dice rolling is a core mechanism of CozyVTT, invoked in character rolls, initiative, live table chat, and customizable dice macros. The existing parser implementation in `backend/src/utils/dice-parser.ts` suffered from significant architectural weaknesses:

1. **Dual Parsing Paths and Phantom Roll Validation**: Validation (`parseDiceExpression`) and roll execution (`rollDice`) were historically duplicated. To prevent grammar drift, `parseDiceExpression` called `rollDice` and discarded the result. While preventing syntax divergence, this approach meant validation had side effects (calling `Math.random()`, executing roll logic, evaluating mathjs) rather than performing pure syntactic and structural validation.
2. **Grammar Inconsistencies and Edge Cases**: Uppercase die identifiers (`1D20`), shorthand dice expressions (`d20`, `d%`), drop-highest modifiers (`dh`), and edge cases such as division by zero or invalid modifier counts (`4d6kh5`) were either mishandled or deferred with `TODO` markers (e.g. `TODO(#155)`).
3. **Frontend Validation Divergence**: The client-side validator `frontend/src/utils/diceExpression.ts` relied on a loose regular expression (`/^[\dd+\-*/khldisavw\s]+$/i`) that accepted syntactically malformed strings like `2d6+`, `++++`, or `//2d6`, causing UI forms to submit invalid expressions that failed late on backend execution.
4. **Absence of Parity Enforcement**: No regression test prevented frontend and backend validation rules from drifting out of sync.

## Decision

We decide to refactor the dice parser architecture around a unified, pure tokenizer and Abstract Syntax Tree (AST) parser in `backend/src/utils/dice-parser.ts`, align `frontend/src/utils/diceExpression.ts`, and enforce grammar parity with automated tests:

1. **Strict Decoupling of Parsing and Evaluation**:
   - Introduce `parseDiceAST(expression: string): DiceAST` as a pure, deterministic function without side effects or random number generation.
   - `parseDiceExpression(expression: string): boolean` becomes a pure validation wrapper calling `parseDiceAST(expression)` and returning `true` or throwing `DiceParserError`.
   - `rollDice(expression: string, rng?: (sides: number) => number): RollResult` parses the expression into a `DiceAST` via `parseDiceAST` and evaluates the tree, allowing deterministic test injection of RNG.
2. **Formal Canonical Grammar**:
   - Support standard shorthand dice syntax: `d20` defaults to `1d20`; `d%` (or `1d%`) expands to `1d100`.
   - Support case-insensitive tokens (`d`, `D`, `kh`, `KH`, `kl`, `KL`, `dh`, `DH`, `dl`, `DL`, `adv`, `ADV`, `dis`, `DIS`).
   - Validate selection modifier bounds at AST construction time: modifier count $N$ must satisfy $1 \le N \le count$ for keep operations (`kh`, `kl`) and $1 \le N < count$ for drop operations (`dh`, `dl`). Expressions like `4d6kh5` or `3d6dl3` are rejected immediately.
   - Explicitly detect and reject division by zero (`DiceParserError("Division by zero")`) during validation/evaluation, resolving the lingering `TODO(#155)`.
   - Retain existing anti-abuse limits: maximum 100 dice per expression, maximum d1000 die size, modifier values bounded to $\pm 9999$, maximum expression length of 200 characters.
3. **Frontend Validator Alignment**:
   - Refactor `isValidDiceExpression` in `frontend/src/utils/diceExpression.ts` to utilize the same token and structure validation rules without external heavy runtime dependencies.
4. **Automated Continuous Parity Enforcement**:
   - Add dedicated checks in `backend/src/__tests__/keepInStep.test.ts` executing a comprehensive suite of valid and invalid expressions against both frontend and backend validation logic.
5. **Backward Compatibility**:
   - Preserve all public exports, signatures, and interfaces: `rollDice`, `parseDiceExpression`, `RollResult`, `DiceRoll`, and `DiceParserError`.

## Consequences

### Positive

- **Purity and Predictability**: Validating an expression no longer spins the random number generator or allocates throwaway roll arrays.
- **Zero Grammar Drift**: Both backend validation and execution share the exact same parsed representation, while frontend rejection matches backend rejection.
- **Robust Error Handling**: Syntactic mistakes, impossible modifier thresholds, and arithmetic zero divisions fail fast with descriptive error messages.
- **Testability**: The evaluator accepts an injected RNG function, making complex dice combinations (keep/drop distributions) deterministically testable.

### Negative / Trade-offs

- The internal tokenizer and AST parsing logic requires maintainable recursive-descent or Shunting-Yard operator precedence parsing without adding external heavyweight parser generator libraries.