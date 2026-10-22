import { PALE_HEADER_COLOUR_MESSAGE, themeColorSchema } from '../sheetChrome';

describe('themeColorSchema', () => {
  it.each(['Classic Red', 'Teal', 'Victorian Purple', 'Slate Gray', '#b91c1c', '#B91C1C', ''])(
    'accepts %j',
    (value) => expect(themeColorSchema.safeParse(value).success).toBe(true),
  );

  it.each(['#12345', '#12345g', 'red; background: url(x)', '<script>', 'url(javascript:alert(1))', 'x'.repeat(41)])(
    'rejects %j',
    (value) => expect(themeColorSchema.safeParse(value).success).toBe(false),
  );

  it('refuses #FFFF00 as too pale for the light header text', () => {
    const result = themeColorSchema.safeParse('#FFFF00');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(PALE_HEADER_COLOUR_MESSAGE);
    }
  });

  it('refuses #ffff00', () => {
    expect(themeColorSchema.safeParse('#ffff00').success).toBe(false);
  });

  it('accepts the Classic Red preset without a contrast check', () => {
    expect(themeColorSchema.safeParse('Classic Red').success).toBe(true);
  });

  it('is optional', () => {
    expect(themeColorSchema.safeParse(undefined).success).toBe(true);
    expect(themeColorSchema.safeParse('').success).toBe(true);
  });
});
