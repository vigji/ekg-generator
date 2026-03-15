#!/usr/bin/env bash
# Serve the monitor simulator locally for testing.
# Once deployed to GitHub Pages, this script is not needed.

PORT="${1:-8000}"
DIR="$(dirname "$0")/monitor_simulator/frontend"

URL="http://localhost:$PORT"
echo "Serving monitor simulator at $URL"
echo ""

# Open browser after a short delay to let the server start
(sleep 1 && open "$URL") &

if command -v python3 &>/dev/null; then
    cd "$DIR" && python3 -m http.server "$PORT"
elif command -v npx &>/dev/null; then
    npx serve "$DIR" -l "$PORT"
else
    echo "Error: No suitable server found. Install Python 3 or Node.js."
    exit 1
fi
