import { ProblemException } from '@novan/api-common';
import { fileTypeOf } from '@novan/shared-schemas';
import sharp from 'sharp';
import { inspectFile, sanitizeSvg, svgSize } from './file-inspector';

const typeOf = (name: string) => {
  const type = fileTypeOf(name);
  if (!type) throw new Error(`no type for ${name}`);
  return type;
};

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#c00' } })
    .png()
    .toBuffer();

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProblemException) return error.code;
    throw error;
  }
  throw new Error('expected the file to be refused');
}

describe('inspectFile', () => {
  it('reads the size of a real image', async () => {
    const file = await inspectFile(await png(40, 30), typeOf('a.png'));
    expect(file).toMatchObject({ mime: 'image/png', width: 40, height: 30 });
  });

  it('reads JPEG, WebP and GIF, and the frame size of an animation', async () => {
    const base = sharp({ create: { width: 8, height: 6, channels: 3, background: '#00c' } });
    expect(await inspectFile(await base.clone().jpeg().toBuffer(), typeOf('a.jpg'))).toMatchObject({
      width: 8,
      height: 6,
    });
    expect(await inspectFile(await base.clone().webp().toBuffer(), typeOf('a.webp'))).toMatchObject({
      width: 8,
      height: 6,
    });
    const frames = await sharp({ create: { width: 8, height: 18, channels: 4, background: '#0c0' } })
      .gif({ loop: 0 })
      .toBuffer();
    const animated = await sharp(frames, { animated: true }).gif().toBuffer();
    expect(await inspectFile(animated, typeOf('a.gif'))).toMatchObject({ width: 8 });
  });

  it('swaps width and height for photos stored on their side', async () => {
    const rotated = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c00' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(await inspectFile(rotated, typeOf('a.jpg'))).toMatchObject({ width: 30, height: 40 });
  });

  it.each([
    ['an HTML page named .png', Buffer.from('<!doctype html><script>alert(1)</script>'), 'a.png', 'file_type_mismatch'],
    ['a PNG named .jpg', null, 'a.jpg', 'file_type_mismatch'],
    ['a Windows program named .pdf', Buffer.from('MZ\x90\x00rest'), 'a.pdf', 'file_unsafe'],
    ['a Linux program named .png', Buffer.from('\x7fELF\x02\x01', 'latin1'), 'a.png', 'file_unsafe'],
    ['a shell script named .txt', Buffer.from('#!/bin/sh\nrm -rf /'), 'a.txt', 'file_unsafe'],
    [
      'an HTML page named .txt',
      Buffer.from('  <html><body onload="x()"></body></html>'),
      'notes.txt',
      'file_type_mismatch',
    ],
    ['an HTML page named .csv', Buffer.from('<!-- hi --><script>alert(1)</script>'), 'data.csv', 'file_type_mismatch'],
    ['text named .pdf', Buffer.from('hello'), 'a.pdf', 'file_type_mismatch'],
    ['binary named .txt', Buffer.from([0x00, 0x01, 0x02]), 'a.txt', 'file_type_mismatch'],
    ['nothing', Buffer.alloc(0), 'a.png', 'file_empty'],
  ])('refuses %s', async (_what, bytes, name, code) => {
    expect(await refusal(inspectFile(bytes ?? (await png(4, 4)), typeOf(name)))).toBe(code);
  });

  it('accepts documents by their signature', async () => {
    expect(await inspectFile(Buffer.from('%PDF-1.7\n...'), typeOf('a.pdf'))).toMatchObject({
      mime: 'application/pdf',
      width: null,
    });
    expect(await inspectFile(Buffer.from('PK\x03\x04rest', 'latin1'), typeOf('a.docx'))).toMatchObject({ width: null });
    expect(await inspectFile(Buffer.from('name,age\nAda,36\n'), typeOf('a.csv'))).toMatchObject({ mime: 'text/csv' });
    expect(await inspectFile(Buffer.from('\x00\x00\x00\x18ftypmp42', 'latin1'), typeOf('a.mp4'))).toMatchObject({
      mime: 'video/mp4',
    });
  });
});

describe('SVG', () => {
  const evil = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="80" onload="alert(1)">
  <script>alert(2)</script>
  <a href="javascript:alert(3)"><rect width="10" height="10" fill="red" onclick="alert(4)"/></a>
  <image href="https://tracker.example/pixel.png" width="1" height="1"/>
  <foreignObject><iframe src="https://example.com"></iframe></foreignObject>
  <linearGradient id="fade"><stop offset="0" stop-color="#fff"/></linearGradient>
  <circle id="dot" cx="5" cy="5" r="4" fill="url(#fade)"/>
</svg>`;

  it('removes scripts, handlers, external links and embedded HTML, and keeps the drawing', () => {
    const clean = sanitizeSvg(evil) as string;
    expect(clean).not.toMatch(/script|onload|onclick|javascript:|tracker\.example|foreignObject|iframe|ENTITY|passwd/i);
    expect(clean).toMatch(/<rect width="10" height="10" fill="red"/);
    expect(clean).toMatch(/<circle id="dot" cx="5" cy="5" r="4" fill="url\(#fade\)"/);
    expect(clean).toContain('<linearGradient id="fade">');
  });

  it('refuses something that is not an SVG', () => {
    expect(sanitizeSvg('<html><body>hi</body></html>')).toBeNull();
  });

  it('reads the size from width and height, else the viewBox', () => {
    expect(svgSize('<svg width="120" height="80px"></svg>')).toEqual({ width: 120, height: 80 });
    expect(svgSize('<svg width="100%" viewBox="0 0 24 12"></svg>')).toEqual({ width: 24, height: 12 });
    expect(svgSize('<svg></svg>')).toBeNull();
  });

  it('inspects to the sanitised bytes', async () => {
    const file = await inspectFile(Buffer.from(evil), typeOf('logo.svg'));
    expect(file).toMatchObject({ mime: 'image/svg+xml', width: 120, height: 80 });
    expect(file.bytes.toString()).not.toContain('alert');
  });
});
