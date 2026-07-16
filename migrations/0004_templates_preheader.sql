PRAGMA foreign_keys = ON;

-- Preheader (preview text) shown by inboxes after the subject line.
ALTER TABLE campaigns ADD COLUMN preheader TEXT NOT NULL DEFAULT '';

-- Reusable campaign templates.
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  preheader TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX idx_templates_workspace ON templates(workspace_id, updated_at DESC);
