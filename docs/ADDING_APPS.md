# Adding a future application

1. Create UI: `/private/<app-id>/index.html` (reuse `/private/assets/private.css`).
2. Register the app:
   - Preferred: `INSERT INTO applications (...)` via D1, or
   - Temporary: append to `FALLBACK_APPS` in `functions/lib/apps.ts`.
3. Add APIs under `functions/api/<app>/` if needed.
4. New tables → new file in `migrations/` (do not reuse Publisher HQ tables unless shared on purpose).
5. Protect routes: anything under `/private/` and `/api/` is already gated by Access + middleware.
6. Optional: app-specific permissions in `application_permissions`.

Planned apps (Trading Center, Project Center) stay `status = 'planned'` with no fake features.
