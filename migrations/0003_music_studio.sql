-- Replace Project Center with Music Studio.
DELETE FROM applications WHERE id = 'project-center';

INSERT INTO applications (id, name, description, icon, route, status, version, sort_order)
VALUES (
  'music-studio',
  'Music studio',
  'Private music workspace for tracks, sessions, and studio tools.',
  'music',
  '/private/music/',
  'active',
  '0.1.0',
  30
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  route = excluded.route,
  status = excluded.status,
  version = excluded.version,
  sort_order = excluded.sort_order;
