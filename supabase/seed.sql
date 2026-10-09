-- Local development seed. Runs after migrations on `supabase db reset`.
-- Never run this against staging or production: it creates users with a known password.

-- ---------------------------------------------------------------------------
-- Users (password: password123)
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'agency@novan.test',
    extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', '{"display_name": "Agency User"}', now(), now(),
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'client@novan.test',
    extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', '{"display_name": "Client User"}', now(), now(),
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'novanwebservices@gmail.com',
    extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', '{"display_name": "Novan Admin"}', now(), now(),
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', 'developer@novan.test',
    extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', '{"display_name": "Developer User"}', now(), now(),
    '', '', '', ''
  );

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email in ('agency@novan.test', 'client@novan.test', 'novanwebservices@gmail.com', 'developer@novan.test');

-- The auth.users trigger already created the profiles; mark the agency user as staff. The Novan
-- admin is a space admin but not staff, so browser testing needs no second factor. The developer is
-- an agency developer without staff rights: agency mode through their role alone (package 11).
insert into public.profiles (user_id, display_name, is_agency_staff)
values
  ('00000000-0000-4000-8000-000000000001', 'Agency User', true),
  ('00000000-0000-4000-8000-000000000002', 'Client User', false),
  ('00000000-0000-4000-8000-000000000003', 'Novan Admin', false),
  ('00000000-0000-4000-8000-000000000004', 'Developer User', false)
on conflict (user_id) do update
  set display_name = excluded.display_name, is_agency_staff = excluded.is_agency_staff;

-- Agency staff need a second factor (AAL2). Verified TOTP factor with a known secret, so local
-- sign-in and e2e tests can generate codes: any authenticator app accepts this base32 secret.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at)
values (
  '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
  'Seeded authenticator', 'totp', 'verified', 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', now(), now()
);

-- ---------------------------------------------------------------------------
-- Organisation and space (the space trigger creates `main` and the default roles)
-- ---------------------------------------------------------------------------
insert into public.organisations (id, name)
values ('00000000-0000-4000-8000-000000000100', 'Novan Web Services');

insert into public.spaces (id, organisation_id, name, slug, preview_url)
values (
  '00000000-0000-4000-8000-000000000200', '00000000-0000-4000-8000-000000000100',
  'Demo site', 'demo-site', 'http://localhost:4300'
);

insert into public.members (space_id, user_id, role_id, invited_by)
select s.id, m.user_id, r.id, m.invited_by
from public.spaces s
cross join (
  values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'admin', null::uuid),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'editor', '00000000-0000-4000-8000-000000000001'::uuid),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'admin', '00000000-0000-4000-8000-000000000001'::uuid),
    ('00000000-0000-4000-8000-000000000004'::uuid, 'developer', '00000000-0000-4000-8000-000000000001'::uuid)
) as m (user_id, role_key, invited_by)
join public.roles r on r.space_id = s.id and r.key = m.role_key
where s.slug = 'demo-site';

-- ---------------------------------------------------------------------------
-- Content model (package 05): the `page` type and the five blocks built in package 10.
-- JSON is in the form the API stores (every default filled in), so it parses unchanged with
-- libs/shared/schemas (apps/api/src/app/content-model.spec.ts checks this). Block fields and style
-- options must match the components in libs/blocks.
-- ---------------------------------------------------------------------------
insert into public.content_types (space_id, environment_id, api_id, name, kind, description, fields)
select e.space_id, e.id, 'page', 'Page', 'page', 'A web page built from blocks.', $json$[
  {"id": "title", "apiId": "title", "label": "Title", "type": "text", "required": true, "localised": true,
   "multiline": false, "max": 120},
  {"id": "slug", "apiId": "slug", "label": "Slug", "help": "The last part of the page address, like about-us.",
   "type": "text", "required": true, "localised": true, "multiline": false, "max": 100,
   "pattern": "[a-z0-9]+(-[a-z0-9]+)*"},
  {"id": "seo", "apiId": "seo", "label": "SEO", "help": "How the page appears in search results and when shared.",
   "type": "group", "required": false, "localised": true, "multiple": false, "fields": [
    {"id": "metaTitle", "apiId": "metaTitle", "label": "Search title", "help": "Leave empty to use the page title.",
     "type": "text", "required": false, "localised": true, "multiline": false, "max": 60},
    {"id": "metaDescription", "apiId": "metaDescription", "label": "Search description",
     "help": "One or two sentences on what the page offers. Leave empty to let search engines choose.", "type": "text",
     "required": false, "localised": true, "multiline": true, "max": 160},
    {"id": "ogImage", "apiId": "ogImage", "label": "Sharing image",
     "help": "Shown when the page is shared on social media. Leave empty to use the site's sharing image.",
     "type": "media", "required": false, "localised": false, "accept": ["image"], "multiple": false, "requireAlt": true},
    {"id": "canonical", "apiId": "canonical", "label": "Canonical address",
     "help": "Only when this page copies another: the full address of the original. Leave empty otherwise.",
     "type": "text", "required": false, "localised": false, "multiline": false, "max": 2048, "pattern": "https?://\\S+"},
    {"id": "noindex", "apiId": "noindex", "label": "Hide from search engines", "type": "boolean",
     "required": false, "localised": false, "default": false}
  ]},
  {"id": "body", "apiId": "body", "label": "Content", "type": "blocks", "required": false, "localised": true,
   "allowedBlocks": ["hero", "richText", "image", "featureGrid", "cta"]}
]$json$::jsonb
from public.environments e
join public.spaces s on s.id = e.space_id
where s.slug = 'demo-site' and e.is_main;

insert into public.block_types (space_id, environment_id, api_id, name, icon, fields, style_options)
select e.space_id, e.id, b.api_id, b.name, b.icon, b.fields, b.style_options
from public.environments e
join public.spaces s on s.id = e.space_id
cross join (
  values
    ('hero', 'Hero', 'window-fullscreen', $json$[
      {"id": "heading", "apiId": "heading", "label": "Heading", "type": "text", "required": true, "localised": true,
       "multiline": false, "max": 120},
      {"id": "subheading", "apiId": "subheading", "label": "Subheading", "type": "text", "required": false,
       "localised": true, "multiline": true, "max": 300},
      {"id": "image", "apiId": "image", "label": "Background image", "type": "media", "required": false,
       "localised": false, "accept": ["image"], "multiple": false, "requireAlt": true},
      {"id": "action", "apiId": "action", "label": "Button", "type": "link", "required": false, "localised": true,
       "allowExternal": true, "allowEmail": false}
    ]$json$::jsonb, $json${
      "tone": {"kind": "radio", "label": "Tone", "hint": "Background and text colours.", "default": "brand",
        "options": [{"value": "light", "label": "Light"}, {"value": "brand", "label": "Brand"}, {"value": "dark", "label": "Dark"}]},
      "alignment": {"kind": "radio", "label": "Alignment", "default": "start",
        "options": [{"value": "start", "label": "Left"}, {"value": "center", "label": "Centre"}]},
      "height": {"kind": "select", "label": "Height", "default": "standard",
        "options": [{"value": "compact", "label": "Compact"}, {"value": "standard", "label": "Standard"}, {"value": "tall", "label": "Tall"}]},
      "headingLevel": {"kind": "select", "label": "Heading level", "hint": "Use H1 only for the first block on a page.",
        "default": "h1", "options": [{"value": "h1", "label": "H1"}, {"value": "h2", "label": "H2"}]}
    }$json$::jsonb),
    ('richText', 'Rich text', 'text-paragraph', $json$[
      {"id": "body", "apiId": "body", "label": "Text", "type": "richText", "required": true, "localised": true,
       "marks": ["bold", "italic", "underline", "link"], "nodes": ["heading", "bulletList", "orderedList", "blockquote"]}
    ]$json$::jsonb, $json${
      "width": {"kind": "radio", "label": "Width", "default": "narrow",
        "options": [{"value": "narrow", "label": "Narrow"}, {"value": "wide", "label": "Wide"}]},
      "tone": {"kind": "radio", "label": "Tone", "hint": "Background and text colours.", "default": "light",
        "options": [{"value": "light", "label": "Light"}, {"value": "brand", "label": "Brand"}, {"value": "dark", "label": "Dark"}]}
    }$json$::jsonb),
    ('image', 'Image', 'image', $json$[
      {"id": "image", "apiId": "image", "label": "Image", "type": "media", "required": true, "localised": false,
       "accept": ["image"], "multiple": false, "requireAlt": true},
      {"id": "caption", "apiId": "caption", "label": "Caption", "type": "text", "required": false, "localised": true,
       "multiline": false, "max": 200}
    ]$json$::jsonb, $json${
      "width": {"kind": "select", "label": "Width", "default": "wide",
        "options": [{"value": "narrow", "label": "Narrow"}, {"value": "wide", "label": "Wide"}, {"value": "full", "label": "Full width"}]},
      "rounded": {"kind": "toggle", "label": "Rounded corners", "default": false}
    }$json$::jsonb),
    ('featureGrid', 'Feature grid', 'grid-3x3-gap', $json$[
      {"id": "heading", "apiId": "heading", "label": "Heading", "type": "text", "required": false, "localised": true,
       "multiline": false, "max": 120},
      {"id": "intro", "apiId": "intro", "label": "Introduction", "type": "text", "required": false, "localised": true,
       "multiline": true, "max": 300},
      {"id": "features", "apiId": "features", "label": "Features", "type": "group", "required": true,
       "localised": true, "multiple": true, "min": 1, "max": 12, "fields": [
        {"id": "icon", "apiId": "icon", "label": "Icon", "type": "select", "required": false, "localised": false,
         "multiple": false, "options": [
          {"value": "check-circle", "label": "Tick"}, {"value": "star", "label": "Star"},
          {"value": "lightning", "label": "Lightning"}, {"value": "shield-check", "label": "Shield"},
          {"value": "heart", "label": "Heart"}, {"value": "chat-dots", "label": "Speech bubble"}
        ]},
        {"id": "title", "apiId": "title", "label": "Title", "type": "text", "required": true, "localised": true,
         "multiline": false, "max": 80},
        {"id": "text", "apiId": "text", "label": "Text", "type": "text", "required": false, "localised": true,
         "multiline": true, "max": 240}
      ]}
    ]$json$::jsonb, $json${
      "columns": {"kind": "radio", "label": "Columns", "default": "three",
        "options": [{"value": "two", "label": "2"}, {"value": "three", "label": "3"}, {"value": "four", "label": "4"}]},
      "tone": {"kind": "radio", "label": "Tone", "hint": "Background and text colours.", "default": "light",
        "options": [{"value": "light", "label": "Light"}, {"value": "brand", "label": "Brand"}, {"value": "dark", "label": "Dark"}]},
      "headingLevel": {"kind": "select", "label": "Heading level", "hint": "Keep headings in order on the page.",
        "default": "h2", "options": [{"value": "h2", "label": "H2"}, {"value": "h3", "label": "H3"}, {"value": "h4", "label": "H4"}]}
    }$json$::jsonb),
    ('cta', 'Call to action', 'megaphone', $json$[
      {"id": "heading", "apiId": "heading", "label": "Heading", "type": "text", "required": true, "localised": true,
       "multiline": false, "max": 120},
      {"id": "text", "apiId": "text", "label": "Text", "type": "text", "required": false, "localised": true,
       "multiline": true, "max": 300},
      {"id": "action", "apiId": "action", "label": "Button", "type": "link", "required": true, "localised": true,
       "allowExternal": true, "allowEmail": true}
    ]$json$::jsonb, $json${
      "tone": {"kind": "radio", "label": "Tone", "hint": "Background and text colours.", "default": "brand",
        "options": [{"value": "light", "label": "Light"}, {"value": "brand", "label": "Brand"}, {"value": "dark", "label": "Dark"}]},
      "alignment": {"kind": "radio", "label": "Alignment", "default": "center",
        "options": [{"value": "start", "label": "Left"}, {"value": "center", "label": "Centre"}]},
      "headingLevel": {"kind": "select", "label": "Heading level", "hint": "Keep headings in order on the page.",
        "default": "h2", "options": [{"value": "h2", "label": "H2"}, {"value": "h3", "label": "H3"}, {"value": "h4", "label": "H4"}]}
    }$json$::jsonb)
) as b (api_id, name, icon, fields, style_options)
where s.slug = 'demo-site' and e.is_main;

-- ---------------------------------------------------------------------------
-- Starter site (package 10): the singletons every page uses, the media they show, and three published pages
-- built from all five blocks. Rows are what publishing through the API writes (entries, versions,
-- published_content, asset_usages); data is in the form `buildEntrySchema` stores. A block's `_style` holds
-- its style options (docs/build/10-blocks-starter-site.md); blocks without one use the defaults.
-- ---------------------------------------------------------------------------
insert into public.content_types (space_id, environment_id, api_id, name, kind, description, fields)
select e.space_id, e.id, t.api_id, t.name, 'singleton', t.description, t.fields
from public.environments e
join public.spaces s on s.id = e.space_id
cross join (
  values
    ('navigation', 'Navigation', 'The menu at the top of every page and the links in the footer.', $json$[
      {"id": "items", "apiId": "items", "label": "Main menu", "help": "The links across the top of every page.",
       "type": "group", "required": false, "localised": true, "multiple": true, "max": 8, "fields": [
        {"id": "label", "apiId": "label", "label": "Label", "type": "text", "required": true, "localised": true,
         "multiline": false, "max": 40},
        {"id": "link", "apiId": "link", "label": "Link", "help": "Leave empty for a menu that only opens its sub-links.",
         "type": "link", "required": false, "localised": true, "allowExternal": true, "allowEmail": false},
        {"id": "subItems", "apiId": "subItems", "label": "Sub-links", "type": "group", "required": false,
         "localised": true, "multiple": true, "max": 10, "fields": [
          {"id": "label", "apiId": "label", "label": "Label", "type": "text", "required": true, "localised": true,
           "multiline": false, "max": 40},
          {"id": "link", "apiId": "link", "label": "Link", "type": "link", "required": true, "localised": true,
           "allowExternal": true, "allowEmail": false}
        ]}
      ]},
      {"id": "footerGroups", "apiId": "footerGroups", "label": "Footer links", "help": "Columns of links above the copyright line.",
       "type": "group", "required": false, "localised": true, "multiple": true, "max": 4, "fields": [
        {"id": "title", "apiId": "title", "label": "Title", "type": "text", "required": true, "localised": true,
         "multiline": false, "max": 40},
        {"id": "links", "apiId": "links", "label": "Links", "type": "group", "required": true, "localised": true,
         "multiple": true, "min": 1, "max": 10, "fields": [
          {"id": "label", "apiId": "label", "label": "Label", "type": "text", "required": true, "localised": true,
           "multiline": false, "max": 40},
          {"id": "link", "apiId": "link", "label": "Link", "type": "link", "required": true, "localised": true,
           "allowExternal": true, "allowEmail": true}
        ]}
      ]}
    ]$json$::jsonb),
    ('siteSettings', 'Site settings', 'The site''s name, look in browsers and search results, and how to get in touch.', $json$[
      {"id": "siteName", "apiId": "siteName", "label": "Site name", "help": "Shown in the header and in browser tabs.",
       "type": "text", "required": true, "localised": true, "multiline": false, "max": 60},
      {"id": "organisationName", "apiId": "organisationName", "label": "Organisation name",
       "help": "Shown in the copyright line, and to search engines as who runs the site.", "type": "text", "required": true,
       "localised": false, "multiline": false, "max": 120},
      {"id": "logo", "apiId": "logo", "label": "Logo", "help": "Shown in the header instead of the site name. An SVG or a wide PNG works best.",
       "type": "media", "required": false, "localised": false, "accept": ["image"], "multiple": false, "requireAlt": false},
      {"id": "favicon", "apiId": "favicon", "label": "Browser tab icon",
       "help": "A square image, at least 48 by 48 pixels: a PNG or an SVG.", "type": "media", "required": false,
       "localised": false, "accept": ["image"], "multiple": false, "requireAlt": false},
      {"id": "defaultOgImage", "apiId": "defaultOgImage", "label": "Sharing image",
       "help": "Shown when a page without its own sharing image is shared on social media. 1200 by 630 pixels works best.",
       "type": "media", "required": false, "localised": false, "accept": ["image"], "multiple": false, "requireAlt": true},
      {"id": "contact", "apiId": "contact", "label": "Contact details", "help": "Shown in the footer, and to search engines.",
       "type": "group", "required": false, "localised": false, "multiple": false, "fields": [
        {"id": "email", "apiId": "email", "label": "Email address", "type": "text", "required": false, "localised": false,
         "multiline": false, "max": 254, "pattern": "[^@\\s]+@[^@\\s]+\\.[^@\\s]+"},
        {"id": "phone", "apiId": "phone", "label": "Phone number", "type": "text", "required": false, "localised": false,
         "multiline": false, "max": 40, "pattern": "\\+?[0-9 ()-]{6,40}"},
        {"id": "address", "apiId": "address", "label": "Postal address", "type": "text", "required": false,
         "localised": false, "multiline": true, "max": 300}
      ]},
      {"id": "socialLinks", "apiId": "socialLinks", "label": "Social media", "help": "Your profiles, shown in the footer.",
       "type": "group", "required": false, "localised": false, "multiple": true, "max": 10, "fields": [
        {"id": "network", "apiId": "network", "label": "Network", "type": "select", "required": true, "localised": false,
         "multiple": false, "options": [
          {"value": "facebook", "label": "Facebook"}, {"value": "instagram", "label": "Instagram"},
          {"value": "linkedin", "label": "LinkedIn"}, {"value": "x", "label": "X"},
          {"value": "youtube", "label": "YouTube"}, {"value": "tiktok", "label": "TikTok"},
          {"value": "other", "label": "Other"}
        ]},
        {"id": "url", "apiId": "url", "label": "Profile address", "type": "text", "required": true, "localised": false,
         "multiline": false, "max": 2048, "pattern": "https://\\S+"}
      ]},
      {"id": "analyticsId", "apiId": "analyticsId", "label": "Google Analytics measurement ID",
       "help": "Starts G-, for example G-ABC123XYZ. Leave empty for no analytics.", "type": "text", "required": false,
       "localised": false, "multiline": false, "max": 20, "pattern": "G-[A-Z0-9]{4,16}"}
    ]$json$::jsonb),
    ('notFound', 'Page not found', 'What people see at an address with no page.', $json$[
      {"id": "title", "apiId": "title", "label": "Title", "type": "text", "required": true, "localised": true,
       "multiline": false, "max": 120},
      {"id": "body", "apiId": "body", "label": "Content", "type": "blocks", "required": false, "localised": true,
       "allowedBlocks": ["richText", "cta"]}
    ]$json$::jsonb)
) as t (api_id, name, description, fields)
where s.slug = 'demo-site' and e.is_main;

-- The files are uploaded from supabase/seed/media on `db reset` ([storage.buckets.media] in config.toml).
insert into public.assets (id, space_id, path, filename, mime, size_bytes, width, height, alt, title, tags, uploaded_by)
values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000200',
   'spaces/00000000-0000-4000-8000-000000000200/00000000-0000-4000-8000-000000000501/shapes-navy.jpg',
   'shapes-navy.jpg', 'image/jpeg', 14596, 1920, 960,
   'Abstract illustration of large purple circles on a navy background', 'Navy shapes', '{demo}',
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000200',
   'spaces/00000000-0000-4000-8000-000000000200/00000000-0000-4000-8000-000000000502/shapes-light.jpg',
   'shapes-light.jpg', 'image/jpeg', 24982, 1600, 900,
   'Abstract illustration of overlapping navy, purple and grey circles on a pale background', 'Light shapes', '{demo}',
   '00000000-0000-4000-8000-000000000001');

-- Creates an entry in the demo space's main environment with its first version, and publishes it at `/<slug>`.
create function pg_temp.seed_published_entry(entry_id uuid, type_api_id text, slug text, data jsonb)
returns void
language plpgsql
as $$
declare
  space uuid := '00000000-0000-4000-8000-000000000200';
  author uuid := '00000000-0000-4000-8000-000000000001';
  env uuid;
  type_id uuid;
  version_id uuid := gen_random_uuid();
begin
  select e.id into env from public.environments e where e.space_id = space and e.is_main;
  select t.id into type_id from public.content_types t where t.environment_id = env and t.api_id = type_api_id;

  insert into public.entries (id, space_id, environment_id, content_type_id, slug, locale, created_by)
  values (entry_id, space, env, type_id, slug, 'en-GB', author);
  insert into public.entry_versions (id, entry_id, space_id, data, message, created_by)
  values (version_id, entry_id, space, data, 'Seeded', author);
  update public.entries e
  set current_version_id = version_id, published_version_id = version_id, status = 'published', published_at = now()
  where e.id = entry_id;
  insert into public.published_content
    (entry_id, space_id, environment_id, content_type_api_id, full_path, locale, data, published_at, cache_tags)
  values (
    entry_id, space, env, type_api_id, '/' || slug, 'en-GB', data, now(),
    array['entry:' || entry_id, 'type:' || env || ':' || type_api_id]
  );
end;
$$;

-- Pages: …0701 home (`/`), …0702 about, …0703 contact. Singletons: …0711 navigation, …0712 site settings,
-- …0713 page not found. Block `_uid`s are …09xx.
select pg_temp.seed_published_entry('00000000-0000-4000-8000-000000000701', 'page', 'home', $json${
  "title": "Home",
  "slug": "home",
  "seo": {"metaDescription": "A demo site whose every page comes from Novan CMS.", "noindex": false},
  "body": [
    {"_uid": "00000000-0000-4000-8000-000000000901", "_block": "hero",
     "heading": "Welcome to the Novan demo site",
     "subheading": "Every page here is made of blocks, published from Novan CMS and rendered on the server.",
     "image": {"assetId": "00000000-0000-4000-8000-000000000501"},
     "action": {"type": "internal", "entryId": "00000000-0000-4000-8000-000000000702", "text": "About this site"}},
    {"_uid": "00000000-0000-4000-8000-000000000902", "_block": "featureGrid",
     "heading": "What the starter site shows",
     "intro": "The template every Novan client site starts from.",
     "features": [
       {"icon": "lightning", "title": "Rendered on the server", "text": "Pages arrive as finished HTML, so they load fast and search engines can read them."},
       {"icon": "shield-check", "title": "Cached at the edge", "text": "The CDN keeps each page until someone publishes a change to it."},
       {"icon": "heart", "title": "Accessible by default", "text": "Every block is built to meet WCAG 2.2 AA, whichever style an editor picks."}
     ]},
    {"_uid": "00000000-0000-4000-8000-000000000903", "_block": "cta", "_style": {"tone": "dark"},
     "heading": "Want a site like this?",
     "text": "Tell us what you need and we will show you how it would work.",
     "action": {"type": "internal", "entryId": "00000000-0000-4000-8000-000000000703", "text": "Get in touch"}}
  ]
}$json$::jsonb);

select pg_temp.seed_published_entry('00000000-0000-4000-8000-000000000702', 'page', 'about', $json${
  "title": "About",
  "slug": "about",
  "seo": {"metaDescription": "How the Novan demo site is built.", "noindex": false},
  "body": [
    {"_uid": "00000000-0000-4000-8000-000000000911", "_block": "hero", "_style": {"tone": "light", "height": "compact"},
     "heading": "About this site",
     "subheading": "A small site that shows what each Novan CMS block can do."},
    {"_uid": "00000000-0000-4000-8000-000000000912", "_block": "richText",
     "body": {"type": "doc", "content": [
       {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "How the pages are made"}]},
       {"type": "paragraph", "content": [
         {"type": "text", "text": "Editors build each page from blocks in Novan CMS and press "},
         {"type": "text", "text": "Publish", "marks": [{"type": "bold"}]},
         {"type": "text", "text": ". The site asks the Delivery API for the page, renders it on the server and lets the CDN keep it until the next change."}
       ]},
       {"type": "bulletList", "content": [
         {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Five blocks: hero, rich text, image, feature grid and call to action"}]}]},
         {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Style options chosen from presets, so every page stays on brand"}]}]}
       ]},
       {"type": "paragraph", "content": [
         {"type": "text", "text": "Questions? "},
         {"type": "text", "text": "Contact us", "marks": [{"type": "link", "attrs": {"href": "/contact"}}]},
         {"type": "text", "text": "."}
       ]}
     ]}},
    {"_uid": "00000000-0000-4000-8000-000000000913", "_block": "image", "_style": {"rounded": true},
     "image": {"assetId": "00000000-0000-4000-8000-000000000502"},
     "caption": "Images come from the media library and are resized for each screen."},
    {"_uid": "00000000-0000-4000-8000-000000000914", "_block": "featureGrid", "_style": {"tone": "brand", "columns": "two"},
     "heading": "Five blocks to start with",
     "features": [
       {"icon": "star", "title": "Hero", "text": "The opening banner, with an optional background image."},
       {"icon": "chat-dots", "title": "Rich text", "text": "Headings, lists, quotes and links."},
       {"icon": "check-circle", "title": "Image and feature grid", "text": "A picture with a caption, and lists like this one."},
       {"icon": "lightning", "title": "Call to action", "text": "One clear next step: a page, a website or an email address."}
     ]},
    {"_uid": "00000000-0000-4000-8000-000000000915", "_block": "cta", "_style": {"tone": "light"},
     "heading": "Have a question about the site?",
     "action": {"type": "internal", "entryId": "00000000-0000-4000-8000-000000000703", "text": "Contact us"}}
  ]
}$json$::jsonb);

select pg_temp.seed_published_entry('00000000-0000-4000-8000-000000000703', 'page', 'contact', $json${
  "title": "Contact",
  "slug": "contact",
  "seo": {"metaDescription": "How to reach the team behind the Novan demo site.", "noindex": false},
  "body": [
    {"_uid": "00000000-0000-4000-8000-000000000921", "_block": "hero", "_style": {"tone": "dark", "height": "compact", "alignment": "center"},
     "heading": "Contact",
     "subheading": "Send us a message and we will reply by email."},
    {"_uid": "00000000-0000-4000-8000-000000000922", "_block": "richText", "_style": {"tone": "brand", "width": "wide"},
     "body": {"type": "doc", "content": [
       {"type": "paragraph", "content": [
         {"type": "text", "text": "Email "},
         {"type": "text", "text": "hello@example.com", "marks": [{"type": "link", "attrs": {"href": "mailto:hello@example.com"}}]},
         {"type": "text", "text": " with a few lines about your project. There is no need to have everything worked out."}
       ]}
     ]}},
    {"_uid": "00000000-0000-4000-8000-000000000923", "_block": "cta", "_style": {"tone": "light", "alignment": "start"},
     "heading": "Prefer to write now?",
     "text": "Your email app opens with our address filled in.",
     "action": {"type": "email", "email": "hello@example.com", "text": "Email hello@example.com"}}
  ]
}$json$::jsonb);

select pg_temp.seed_published_entry('00000000-0000-4000-8000-000000000711', 'navigation', 'navigation', $json${
  "items": [
    {"label": "Home", "link": {"type": "internal", "entryId": "00000000-0000-4000-8000-000000000701"}},
    {"label": "About", "link": {"type": "internal", "entryId": "00000000-0000-4000-8000-000000000702"}},
    {"label": "Contact", "link": {"type": "internal", "entryId": "00000000-0000-4000-8000-000000000703"}}
  ],
  "footerGroups": [
    {"title": "This site", "links": [
      {"label": "About", "link": {"type": "internal", "entryId": "00000000-0000-4000-8000-000000000702"}},
      {"label": "Contact", "link": {"type": "internal", "entryId": "00000000-0000-4000-8000-000000000703"}}
    ]},
    {"title": "Get in touch", "links": [
      {"label": "Email us", "link": {"type": "email", "email": "hello@example.com"}}
    ]}
  ]
}$json$::jsonb);

select pg_temp.seed_published_entry('00000000-0000-4000-8000-000000000712', 'siteSettings', 'site-settings', $json${
  "siteName": "Novan demo site",
  "organisationName": "Novan Web Services",
  "defaultOgImage": {"assetId": "00000000-0000-4000-8000-000000000501"},
  "contact": {"email": "hello@example.com"},
  "socialLinks": [{"network": "linkedin", "url": "https://www.linkedin.com/company/example"}]
}$json$::jsonb);

select pg_temp.seed_published_entry('00000000-0000-4000-8000-000000000713', 'notFound', 'not-found', $json${
  "title": "Page not found",
  "body": [
    {"_uid": "00000000-0000-4000-8000-000000000931", "_block": "richText", "_style": {"tone": "dark", "width": "wide"},
     "body": {"type": "doc", "content": [
       {"type": "paragraph", "content": [
         {"type": "text", "text": "There is no page at this address. It may have moved, or the link may be mistyped. The "},
         {"type": "text", "text": "contact page", "marks": [{"type": "link", "attrs": {"href": "/contact"}}]},
         {"type": "text", "text": " can help."}
       ]}
     ]}},
    {"_uid": "00000000-0000-4000-8000-000000000932", "_block": "cta", "_style": {"tone": "light"},
     "heading": "Start again from the home page",
     "action": {"type": "internal", "entryId": "00000000-0000-4000-8000-000000000701", "text": "Go to the home page"}}
  ]
}$json$::jsonb);

insert into public.asset_usages (asset_id, entry_id, space_id, field_path)
values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000200',
   'body.00000000-0000-4000-8000-000000000901.image'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000200',
   'body.00000000-0000-4000-8000-000000000913.image'),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000712', '00000000-0000-4000-8000-000000000200',
   'defaultOgImage');

-- A redirect from an address the demo site used to have (package 14).
insert into public.redirects (space_id, from_path, to_path, status, created_by)
values ('00000000-0000-4000-8000-000000000200', '/about-us', '/about', 301, '00000000-0000-4000-8000-000000000001');

-- The starter site's delivery and preview tokens, for local development only (NOVAN_DELIVERY_TOKEN and
-- NOVAN_PREVIEW_TOKEN in .env.example). They are fixed, public values so `npm run db:reset` leaves the site and
-- the visual editor working; real tokens are created in the admin.
insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint, created_by)
select e.space_id, e.id, t.name, t.scope, encode(extensions.digest(t.token, 'sha256'), 'hex'), t.hint,
  '00000000-0000-4000-8000-000000000001'
from public.environments e
join public.spaces s on s.id = e.space_id
cross join (values
  ('Starter site (local)', 'delivery', 'nv_del_LocalStarterSiteDeliveryTokenSeedOnly000000', 'nv_del_…0000'),
  ('Starter site previews (local)', 'preview', 'nv_pre_LocalStarterSitePreviewTokenSeedOnly0000000', 'nv_pre_…0000')
) as t (name, scope, token, hint)
where s.slug = 'demo-site' and e.is_main;
