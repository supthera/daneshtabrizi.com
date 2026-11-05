# Security checklist

- [ ] Cloudflare Access app covers `/private*` and `/api*`
- [ ] Only your Gmail (or explicit allowlist) in Access policy
- [ ] Public registration disabled
- [ ] `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` set as Pages secrets
- [ ] `DEV_AUTH_BYPASS` unset / false in production
- [ ] D1 bound; migrations applied remotely
- [ ] Destination API tokens only in Worker secrets (not D1 plaintext, not frontend)
- [ ] R2 bucket private; no public listing
- [ ] Always Use HTTPS enabled on the zone
- [ ] Audit logs reviewed for publish / website mutations
- [ ] WASD treated as discovery only — never as auth
