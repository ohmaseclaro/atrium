#!/bin/sh
set -e
cd /repo
# Virtual framebuffer (Xvfb) — same stack `xvfb-run` wraps, without fragile argv parsing.
Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp &
sleep 1
export DISPLAY=:99
exec node packages/worker/dist/run.js
