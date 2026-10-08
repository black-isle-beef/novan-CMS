import { bridgeEnvelope, parseAdminMessage, parseSiteMessage } from './bridge';

const wrap = (type: string, payload: unknown) => ({ source: 'novan', v: 1, type, payload });

describe('bridge protocol', () => {
  it('reads every site message', () => {
    expect(parseSiteMessage(wrap('ready', { path: '/about', sdkVersion: '0.3.0' }))).toEqual({
      type: 'ready',
      payload: { path: '/about', sdkVersion: '0.3.0' },
    });
    expect(parseSiteMessage(wrap('select', { uid: 'a1' }))).toEqual({ type: 'select', payload: { uid: 'a1' } });
    expect(parseSiteMessage(wrap('hover', { uid: null }))).toEqual({ type: 'hover', payload: { uid: null } });
    expect(parseSiteMessage(wrap('rects', { a1: { x: 0, y: 10, width: 300, height: 40.5, extra: 1 } }))).toEqual({
      type: 'rects',
      payload: { a1: { x: 0, y: 10, width: 300, height: 40.5 } },
    });
    expect(parseSiteMessage(wrap('insert', { uid: 'a1', position: 'after' }))).toEqual({ type: 'insert', payload: { uid: 'a1', position: 'after' } });
    expect(parseSiteMessage(wrap('text', { uid: 'a1', field: 'heading', value: 'Hi', done: false }))).toEqual({
      type: 'text',
      payload: { uid: 'a1', field: 'heading', value: 'Hi', done: false },
    });
  });

  it('reads every admin message', () => {
    expect(parseAdminMessage(wrap('update', { data: { title: 'Hi' } }))).toEqual({ type: 'update', payload: { data: { title: 'Hi' } } });
    expect(parseAdminMessage(wrap('select', { uid: null }))).toEqual({ type: 'select', payload: { uid: null } });
    expect(parseAdminMessage(wrap('hover', { uid: 'b2' }))).toEqual({ type: 'hover', payload: { uid: 'b2' } });
    expect(parseAdminMessage(wrap('scrollTo', { uid: 'b2' }))).toEqual({ type: 'scrollTo', payload: { uid: 'b2' } });
    expect(parseAdminMessage(wrap('token', { token: 'abc.def' }))).toEqual({ type: 'token', payload: { token: 'abc.def' } });
    const fields = [{ field: 'heading', value: 'Hi', multiline: false, extra: 1 }];
    expect(parseAdminMessage(wrap('editable', { uid: 'a1', fields }))).toEqual({
      type: 'editable',
      payload: { uid: 'a1', fields: [{ field: 'heading', value: 'Hi', multiline: false }] },
    });
    expect(parseAdminMessage(wrap('editable', { uid: null, fields: [] }))).toEqual({ type: 'editable', payload: { uid: null, fields: [] } });
  });

  it.each([
    ['not an object', 'ready'],
    ['another source', { ...wrap('select', { uid: 'a' }), source: 'other' }],
    ['another version', { ...wrap('select', { uid: 'a' }), v: 2 }],
    ['an unknown type', wrap('reload', {})],
    ['a missing payload', { source: 'novan', v: 1, type: 'select' }],
    ['an empty uid', wrap('select', { uid: '' })],
    ['a null uid where one is required', wrap('select', { uid: null })],
    ['a long uid', wrap('hover', { uid: 'x'.repeat(101) })],
    ['a rect that is not finite', wrap('rects', { a: { x: Number.NaN, y: 0, width: 1, height: 1 } })],
    ['a rect without a size', wrap('rects', { a: { x: 0, y: 0 } })],
    ['a ready without a version', wrap('ready', { path: '/' })],
    ['an insert in an unknown position', wrap('insert', { uid: 'a', position: 'inside' })],
    ['text for a field with an odd name', wrap('text', { uid: 'a', field: 'x.y', value: '', done: true })],
    ['text without done', wrap('text', { uid: 'a', field: 'heading', value: '' })],
    ['huge text', wrap('text', { uid: 'a', field: 'heading', value: 'x'.repeat(10_001), done: false })],
  ])('ignores %s from the site', (_, data) => {
    expect(parseSiteMessage(data)).toBeNull();
  });

  it.each([
    ['data that is a list', wrap('update', { data: [] })],
    ['an empty token', wrap('token', { token: '' })],
    ['a huge token', wrap('token', { token: 'x'.repeat(4097) })],
    ['a scrollTo without a uid', wrap('scrollTo', { uid: null })],
    ['editable fields that are not a list', wrap('editable', { uid: 'a', fields: {} })],
    ['an editable field without multiline', wrap('editable', { uid: 'a', fields: [{ field: 'heading', value: '' }] })],
    ['too many editable fields', wrap('editable', { uid: 'a', fields: Array(51).fill({ field: 'f', value: '', multiline: false }) })],
    // Site messages are not admin messages.
    ['rects', wrap('rects', {})],
  ])('ignores %s from the admin', (_, data) => {
    expect(parseAdminMessage(data)).toBeNull();
  });

  it('wraps messages so the other side reads them', () => {
    const message = bridgeEnvelope({ type: 'scrollTo', payload: { uid: 'c3' } });
    expect(message).toEqual({ source: 'novan', v: 1, type: 'scrollTo', payload: { uid: 'c3' } });
    expect(parseAdminMessage(message)).toEqual({ type: 'scrollTo', payload: { uid: 'c3' } });
  });
});
