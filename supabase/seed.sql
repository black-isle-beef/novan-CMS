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
  );

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email in ('agency@novan.test', 'client@novan.test');

-- The auth.users trigger already created both profiles; mark the agency user as staff.
insert into public.profiles (user_id, display_name, is_agency_staff)
values
  ('00000000-0000-4000-8000-000000000001', 'Agency User', true),
  ('00000000-0000-4000-8000-000000000002', 'Client User', false)
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
    ('00000000-0000-4000-8000-000000000002'::uuid, 'editor', '00000000-0000-4000-8000-000000000001'::uuid)
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
    {"id": "metaDescription", "apiId": "metaDescription", "label": "Search description", "type": "text",
     "required": false, "localised": true, "multiline": true, "max": 160},
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
