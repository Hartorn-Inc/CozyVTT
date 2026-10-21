.DEFAULT_GOAL := help

# GNU make does not escape spaces in MAKEFILE_LIST for make functions. Passing
# the complete, self-contained Makefile path through a quoted shell command
# keeps spaces intact; this file deliberately has no included makefiles.
MAKEFILE_PATH := $(shell realpath -- "$(MAKEFILE_LIST)")
REPO_DIR := $(shell dirname -- "$(MAKEFILE_PATH)")
PROJECT_HASH := $(shell printf '%s' "$(REPO_DIR)" | sha256sum | cut -c1-12)
DEV_PROJECT := cozyvtt-dev-$(PROJECT_HASH)
LEGACY_PROJECT := cozyvtt
COMPOSE_FILE := $(REPO_DIR)/docker-compose.dev.yml
ENV_FILE := $(REPO_DIR)/.env
ENV_EXAMPLE := $(REPO_DIR)/.env.example
COMPOSE_ENV_FILE := $(shell if [ -f "$(ENV_FILE)" ]; then printf '%s' '--env-file "$(ENV_FILE)"'; fi)
DC ?= docker compose
DEV_COMPOSE := $(DC) --project-name $(DEV_PROJECT) --project-directory "$(REPO_DIR)" $(COMPOSE_ENV_FILE) -f "$(COMPOSE_FILE)"
LEGACY_COMPOSE := $(DC) --project-name $(LEGACY_PROJECT) --project-directory "$(REPO_DIR)" $(COMPOSE_ENV_FILE) -f "$(COMPOSE_FILE)"
UPLOADS_DIR := $(REPO_DIR)/backend/uploads-dev
BACKUPS_DIR := $(REPO_DIR)/backend/backups-dev
PRODUCTION_CONTAINERS := cozyvtt-database cozyvtt-backend cozyvtt-frontend cozyvtt-nginx

.PHONY: help require-env preflight legacy-check legacy-stop setup up start down logs print-project

help: ## Display available development commands
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make <target>\n\nTargets:\n"} /^[a-zA-Z][a-zA-Z0-9_-]*:.*##/ {printf "  %-12s %s\n", $$1, $$2}' "$(MAKEFILE_PATH)"

require-env:
	@set -eu; \
	env_file="$(ENV_FILE)"; \
	if [ "$${DEV_SESSION_SECRET+x}" = x ] || [ "$${SESSION_SECRET+x}" = x ]; then \
		echo "Refusing exported session-secret overrides; set both session values only in $$env_file." >&2; \
		exit 1; \
	fi; \
	if [ -L "$$env_file" ] || [ ! -f "$$env_file" ]; then \
		echo "Missing or unsafe .env: it must be a regular, non-symlink file at $$env_file." >&2; \
		echo "Copy $(ENV_EXAMPLE) to $$env_file, run 'chmod 600 $$env_file', set DEV_SESSION_SECRET, then run 'make up'." >&2; \
		exit 1; \
	fi; \
	mode=$$(stat -c '%a' -- "$$env_file" 2>/dev/null || true); \
	if [ "$$mode" != "600" ]; then \
		echo "Refusing to use $$env_file: set its mode to 0600 with 'chmod 600 $$env_file'." >&2; \
		exit 1; \
	fi; \
	compose_environment=$$($(DEV_COMPOSE) config --environment); \
	dev_session_secret=$$(printf '%s\n' "$$compose_environment" | awk -F= '$$1 == "DEV_SESSION_SECRET" {print substr($$0, index($$0, "=") + 1); exit}'); \
	case "$$dev_session_secret" in \
		""|"\"\""|"''"|CHANGE_ME_TO_A_DIFFERENT_DEV_SECRET_32_CHARS_MIN|CHANGE_ME_TO_RANDOM_STRING_32_CHARS_MIN|development-secret-change-in-production|CHANGE_ME_TO_RANDOM_STRING|your-64-char-random-string|"<paste the 64 characters that command prints>"|dev-session-secret-change-in-production-please) \
			echo "Missing DEV_SESSION_SECRET in $$env_file; set a development-only session secret." >&2; \
			exit 1; \
			;; \
	esac; \
	if [ "$${#dev_session_secret}" -lt 32 ]; then \
		echo "DEV_SESSION_SECRET must be at least 32 characters." >&2; \
		exit 1; \
	fi; \
	root_session_secret=$$(printf '%s\n' "$$compose_environment" | awk -F= '$$1 == "SESSION_SECRET" {print substr($$0, index($$0, "=") + 1); exit}'); \
	if [ -n "$$root_session_secret" ] && [ "$$dev_session_secret" = "$$root_session_secret" ]; then \
		echo "Refusing to use DEV_SESSION_SECRET equal to production SESSION_SECRET; set a separate development secret." >&2; \
		exit 1; \
	fi

preflight:
	@set -eu; \
	repo="$(REPO_DIR)"; \
	backend_root="$$repo/backend"; \
	if [ -L "$$backend_root" ] || [ ! -d "$$backend_root" ]; then \
		echo "Refusing setup: $$backend_root is not the repository backend directory." >&2; \
		exit 1; \
	fi; \
	if ! command -v findmnt >/dev/null 2>&1; then \
		echo "Refusing setup: findmnt (util-linux) is required for mount-boundary checks." >&2; \
		exit 1; \
	fi; \
	for path in "$$backend_root/uploads-dev" "$$backend_root/backups-dev"; do \
		if [ -L "$$path" ]; then \
			echo "Refusing setup: $$path is a symlink." >&2; \
			exit 1; \
		fi; \
		if [ -e "$$path" ]; then \
			if [ ! -d "$$path" ]; then \
				echo "Refusing setup: $$path is not a directory." >&2; \
				exit 1; \
			fi; \
			resolved=$$(cd "$$path" && pwd -P); \
			case "$$resolved/" in \
				"$$backend_root/"*) ;; \
				*) \
					echo "Refusing setup: $$path resolves outside $$backend_root." >&2; \
					exit 1; \
					;; \
			esac; \
			nested_link=$$(find "$$path" -type l -print -quit 2>/dev/null); \
			if [ -n "$$nested_link" ]; then \
				echo "Refusing setup: $$path contains a symlink ($$nested_link)." >&2; \
				exit 1; \
			fi; \
			mount_targets=$$(findmnt --raw --noheadings --output TARGET) || { \
				echo "Refusing setup: findmnt failed while checking $$path." >&2; \
				exit 1; \
			}; \
			mounts=$$(printf '%s\n' "$$mount_targets" | while IFS= read -r target; do \
				decoded=$$(printf '%b' "$$target"); \
				case "$$decoded" in \
					"$$path"|"$$path"/*) printf '%s\n' "$$decoded"; break;; \
				esac; \
			done); \
			if [ -n "$$mounts" ]; then \
				echo "Refusing setup: $$path is a mount point or contains a nested mount." >&2; \
				echo "This check cannot prevent a later mount change." >&2; \
				exit 1; \
			fi; \
		fi; \
	done; \
	if ! command -v docker >/dev/null 2>&1 || ! docker ps >/dev/null 2>&1; then \
		echo "Refusing setup: Docker is required for the ownership helper." >&2; \
		exit 1; \
	fi; \
	for container_name in $(PRODUCTION_CONTAINERS); do \
		container_id=$$(docker ps --filter "name=^/$${container_name}$$" --quiet); \
		if [ -n "$$container_id" ]; then \
			config_files=$$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$$container_id" 2>/dev/null || true); \
			working_dir=$$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$$container_id" 2>/dev/null || true); \
			case "$$config_files" in \
				*"$$repo/docker-compose.dev.yml"*) \
					if [ "$$working_dir" != "$$repo" ]; then \
						echo "Refusing setup: $$container_name belongs to another checkout." >&2; \
						exit 1; \
					fi \
					;; \
				*) \
					echo "Refusing setup: active production or unknown $$container_name container detected." >&2; \
					echo "Stop or isolate the production stack before running the dev setup." >&2; \
					exit 1; \
					;; \
			esac; \
		fi; \
	done; \
	for container_id in $$(docker ps -a --filter "label=com.docker.compose.project=$(DEV_PROJECT)" --quiet); do \
		config_files=$$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$$container_id" 2>/dev/null || true); \
		working_dir=$$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$$container_id" 2>/dev/null || true); \
		case "$$config_files" in \
			*"$$repo/docker-compose.dev.yml"*) \
				if [ "$$working_dir" != "$$repo" ]; then \
					echo "Refusing setup: $(DEV_PROJECT) belongs to another checkout." >&2; \
					exit 1; \
				fi \
				;; \
			*) \
				echo "Refusing setup: active $(DEV_PROJECT) containers use another Compose file." >&2; \
				exit 1; \
				;; \
		esac; \
	done

legacy-check: preflight
	@set -eu; \
	repo="$(REPO_DIR)"; \
	for container_name in $(PRODUCTION_CONTAINERS); do \
		container_id=$$(docker ps --filter "name=^/$${container_name}$$" --quiet); \
		if [ -n "$$container_id" ]; then \
			config_files=$$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$$container_id" 2>/dev/null || true); \
			working_dir=$$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$$container_id" 2>/dev/null || true); \
			case "$$config_files" in \
				*"$$repo/docker-compose.dev.yml"*) \
					if [ "$$working_dir" = "$$repo" ]; then \
						echo "Refusing up: pre-isolation dev container $$container_name is still active." >&2; \
						echo "Stop/remove that old dev stack without '-v', or isolate it before running 'make up'." >&2; \
						exit 1; \
					fi \
					;; \
			esac; \
		fi; \
	done

legacy-stop: preflight ## Stop/remove validated pre-isolation dev containers without volumes
	@set -eu; \
	repo="$(REPO_DIR)"; \
	services=""; \
	for container_name in $(PRODUCTION_CONTAINERS); do \
		container_id=$$(docker ps -a --filter "name=^/$${container_name}$$" --quiet); \
		if [ -n "$$container_id" ]; then \
			config_files=$$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$$container_id" 2>/dev/null || true); \
			working_dir=$$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$$container_id" 2>/dev/null || true); \
			service_name=$$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$$container_id" 2>/dev/null || true); \
			expected_service=$${container_name#cozyvtt-}; \
			case "$$config_files" in \
				*"$$repo/docker-compose.dev.yml"*) ;; \
				*) \
					echo "Refusing legacy-stop: $$container_name is not proven to be this checkout's dev container." >&2; \
					exit 1; \
					;; \
			esac; \
			if [ "$$working_dir" != "$$repo" ] || [ "$$service_name" != "$$expected_service" ]; then \
				echo "Refusing legacy-stop: $$container_name belongs to another checkout or Compose service." >&2; \
				exit 1; \
			fi; \
			services="$$services $$service_name"; \
		fi; \
	done; \
	if [ -n "$$services" ]; then \
		$(LEGACY_COMPOSE) stop $$services; \
		$(LEGACY_COMPOSE) rm -f $$services; \
	fi

setup: preflight ## Create dev runtime directories and repair backend ownership
	@mkdir -p "$(UPLOADS_DIR)" "$(BACKUPS_DIR)"
	# Capture the host identities after mkdir and pass them as command args. The
	# helper checks the bind targets before any chown, but cannot stop a later
	# concurrent replacement of a host path.
	@set -eu; \
	uploads_identity=$$(stat -c '%d:%i' -- "$(UPLOADS_DIR)"); \
	backups_identity=$$(stat -c '%d:%i' -- "$(BACKUPS_DIR)"); \
	$(DEV_COMPOSE) --profile permissions run --build --rm --no-deps backend-permissions \
		"$$uploads_identity" "$$backups_identity"

print-project:
	@printf '%s\n' "$(DEV_PROJECT)"

up: require-env legacy-check ## Prepare and start the isolated local development stack
	$(MAKE) --no-print-directory setup
	$(DEV_COMPOSE) up -d

start: up ## Alias for up

down: preflight ## Stop the isolated local development stack without removing volumes
	$(DEV_COMPOSE) down --remove-orphans

logs: preflight ## Follow logs for the isolated local development stack
	$(DEV_COMPOSE) logs -f
