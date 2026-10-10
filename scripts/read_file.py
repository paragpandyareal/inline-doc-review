#!/usr/bin/env python3
# Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
# Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel
"""Hands one Word, Excel or PDF file's bytes to the Lazy Panda Panel.

Claude Code lets a mod read files of up to 4 MB itself. For a larger
document, the mod runs this script, which reads the file and prints it as
base64; the mod's own readers then show it, as for any smaller file.

The path comes on standard input. Standard library only: no packages, no
network, and it reads one file and writes nothing.

    python3 -I read_file.py < path       prints "LPP1 <size>" and the base64
    echo --check | python3 -I read_file.py   prints "LPP1 ok <python version>"
"""
import base64
import os
import sys

MAX_BYTES = 50 * 1024 * 1024
KINDS = (".docx", ".xlsx", ".pdf")


def main():
    if sys.version_info < (3, 6):
        sys.stdout.write("LPP1 old\n")
        sys.exit(8)
    # Only the line break the mod may add is dropped: a path can start or end with a space.
    request = sys.stdin.buffer.read().decode("utf-8", "replace").rstrip("\r\n")
    if request.strip() == "--check":
        sys.stdout.write("LPP1 ok %d.%d\n" % sys.version_info[:2])
        return
    if not request.lower().endswith(KINDS):
        sys.stdout.write("LPP1 error This kind of file is not read here.\n")
        sys.exit(2)
    try:
        size = os.path.getsize(request)
        if size > MAX_BYTES:
            sys.stdout.write("LPP1 error The file is over 50 MB, too large to show here.\n")
            sys.exit(3)
        with open(request, "rb") as handle:
            data = handle.read(MAX_BYTES + 1)
    except OSError as error:
        sys.stdout.write("LPP1 error Could not read the file: %s\n" % (error.strerror or "unknown error"))
        sys.exit(4)
    sys.stdout.write("LPP1 %d\n" % len(data))
    sys.stdout.write(base64.b64encode(data).decode("ascii"))


if __name__ == "__main__":
    main()
