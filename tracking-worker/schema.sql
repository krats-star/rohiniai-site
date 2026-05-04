CREATE TABLE IF NOT EXISTS click_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  slug TEXT NOT NULL,
  click_type TEXT NOT NULL,
  destination_label TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  device TEXT,
  visitor_hash TEXT,
  referrer_host TEXT
);

CREATE INDEX IF NOT EXISTS idx_click_events_created_at ON click_events(created_at);
CREATE INDEX IF NOT EXISTS idx_click_events_slug ON click_events(slug);
CREATE INDEX IF NOT EXISTS idx_click_events_type ON click_events(click_type);
CREATE INDEX IF NOT EXISTS idx_click_events_region ON click_events(country, region);
CREATE INDEX IF NOT EXISTS idx_click_events_visitor ON click_events(visitor_hash);
