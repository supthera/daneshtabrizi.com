-- Replace Trading Center with Agenda in the application registry.
DELETE FROM applications WHERE id = 'trading-center';

INSERT INTO applications (id, name, description, icon, route, status, version, sort_order)
VALUES (
  'agenda',
  'Dev Agenda',
  'Projects, tasks, and day-to-day operational schedule.',
  'agenda',
  '/private/agenda/',
  'active',
  '0.1.0',
  20
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  route = excluded.route,
  status = excluded.status,
  version = excluded.version,
  sort_order = excluded.sort_order;
