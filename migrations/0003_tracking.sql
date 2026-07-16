PRAGMA foreign_keys = ON;

-- Per-campaign opt-in flags. Tracking is OFF by default; a campaign must
-- explicitly enable it, and enabling it is disclosed in the compliance footer.
ALTER TABLE campaigns ADD COLUMN track_opens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN track_clicks INTEGER NOT NULL DEFAULT 0;

-- Aggregated open events: one row per (campaign, contact) with a hit counter.
-- Aggregating avoids unbounded growth from Apple Mail Privacy Protection prefetches.
CREATE TABLE email_opens (
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, contact_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);
CREATE INDEX idx_opens_workspace ON email_opens(workspace_id, last_at);

-- Aggregated click events: one row per (campaign, contact, url).
CREATE TABLE email_clicks (
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  url TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, contact_id, url_hash),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);
CREATE INDEX idx_clicks_workspace ON email_clicks(workspace_id, last_at);
CREATE INDEX idx_clicks_campaign ON email_clicks(campaign_id, url_hash);
