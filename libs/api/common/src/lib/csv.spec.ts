import { csvFilename, toCsv } from './csv';

describe('toCsv', () => {
  it('quotes every cell and ends lines with CRLF, after a byte order mark', () => {
    expect(toCsv([['Name', 'Note'], ['Ada', 'Said "hi",\nthen left'], [1, true, null]])).toBe(
      '\uFEFF"Name","Note"\r\n"Ada","Said ""hi"",\nthen left"\r\n"1","true",""\r\n',
    );
  });

  it('defuses text that would run as a formula', () => {
    expect(toCsv([['=HYPERLINK("x")', '+1', '-2', '@SUM(A1)', '\tx', 'a=b']])).toBe(
      '\uFEFF"\'=HYPERLINK(""x"")","\'+1","\'-2","\'@SUM(A1)","\'\tx","a=b"\r\n',
    );
  });
});

describe('csvFilename', () => {
  it('keeps names safe for a header', () => {
    expect(csvFilename('Contact us', 'Form "1"')).toBe('contact-us-form-1.csv');
    expect(csvFilename('')).toBe('export.csv');
  });
});
