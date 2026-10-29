/**
 * Dice Parser Unit Tests
 * Tests for the dice expression parser
 */

import {
  rollDice,
  parseDiceExpression,
  evaluateArithmetic,
  DiceParserError,
  parseDiceAST,
  BinaryOpNode,
  DiceNode,
} from './dice-parser';

describe('Dice Parser', () => {
  describe('Basic Rolls', () => {
    test('1d20 - single die roll', () => {
      const result = rollDice('1d20');

      expect(result.expression).toBe('1d20');
      expect(result.rolls).toHaveLength(1);
      expect(result.rolls[0].type).toBe('dice');
      expect(result.rolls[0].count).toBe(1);
      expect(result.rolls[0].sides).toBe(20);
      expect(result.rolls[0].results).toHaveLength(1);
      expect(result.rolls[0].results![0]).toBeGreaterThanOrEqual(1);
      expect(result.rolls[0].results![0]).toBeLessThanOrEqual(20);
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeLessThanOrEqual(20);
    });

    test('2d6 - multiple dice', () => {
      const result = rollDice('2d6');

      expect(result.rolls).toHaveLength(1);
      expect(result.rolls[0].count).toBe(2);
      expect(result.rolls[0].sides).toBe(6);
      expect(result.rolls[0].results).toHaveLength(2);
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeLessThanOrEqual(12);
    });

    test('d6 - implicit 1d6', () => {
      const result = rollDice('d6');

      expect(result.rolls[0].count).toBe(1);
      expect(result.rolls[0].sides).toBe(6);
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeLessThanOrEqual(6);
    });

    test('3d10 - three dice', () => {
      const result = rollDice('3d10');

      expect(result.rolls[0].count).toBe(3);
      expect(result.rolls[0].sides).toBe(10);
      expect(result.rolls[0].results).toHaveLength(3);
      expect(result.total).toBeGreaterThanOrEqual(3);
      expect(result.total).toBeLessThanOrEqual(30);
    });
  });

  describe('Rolls with Modifiers', () => {
    test('1d20+5 - roll with addition', () => {
      const result = rollDice('1d20+5');

      expect(result.rolls).toHaveLength(2);
      expect(result.rolls[0].type).toBe('dice');
      expect(result.rolls[1].type).toBe('modifier');
      expect(result.rolls[1].value).toBe(5);
      expect(result.total).toBeGreaterThanOrEqual(6);
      expect(result.total).toBeLessThanOrEqual(25);
    });

    test('2d6-2 - roll with subtraction', () => {
      const result = rollDice('2d6-2');

      expect(result.rolls).toHaveLength(2);
      expect(result.rolls[1].value).toBe(2);
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeLessThanOrEqual(10);
    });

    test('1d8+3 - roll with modifier', () => {
      const result = rollDice('1d8+3');

      expect(result.total).toBeGreaterThanOrEqual(4);
      expect(result.total).toBeLessThanOrEqual(11);
    });

    test('3d10*2 - roll with multiplication', () => {
      const result = rollDice('3d10*2');

      expect(result.total).toBeGreaterThanOrEqual(6);
      expect(result.total).toBeLessThanOrEqual(60);
      expect(result.formula).toContain('*');
    });

    test('4d6/2 - roll with division', () => {
      const result = rollDice('4d6/2');

      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeLessThanOrEqual(12);
      expect(result.formula).toContain('/');
    });
  });

  describe('Multiple Dice Types', () => {
    test('2d6+1d4+3 - multiple dice and modifier', () => {
      const result = rollDice('2d6+1d4+3');

      expect(result.rolls).toHaveLength(3);
      expect(result.rolls[0].notation).toBe('2d6');
      expect(result.rolls[1].notation).toBe('1d4');
      expect(result.rolls[2].type).toBe('modifier');
      expect(result.total).toBeGreaterThanOrEqual(6); // 2+1+3 minimum
      expect(result.total).toBeLessThanOrEqual(19); // 12+4+3 maximum
    });

    test('1d20+2d6 - attack roll with damage', () => {
      const result = rollDice('1d20+2d6');

      expect(result.rolls).toHaveLength(2);
      expect(result.total).toBeGreaterThanOrEqual(3);
      expect(result.total).toBeLessThanOrEqual(32);
    });

    test('1d8+1d6+1d4+2 - complex multi-dice', () => {
      const result = rollDice('1d8+1d6+1d4+2');

      expect(result.rolls).toHaveLength(4);
      expect(result.total).toBeGreaterThanOrEqual(5); // 1+1+1+2
      expect(result.total).toBeLessThanOrEqual(20); // 8+6+4+2
    });
  });

  describe('Keep/Drop Modifiers', () => {
    test('4d6kh3 - keep highest 3', () => {
      const result = rollDice('4d6kh3');

      expect(result.rolls[0].count).toBe(4);
      expect(result.rolls[0].results).toHaveLength(4);
      expect(result.rolls[0].kept).toHaveLength(3);
      expect(result.rolls[0].modifier).toBe('kh');
      expect(result.rolls[0].modifierCount).toBe(3);

      // Verify kept are the highest 3
      const sortedResults = [...result.rolls[0].results!].sort((a, b) => b - a);
      const expectedKept = sortedResults.slice(0, 3);
      expect(result.rolls[0].kept!.sort((a, b) => b - a)).toEqual(expectedKept);
    });

    test('2d20kh1 - advantage roll', () => {
      const result = rollDice('2d20kh1');

      expect(result.rolls[0].count).toBe(2);
      expect(result.rolls[0].kept).toHaveLength(1);
      expect(result.rolls[0].modifier).toBe('kh');

      // Verify kept is the highest
      const highest = Math.max(...result.rolls[0].results!);
      expect(result.rolls[0].kept![0]).toBe(highest);
    });

    test('2d20kl1 - disadvantage roll', () => {
      const result = rollDice('2d20kl1');

      expect(result.rolls[0].count).toBe(2);
      expect(result.rolls[0].kept).toHaveLength(1);
      expect(result.rolls[0].modifier).toBe('kl');

      // Verify kept is the lowest
      const lowest = Math.min(...result.rolls[0].results!);
      expect(result.rolls[0].kept![0]).toBe(lowest);
    });

    test('4d6dl1 - drop lowest', () => {
      const result = rollDice('4d6dl1');

      expect(result.rolls[0].count).toBe(4);
      expect(result.rolls[0].results).toHaveLength(4);
      expect(result.rolls[0].kept).toHaveLength(3);
      expect(result.rolls[0].modifier).toBe('dl');

      // Verify lowest is dropped (kept has 3 highest values)
      const sortedResults = [...result.rolls[0].results!].sort((a, b) => a - b);
      const expectedKept = sortedResults.slice(1); // Drop first (lowest)

      expect(result.rolls[0].kept!.sort((a, b) => a - b)).toEqual(expectedKept);
    });

    test('2d20kh1+5 - advantage with modifier', () => {
      const result = rollDice('2d20kh1+5');

      expect(result.rolls).toHaveLength(2);
      expect(result.rolls[0].modifier).toBe('kh');
      expect(result.rolls[1].value).toBe(5);
      expect(result.total).toBeGreaterThanOrEqual(6);
      expect(result.total).toBeLessThanOrEqual(25);
    });
  });

  describe('Shorthand Notation', () => {
    test('adv - advantage shorthand', () => {
      const result = rollDice('adv');

      expect(result.rolls[0].count).toBe(2);
      expect(result.rolls[0].sides).toBe(20);
      expect(result.rolls[0].kept).toHaveLength(1);
      expect(result.rolls[0].modifier).toBe('kh');
    });

    test('dis - disadvantage shorthand', () => {
      const result = rollDice('dis');

      expect(result.rolls[0].count).toBe(2);
      expect(result.rolls[0].sides).toBe(20);
      expect(result.rolls[0].kept).toHaveLength(1);
      expect(result.rolls[0].modifier).toBe('kl');
    });

    test('adv+5 - advantage with modifier', () => {
      const result = rollDice('adv+5');

      expect(result.rolls).toHaveLength(2);
      expect(result.rolls[0].modifier).toBe('kh');
      expect(result.rolls[1].value).toBe(5);
    });
  });

  describe('Whitespace Handling', () => {
    test('1d20 + 5 - with spaces', () => {
      const result = rollDice('1d20 + 5');

      expect(result.rolls).toHaveLength(2);
      expect(result.total).toBeGreaterThanOrEqual(6);
      expect(result.total).toBeLessThanOrEqual(25);
    });

    test('  2d6  +  3  - extra spaces', () => {
      const result = rollDice('  2d6  +  3  ');

      expect(result.rolls).toHaveLength(2);
      expect(result.total).toBeGreaterThanOrEqual(5);
      expect(result.total).toBeLessThanOrEqual(15);
    });
  });

  describe('Edge Cases', () => {
    test('1d1 - minimum die size', () => {
      const result = rollDice('1d1');

      expect(result.total).toBe(1);
      expect(result.rolls[0].results![0]).toBe(1);
    });

    test('d1000 - maximum die size', () => {
      const result = rollDice('d1000');

      expect(result.rolls[0].sides).toBe(1000);
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeLessThanOrEqual(1000);
    });

    test('100d1 - maximum dice count', () => {
      const result = rollDice('100d1');

      expect(result.rolls[0].count).toBe(100);
      expect(result.total).toBe(100);
    });

    test('1d20+9999 - maximum modifier', () => {
      const result = rollDice('1d20+9999');

      expect(result.rolls[1].value).toBe(9999);
      expect(result.total).toBeGreaterThanOrEqual(10000);
      expect(result.total).toBeLessThanOrEqual(10019);
    });
  });

  describe('Limit Enforcement', () => {
    test('101d20 - too many dice', () => {
      expect(() => rollDice('101d20')).toThrow(DiceParserError);
      expect(() => rollDice('101d20')).toThrow('Too many dice');
    });

    test('50d6+51d6 - total dice exceeds limit', () => {
      expect(() => rollDice('50d6+51d6')).toThrow(DiceParserError);
      expect(() => rollDice('50d6+51d6')).toThrow('Too many dice');
    });

    test('1d1001 - die size too large', () => {
      expect(() => rollDice('1d1001')).toThrow(DiceParserError);
      expect(() => rollDice('1d1001')).toThrow('Die size too large');
    });

    test('1d20+10000 - modifier too large', () => {
      expect(() => rollDice('1d20+10000')).toThrow(DiceParserError);
      expect(() => rollDice('1d20+10000')).toThrow('Modifier too large');
    });

    test('very long expression - exceeds character limit', () => {
      const longExpression = '1d20+'.repeat(100) + '1';
      expect(() => rollDice(longExpression)).toThrow(DiceParserError);
      expect(() => rollDice(longExpression)).toThrow('Expression too long');
    });
  });

  describe('Invalid Syntax', () => {
    test('empty expression', () => {
      expect(() => rollDice('')).toThrow(DiceParserError);
      expect(() => rollDice('')).toThrow('Empty expression');
    });

    test('whitespace only', () => {
      expect(() => rollDice('   ')).toThrow(DiceParserError);
      expect(() => rollDice('   ')).toThrow('Empty expression');
    });

    test('invalid dice notation - d0', () => {
      expect(() => rollDice('d0')).toThrow(DiceParserError);
      expect(() => rollDice('d0')).toThrow('Invalid die size');
    });

    test('invalid dice notation - 2x6', () => {
      expect(() => rollDice('2x6')).toThrow(DiceParserError);
    });

    test('invalid dice notation - 2d', () => {
      expect(() => rollDice('2d')).toThrow(DiceParserError);
    });

    test('invalid modifier - kh', () => {
      expect(() => rollDice('2d6kh')).toThrow(DiceParserError);
    });

    test('random text', () => {
      expect(() => rollDice('hello world')).toThrow(DiceParserError);
    });

    test('incomplete expression - 1d20+', () => {
      expect(() => rollDice('1d20+')).toThrow(DiceParserError);
    });

    test('double operators - 1d20**5', () => {
      // Note: 1d20++5 is valid (equivalent to 1d20 + (+5))
      // Testing ** which is not a supported operator
      expect(() => rollDice('1d20**5')).toThrow(DiceParserError);
    });
  });

  describe('parseDiceExpression (Validation Only)', () => {
    test('valid expression - 1d20+5', () => {
      expect(parseDiceExpression('1d20+5')).toBe(true);
    });

    test('valid expression - 4d6kh3', () => {
      expect(parseDiceExpression('4d6kh3')).toBe(true);
    });

    test('valid expression - adv', () => {
      expect(parseDiceExpression('adv')).toBe(true);
    });

    test('invalid expression - 101d20', () => {
      expect(() => parseDiceExpression('101d20')).toThrow(DiceParserError);
    });

    test('invalid expression - empty', () => {
      expect(() => parseDiceExpression('')).toThrow(DiceParserError);
    });

    test('invalid expression - random text', () => {
      expect(() => parseDiceExpression('invalid')).toThrow(DiceParserError);
    });
  });

  describe('Formula Generation', () => {
    test('formula shows dice totals', () => {
      const result = rollDice('2d6+3');

      expect(result.formula).toMatch(/^\d+ \+ 3$/);
    });

    test('formula shows multiple dice', () => {
      const result = rollDice('2d6+1d4');

      expect(result.formula).toMatch(/^\d+ \+ \d+$/);
    });

    test('formula shows operations', () => {
      const result = rollDice('2d6*2');

      expect(result.formula).toContain('*');
    });
  });

  describe('Arithmetic totals', () => {
    // Dice of one side always roll 1, so these totals are exact. They pin the
    // order of operations, left to right evaluation, unary signs and rounding
    // down of a fractional total.
    const cases: [string, number][] = [
      ['2+3*4', 14],
      ['2*3+4', 10],
      ['10-3-2', 5],
      ['6/4*2', 3],
      ['12/3/2', 2],
      ['12/3*2', 8],
      ['20-10+5', 15],
      ['20-10-5', 5],
      ['24/6*2/4', 2],
      ['10-2*3+8/4', 6],
      ['2*3+4*5', 26],
      ['7/2', 3],
      ['100/3', 33],
      ['1-5', -4],
      ['1-7/2', -3],
      ['-7/2', -4],
      ['2++3', 5],
      ['1d1--1', 2],
      ['10+-+3', 7],
      ['1d1+-+3', -2],
      ['10---3', 7],
      ['1d1*--3', 3],
      ['2*--3', 6],
      ['6/-2', -3],
      ['6/--2', 3],
      ['6/-+2', -3],
      ['2d1*-3', -6],
      ['5+-2', 3],
      ['5-+2', 3],
      ['5--2', 7],
      ['5++2', 7],
      ['+5', 5],
      ['-5', -5],
      ['++5', 5],
      ['--5', 5],
      ['+-5', -5],
      ['-+-5', 5],
      ['---5', -5],
      ['1d1 - -1', 2],
      ['10 + - + 3', 7],
      ['9999*9999', 99980001],
      ['4d1kh3+2', 5],
      ['2d1*3/2', 3],
      ['1d1*3/2', 1],
      ['1d1+2*3-4/2', 5],
      ['1d1+1d1*2', 3],
      ['1d1*2+1d1', 3],
      ['1d1-1', 0],
      ['0*5', 0],
      ['0+0', 0],
      ['0-0', 0],
      ['0/5', 0],
      ['-0', 0],
    ];

    it.each(cases)('%s totals %d', (expression, expected) => {
      expect(rollDice(expression).total).toBe(expected);
    });
  });

  describe('Arithmetic Evaluator direct tests & error cases', () => {
    test('division by zero throws DiceParserError in rollDice', () => {
      expect(() => rollDice('1d6/0')).toThrow(DiceParserError);
      expect(() => rollDice('1d6/0')).toThrow('Division by zero');
      expect(() => rollDice('10/0')).toThrow(DiceParserError);
      expect(() => rollDice('10/0')).toThrow('Division by zero');
      expect(() => rollDice('0/0')).toThrow(DiceParserError);
      expect(() => rollDice('0/0')).toThrow('Division by zero');
      expect(() => rollDice('4d6/0')).toThrow(DiceParserError);
      expect(() => rollDice('4d6/0')).toThrow('Division by zero');
      expect(() => rollDice('1d20/0')).toThrow(DiceParserError);
      expect(() => rollDice('1d20/0')).toThrow('Division by zero');
      expect(() => rollDice('2d20kh1/0')).toThrow(DiceParserError);
      expect(() => rollDice('2d20kh1/0')).toThrow('Division by zero');
      expect(() => rollDice('10/2/0')).toThrow(DiceParserError);
      expect(() => rollDice('10/2/0')).toThrow('Division by zero');
      expect(() => rollDice('2+1d6/0')).toThrow(DiceParserError);
      expect(() => rollDice('2+1d6/0')).toThrow('Division by zero');
      expect(() => rollDice('1d6/-0')).toThrow(DiceParserError);
      expect(() => rollDice('1d6/-0')).toThrow('Division by zero');
      expect(() => rollDice('10/+0')).toThrow(DiceParserError);
      expect(() => rollDice('10/+0')).toThrow('Division by zero');
      expect(() => rollDice('1d20/(5-5)')).toThrow(DiceParserError);
    });

    test('division by zero throws DiceParserError in parseDiceExpression', () => {
      expect(() => parseDiceExpression('1d6/0')).toThrow(DiceParserError);
      expect(() => parseDiceExpression('1d6/0')).toThrow('Division by zero');
      expect(() => parseDiceExpression('10/0')).toThrow(DiceParserError);
      expect(() => parseDiceExpression('10/0')).toThrow('Division by zero');
      expect(() => parseDiceExpression('0/0')).toThrow(DiceParserError);
      expect(() => parseDiceExpression('0/0')).toThrow('Division by zero');
    });

    test('division by zero throws DiceParserError in evaluateArithmetic', () => {
      expect(() => evaluateArithmetic(['1', '/', '0'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['1', '/', '0'])).toThrow('Division by zero');
      expect(() => evaluateArithmetic(['10', '/', '0'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['10', '/', '0'])).toThrow('Division by zero');
      expect(() => evaluateArithmetic(['0', '/', '0'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['0', '/', '0'])).toThrow('Division by zero');
      expect(() => evaluateArithmetic(['10', '/', '-', '0'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['10', '/', '-', '0'])).toThrow('Division by zero');
      expect(() => evaluateArithmetic(['10', '/', '+', '0'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['10', '/', '+', '0'])).toThrow('Division by zero');
      expect(() => evaluateArithmetic(['12', '/', '(', '3', '-', '3', ')'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['12', '/', '(', '3', '-', '3', ')'])).toThrow('Division by zero');
    });

    test('chained unary signs evaluate correctly in evaluateArithmetic', () => {
      expect(evaluateArithmetic(['-', '-', '5'])).toBe(5);
      expect(evaluateArithmetic(['-', '+', '5'])).toBe(-5);
      expect(evaluateArithmetic(['+', '-', '5'])).toBe(-5);
      expect(evaluateArithmetic(['+', '+', '5'])).toBe(5);
      expect(evaluateArithmetic(['-', '-', '-', '5'])).toBe(-5);
      expect(evaluateArithmetic(['10', '+', '-', '+', '3'])).toBe(7);
      expect(evaluateArithmetic(['1', '-', '-', '1'])).toBe(2);
      expect(evaluateArithmetic(['2', '+', '+', '3'])).toBe(5);
      expect(evaluateArithmetic(['-', '7', '/', '2'])).toBe(-3.5);
      expect(evaluateArithmetic(['2', '*', '-', '-', '3'])).toBe(6);
      expect(evaluateArithmetic(['10', '-', '-', '-', '2'])).toBe(8);
      expect(evaluateArithmetic(['6', '/', '-', '2'])).toBe(-3);
      expect(evaluateArithmetic(['6', '/', '-', '-', '2'])).toBe(3);
      expect(evaluateArithmetic(['6', '/', '-', '+', '2'])).toBe(-3);
    });

    test('operator precedence and left-to-right associativity are strictly respected', () => {
      expect(evaluateArithmetic(['2', '+', '3', '*', '4'])).toBe(14);
      expect(evaluateArithmetic(['2', '*', '3', '+', '4'])).toBe(10);
      expect(evaluateArithmetic(['10', '-', '3', '-', '2'])).toBe(5);
      expect(evaluateArithmetic(['12', '/', '3', '/', '2'])).toBe(2);
      expect(evaluateArithmetic(['12', '/', '3', '*', '2'])).toBe(8);
      expect(evaluateArithmetic(['6', '/', '4', '*', '2'])).toBe(3);
      expect(evaluateArithmetic(['20', '-', '10', '+', '5'])).toBe(15);
      expect(evaluateArithmetic(['20', '-', '10', '-', '5'])).toBe(5);
      expect(evaluateArithmetic(['24', '/', '6', '*', '2', '/', '4'])).toBe(2);
      expect(evaluateArithmetic(['2', '*', '3', '+', '4', '*', '5'])).toBe(26);
      expect(evaluateArithmetic(['10', '-', '2', '*', '3', '+', '8', '/', '4'])).toBe(6);
      expect(evaluateArithmetic(['(', '2', '+', '3', ')', '*', '4'])).toBe(20);
      expect(evaluateArithmetic(['2', '*', '(', '3', '+', '4', ')'])).toBe(14);
      expect(evaluateArithmetic(['10', '-', '(', '3', '-', '2', ')'])).toBe(9);
      expect(evaluateArithmetic(['12', '/', '(', '3', '*', '2', ')'])).toBe(2);
    });

    test('non-finite results throw DiceParserError', () => {
      expect(() => evaluateArithmetic(['1e308', '*', '1e308'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['1e308', '*', '2'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['-', '1e308', '*', '2'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['Infinity'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['-Infinity'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['NaN'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['1', '+', 'Infinity'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['(', '1e308', '*', '2', ')'])).toThrow(DiceParserError);
    });

    test('empty or invalid tokens throw DiceParserError', () => {
      expect(() => evaluateArithmetic([])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['+'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['2', '+'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['*', '2'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['/', '2'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['2', '3'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['(', '2', '+', '3'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['2', '+', '3', ')'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['abc'])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic([''])).toThrow(DiceParserError);
      expect(() => evaluateArithmetic(['   '])).toThrow(DiceParserError);
    });
  });

  describe('Deterministic Tests (Results Validation)', () => {
    test('all results are within valid range', () => {
      for (let i = 0; i < 100; i++) {
        const result = rollDice('5d10');
        expect(result.total).toBeGreaterThanOrEqual(5);
        expect(result.total).toBeLessThanOrEqual(50);

        result.rolls[0].results!.forEach((r) => {
          expect(r).toBeGreaterThanOrEqual(1);
          expect(r).toBeLessThanOrEqual(10);
        });
      }
    });

    test('kept values are correctly filtered', () => {
      for (let i = 0; i < 50; i++) {
        const result = rollDice('4d6kh3');
        const roll = result.rolls[0];

        // Kept should have 3 values
        expect(roll.kept).toHaveLength(3);

        // Kept should be the 3 highest
        const sortedResults = [...roll.results!].sort((a, b) => b - a);
        const expectedKept = sortedResults.slice(0, 3);
        expect(roll.kept!.sort((a, b) => b - a)).toEqual(expectedKept);

        // Total should equal sum of kept
        const keptSum = roll.kept!.reduce((sum, val) => sum + val, 0);
        expect(roll.total).toBe(keptSum);
      }
    });
  });
});

/**
 * The validator and the roller must answer the same question.
 *
 * `parseDiceExpression` exists so callers can ask "would this roll?" without
 * rolling. That is only useful if its answer matches what `rollDice` actually
 * does — and it did not. The validator checked each token in isolation and
 * never checked that the tokens formed a usable expression, so `2d6+` passed
 * validation and then threw when rolled.
 *
 * Every caller validates and then rolls, so the gap meant an expression could
 * clear the gate and fail immediately afterwards. Worse for anything that
 * *stores* a validated expression — a saved dice macro, an initiative
 * fallback — where the failure arrives long after the mistake.
 *
 * This pins the two together. It is a property, not a list: whatever either one
 * decides, the other must decide the same.
 */
describe('parseDiceExpression agrees with rollDice', () => {
  const expressions = [
    // Ordinary things people roll
    '1d20', '2d6+3', '4d6kh3', '1d20+5', '2d20kh1', '2d20kl1', '1d100', '3d8-1',
    '1d12*2', '10d6', '1d6+1d8', '5', '1d20 + 5',
    // Arithmetic precedence, associativity, and chained unary signs
    '6/4*2', '10-3-2', '2+3*4', '2*3+4', '12/3/2', '12/3*2', '20-10+5', '20-10-5',
    '24/6*2/4', '1d1+2*3-4/2', '2*3+4*5', '10-2*3+8/4', '1d1+1d1*2', '1d1*2+1d1',
    '2d1*3/2', '1d1*3/2', '1d1-1', '0*5', '0+0', '0-0', '0/5', '-0',
    '1d1--1', '2++3', '-7/2', '10+-+3', '1d1+-+3', '10---3', '1d1*--3', '2*--3',
    '6/-2', '6/--2', '6/-+2', '2d1*-3', '5+-2', '5-+2', '5--2', '5++2',
    '+5', '-5', '++5', '--5', '+-5', '-+-5', '---5', '1d1 - -1', '10 + - + 3',
    // Division by zero
    '1d6/0', '10/0', '0/0', '4d6/0', '1d20/0', '2d20kh1/0', '10/2/0', '2+1d6/0', '1d6/-0', '10/+0',
    // Malformed in various ways
    '2d6+', '+2d6', '2d6++3', 'dddd', 'invalid', '', '   ', 'd', '2d', 'd6',
    '2d6+-', '()', '2d6*', '/2d6', '1d6/', '/0', '1d6//0', '1d6/*2', '+', '-', '*2', '/2',
    '1d20/(5-5)',
    // Past the limits
    '101d20', '50d6+51d6', '1d1001', '1d0', '1d20+10000',
  ];

  it.each(expressions)('gives the same verdict for %j', (expression) => {
    const validatorAccepts = (() => {
      try { parseDiceExpression(expression); return true; } catch { return false; }
    })();

    const rollerAccepts = (() => {
      try { rollDice(expression); return true; } catch { return false; }
    })();

    expect(validatorAccepts).toBe(rollerAccepts);
  });
});

describe('parseDiceAST', () => {
  describe('Node generation & structures', () => {
    test('single die roll - 1d20', () => {
      const ast = parseDiceAST('1d20');
      expect(ast.expression).toBe('1d20');
      expect(ast.totalDiceCount).toBe(1);
      expect(ast.dice).toHaveLength(1);
      expect(ast.root.type).toBe('dice');
      const root = ast.root as DiceNode;
      expect(root.count).toBe(1);
      expect(root.sides).toBe(20);
      expect(root.notation).toBe('1d20');
    });

    test('multiple dice - 2d6', () => {
      const ast = parseDiceAST('2d6');
      expect(ast.totalDiceCount).toBe(2);
      expect(ast.root.type).toBe('dice');
      const root = ast.root as DiceNode;
      expect(root.count).toBe(2);
      expect(root.sides).toBe(6);
    });

    test('constant integer modifier', () => {
      const ast = parseDiceAST('5');
      expect(ast.totalDiceCount).toBe(0);
      expect(ast.dice).toHaveLength(0);
      expect(ast.root).toEqual({ type: 'modifier', value: 5 });
    });

    test('zero modifier', () => {
      const ast = parseDiceAST('0');
      expect(ast.root).toEqual({ type: 'modifier', value: 0 });
    });

    test('unary negative modifier', () => {
      const ast = parseDiceAST('-5');
      expect(ast.root).toEqual({ type: 'modifier', value: -5 });
    });

    test('unary positive modifier', () => {
      const ast = parseDiceAST('+5');
      expect(ast.root).toEqual({ type: 'modifier', value: 5 });
    });
  });

  describe('Shorthands and normalizations', () => {
    test('implicit die count - d20 -> 1d20', () => {
      const ast = parseDiceAST('d20');
      expect(ast.totalDiceCount).toBe(1);
      const root = ast.root as DiceNode;
      expect(root.count).toBe(1);
      expect(root.sides).toBe(20);
    });

    test('implicit die count - d6 -> 1d6', () => {
      const ast = parseDiceAST('d6');
      const root = ast.root as DiceNode;
      expect(root.count).toBe(1);
      expect(root.sides).toBe(6);
    });

    test('case-insensitivity - 1D20, 2D6', () => {
      const ast1 = parseDiceAST('1D20');
      expect((ast1.root as DiceNode).count).toBe(1);
      expect((ast1.root as DiceNode).sides).toBe(20);

      const ast2 = parseDiceAST('2D6');
      expect((ast2.root as DiceNode).count).toBe(2);
      expect((ast2.root as DiceNode).sides).toBe(6);
    });

    test('adv shorthand -> 2d20kh1', () => {
      const ast = parseDiceAST('adv');
      expect(ast.totalDiceCount).toBe(2);
      const root = ast.root as DiceNode;
      expect(root.count).toBe(2);
      expect(root.sides).toBe(20);
      expect(root.modifier).toBe('kh');
      expect(root.modifierCount).toBe(1);
      expect(root.notation).toBe('2d20kh1');
    });

    test('dis shorthand -> 2d20kl1', () => {
      const ast = parseDiceAST('dis');
      expect(ast.totalDiceCount).toBe(2);
      const root = ast.root as DiceNode;
      expect(root.count).toBe(2);
      expect(root.sides).toBe(20);
      expect(root.modifier).toBe('kl');
      expect(root.modifierCount).toBe(1);
      expect(root.notation).toBe('2d20kl1');
    });

    test('case-insensitive shorthands - ADV, Dis', () => {
      const ast1 = parseDiceAST('ADV');
      expect((ast1.root as DiceNode).modifier).toBe('kh');
      const ast2 = parseDiceAST('Dis');
      expect((ast2.root as DiceNode).modifier).toBe('kl');
    });

    test('percentage dice - d% -> 1d100', () => {
      const ast = parseDiceAST('d%');
      expect(ast.totalDiceCount).toBe(1);
      const root = ast.root as DiceNode;
      expect(root.count).toBe(1);
      expect(root.sides).toBe(100);
    });

    test('percentage dice with count - 2d% -> 2d100', () => {
      const ast = parseDiceAST('2d%');
      expect(ast.totalDiceCount).toBe(2);
      const root = ast.root as DiceNode;
      expect(root.count).toBe(2);
      expect(root.sides).toBe(100);
    });

    test('case-insensitive percentage dice - 3D% -> 3d100', () => {
      const ast = parseDiceAST('3D%');
      expect((ast.root as DiceNode).count).toBe(3);
      expect((ast.root as DiceNode).sides).toBe(100);
    });
  });

  describe('Selection modifiers (kh, kl, dh, dl)', () => {
    test('4d6kh3 - keep highest 3', () => {
      const ast = parseDiceAST('4d6kh3');
      const root = ast.root as DiceNode;
      expect(root.count).toBe(4);
      expect(root.sides).toBe(6);
      expect(root.modifier).toBe('kh');
      expect(root.modifierCount).toBe(3);
    });

    test('4d6kh4 - keep all dice is allowed', () => {
      const ast = parseDiceAST('4d6kh4');
      expect((ast.root as DiceNode).modifierCount).toBe(4);
    });

    test('2d20kl1 - keep lowest 1', () => {
      const ast = parseDiceAST('2d20kl1');
      const root = ast.root as DiceNode;
      expect(root.count).toBe(2);
      expect(root.sides).toBe(20);
      expect(root.modifier).toBe('kl');
      expect(root.modifierCount).toBe(1);
    });

    test('4d6dh1 - drop highest 1', () => {
      const ast = parseDiceAST('4d6dh1');
      const root = ast.root as DiceNode;
      expect(root.count).toBe(4);
      expect(root.sides).toBe(6);
      expect(root.modifier).toBe('dh');
      expect(root.modifierCount).toBe(1);
    });

    test('4d6dl1 - drop lowest 1', () => {
      const ast = parseDiceAST('4d6dl1');
      const root = ast.root as DiceNode;
      expect(root.count).toBe(4);
      expect(root.sides).toBe(6);
      expect(root.modifier).toBe('dl');
      expect(root.modifierCount).toBe(1);
    });

    test('case-insensitive selection modifier - 4d6KH3, 4d6DL1, 4d6DH2', () => {
      expect((parseDiceAST('4d6KH3').root as DiceNode).modifier).toBe('kh');
      expect((parseDiceAST('4d6DL1').root as DiceNode).modifier).toBe('dl');
      expect((parseDiceAST('4d6DH2').root as DiceNode).modifier).toBe('dh');
    });
  });

  describe('Operator precedence and associativity', () => {
    test('binary addition - 1d20+5', () => {
      const ast = parseDiceAST('1d20+5');
      expect(ast.root.type).toBe('binaryOp');
      const root = ast.root as BinaryOpNode;
      expect(root.operator).toBe('+');
      expect(root.op).toBe('+');
      expect(root.left).toMatchObject({ type: 'dice', count: 1, sides: 20 });
      expect(root.right).toMatchObject({ type: 'modifier', value: 5 });
    });

    test('precedence of * over + : 2 + 3 * 4', () => {
      const ast = parseDiceAST('2 + 3 * 4');
      const root = ast.root as BinaryOpNode;
      expect(root.operator).toBe('+');
      expect(root.left).toEqual({ type: 'modifier', value: 2 });
      expect(root.right.type).toBe('binaryOp');
      const right = root.right as BinaryOpNode;
      expect(right.operator).toBe('*');
      expect(right.left).toEqual({ type: 'modifier', value: 3 });
      expect(right.right).toEqual({ type: 'modifier', value: 4 });
    });

    test('precedence of * over + : 2 * 3 + 4', () => {
      const ast = parseDiceAST('2 * 3 + 4');
      const root = ast.root as BinaryOpNode;
      expect(root.operator).toBe('+');
      expect(root.left.type).toBe('binaryOp');
      const left = root.left as BinaryOpNode;
      expect(left.operator).toBe('*');
      expect(left.left).toEqual({ type: 'modifier', value: 2 });
      expect(left.right).toEqual({ type: 'modifier', value: 3 });
      expect(root.right).toEqual({ type: 'modifier', value: 4 });
    });

    test('left-associativity of - : 10 - 3 - 2', () => {
      const ast = parseDiceAST('10 - 3 - 2');
      const root = ast.root as BinaryOpNode;
      expect(root.operator).toBe('-');
      expect(root.left.type).toBe('binaryOp');
      const left = root.left as BinaryOpNode;
      expect(left.operator).toBe('-');
      expect(left.left).toEqual({ type: 'modifier', value: 10 });
      expect(left.right).toEqual({ type: 'modifier', value: 3 });
      expect(root.right).toEqual({ type: 'modifier', value: 2 });
    });

    test('left-associativity of / : 12 / 3 / 2', () => {
      const ast = parseDiceAST('12 / 3 / 2');
      const root = ast.root as BinaryOpNode;
      expect(root.operator).toBe('/');
      expect(root.left.type).toBe('binaryOp');
      const left = root.left as BinaryOpNode;
      expect(left.operator).toBe('/');
      expect(left.left).toEqual({ type: 'modifier', value: 12 });
      expect(left.right).toEqual({ type: 'modifier', value: 3 });
      expect(root.right).toEqual({ type: 'modifier', value: 2 });
    });
  });

  describe('Parenthesis grouping', () => {
    test('overriding precedence with parens - (2 + 3) * 4', () => {
      const ast = parseDiceAST('(2 + 3) * 4');
      const root = ast.root as BinaryOpNode;
      expect(root.operator).toBe('*');
      expect(root.left.type).toBe('binaryOp');
      const left = root.left as BinaryOpNode;
      expect(left.operator).toBe('+');
      expect(left.left).toEqual({ type: 'modifier', value: 2 });
      expect(left.right).toEqual({ type: 'modifier', value: 3 });
      expect(root.right).toEqual({ type: 'modifier', value: 4 });
    });

    test('complex nested parens - ((1d20 + 5) * 2)', () => {
      const ast = parseDiceAST('((1d20 + 5) * 2)');
      const root = ast.root as BinaryOpNode;
      expect(root.operator).toBe('*');
      expect(root.left.type).toBe('binaryOp');
      const left = root.left as BinaryOpNode;
      expect(left.operator).toBe('+');
      expect(left.left).toMatchObject({ type: 'dice', count: 1, sides: 20 });
      expect(left.right).toEqual({ type: 'modifier', value: 5 });
      expect(root.right).toEqual({ type: 'modifier', value: 2 });
    });

    test('single node in parens - (1d20)', () => {
      const ast = parseDiceAST('(1d20)');
      expect(ast.root).toMatchObject({ type: 'dice', count: 1, sides: 20 });
    });
  });

  describe('Chained unary signs and modifiers', () => {
    test('1d20 + -5', () => {
      const ast = parseDiceAST('1d20 + -5');
      const root = ast.root as BinaryOpNode;
      expect(root.operator).toBe('+');
      expect(root.right).toEqual({ type: 'modifier', value: -5 });
    });

    test('1d1 - -1', () => {
      const ast = parseDiceAST('1d1 - -1');
      const root = ast.root as BinaryOpNode;
      expect(root.operator).toBe('-');
      expect(root.right).toEqual({ type: 'modifier', value: -1 });
    });

    test('chained unary signs - 10 + - + 3', () => {
      const ast = parseDiceAST('10 + - + 3');
      const root = ast.root as BinaryOpNode;
      expect(root.operator).toBe('+');
      expect(root.right).toEqual({ type: 'modifier', value: -3 });
    });

    test('double minus unary - --5', () => {
      const ast = parseDiceAST('--5');
      expect(ast.root).toEqual({ type: 'modifier', value: 5 });
    });

    test('triple minus unary - ---5', () => {
      const ast = parseDiceAST('---5');
      expect(ast.root).toEqual({ type: 'modifier', value: -5 });
    });
  });

  describe('Cumulative dice counting', () => {
    test('multi-part dice - 2d6+1d4+3', () => {
      const ast = parseDiceAST('2d6+1d4+3');
      expect(ast.totalDiceCount).toBe(3);
      expect(ast.dice).toHaveLength(2);
      expect(ast.dice[0]).toMatchObject({ count: 2, sides: 6 });
      expect(ast.dice[1]).toMatchObject({ count: 1, sides: 4 });
    });

    test('maximum permitted dice count - 50d6 + 50d6', () => {
      const ast = parseDiceAST('50d6 + 50d6');
      expect(ast.totalDiceCount).toBe(100);
    });
  });

  describe('Static invariant enforcement (errors)', () => {
    test('rejects empty string', () => {
      expect(() => parseDiceAST('')).toThrow(DiceParserError);
      expect(() => parseDiceAST('')).toThrow('Empty expression');
    });

    test('rejects whitespace only', () => {
      expect(() => parseDiceAST('   ')).toThrow(DiceParserError);
      expect(() => parseDiceAST('\t\n')).toThrow('Empty expression');
    });

    test('rejects expression over 200 characters', () => {
      const longExpression = '1d20+'.repeat(50) + '1';
      expect(() => parseDiceAST(longExpression)).toThrow(DiceParserError);
      expect(() => parseDiceAST(longExpression)).toThrow('Expression too long');
    });

    test('rejects single die exceeding 100 count', () => {
      expect(() => parseDiceAST('101d20')).toThrow(DiceParserError);
      expect(() => parseDiceAST('101d20')).toThrow('Too many dice');
    });

    test('rejects cumulative dice exceeding 100', () => {
      expect(() => parseDiceAST('50d6 + 51d6')).toThrow(DiceParserError);
      expect(() => parseDiceAST('50d6 + 51d6')).toThrow('Too many dice');
    });

    test('rejects die sides below 1', () => {
      expect(() => parseDiceAST('1d0')).toThrow(DiceParserError);
      expect(() => parseDiceAST('1d0')).toThrow('Invalid die size');
      expect(() => parseDiceAST('d0')).toThrow('Invalid die size');
    });

    test('rejects die sides above 1000', () => {
      expect(() => parseDiceAST('1d1001')).toThrow(DiceParserError);
      expect(() => parseDiceAST('1d1001')).toThrow('Die size too large');
    });

    test('rejects modifiers outside [-9999, 9999]', () => {
      expect(() => parseDiceAST('1d20 + 10000')).toThrow(DiceParserError);
      expect(() => parseDiceAST('1d20 + 10000')).toThrow('Modifier too large');
      expect(() => parseDiceAST('1d20 - 10000')).toThrow('Modifier too large');
      expect(() => parseDiceAST('10000')).toThrow('Modifier too large');
    });

    test('accepts modifier at boundaries: 9999 and -9999', () => {
      expect(parseDiceAST('1d20 + 9999').totalDiceCount).toBe(1);
      expect(parseDiceAST('1d20 - 9999').totalDiceCount).toBe(1);
      expect(parseDiceAST('9999').totalDiceCount).toBe(0);
      expect(parseDiceAST('-9999').totalDiceCount).toBe(0);
    });

    test('rejects kh selection with count < 1', () => {
      expect(() => parseDiceAST('4d6kh0')).toThrow(DiceParserError);
      expect(() => parseDiceAST('4d6kh0')).toThrow('Invalid keep count');
    });

    test('rejects kh selection with count > count', () => {
      expect(() => parseDiceAST('4d6kh5')).toThrow(DiceParserError);
      expect(() => parseDiceAST('4d6kh5')).toThrow('Invalid keep count');
    });

    test('rejects kl selection bounds', () => {
      expect(() => parseDiceAST('4d6kl0')).toThrow('Invalid keep count');
      expect(() => parseDiceAST('4d6kl5')).toThrow('Invalid keep count');
    });

    test('rejects dh selection with count < 1', () => {
      expect(() => parseDiceAST('4d6dh0')).toThrow(DiceParserError);
      expect(() => parseDiceAST('4d6dh0')).toThrow('Invalid drop count');
    });

    test('rejects dh selection with count >= count', () => {
      expect(() => parseDiceAST('4d6dh4')).toThrow(DiceParserError);
      expect(() => parseDiceAST('4d6dh4')).toThrow('Invalid drop count');
      expect(() => parseDiceAST('4d6dh5')).toThrow('Invalid drop count');
    });

    test('rejects dl selection bounds', () => {
      expect(() => parseDiceAST('4d6dl0')).toThrow('Invalid drop count');
      expect(() => parseDiceAST('4d6dl4')).toThrow('Invalid drop count');
      expect(() => parseDiceAST('4d6dl5')).toThrow('Invalid drop count');
    });

    test('rejects drop on single die (1d6dl1, 1d6dh1)', () => {
      expect(() => parseDiceAST('1d6dl1')).toThrow(DiceParserError);
      expect(() => parseDiceAST('1d6dh1')).toThrow(DiceParserError);
    });

    test('rejects empty or whitespace parentheses', () => {
      expect(() => parseDiceAST('()')).toThrow(DiceParserError);
      expect(() => parseDiceAST('(   )')).toThrow(DiceParserError);
    });

    test('rejects unclosed or unbalanced parentheses', () => {
      expect(() => parseDiceAST('(1d20+5')).toThrow(DiceParserError);
      expect(() => parseDiceAST('1d20+5)')).toThrow(DiceParserError);
    });

    test('rejects incomplete expressions / trailing operators', () => {
      expect(() => parseDiceAST('1d20+')).toThrow(DiceParserError);
      expect(() => parseDiceAST('1d20-')).toThrow(DiceParserError);
      expect(() => parseDiceAST('1d20*')).toThrow(DiceParserError);
      expect(() => parseDiceAST('1d20/')).toThrow(DiceParserError);
    });

    test('rejects double operators (**)', () => {
      expect(() => parseDiceAST('1d20**5')).toThrow(DiceParserError);
    });

    test('rejects invalid tokens and syntax', () => {
      expect(() => parseDiceAST('2x6')).toThrow(DiceParserError);
      expect(() => parseDiceAST('2d')).toThrow(DiceParserError);
      expect(() => parseDiceAST('d')).toThrow(DiceParserError);
      expect(() => parseDiceAST('2d6kh')).toThrow(DiceParserError);
      expect(() => parseDiceAST('4d6dl')).toThrow(DiceParserError);
      expect(() => parseDiceAST('hello world')).toThrow(DiceParserError);
      expect(() => parseDiceAST('1d20 5')).toThrow(DiceParserError);
      expect(() => parseDiceAST('%')).toThrow(DiceParserError);
    });
  });

  describe('Zero RNG guarantee', () => {
    test('does not call Math.random during parseDiceAST', () => {
      const spy = jest.spyOn(Math, 'random');
      parseDiceAST('100d1000 + 4d6kh3 + adv + dis + d%');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
