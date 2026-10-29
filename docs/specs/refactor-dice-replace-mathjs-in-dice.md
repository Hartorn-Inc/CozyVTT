# Specification: refactor(dice): Replace mathjs in Dice Parser with Lightweight Arithmetic Evaluator

## 1. Executive Summary & Problem Statement

The CozyVTT backend dice evaluation module (`backend/src/utils/dice-parser.ts`) relies on the third-party library `mathjs` (`15.2.0`) to compute arithmetic formulas generated from rolled dice totals and modifier tokens. Installing `mathjs` pulls in approximately 18 megabytes across 35 transitive dependencies, introducing significant bloat to `backend/node_modules` and increasing security exposure.

Furthermore, `mathjs.evaluate` permits non-finite numeric outcomes such as `Infinity` when dividing by zero, requiring CozyVTT to carry an unresolved source code debt (`TODO(#155): handle division by zero and reject non-finite totals with DiceParserError`).

This refactoring replaces `mathjs` with a deterministic, self-contained, zero-dependency arithmetic evaluator embedded directly in the backend dice utility, enforces strict division-by-zero rejection with `DiceParserError`, uninstalls `mathjs` and its type definitions from `backend/package.json`, and guarantees 100% backward compatibility with all existing dice rolling semantics and test suites.

---

## 2. Scope & Boundaries

### In Scope
- **Zero-Dependency Arithmetic Engine**: Implement a deterministic evaluator in `backend/src/utils/dice-parser.ts` supporting:
  - Binary operations: addition (`+`), subtraction (`-`), multiplication (`*`), division (`/`).
  - Operator precedence: `*` and `/` possess equal precedence and evaluate before `+` and `-`.
  - Associativity: Left-to-right evaluation for operators of identical precedence (e.g. `10 - 3 - 2 = 5`, `6 / 4 * 2 = 3`).
  - Unary signs: Leading and chained unary `+` and `-` operators (e.g. `-7 / 2`, `2++3`, `1d1--1`, `10 + - + 3`).
  - Fractional rounding: Double-precision IEEE 754 floating-point operations during intermediate steps, rounded down via `Math.floor` on final roll totals.
- **Error Handling & Finitude Checks**:
  - Reject explicit division by zero (`divisor === 0`) by throwing a `DiceParserError` (e.g., `'Division by zero'`).
  - Reject intermediate or resulting non-finite numbers (`!Number.isFinite(value)`) with `DiceParserError`.
  - Remove the debt marker `// TODO(#155): handle division by zero and reject non-finite totals with DiceParserError`.
- **Dependency Removal**:
  - Remove `mathjs` from `dependencies` in `backend/package.json`.
  - Remove any `@types/mathjs` if present in `devDependencies`.
  - Update `backend/package-lock.json` via clean npm lifecycle synchronization.
- **Testing & Verification**:
  - Expand `backend/src/utils/dice-parser.test.ts` to cover division-by-zero edge cases (`1d6/0`, `10/0`, `0/0`), consecutive unary signs, operator precedence, and parity between `parseDiceExpression` and `rollDice`.

### Out of Scope
- **Parentheses Support**: Expressions containing parentheses (`(`, `)`) remain invalid syntax and MUST continue to throw `DiceParserError` (`'()'` is explicitly tested as invalid syntax).
- **Modifications to Dice Rolling Syntax**: Keep-highest (`kh`), keep-lowest (`kl`), drop-lowest (`dl`), die face maximums, dice count limits, and modifier limits remain completely unchanged.
- **New Mathematical Operators**: Modulo (`%`), exponentiation (`^`), bitwise operators, or mathematical functions (`sin`, `cos`, `sqrt`) are excluded.

---

## 3. Architecture & Arithmetic Evaluation Design

### 3.1 Expression Grammar (EBNF)

The dice parser tokenizes expressions into alternating operand and operator streams without parentheses:

```ebnf
Expression    ::= AdditiveExpr
AdditiveExpr  ::= MultiplicativeExpr ( ( '+' | '-' ) MultiplicativeExpr )*
MultiplicativeExpr ::= UnaryExpr ( ( '*' | '/' ) UnaryExpr )*
UnaryExpr     ::= ( '+' | '-' )* Primary
Primary       ::= Number
Number        ::= [0-9]+ ( '.' [0-9]+ )?
```

### 3.2 Token Stream Representation

In `rollDice`, raw user input is tokenized and processed:
1. Dice notation tokens (e.g. `2d6kh1`) are rolled and substituted with their resolved integer total (`diceRoll.total!.toString()`).
2. Integer modifier tokens (e.g. `5`) are validated against `MAX_MODIFIER` (10,000) and kept as string representations.
3. Operator tokens (`+`, `-`, `*`, `/`) are retained as individual tokens.
4. Tokens are joined by space into `formula = formulaParts.join(' ')` (e.g. `'2 + + 3'`, `'1 - - 1'`, `'- 7 / 2'`, `'6 / 4 * 2'`).

### 3.3 Evaluation Algorithm: Two-Pass Shunting-Yard / Recursive Descent

The evaluator can be implemented cleanly either as a classic Shunting-Yard parser to Reverse Polish Notation (RPN) or via a compact recursive descent / precedence climbing evaluator (~60-80 lines). Given the linear token list (no parentheses):

#### Evaluator Tokenizer / Pre-processor
When parsing the formula tokens:
- Operators can be binary or unary. An operator token `+` or `-` is **unary** if:
  - It occurs at index 0 of the formula token stream, OR
  - It immediately follows another operator (`+`, `-`, `*`, `/`).
- Unary operators fold directly into the operand sign: multiple unary minuses negate the value; unary pluses preserve it (e.g. `--3` is `+3`, `+-+3` is `-3`).

#### Precedence & Associativity Table
| Operator | Precedence | Associativity | Sémantique |
| :--- | :--- | :--- | :--- |
| Unary `+`, `-` | 3 | Right | Sign inversion or preservation |
| Binary `*` | 2 | Left | Multiplication |
| Binary `/` | 2 | Left | Division (reject divisor 0 with `DiceParserError`) |
| Binary `+` | 1 | Left | Addition |
| Binary `-` | 1 | Left | Subtraction |

#### Execution Steps
1. **Lexical / Token Walk**: Convert `formula` (or directly accept `formulaParts`) into a structured list of evaluated numeric values and binary operators, resolving all leading and chained unary signs.
2. **Pass 1 - High Precedence (`*`, `/`)**:
   - Process left to right.
   - When encountering `*`, compute `left * right`.
   - When encountering `/`, verify `right !== 0`. If `right === 0`, throw `DiceParserError('Division by zero')`.
   - Compute `left / right`. Verify `Number.isFinite(result)`; throw `DiceParserError('Failed to evaluate expression')` if not finite.
   - Replace the left, operator, and right elements with the result.
3. **Pass 2 - Low Precedence (`+`, `-`)**:
   - Process left to right.
   - Compute addition and subtraction successively.
   - Verify `Number.isFinite(result)` at each step.
4. **Final Rounding**:
   - Return `Math.floor(result)` to obtain the integer total for the roll.

### 3.4 Division by Zero & Finitude Semantics

- Any division where `denominator === 0` (or `-0`) MUST immediately throw `new DiceParserError('Division by zero')`.
- Any expression generating `NaN`, `Infinity`, or `-Infinity` (e.g. float overflow beyond `Number.MAX_VALUE`) MUST throw `new DiceParserError('Failed to evaluate expression')` or `new DiceParserError('Division by zero')`.
- The unresolved `TODO(#155)` line in `backend/src/utils/dice-parser.ts` is eliminated.

---

## 4. Source Changes & Impacted Files

### 4.1 `backend/src/utils/dice-parser.ts`
- **Remove**: `import { evaluate } from 'mathjs';`
- **Add**: Self-contained helper `evaluateArithmetic(formula: string): number` (or operating directly on formula tokens).
- **Update `rollDice`**:
  ```typescript
  // Evaluate formula deterministically
  let total: number;
  try {
    total = evaluateArithmetic(formula);
  } catch (error) {
    if (error instanceof DiceParserError) {
      throw error;
    }
    throw new DiceParserError('Failed to evaluate expression');
  }
  ```
- **Remove**: Comment `// TODO(#155): handle division by zero and reject non-finite totals with DiceParserError`.

### 4.2 `backend/package.json` & `backend/package-lock.json`
- Remove `