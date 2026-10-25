import { classGroupOf } from './class-groups';

describe('class groups', () => {
  it.each([
    ['px-3', 'spacing'],
    ['mt-auto', 'spacing'],
    ['d-md-none', 'display'],
    ['justify-content-between', 'flex'],
    ['col-md-6', 'grid'],
    ['row', 'grid'],
    ['w-100', 'sizing'],
    ['position-absolute', 'position'],
    ['rounded-3', 'borders'],
    ['border-primary', 'colour'],
    ['shadow-lg', 'shadow'],
    ['text-center', 'typography'],
    ['text-primary', 'colour'],
    ['text-body-secondary', 'colour'],
    ['fs-4', 'typography'],
    ['bg-dark', 'colour'],
    ['btn-outline-primary', 'buttons'],
    ['form-control', 'forms'],
    ['card-body', 'components'],
    ['md:px-8', 'spacing'],
    ['hover:bg-white', 'colour'],
  ])('puts %s in %s', (name, group) => expect(classGroupOf(name)).toBe(group));

  it('leaves classes it does not recognise ungrouped', () => {
    expect(classGroupOf('acme-hero')).toBeNull();
    expect(classGroupOf('columns')).toBeNull();
  });

  it("prefers the manifest's own groups", () => {
    expect(classGroupOf('acme-hero', { marketing: ['acme-'] })).toBe('marketing');
    expect(classGroupOf('px-3', { layout: ['px-3'] })).toBe('layout');
    expect(classGroupOf('px-4', { layout: ['px-3'] })).toBe('spacing');
  });
});
