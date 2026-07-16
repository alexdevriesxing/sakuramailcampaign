PRAGMA foreign_keys = ON;

CREATE TABLE sender_identities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  label TEXT NOT NULL,
  from_name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  reply_to TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, email),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX idx_sender_identities_workspace ON sender_identities(workspace_id, status, created_at);
CREATE UNIQUE INDEX idx_sender_identities_default ON sender_identities(workspace_id) WHERE is_default = 1;

INSERT INTO sender_identities (id, workspace_id, label, from_name, email, reply_to, status, is_default, created_at, updated_at)
SELECT
  'snd_' || lower(hex(randomblob(12))),
  id,
  'Default sender',
  COALESCE(NULLIF(default_from_name, ''), name),
  default_from_email,
  reply_to_email,
  'active',
  1,
  created_at,
  updated_at
FROM workspaces
WHERE default_from_email IS NOT NULL AND default_from_email != '';

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, slug),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX idx_tags_workspace ON tags(workspace_id, name);

CREATE TABLE contact_tags (
  contact_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (contact_id, tag_id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX idx_contact_tags_tag ON contact_tags(tag_id, contact_id);

CREATE TABLE segments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  rules_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX idx_segments_workspace ON segments(workspace_id, updated_at DESC);

ALTER TABLE campaigns ADD COLUMN sender_identity_id TEXT REFERENCES sender_identities(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN segment_id TEXT REFERENCES segments(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN audience_filter_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX idx_contacts_workspace_created ON contacts(workspace_id, created_at DESC);
CREATE INDEX idx_contacts_workspace_first_name ON contacts(workspace_id, first_name);
CREATE INDEX idx_contacts_workspace_last_name ON contacts(workspace_id, last_name);
