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

## Out of scope

Video transcoding, AI alt-text suggestions (phase 4).

## Verify

```bash
npm run db:test                         # storage policy tests: user in space A cannot read space B objects
npx nx test api admin-media
npx nx e2e admin-e2e --grep @media      # upload 3 images, set alt + focal point, pick one in a hero block, publish
```

## Definition of done

- [ ] Direct-to-storage uploads with server-side validation
- [ ] Cross-tenant storage access denied (tested)
- [ ] Alt text enforced at publish
