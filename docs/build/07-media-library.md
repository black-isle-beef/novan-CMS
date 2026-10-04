# 07 — Media library

**Phase:** 1 Headless core · **Estimate:** 3 days · **Prerequisites:** 06

## Goal

Editors upload, organise and pick images and files; images are resized on request and delivered through the CDN; alt text is enforced.

## Data and storage

- Storage bucket `media`, private, path `spaces/<space_id>/<asset_id>/<filename>`. Storage RLS policies on `storage.objects` restrict by the `space_id` path segment and membership.
- Migration `0007_assets.sql`: `assets (id, space_id, path, filename, mime, size_bytes, width, height, focal_x, focal_y, alt, title, tags text[], folder, uploaded_by, created_at, deleted_at)` and `asset_usages (asset_id, entry_id, field_path)` maintained on publish.

## Tasks

1. Upload flow: admin requests a signed upload URL from the API (`POST /assets/upload-url` checks type and size limits per plan: images ≤ 20 MB, other files ≤ 50 MB), uploads directly to Supabase Storage, then calls `POST /assets/complete` which reads dimensions (`sharp` metadata) and creates the row.
2. Reject or sanitise risky files: block HTML and executable types; sanitise SVG with DOMPurify server-side or disallow SVG by default (space setting).
3. Image URLs: the Delivery API returns `{ url, width, height, alt, focal }` and the SDK builds transformed URLs using Supabase image transformations (`/storage/v1/render/image/...?width=&height=&resize=cover&quality=`) served through Cloudflare. Document that image transformations need the Supabase Pro plan; on local/free plans fall back to original URLs.
4. Admin `libs/admin/media`: grid and list views, drag-and-drop multi-upload with progress, folders, tags, search by filename/alt/tags, detail panel (alt, title, focal point picker, usage list), replace file keeping the same asset ID, soft delete with "in use on N pages" warning.
5. Media picker dialog used by `media` fields in forms and the visual editor.
6. Publishing an entry fails validation if a used image has no alt text and the field has `requireAlt`.

## Decisions made during this package

- **Published files are served by the API, not straight from Storage.** The bucket stays private, so a
  browser could only load an object through a signed URL, and those bake the resize options into the
  signature. Instead `GET /v1/assets/:id/:filename?width=&height=&resize=&quality=&v=` serves, without a
  token, only files that are live and used by published content (`asset_usages`). It reads through the
  service role, resizes through Supabase image transformations when `SUPABASE_IMAGE_TRANSFORMS=true`
  (Supabase Pro plan; locally and on free plans the original is sent), and answers with
  `Cache-Control: public, max-age=31536000, immutable` when `v` is the current revision, plus
  `Cache-Tag: asset:<id>`, so Cloudflare caches it. The Delivery API (08) expands `{ assetId, alt }` to
  `{ id, url, filename, mime, width, height, alt, focal }` with `assetUrl()`, and the SDK (09) adds resize
  options with `imageUrl()`; both live in `@novan/shared-schemas`.
- **Nobody writes to the bucket directly.** `POST assets/upload-url` signs an upload to
  `spaces/<space>/<asset>/pending/<filename>`; `POST assets/complete` reads it, checks the type from the
  bytes (not the name), the size against the plan, reads dimensions with `sharp`, and only then writes the
  checked file to `spaces/<space>/<asset>/<filename>` with the content type the API chose. Storage RLS
  lets members read their spaces' files (the admin's thumbnails are signed through the user's session)
  and has no write policies. Replacing a file works the same way and bumps `revision`.
- **Accepted types are an allow-list** (images, MP4/WebM/MOV, PDF, Office, text, CSV, ZIP), checked by
  extension and by magic bytes; programs, scripts and HTML in disguise are refused. **SVG is off by
  default**; a space turns it on with `settings.media.allowSvg = true`, and uploads are then sanitised
  with DOMPurify (no scripts, handlers, embedded HTML or links out of the file). The bucket also refuses
  other MIME types and anything over 50 MB.
- **Authors upload and describe their own files** (alt text, title, tags, folder, focal point), so they
  can fill in what publishing asks for; editors describe any file, replace files and use the bin. RLS and
  an `assets_guard` trigger apply the same rules.
- **Alt text lives in the library; a page may override it.** A media item stays `{ assetId, alt? }`; an
  empty `alt` uses the asset's. `buildEntrySchema` takes an `assets` lookup: a file of a kind the field
  does not accept is refused even in a draft; to publish, every file must still be in the library and a
  `requireAlt` field needs alt text on the item or the asset. Drafts may miss alt text (they may be
  incomplete, as in 06).
- **`asset_usages` records published entries only**, rewritten on publish and cleared on unpublish or
  bin, with field paths that name blocks by `_uid` (`body.<uid>.image`). "In use on N pages" counts
  published pages.
- Folders are a path on the asset (`Brand/Logos`) rather than a table: a folder exists while a file is in
  it. Binned files leave the site at once; they stay restorable for 30 days (purge job in 17).
- `asset.replaced` and `asset.deleted` go out on an in-process `MediaEvents` bus for cache purging (08).
- The visual editor (12) is not built yet, so the picker (`MediaPicker` + `<nv-media-picker>`) is used by
  media fields in forms; the editor's side panel will reuse it.

## Out of scope

Video transcoding, AI alt-text suggestions (phase 4).

## Verify

```bash
npm run db:test                         # storage policy tests: user in space A cannot read space B objects
npx nx test api admin-media
npx nx e2e admin-e2e --grep @media      # upload 3 images, set alt + focal point, pick one in a hero block, publish
```

## Definition of done

- [x] Direct-to-storage uploads with server-side validation
- [x] Cross-tenant storage access denied (tested)
- [x] Alt text enforced at publish
