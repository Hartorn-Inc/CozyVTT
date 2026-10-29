import { describe, it, expect } from 'vitest';
import { isValidDiceExpression } from '../diceExpression';

describe('isValidDiceExpression', () => {
  it('accepts valid expressions', () => {
    expect(isValidDiceExpression('1d20')).toBe(true);
  });
});
