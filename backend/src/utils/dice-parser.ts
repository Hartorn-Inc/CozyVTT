/**
 * Dice Roller Parser
 * Dice Roller Parser Specification
 *
 * Supports:
 * - Basic notation: 1d20, 2d6+3, 3d10-2
 * - Multiple dice: 2d6+1d4+3
 * - Keep highest/lowest: 4d6kh3, 2d20kl1
 * - Drop lowest: 4d6dl1
 * - Advantage/Disadvantage: adv, dis
 * - Operators: +, -, *, /
 *
 * Anti-abuse limits:
 * - Max 100 dice per expression
 * - Max die size: d1000
 * - Max modifier: ±9999
 * - Expression max length: 200 chars
 */



// Limits
const MAX_DICE = 100;
const MAX_DIE_SIZE = 1000;
const MAX_MODIFIER = 9999;
const MAX_EXPRESSION_LENGTH = 200;

// AST types and node interfaces

export type NodeType = 'dice' | 'modifier' | 'binaryOp' | 'binary_op';

export interface BaseNode {
  type: NodeType;
}

export type SelectionType = 'kh' | 'kl' | 'dh' | 'dl';

export interface DiceNode extends BaseNode {
  type: 'dice';
  count: number;
  sides: number;
  modifier?: SelectionType;
  modifierCount?: number;
  notation?: string;
}

export interface ModifierNode extends BaseNode {
  type: 'modifier';
  value: number;
}

export interface BinaryOpNode extends BaseNode {
  type: 'binaryOp';
  operator: '+' | '-' | '*' | '/';
  op: '+' | '-' | '*' | '/';
  left: ASTNode;
  right: ASTNode;
}

export type ASTNode = DiceNode | ModifierNode | BinaryOpNode;

export interface DiceAST {
  root: ASTNode;
  expression: string;
  totalDiceCount: number;
  dice: DiceNode[];
}

// Interfaces

export interface DiceRoll {
  type: 'dice' | 'modifier';
  notation?: string;
  count?: number;
  sides?: number;
  results?: number[];
  kept?: number[];
  total?: number;
  value?: number; // For modifiers
  modifier?: 'kh' | 'kl' | 'dh' | 'dl'; // Keep highest, keep lowest, drop highest, drop lowest
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

/**
 * Roll a single die
 */
function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Parse a single dice expression like "2d6", "4d6kh3", "2d20kl1", "4d6dl1"
 */
function parseSingleDiceExpression(notation: string): DiceRoll {
  // Regex to match: (count)d(sides)(modifier)
  // Examples: 2d6, 4d6kh3, 2d20kl1, 4d6dl1, 1d20
  const regex = /^(\d+)?d(\d+)(kh\d+|kl\d+|dl\d+)?$/i;
  const match = notation.trim().match(regex);

  if (!match) {
    throw new DiceParserError(`Invalid dice notation: ${notation}`);
  }

  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2], 10);
  const modifierStr = match[3];

  // Validation
  if (count > MAX_DICE) {
    throw new DiceParserError(`Too many dice. Maximum ${MAX_DICE} per roll.`);
  }

  if (sides > MAX_DIE_SIZE) {
    throw new DiceParserError(`Die size too large. Maximum d${MAX_DIE_SIZE}.`);
  }

  if (sides < 1) {
    throw new DiceParserError(`Invalid die size: d${sides}. Must be at least 1.`);
  }

  // Roll the dice
  const results: number[] = [];
  for (let i = 0; i < count; i++) {
    results.push(rollDie(sides));
  }

  // Parse modifier (kh, kl, dl)
  let modifier: 'kh' | 'kl' | 'dl' | undefined;
  let modifierCount: number | undefined;
  let kept: number[] = [...results];

  if (modifierStr) {
    const modType = modifierStr.substring(0, 2).toLowerCase();
    const modNum = parseInt(modifierStr.substring(2), 10);

    if (modType === 'kh') {
      // Keep highest N
      modifier = 'kh';
      modifierCount = modNum;
      kept = [...results].sort((a, b) => b - a).slice(0, modNum);
    } else if (modType === 'kl') {
      // Keep lowest N
      modifier = 'kl';
      modifierCount = modNum;
      kept = [...results].sort((a, b) => a - b).slice(0, modNum);
    } else if (modType === 'dl') {
      // Drop lowest N
      modifier = 'dl';
      modifierCount = modNum;
      const sorted = [...results].sort((a, b) => a - b);
      kept = sorted.slice(modNum);
    }
  }

  const total = kept.reduce((sum, val) => sum + val, 0);

  return {
    type: 'dice',
    notation,
    count,
    sides,
    results,
    kept,
    total,
    modifier,
    modifierCount,
  };
}

/**
 * Tokenize expression into dice expressions, operators, and numbers
 */
function tokenize(expression: string): string[] {
  // Replace advantage/disadvantage shorthand
  let normalized = expression.toLowerCase();
  normalized = normalized.replace(/\badv\b/g, '2d20kh1');
  normalized = normalized.replace(/\bdis\b/g, '2d20kl1');

  // Remove all whitespace
  normalized = normalized.replace(/\s+/g, '');

  // Tokenize by splitting on operators while keeping them
  const tokens: string[] = [];
  let currentToken = '';

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (['+', '-', '*', '/'].includes(char)) {
      if (currentToken) {
        tokens.push(currentToken);
      }
      tokens.push(char);
      currentToken = '';
    } else {
      currentToken += char;
    }
  }

  if (currentToken) {
    tokens.push(currentToken);
  }

  return tokens;
}

/**
 * Parse dice expression and calculate result
 * @param expression Dice expression like "2d6+3", "4d6kh3", "2d20kh1+5"
 * @returns RollResult with detailed breakdown
 */
export function rollDice(expression: string): RollResult {
  // Validation
  if (!expression || expression.trim().length === 0) {
    throw new DiceParserError('Empty expression');
  }

  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new DiceParserError(`Expression too long. Maximum ${MAX_EXPRESSION_LENGTH} characters.`);
  }

  const originalExpression = expression;

  try {
    // Tokenize
    const tokens = tokenize(expression);

    if (tokens.length === 0) {
      throw new DiceParserError('Invalid expression');
    }

    const rolls: DiceRoll[] = [];
    let formulaParts: string[] = [];
    let totalDiceCount = 0;

    // Process tokens
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Check if token is a dice expression
      if (/d\d+/i.test(token)) {
        const diceRoll = parseSingleDiceExpression(token);
        rolls.push(diceRoll);
        formulaParts.push(diceRoll.total!.toString());
        totalDiceCount += diceRoll.count!;
      }
      // Check if token is an operator
      else if (['+', '-', '*', '/'].includes(token)) {
        formulaParts.push(token);
      }
      // Check if token is a number (modifier)
      else if (/^\d+$/.test(token)) {
        const value = parseInt(token, 10);

        if (value > MAX_MODIFIER) {
          throw new DiceParserError(`Modifier too large. Maximum ±${MAX_MODIFIER}.`);
        }

        rolls.push({
          type: 'modifier',
          value,
        });
        formulaParts.push(value.toString());
      }
      // Invalid token
      else {
        throw new DiceParserError(`Invalid token: ${token}`);
      }
    }

    // Check total dice count
    if (totalDiceCount > MAX_DICE) {
      throw new DiceParserError(`Too many dice. Maximum ${MAX_DICE} per expression.`);
    }

    // Build formula string
    const formula = formulaParts.join(' ');

    // Evaluate formula with zero-dependency arithmetic evaluator
    let total: number;
    try {
      const result = evaluateArithmetic(formulaParts);
      if (!Number.isFinite(result)) {
        throw new DiceParserError('Failed to evaluate expression');
      }
      total = Math.floor(result);
      if (total === 0) {
        total = 0;
      }
    } catch (error) {
      if (error instanceof DiceParserError) {
        throw error;
      }
      throw new DiceParserError('Failed to evaluate expression');
    }

    return {
      expression: originalExpression,
      rolls,
      total,
      formula,
    };
  } catch (error) {
    if (error instanceof DiceParserError) {
      throw error;
    }
    throw new DiceParserError(`Failed to parse expression: ${expression}`);
  }
}

/**
 * Evaluates arithmetic formula tokens using standard operator precedence (*, / before +, -),
 * left-to-right associativity, and leading/chained unary signs (+, -).
 * Uses IEEE 754 floating-point operations.
 * Rejects division by zero and non-finite intermediate/resulting values with DiceParserError.
 */
export function evaluateArithmetic(tokens: string[]): number {
  if (tokens.length === 0) {
    throw new DiceParserError('Failed to evaluate expression');
  }

  let index = 0;

  function parsePrimary(): number {
    if (index >= tokens.length) {
      throw new DiceParserError('Failed to evaluate expression');
    }

    const token = tokens[index];

    // Handle unary + and -
    if (token === '+' || token === '-') {
      index++;
      const operand = parsePrimary();
      const signed = token === '-' ? -operand : operand;
      if (!Number.isFinite(signed)) {
        throw new DiceParserError('Failed to evaluate expression');
      }
      return signed;
    }

    // Parenthesized expressions if encountered
    if (token === '(') {
      index++;
      const inner = parseAdditive();
      if (index >= tokens.length || tokens[index] !== ')') {
        throw new DiceParserError('Failed to evaluate expression');
      }
      index++;
      return inner;
    }

    // Number token
    const value = Number(token);
    if (!Number.isFinite(value) || token.trim() === '') {
      throw new DiceParserError('Failed to evaluate expression');
    }

    index++;
    return value;
  }

  function parseMultiplicative(): number {
    let left = parsePrimary();

    while (index < tokens.length) {
      const op = tokens[index];
      if (op !== '*' && op !== '/') {
        break;
      }
      index++;
      const right = parsePrimary();

      if (op === '*') {
        left = left * right;
      } else {
        if (right === 0) {
          throw new DiceParserError('Division by zero');
        }
        left = left / right;
      }

      if (!Number.isFinite(left)) {
        throw new DiceParserError('Failed to evaluate expression');
      }
    }

    return left;
  }

  function parseAdditive(): number {
    let left = parseMultiplicative();

    while (index < tokens.length) {
      const op = tokens[index];
      if (op !== '+' && op !== '-') {
        break;
      }
      index++;
      const right = parseMultiplicative();

      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }

      if (!Number.isFinite(left)) {
        throw new DiceParserError('Failed to evaluate expression');
      }
    }

    return left;
  }

  const result = parseAdditive();

  if (index < tokens.length) {
    throw new DiceParserError('Failed to evaluate expression');
  }

  if (!Number.isFinite(result)) {
    throw new DiceParserError('Failed to evaluate expression');
  }

  return result;
}

/**
 * Would this expression roll?
 *
 * Answers by rolling it and throwing the result away, rather than by
 * re-implementing the rules. It used to have its own copy of the token loop,
 * which checked each token in isolation and never checked that the tokens formed
 * a usable expression — so `2d6+`, `2d6*`, `2d6+-` and `/2d6` all passed
 * validation and then threw the moment they were rolled.
 *
 * Every caller validates and then rolls, so that gap let an expression clear the
 * gate and fail immediately afterwards. It was worse for anything that *stores* a
 * validated expression — a saved dice macro, an initiative fallback — where the
 * failure arrives long after the mistake was made and with nothing to connect
 * the two.
 *
 * Two functions answering one question will drift; this is the cheap fix, and
 * `dice-parser.test.ts` pins the two verdicts together so they cannot part again.
 * The wasted roll costs nothing: the expression is capped at 100 dice.
 *
 * @param expression Dice expression
 * @returns true if valid; throws DiceParserError if not
 */
export function parseDiceExpression(expression: string): boolean {
  rollDice(expression);
  return true;
}

interface AstToken {
  type: 'DICE' | 'NUMBER' | 'OP' | 'LPAREN' | 'RPAREN';
  raw: string;
  count?: number;
  sides?: number;
  modifier?: SelectionType;
  modifierCount?: number;
  numValue?: number;
}

/**
 * Authoritative tokenizer and AST parser for dice expressions.
 * Builds an AST and enforces all syntactic and semantic invariants without RNG.
 */
export function parseDiceAST(expression: string): DiceAST {
  if (!expression || typeof expression !== 'string' || expression.trim().length === 0) {
    throw new DiceParserError('Empty expression');
  }

  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new DiceParserError(`Expression too long. Maximum ${MAX_EXPRESSION_LENGTH} characters.`);
  }

  let normalized = expression.replace(/\badv\b/gi, '2d20kh1');
  normalized = normalized.replace(/\bdis\b/gi, '2d20kl1');
  normalized = normalized.replace(/(\d*)d%/gi, (_match, count) => (count || '1') + 'd100');

  const tokens: AstToken[] = [];
  let pos = 0;

  while (pos < normalized.length) {
    const ch = normalized[pos];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      pos++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', raw: '(' });
      pos++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', raw: ')' });
      pos++;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'OP', raw: ch });
      pos++;
      continue;
    }

    if (/[a-zA-Z0-9]/.test(ch)) {
      const remaining = normalized.slice(pos);
      const match = remaining.match(/^[a-zA-Z0-9]+/);
      if (!match) {
        throw new DiceParserError(`Invalid character: ${ch}`);
      }
      const rawWord = match[0];
      pos += rawWord.length;

      if (/^\d+$/.test(rawWord)) {
        const val = parseInt(rawWord, 10);
        if (val > MAX_MODIFIER) {
          throw new DiceParserError(`Modifier too large. Maximum ±${MAX_MODIFIER}.`);
        }
        tokens.push({ type: 'NUMBER', raw: rawWord, numValue: val });
        continue;
      }

      const diceMatch = rawWord.match(/^(\d+)?d(\d+)(kh\d+|kl\d+|dh\d+|dl\d+)?$/i);
      if (!diceMatch) {
        throw new DiceParserError(`Invalid dice notation: ${rawWord}`);
      }

      const count = diceMatch[1] ? parseInt(diceMatch[1], 10) : 1;
      const sides = parseInt(diceMatch[2], 10);
      const modifierStr = diceMatch[3];

      if (count < 1) {
        throw new DiceParserError(`Invalid dice count: ${count}. Must be at least 1.`);
      }
      if (count > MAX_DICE) {
        throw new DiceParserError(`Too many dice. Maximum ${MAX_DICE} per expression.`);
      }
      if (sides < 1) {
        throw new DiceParserError(`Invalid die size: d${sides}. Must be at least 1.`);
      }
      if (sides > MAX_DIE_SIZE) {
        throw new DiceParserError(`Die size too large. Maximum d${MAX_DIE_SIZE}.`);
      }

      let modType: SelectionType | undefined;
      let modNum: number | undefined;

      if (modifierStr) {
        modType = modifierStr.substring(0, 2).toLowerCase() as SelectionType;
        modNum = parseInt(modifierStr.substring(2), 10);

        if (modType === 'kh' || modType === 'kl') {
          if (modNum < 1 || modNum > count) {
            throw new DiceParserError(`Invalid keep count: ${modNum}. Must be between 1 and ${count}.`);
          }
        } else if (modType === 'dh' || modType === 'dl') {
          if (modNum < 1 || modNum >= count) {
            throw new DiceParserError(`Invalid drop count: ${modNum}. Must be between 1 and ${count - 1}.`);
          }
        }
      }

      tokens.push({
        type: 'DICE',
        raw: rawWord,
        count,
        sides,
        modifier: modType,
        modifierCount: modNum,
      });
      continue;
    }

    throw new DiceParserError(`Invalid token: ${ch}`);
  }

  if (tokens.length === 0) {
    throw new DiceParserError('Empty expression');
  }

  let tokenIdx = 0;

  function parsePrimary(): ASTNode {
    let sign = 1;
    let hasUnary = false;

    while (tokenIdx < tokens.length) {
      const tok = tokens[tokenIdx];
      if (tok.type === 'OP' && (tok.raw === '+' || tok.raw === '-')) {
        hasUnary = true;
        if (tok.raw === '-') {
          sign = -sign;
        }
        tokenIdx++;
      } else {
        break;
      }
    }

    if (tokenIdx >= tokens.length) {
      throw new DiceParserError('Unexpected end of expression');
    }

    const token = tokens[tokenIdx++];

    if (token.type === 'LPAREN') {
      if (tokenIdx < tokens.length && tokens[tokenIdx].type === 'RPAREN') {
        throw new DiceParserError('Empty parentheses are not allowed');
      }
      const expr = parseAdditive();
      if (tokenIdx >= tokens.length || tokens[tokenIdx].type !== 'RPAREN') {
        throw new DiceParserError("Expected ')'");
      }
      tokenIdx++;

      if (hasUnary && sign === -1) {
        return {
          type: 'binaryOp',
          operator: '-',
          op: '-',
          left: { type: 'modifier', value: 0 },
          right: expr,
        };
      }
      return expr;
    }

    if (token.type === 'NUMBER') {
      let value = token.numValue!;
      if (hasUnary) {
        value = sign * value;
      }
      if (value === 0) {
        value = 0;
      }
      if (value > MAX_MODIFIER || value < -MAX_MODIFIER) {
        throw new DiceParserError(`Modifier too large. Maximum ±${MAX_MODIFIER}.`);
      }
      return {
        type: 'modifier',
        value,
      };
    }

    if (token.type === 'DICE') {
      const diceNode: DiceNode = {
        type: 'dice',
        count: token.count!,
        sides: token.sides!,
        notation: `${token.count!}d${token.sides!}${token.modifier ? token.modifier + token.modifierCount : ''}`,
      };
      if (token.modifier) {
        diceNode.modifier = token.modifier;
        diceNode.modifierCount = token.modifierCount;
      }

      if (hasUnary && sign === -1) {
        return {
          type: 'binaryOp',
          operator: '-',
          op: '-',
          left: { type: 'modifier', value: 0 },
          right: diceNode,
        };
      }
      return diceNode;
    }

    throw new DiceParserError(`Unexpected token: ${token.raw}`);
  }

  function parseMultiplicative(): ASTNode {
    let left = parsePrimary();

    while (tokenIdx < tokens.length) {
      const tok = tokens[tokenIdx];
      if (tok.type !== 'OP' || (tok.raw !== '*' && tok.raw !== '/')) {
        break;
      }
      tokenIdx++;
      const op = tok.raw as '*' | '/';
      const right = parsePrimary();
      left = {
        type: 'binaryOp',
        operator: op,
        op,
        left,
        right,
      };
    }

    return left;
  }

  function parseAdditive(): ASTNode {
    let left = parseMultiplicative();

    while (tokenIdx < tokens.length) {
      const tok = tokens[tokenIdx];
      if (tok.type !== 'OP' || (tok.raw !== '+' && tok.raw !== '-')) {
        break;
      }
      tokenIdx++;
      const op = tok.raw as '+' | '-';
      const right = parseMultiplicative();
      left = {
        type: 'binaryOp',
        operator: op,
        op,
        left,
        right,
      };
    }

    return left;
  }

  const root = parseAdditive();

  if (tokenIdx < tokens.length) {
    throw new DiceParserError(`Unexpected token: ${tokens[tokenIdx].raw}`);
  }

  const allDice: DiceNode[] = [];
  function collect(node: ASTNode) {
    if (node.type === 'dice') {
      allDice.push(node);
    } else if (node.type === 'binaryOp') {
      collect(node.left);
      collect(node.right);
    }
  }
  collect(root);

  const totalDiceCount = allDice.reduce((sum, d) => sum + d.count, 0);
  if (totalDiceCount > MAX_DICE) {
    throw new DiceParserError(`Too many dice. Maximum ${MAX_DICE} per expression.`);
  }

  return {
    root,
    expression,
    totalDiceCount,
    dice: allDice,
  };
}
