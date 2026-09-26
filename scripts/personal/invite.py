#!/usr/bin/env python3
"""Bootstrap only the configured owner; no login bypass or admin enrollment."""
import argparse
from pathlib import Path
import subprocess
import sys

from configure import DEFAULT_ENV, PROJECT, compose, docker_env, load_env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--project", default=PROJECT)
    args = parser.parse_args()
    config = load_env(args.env)
    command = compose(args.env, args.project)
    running = subprocess.check_output(command + ["ps", "--status", "running", "--services"], env=docker_env(), text=True).split()
    if "web" in running:
        raise ValueError("stop web before bootstrapping invites")
    # Strict email validation excludes quotes/backslashes. SQL goes over stdin,
    # never psql -c/-v (which would put the owner's identity in argv).
    email = config["OWNER_EMAIL"]
    sql = f"""
BEGIN;
SELECT pg_advisory_xact_lock(741733075);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE LOWER(email::text) <> '{email}')
     OR EXISTS (SELECT 1 FROM account_invites WHERE email <> '{email}') THEN
    RAISE EXCEPTION 'not a single configured-owner installation';
  END IF;
END $$;
INSERT INTO account_invites (id, email)
VALUES (gen_random_uuid(), '{email}') ON CONFLICT (LOWER(email)) DO NOTHING;
COMMIT;
"""
    subprocess.run(command + ["exec", "-T", "postgres", "psql", "-X", "-q", "-U", "prosepect", "-d", "prosepect", "-v", "ON_ERROR_STOP=1"],
                   input=sql, text=True, env=docker_env(), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("Configured owner invite is present; cap remains one. No Operations permission granted.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Invite bootstrap failed ({type(error).__name__}); keep web stopped and check the configured owner/database.", file=sys.stderr)
        sys.exit(1)
