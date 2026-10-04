import { TestBed } from '@angular/core/testing';
import { FieldFormContext } from '@novan/admin-fields';
import type { Asset } from '@novan/shared-schemas';
import { of } from 'rxjs';
import { MediaApi } from './media-api';
import { MediaPicker } from './media-picker';
import { asset } from './testing';
import { Thumbnails } from './thumbnails';

const spaceId = '00000000-0000-4000-8000-000000000200';

function setup(found: Asset[]) {
  const api = { list: vi.fn(() => of(found)) };
  const thumbnails = {
    urls: vi.fn(async (_s: string, assets: Asset[]) => new Map(assets.map((a) => [a.id, `https://img/${a.id}`]))),
  };
  TestBed.configureTestingModule({
    providers: [
      MediaPicker,
      FieldFormContext,
      { provide: MediaApi, useValue: api },
      { provide: Thumbnails, useValue: thumbnails },
    ],
  });
  const picker = TestBed.inject(MediaPicker);
  const form = TestBed.inject(FieldFormContext);
  picker.connect(form, spaceId);
  return { api, picker, form };
}

describe('MediaPicker', () => {
  it("becomes the form's media source", () => {
    const { picker, form } = setup([]);
    expect(form.media()).toBe(picker);
  });

  it('loads previews by id, and marks files that are no longer in the library', async () => {
    const door = asset(1, { alt: 'A red door' });
    const { api, picker, form } = setup([door]);
    picker.load([door.id, asset(2).id]);
    await vi.waitFor(() => expect(form.assets().size).toBe(2));

    expect(api.list).toHaveBeenCalledWith(spaceId, { ids: `${door.id},${asset(2).id}` });
    expect(form.assets().get(door.id)).toEqual({
      id: door.id,
      filename: 'photo-1.jpg',
      title: 'Photo 1',
      kind: 'image',
      alt: 'A red door',
      thumbnailUrl: `https://img/${door.id}`,
    });
    expect(form.assets().get(asset(2).id)).toBeNull();
    expect(form.assetInfo(door.id)).toEqual({ kind: 'image', alt: 'A red door' });
  });

  it('opens the picker and resolves with the chosen files, or null when cancelled', async () => {
    const { picker, form } = setup([]);
    const choosing = picker.choose({ accept: ['image'], multiple: false, label: 'Hero image' });
    expect(picker.request()).toEqual({ spaceId, accept: ['image'], multiple: false, label: 'Hero image' });

    await picker.finish([asset(3)]);
    expect(await choosing).toEqual([expect.objectContaining({ id: asset(3).id, title: 'Photo 3' })]);
    expect(picker.request()).toBeNull();
    expect(form.assets().has(asset(3).id)).toBe(true);

    const cancelled = picker.choose({ accept: ['file'], multiple: true, label: 'Downloads' });
    await picker.finish(null);
    expect(await cancelled).toBeNull();
  });
});
