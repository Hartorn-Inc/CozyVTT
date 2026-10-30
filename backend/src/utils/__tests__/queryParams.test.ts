import { readScalarQuery } from '../queryParams';

describe('readScalarQuery', () => {
  it('returns ok with undefined when parameter is omitted', () => {
    expect(readScalarQuery(undefined, 'search')).toEqual({ ok: true, value: undefined });
  });

  it('returns ok with string value when parameter is a single string', () => {
    expect(readScalarQuery('dragon', 'search')).toEqual({ ok: true, value: 'dragon' });
    expect(readScalarQuery('', 'search')).toEqual({ ok: true, value: '' });
  });

  it('returns an error when parameter is specified multiple times as an array', () => {
    expect(readScalarQuery(['a', 'b'], 'search')).toEqual({
      ok: false,
      message: 'Parameter "search" cannot be specified multiple times.',
    });
  });

  it('returns an error when parameter is not a string or array', () => {
    expect(readScalarQuery({ nested: 'value' }, 'search')).toEqual({
      ok: false,
      message: 'Parameter "search" must be a string.',
    });
  });
});
