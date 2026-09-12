#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=== FloCafe installer ==="
echo

# Android storage permission
termux-setup-storage
sleep 3

# Basic packages
pkg update -y
pkg install -y nodejs unzip curl

# Require Node 22+
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")

if [ "$NODE_MAJOR" -lt 22 ]; then
    echo "ERROR: FloCafe needs Node 22+."
    echo "Installed: $(node -v)"
    exit 1
fi

echo
echo "Node: $(node -v)"
echo "npm:  $(npm -v)"
echo

# --------------------------------------------------
# Find FloCafe ZIP
# --------------------------------------------------

echo "Looking for FloCafe ZIP..."

ZIP=""

# Real Android Downloads folder
if [ -f "/storage/emulated/0/Download/FloCafe.zip" ]; then
    ZIP="/storage/emulated/0/Download/FloCafe.zip"

elif [ -f "/storage/emulated/0/Download/FloCafeZip.zip" ]; then
    ZIP="/storage/emulated/0/Download/FloCafeZip.zip"

# Termux Downloads link
elif [ -f "$HOME/storage/downloads/FloCafe.zip" ]; then
    ZIP="$HOME/storage/downloads/FloCafe.zip"

elif [ -f "$HOME/storage/downloads/FloCafeZip.zip" ]; then
    ZIP="$HOME/storage/downloads/FloCafeZip.zip"
fi

if [ -z "$ZIP" ]; then
    echo
    echo "ERROR: FloCafe ZIP was not found."
    echo
    echo "Android Downloads:"
    ls -lah /storage/emulated/0/Download/ 2>/dev/null || true
    echo
    echo "Termux Downloads:"
    ls -lah "$HOME/storage/downloads/" 2>/dev/null || true
    echo
    echo "Make sure FloCafe.zip is in Android Downloads."
    exit 1
fi

echo "Found: $ZIP"
echo

# --------------------------------------------------
# Install FloCafe
# --------------------------------------------------

rm -rf "$HOME/FloCafe"
mkdir -p "$HOME/FloCafe"

echo "Extracting FloCafe..."

unzip -q "$ZIP" -d "$HOME/FloCafe"

# Handle ZIP containing a single project folder
if [ ! -f "$HOME/FloCafe/package.json" ]; then

    for DIR in "$HOME/FloCafe"/*; do
        if [ -f "$DIR/package.json" ]; then

            echo "Found project folder: $DIR"

            shopt -s dotglob nullglob
            mv "$DIR"/* "$HOME/FloCafe/"
            shopt -u dotglob nullglob

            rmdir "$DIR" 2>/dev/null || true
            break
        fi
    done
fi

if [ ! -f "$HOME/FloCafe/package.json" ]; then
    echo
    echo "ERROR: package.json was not found."
    echo "The ZIP does not appear to contain a FloCafe project."
    exit 1
fi

cd "$HOME/FloCafe"

echo
echo "FloCafe installed at:"
echo "  $HOME/FloCafe"
echo

# --------------------------------------------------
# Install dependencies
# --------------------------------------------------

echo "Installing dependencies..."

# Do not run Electron postinstall scripts.
# FloCafe is being run Node-only.
npm ci --ignore-scripts

echo
echo "Dependencies installed."
echo

# --------------------------------------------------
# Build
# --------------------------------------------------

echo "Building FloCafe..."

npm run build

if [ ! -f "$HOME/FloCafe/dist/main/node-server.js" ]; then
    echo
    echo "ERROR: dist/main/node-server.js was not created."
    exit 1
fi

echo
echo "Build successful."
echo

# --------------------------------------------------
# Create startup directories
# --------------------------------------------------

mkdir -p "$HOME/.shortcuts"
mkdir -p "$HOME/.termux/boot"

# --------------------------------------------------
# Start FloCafe script
# --------------------------------------------------

cat > "$HOME/start-flo.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash

cd "$HOME/FloCafe"

PIDFILE="$HOME/flocafe.pid"

# Check existing process
if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE" 2>/dev/null || true)

    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "FloCafe is already running."
    else
        rm -f "$PIDFILE"
    fi
fi

# Start FloCafe
if [ ! -f "$PIDFILE" ]; then
    echo "Starting FloCafe..."

    nohup node dist/main/node-server.js \
        >> "$HOME/flocafe.log" 2>&1 &

    echo $! > "$PIDFILE"
fi

# Wait for server
echo "Waiting for FloCafe..."

for i in $(seq 1 30); do

    if curl -s --max-time 2 \
        http://127.0.0.1:3003/api/health \
        >/dev/null 2>&1; then

        echo "FloCafe is ready."
        break
    fi

    sleep 1
done

# Open FloCafe
am start \
    -a android.intent.action.VIEW \
    -d "http://127.0.0.1:3003/server-standalone/" \
    >/dev/null 2>&1 || true
EOF

chmod +x "$HOME/start-flo.sh"

# --------------------------------------------------
# Home screen shortcut
# --------------------------------------------------

cp "$HOME/start-flo.sh" "$HOME/.shortcuts/FloCafe"
chmod +x "$HOME/.shortcuts/FloCafe"

# --------------------------------------------------
# Start automatically after reboot
# --------------------------------------------------

cat > "$HOME/.termux/boot/FloCafe" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash

cd "$HOME/FloCafe"

PIDFILE="$HOME/flocafe.pid"

if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE" 2>/dev/null || true)

    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        exit 0
    fi

    rm -f "$PIDFILE"
fi

nohup node dist/main/node-server.js \
    >> "$HOME/flocafe.log" 2>&1 &

echo $! > "$PIDFILE"
EOF

chmod +x "$HOME/.termux/boot/FloCafe"

echo
echo "======================================"
echo "     FLOCAFE INSTALLATION COMPLETE"
echo "======================================"
echo
echo "Start FloCafe:"
echo
echo "    ~/start-flo.sh"
echo
echo "Home-screen shortcut:"
echo
echo "    FloCafe"
echo
echo "Auto-start after reboot: ENABLED"
echo
echo "Log:"
echo
echo "    ~/flocafe.log"
echo
