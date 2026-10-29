/**
 * Whether a string is a valid dice expression the server can evaluate.
 *
 * Implements the authoritative grammar matching backend/src/utils/dice-parser.ts:
 * - Basic notation: 1d20, 2d6+3, 3d10-2
 * - Case-insensitivity: 1D20, 2D6
 * - Implicit die counts: d20, d6, d100
 * - Multiple dice: 2d6+1d4+3
 * - Keep highest/lowest: 4d6kh3, 2d20kl1
 * - Drop highest/lowest: 4d6dh1, 4d6dl1
 * - Advantage/Disadvantage shorthands: adv, dis (case-insensitive)
 * - Percentage shorthand: d%, 1d% (case-insensitive)
 * - Operators: +, -, *, / with precedence and parentheses
 * - Anti-abuse limits: <= 100 total dice, die size <= 1000, modifier <= 9999, length <= 200
 * - Rejects malformed syntax: trailing/dangling operators (2d6+, +2d6, 2d6*),
 *   multiple operators (///), invalid keep/drop bounds (4d6kh5, 2d6dl2),
 *   empty parens (()), static division by zero (/0).
 */

const MAX_DICE = 100;
const MAX_DIE_SIZE = 1000;
const MAX_MODIFIER = 9999;
const MAX_EXPRESSION_LENGTH = 200;

type SelectionType = 'kh' | 'kl' | 'dh' | 'dl';

interface AstToken {
  type: 'DICE' | 'NUMBER' | 'OP' | 'LPAREN' | 'RPAREN';
  raw: string;
  count?: number;
  sides?: number;
  modifier?: SelectionType;
  modifierCount?: number;
  numValue?: number;
}

type ASTNode =
  | {
      type: 'dice';
      count: number;
      sides: number;
      modifier?: SelectionType;
      modifierCount?: number;
    }
  | { type: 'modifier'; value: number }
  | {
      type: 'binaryOp';
      op: '+' | '-' | '*' | '/';
      left: ASTNode;
      right: ASTNode;
    };

export function isValidDiceExpression(expr: string): boolean {
  if (!expr || typeof expr !== 'string' || expr.trim().length === 0) {
    return false;
  }

  if (expr.length > MAX_EXPRESSION_LENGTH) {
    return false;
  }

  let normalized = expr.replace(/\badv\b/gi, '2d20kh1');
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
      if (!match) return false;
      const rawWord = match[0];
      pos += rawWord.length;

      if (/^\d+$/.test(rawWord)) {
        const val = parseInt(rawWord, 10);
        if (val > MAX_MODIFIER) return false;
        tokens.push({ type: 'NUMBER', raw: rawWord, numValue: val });
        continue;
      }

      const diceMatch = rawWord.match(/^(\d+)?d(\d+)(kh\d+|kl\d+|dh\d+|dl\d+)?$/i);
      if (!diceMatch) return false;

      const count = diceMatch[1] ? parseInt(diceMatch[1], 10) : 1;
      const sides = parseInt(diceMatch[2], 10);
      const modifierStr = diceMatch[3];

      if (count < 1 || count > MAX_DICE) return false;
      if (sides < 1 || sides > MAX_DIE_SIZE) return false;

      let modType: SelectionType | undefined;
      let modNum: number | undefined;

      if (modifierStr) {
        modType = modifierStr.substring(0, 2).toLowerCase() as SelectionType;
        modNum = parseInt(modifierStr.substring(2), 10);

        if (modType === 'kh' || modType === 'kl') {
          if (modNum < 1 || modNum > count) return false;
        } else if (modType === 'dh' || modType === 'dl') {
          if (modNum < 1 || modNum >= count) return false;
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

    return false;
  }

  if (tokens.length === 0) return false;

  let tokenIdx = 0;

  function parsePrimary(): ASTNode | null {
    let sign = 1;
    let hasUnary = false;

    while (tokenIdx < tokens.length) {
      const tok = tokens[tokenIdx];
      if (tok.type === 'OP' && (tok.raw === '+' || tok.raw === '-')) {
        hasUnary = true;
        if (tok.raw === '-') sign = -sign;
        tokenIdx++;
      } else {
        break;
      }
    }

    if (tokenIdx >= tokens.length) return null;

    const token = tokens[tokenIdx++];

    if (token.type === 'LPAREN') {
      if (tokenIdx < tokens.length && tokens[tokenIdx].type === 'RPAREN') return null;
      const inner = parseAdditive();
      if (!inner || tokenIdx >= tokens.length || tokens[tokenIdx].type !== 'RPAREN') return null;
      tokenIdx++;

      if (hasUnary && sign === -1) {
        return {
          type: 'binaryOp',
          op: '-',
          left: { type: 'modifier', value: 0 },
          right: inner,
        };
      }
      return inner;
    }

    if (token.type === 'NUMBER') {
      let value = token.numValue!;
      if (hasUnary) value = sign * value;
      if (value === 0) value = 0;
      if (value > MAX_MODIFIER || value < -MAX_MODIFIER) return null;
      return { type: 'modifier', value };
    }

    if (token.type === 'DICE') {
      if (hasUnary) return null;
      const diceNode: ASTNode = {
        type: 'dice',
        count: token.count!,
        sides: token.sides!,
      };
      if (token.modifier) {
        diceNode.modifier = token.modifier;
        diceNode.modifierCount = token.modifierCount;
      }
      return diceNode;
    }

    return null;
  }

  function parseMultiplicative(): ASTNode | null {
    let left = parsePrimary();
    if (!left) return null;

    while (tokenIdx < tokens.length) {
      const tok = tokens[tokenIdx];
      if (tok.type !== 'OP' || (tok.raw !== '*' && tok.raw !== '/')) break;
      tokenIdx++;
      const right = parsePrimary();
      if (!right) return null;
      left = { type: 'binaryOp', op: tok.raw as '*' | '/', left, right };
    }

    return left;
  }

  function parseAdditive(): ASTNode | null {
    let left = parseMultiplicative();
    if (!left) return null;

    while (tokenIdx < tokens.length) {
      const tok = tokens[tokenIdx];
      if (tok.type !== 'OP' || (tok.raw !== '+' && tok.raw !== '-')) break;
      tokenIdx++;
      const right = parseMultiplicative();
      if (!right) return null;
      left = { type: 'binaryOp', op: tok.raw as '+' | '-', left, right };
    }

    return left;
  }

  const root = parseAdditive();
  if (!root || tokenIdx < tokens.length) return false;

  const allDice: { count: number }[] = [];
  function collect(node: ASTNode) {
    if (node.type === 'dice') allDice.push(node);
    else if (node.type === 'binaryOp') {
      collect(node.left);
      collect(node.right);
    }
  }
  collect(root);

  const totalDiceCount = allDice.reduce((sum, d) => sum + d.count, 0);
  if (totalDiceCount > MAX_DICE) return false;

  function checkStaticDivisionByZero(node: ASTNode): number | null {
    if (node.type === 'modifier') return node.value;
    if (node.type === 'dice') return null;
    if (node.type === 'binaryOp') {
      const leftVal = checkStaticDivisionByZero(node.left);
      const rightVal = checkStaticDivisionByZero(node.right);

      if (node.op === '/') {
        if (rightVal === 0) return NaN;
        if (leftVal !== null && rightVal !== null && !Number.isNaN(leftVal) && !Number.isNaN(rightVal)) {
          const res = leftVal / rightVal;
          if (!Number.isFinite(res)) return NaN;
          return res;
        }
        return null;
      }

      if (leftVal !== null && rightVal !== null && !Number.isNaN(leftVal) && !Number.isNaN(rightVal)) {
        let res: number;
        if (node.op === '+') res = leftVal + rightVal;
        else if (node.op === '-') res = leftVal - rightVal;
        else if (node.op === '*') res = leftVal * rightVal;
        else res = leftVal / rightVal;

        if (!Number.isFinite(res)) return NaN;
        return res;
      }
      return null;
    }
    return null;
  }

  const checkDiv = checkStaticDivisionByZero(root);
  if (typeof checkDiv === 'number' && Number.isNaN(checkDiv)) return false;

  return true;
}
