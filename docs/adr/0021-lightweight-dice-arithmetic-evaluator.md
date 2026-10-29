---
status: accepted
---
# Lightweight, Zero-Dependency Arithmetic Evaluator for Dice Parsing

## Context

In `backend/src/utils/dice-parser.ts`, CozyVTT imported `evaluate` from `mathjs` (`15.2.0`) solely to evaluate simple arithmetic expressions on dice subtotals and modifiers (`const result = evaluate(formula)`). Installing `mathjs` introduced approximately 18 megabytes across 35 transitive packages into `backend/node_modules`, dramatically increasing the installation footprint, cold-start CI setup overhead, and software supply chain surface area for a single function call.

Furthermore, `mathjs` permitted non-finite evaluation outcomes such as `Infinity` upon division by zero rather than signaling an immediate parse or execution failure. A source comment `TODO(#155): handle division by zero and reject non-finite totals with DiceParserError` documented this deficiency.

In virtual tabletop play, dice formulas consist strictly of rolled dice groups, integer modifiers, basic binary operators (`+`, `-`, `*`, `/`), unary signs (`+`, `-`), and standard operator precedence with left-to-right associativity. CozyVTT deliberately rejects parentheses in dice expressions (verified by existing unit tests where `'()'` throws `DiceParserError`).

## Decision

1. **Complete Removal of `mathjs`**:
   - Remove `mathjs` and `@types/mathjs` from `backend/package.json` and regenerate `backend/package-lock.json`.
   - Ensure zero external dependencies are imported for arithmetic evaluation in `backend/src/utils/dice-parser.ts`.

2. **Deterministic In-House Arithmetic Evaluator**:
   - Implement a lightweight, self-contained arithmetic evaluator directly within `backend/src/utils/dice-parser.ts` (or private internal helper functions).
   - Support the four fundamental operations (`+`, `-`, `*`, `/`), unary operators (`+`, `-`, including chained unary prefixes like `2++3`, `1d1--1`), and standard arithmetic precedence (`*` and `/` evaluated prior to `+` and `-`) with left-to-right associativity.
   - Maintain intermediate arithmetic using IEEE 754 floating-point calculations, applying `Math.floor` strictly to the final evaluated result to preserve exact equivalence with existing test expectations (`6/4*2 = 3`, `7/2 = 3`, `1-7/2 = -3`, `-7/2 = -4`).

3. **Strict Division-by-Zero and Finitude Enforcement**:
   - Actively detect division where the divisor resolves to zero (or absolute value below numerical precision limits).
   - Inspect intermediate and final evaluation results with `Number.isFinite`. Any non-finite value (`NaN`, `Infinity`, `-Infinity`) or zero division immediately throws a typed `DiceParserError`.
   - Fulfill and remove the `TODO(#155)` debt annotation.

4. **Grammar Parity and Security Isolation**:
   - Retain existing expression boundaries: expressions containing parentheses, unexpected symbols, or exceeding length bounds continue to be rejected during tokenization and validation with `DiceParserError`.
   - Maintain strict synchronization between `parseDiceExpression` and `rollDice`.

## Consequences

- **Positive**:
   - Shrinks `backend/node_modules` by approximately 18 MB and removes 35 transitive third-party dependencies.
   - Eliminates potential code execution or prototype pollution vulnerabilities inherent in heavy expression parsing engines.
   - Guarantees deterministic, predictable execution with explicit division-by-zero protection.
   - Fulfills and closes issue #155 / TODO(#155).
   - Eliminates cold-start package install lag in local development and continuous integration.

- **Negative / Operational Trade-offs**:
   - CozyVTT maintains its own arithmetic parsing routine (~60-90 lines of self-contained TypeScript).
   - Complex scientific functions (exponents, logarithms, trigonometric functions) are unsupported; however, these are completely irrelevant to VTT dice rolling mechanics.

## Considered Options

- **Retain `mathjs` with additional post-evaluation guards**: Rejected. Maintaining an 18 MB external dependency for basic four-function arithmetic is disproportionate and violates lean design principles.
- **Adopt an alternate lightweight library (e.g., `expr-eval`, `jsep`, `math-expression-evaluator`)**: Rejected. Adding another third-party npm package introduces new transitive dependencies and maintenance obligations for an operation that requires fewer than 100 lines of standard TypeScript.
- **Extend grammar to support parentheses**: Explicitly rejected during framing. Parentheses are intentionally unsupported in the current CozyVTT dice grammar and tested as invalid syntax. Modifying input contracts is out of scope for this refactoring.
