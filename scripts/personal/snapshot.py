#!/usr/bin/env python3
"""Matched private snapshot or isolated fresh restore; never deletes operator data."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import uuid

from configure import DEFAULT_ENV, PROJECT, ROOT, compose, docker_env, load_env

VOLUMES = ("files-data", "caddy-data", "caddy-config")
ARTIFACTS = ("database.dump", "installation.env", *(name + ".tar" for name in VOLUMES))


def run(command, **kwargs):
    return subprocess.run(command, env=docker_env(), check=True, stderr=subprocess.DEVNULL, **kwargs)


def text(command):
    return run(command, stdout=subprocess.PIPE, text=True).stdout.strip()


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def check_tar(path):
    seen = set()
    with tarfile.open(path, "r:") as archive:
        for entry in archive:
            name = PurePosixPath(entry.name)
            if name.is_absolute() or ".." in name.parts or str(name) in seen or entry.sparse is not None or not (entry.isfile() or entry.isdir()):
                raise ValueError("unsafe archive entry (paths, links and special files rejected)")
            seen.add(str(name))


def verify(directory):
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("snapshot must be a real directory")
    if {p.name for p in directory.iterdir()} != {*ARTIFACTS, "manifest.json"}:
        raise ValueError("incomplete snapshot or unexpected files")
    for name in (*ARTIFACTS, "manifest.json"):
        path = directory / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("snapshot contains non-regular files")
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest["format"] != 2 or set(manifest["sha256"]) != set(ARTIFACTS):
        raise ValueError("unsupported snapshot format")
    for name in ARTIFACTS:
        if digest(directory / name) != manifest["sha256"][name]:
            raise ValueError("snapshot checksum mismatch")
    load_env(directory / "installation.env")
    for name in VOLUMES:
        check_tar(directory / (name + ".tar"))
    if not re.fullmatch(r"postgres@sha256:[0-9a-f]{64}", manifest["images"]["postgres"]["restore"]):
        raise ValueError("missing/unsupported pinned PostgreSQL restore image")
    return manifest


def snapshot(args):
    command = compose(args.env, args.project)
    values = load_env(args.env)
    # This is a fail-closed bootstrap/backup tool, not a Compose override engine.
    running = text(command + ["ps", "--status", "running", "--services"]).split()
    if not {"postgres", "api", "worker", "web"}.issubset(running):
        raise ValueError("snapshot requires the installed stack running first")
    # A file edited without redeployment could lose the *active* encryption key.
    # Compare privately in memory; never print the resolved Compose environment.
    desired = json.loads(text(command + ["config", "--format", "json"]))
    for service in ("postgres", "api", "worker"):
        container = text(command + ["ps", "-q", service])
        info = json.loads(text(["docker", "inspect", container]))[0]
        actual = dict(item.split("=", 1) for item in info["Config"]["Env"])
        if any(actual.get(key) != str(value) for key, value in desired["services"][service]["environment"].items()):
            raise ValueError("runtime settings differ from saved config; reconcile before snapshot")
    if args.directory.resolve().is_relative_to(ROOT):
        raise ValueError("sensitive snapshot staging must be outside the source checkout")
    images = {}
    for service in ("postgres", "api", "worker", "web"):
        container = text(command + ["ps", "-q", service])
        info = json.loads(text(["docker", "inspect", container]))[0]
        image_id = info["Image"]
        image = json.loads(text(["docker", "image", "inspect", image_id]))[0]
        images[service] = {"id": image_id, "configured": info["Config"]["Image"], "digests": image["RepoDigests"]}
        if service == "postgres":
            matches = [d for d in image["RepoDigests"] if d.startswith("postgres@sha256:")]
            if not matches:
                raise ValueError("pull the packaged PostgreSQL image before snapshotting")
            images[service]["restore"] = matches[0]
    # Validate every source volume exists before Docker can auto-create one.
    for name in VOLUMES:
        run(["docker", "volume", "inspect", f"{args.project}_{name}"], stdout=subprocess.DEVNULL)
    file_owner = text(command + ["exec", "-T", "api", "stat", "-c", "%u:%g", "/data/files"])
    args.directory.mkdir(mode=0o700)  # Never overwrite/reuse an old snapshot.
    os.chmod(args.directory, 0o700)
    print("Pausing ingress, API and worker. Failure leaves writers stopped; see recovery instructions.", flush=True)
    run(command + ["stop", "-t", "60", "web", "api", "worker"], stdout=subprocess.DEVNULL)
    # No writers remain. PostgreSQL stays up for the portable logical dump.
    with (args.directory / "database.dump").open("xb") as output:
        run(command + ["exec", "-T", "postgres", "pg_dump", "-U", "prosepect", "-d", "prosepect", "--format=custom", "--no-owner", "--no-acl"], stdout=output)
    for name in VOLUMES:
        with (args.directory / (name + ".tar")).open("xb") as output:
            run(["docker", "run", "--rm", "--network", "none", "--user", "0", "--entrypoint", "tar",
                 "--mount", f"type=volume,src={args.project}_{name},dst=/volume,readonly",
                 images["postgres"]["id"], "-C", "/volume", "-cpf", "-", "."], stdout=output)
        check_tar(args.directory / (name + ".tar"))
    shutil.copyfile(args.env, args.directory / "installation.env")
    os.chmod(args.directory / "installation.env", 0o600)
    if load_env(args.directory / "installation.env") != values:
        raise ValueError("configuration changed during snapshot")
    manifest = {"format": 2, "file_owner": file_owner,
                "source_revision": text(["git", "-C", str(ROOT), "rev-parse", "HEAD"]),
                "project": args.project, "previously_running": running, "images": images,
                "postgres_version": text(command + ["exec", "-T", "postgres", "postgres", "--version"]),
                "sha256": {name: digest(args.directory / name) for name in ARTIFACTS}}
    with (args.directory / "manifest.json").open("x") as output:
        json.dump(manifest, output, indent=2)
    verify(args.directory)
    run(command + ["start", *running], stdout=subprocess.DEVNULL)
    print("Matched snapshot complete; services restarted. SENSITIVE LOCAL STAGING ONLY: encrypt, verify, copy off-server.")


def restore(args):
    manifest = verify(args.directory)  # All checks precede resources/extraction.
    project = args.project or ("prosepect-rehearsal-" + uuid.uuid4().hex[:12])
    if not re.fullmatch(r"prosepect-rehearsal-[a-z0-9-]{1,30}", project):
        raise ValueError("restore project must start prosepect-rehearsal-")
    for kind in ("container", "volume", "network"):
        ids = text(["docker", kind, "ls", *(["--all"] if kind == "container" else []),
                    "-q", "--filter", f"label=com.docker.compose.project={project}"])
        if ids:
            raise ValueError("restore project already exists; choose a fresh name")
    # Name collisions without Compose labels must also fail, never be adopted.
    for kind in ("container", "volume", "network"):
        names = text(["docker", kind, "ls", *(["--all"] if kind == "container" else []),
                      "--format", "{{.Names}}" if kind == "container" else "{{.Name}}"])
        if any(name.startswith(project) for name in names.splitlines()):
            raise ValueError("restore resource name collision")
    args.output.mkdir(mode=0o700)
    shutil.copyfile(args.directory / "installation.env", args.output / "installation.env")
    os.chmod(args.output / "installation.env", 0o600)
    shutil.copyfile(ROOT / "deploy/personal/restore.compose.yaml", args.output / "compose.yaml")
    # Compose settings stored privately; no secrets appear on command lines.
    with (args.output / "installation.env").open("a") as output:
        output.write(f"RESTORE_POSTGRES_IMAGE={manifest['images']['postgres']['restore']}\n")
    command = ["docker", "compose", "--env-file", str((args.output / "installation.env").resolve()),
               "-p", project, "-f", str((args.output / "compose.yaml").resolve())]
    # Remove inherited restore overrides too; this command is intentionally isolated.
    os.environ.pop("RESTORE_POSTGRES_IMAGE", None)
    run(command + ["pull"], stdout=subprocess.DEVNULL)
    image = manifest["images"]["postgres"]["restore"]
    with (args.directory / "database.dump").open("rb") as source:
        run(["docker", "run", "--rm", "-i", "--network", "none", "--entrypoint", "pg_restore", image, "--list"], stdin=source, stdout=subprocess.DEVNULL)
    for name in ("postgres-data", *VOLUMES):
        run(["docker", "volume", "create", "--label", f"com.docker.compose.project={project}",
             "--label", f"com.docker.compose.volume={name}", f"{project}_{name}"], stdout=subprocess.DEVNULL)
    for name in VOLUMES:
        with (args.directory / (name + ".tar")).open("rb") as source:
            run(["docker", "run", "--rm", "-i", "--network", "none", "--user", "0", "--entrypoint", "tar",
                 "--mount", f"type=volume,src={project}_{name},dst=/volume", image,
                 "-C", "/volume", "-xpf", "-"], stdin=source, stdout=subprocess.DEVNULL)
    run(command + ["up", "-d", "--wait", "--wait-timeout", "120"], stdout=subprocess.DEVNULL)
    with (args.directory / "database.dump").open("rb") as source:
        run(command + ["exec", "-T", "postgres", "pg_restore", "--exit-on-error", "--no-owner", "--no-acl",
                       "-U", "prosepect", "-d", "prosepect"], stdin=source, stdout=subprocess.DEVNULL)
    (args.output / "project.txt").write_text(project + "\n")
    print(f"Restored into isolated project {project}. NO API/worker/ingress. Verify database AND private file bytes/ownership before promotion.")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    backup = sub.add_parser("backup")
    backup.add_argument("directory", type=Path, help="new private staging directory outside checkout")
    backup.add_argument("--env", type=Path, default=DEFAULT_ENV)
    backup.add_argument("--project", default=PROJECT)
    recovery = sub.add_parser("restore")
    recovery.add_argument("directory", type=Path)
    recovery.add_argument("output", type=Path, help="new directory for isolated Compose settings")
    recovery.add_argument("--project")
    args = parser.parse_args()
    if args.action == "backup":
        snapshot(args)
    else:
        restore(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, tarfile.TarError, subprocess.CalledProcessError) as error:
        print(f"Snapshot/restore failed ({type(error).__name__}). No cleanup or automatic recovery attempted. "
              "Keep partial artifacts private; see the guide. Do not delete volumes.", file=sys.stderr)
        sys.exit(1)
