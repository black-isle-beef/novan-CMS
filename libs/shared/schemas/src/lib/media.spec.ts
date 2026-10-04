import {
  assetFolderSchema,
  assetTagsSchema,
  assetUrl,
  fileTypeOf,
  formatBytes,
  imageTransformSchema,
  imageUrl,
  listAssetsQuerySchema,
  safeFilename,
  titleFromFilename,
  updateAssetRequestSchema,
  uploadLimit,
} from './media';

const MB = 1024 * 1024;

describe('media library', () => {
  it('knows the accepted file types by extension, and nothing else', () => {
    expect(fileTypeOf('Photo.JPG')).toEqual({ extension: 'jpg', mime: 'image/jpeg', kind: 'image' });
    expect(fileTypeOf('clip.mp4')).toMatchObject({ kind: 'video' });
    expect(fileTypeOf('menu.pdf')).toMatchObject({ mime: 'application/pdf', kind: 'file' });
    for (const name of ['page.html', 'page.htm', 'run.exe', 'script.js', 'setup.msi', 'noextension', 'shell.sh']) {
      expect(fileTypeOf(name)).toBeNull();
    }
  });

  it('limits uploads by plan: images to 20 MB, other files to 50 MB', () => {
    expect(uploadLimit('agency', 'image')).toBe(20 * MB);
    expect(uploadLimit(null, 'video')).toBe(50 * MB);
    expect(formatBytes(20 * MB)).toBe('20 MB');
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it.each([
    ['Café menu (2).PDF', 'Cafe-menu-2.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\hero image.png', 'hero-image.png'],
    ['.hidden', 'hidden'],
    ['---.jpg', 'file.jpg'],
    ['a'.repeat(300) + '.jpeg', 'a'.repeat(145) + '.jpeg'],
  ])('makes %j a safe file name', (name, safe) => {
    expect(safeFilename(name)).toBe(safe);
    expect(safeFilename(name)).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/);
  });

  it('titles a file from its name', () => {
    expect(titleFromFilename('team_photo-2026.jpg')).toBe('team photo 2026');
  });

  it('tidies folders and tags', () => {
    expect(assetFolderSchema.parse(' Brand / Logos/ ')).toBe('Brand/Logos');
    expect(assetFolderSchema.safeParse('//').success).toBe(false);
    expect(assetTagsSchema.parse(['News', 'news ', 'team'])).toEqual(['news', 'team']);
  });

  it('describing an asset needs something to change, and a focal point inside the image', () => {
    expect(updateAssetRequestSchema.safeParse({}).success).toBe(false);
    expect(updateAssetRequestSchema.safeParse({ focal: { x: 1.2, y: 0.5 } }).success).toBe(false);
    expect(updateAssetRequestSchema.parse({ alt: ' A red door ', focal: null })).toEqual({
      alt: 'A red door',
      focal: null,
    });
  });

  it('reads a list of ids for previews', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(listAssetsQuerySchema.parse({ ids: `${id},${id}` })).toMatchObject({ ids: [id, id], deleted: false });
    expect(listAssetsQuerySchema.safeParse({ ids: 'nope' }).success).toBe(false);
  });

  describe('image URLs', () => {
    const asset = { id: '00000000-0000-4000-8000-000000000001', filename: 'hero image.jpg', revision: 3 };

    it('points at the API image route, changing with each replacement', () => {
      expect(assetUrl('https://api.example.com/', asset)).toBe(
        'https://api.example.com/v1/assets/00000000-0000-4000-8000-000000000001/hero%20image.jpg?v=3',
      );
    });

    it('adds resize options and keeps the revision', () => {
      const url = imageUrl(
        { url: assetUrl('https://api.example.com', asset) },
        { width: 800, resize: 'cover', quality: 75 },
      );
      expect(new URL(url).searchParams.toString()).toBe('v=3&width=800&resize=cover&quality=75');
      expect(imageUrl({ url }, { height: 200 })).toContain('?v=3&height=200');
    });

    it('checks resize options on the way in', () => {
      expect(imageTransformSchema.parse({ width: '640', v: '2' })).toEqual({ width: 640, v: 2 });
      expect(imageTransformSchema.safeParse({ width: '99999' }).success).toBe(false);
      expect(imageTransformSchema.safeParse({ resize: 'stretch' }).success).toBe(false);
      expect(imageTransformSchema.safeParse({ format: 'png' }).success).toBe(false);
    });
  });
});
