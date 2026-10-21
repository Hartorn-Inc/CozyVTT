# Setup is a CLI, not a browser wizard

The first **Administrator** is created by a CLI that already has database access (`./backend/scripts/setup.sh` in Docker, `npm run setup` otherwise). There is no public `POST /api/setup/init` and no setup token: whoever can run the process owns the **Instance**. **Setup** writes only that Administrator; instance name and public registration stay at their defaults. After it succeeds, the operator signs in normally. A browser that arrives before Setup sees the login page without the form, and a short "not ready" signal — not a tutorial. `SETUP_ADMIN_DISPLAY_NAME`, `SETUP_ADMIN_EMAIL`, and `SETUP_ADMIN_PASSWORD` may fill those prompts for a one-shot command; they are not `.env` settings.

We rejected keeping a web wizard (even a shorter one, or a claim URL): it is a privileged public endpoint that then needs a secret the operator already has in the shell. We rejected keeping both CLI and wizard: the token and the attack surface would remain.

**Status**: accepted
