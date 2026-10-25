CREATE TABLE homepage_drafts (
  key text PRIMARY KEY DEFAULT 'default',
  sections jsonb NOT NULL,
  revision integer DEFAULT 1 NOT NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT homepage_drafts_key_singleton CHECK (key = 'default'),
  CONSTRAINT homepage_drafts_revision_positive CHECK (revision >= 1),
  CONSTRAINT homepage_drafts_sections_array CHECK (jsonb_typeof(sections) = 'array')
);
--> statement-breakpoint
INSERT INTO homepage_drafts (key, sections, revision) VALUES ('default', '[]'::jsonb, 1) ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
CREATE TABLE homepage_publications (
  id text PRIMARY KEY,
  version integer NOT NULL,
  source_draft_revision integer NOT NULL,
  sections jsonb NOT NULL,
  published_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT homepage_publications_version_positive CHECK (version >= 1),
  CONSTRAINT homepage_publications_sections_array CHECK (jsonb_typeof(sections) = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX homepage_publications_version_uq ON homepage_publications(version);
--> statement-breakpoint
CREATE INDEX homepage_publications_published_at_idx ON homepage_publications(published_at);

