#!/bin/sh
# ccthread installer — downloads the right binary from GitHub Releases.
set -e

REPO="jakemarsh/ccthread"
VERSION="${CCTHREAD_VERSION:-latest}"

OS=$(uname -s)
ARCH=$(uname -m)
case "$OS-$ARCH" in
  Darwin-arm64)            TARGET="bun-darwin-arm64" ;;
  Darwin-x86_64)           TARGET="bun-darwin-x64-baseline" ;;
  Linux-x86_64)            TARGET="bun-linux-x64-baseline" ;;
  Linux-aarch64|Linux-arm64) TARGET="bun-linux-arm64" ;;
  *) echo "ccthread: unsupported platform $OS/$ARCH" >&2; exit 1 ;;
esac

if [ "$VERSION" = "latest" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -n1)
  if [ -z "$VERSION" ]; then
    echo "ccthread: could not resolve latest version" >&2
    exit 1
  fi
fi

URL="https://github.com/$REPO/releases/download/v$VERSION/ccthread-v$VERSION-$TARGET.tar.gz"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading ccthread v$VERSION ($TARGET)…"
curl -fSL "$URL" -o "$TMP/ccthread.tar.gz"
if curl -fSL "$URL.sha256" -o "$TMP/ccthread.sha256" 2>/dev/null; then
  EXPECTED=$(awk '{print $1}' "$TMP/ccthread.sha256")
  if command -v shasum >/dev/null 2>&1; then
    ACTUAL=$(shasum -a 256 "$TMP/ccthread.tar.gz" | awk '{print $1}')
  else
    ACTUAL=$(sha256sum "$TMP/ccthread.tar.gz" | awk '{print $1}')
  fi
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "ccthread: SHA256 mismatch" >&2
    exit 1
  fi
fi
tar -xzf "$TMP/ccthread.tar.gz" -C "$TMP"

# Pick install destination.
if [ -w "/usr/local/bin" ] || ([ ! -e "/usr/local/bin" ] && mkdir -p /usr/local/bin 2>/dev/null); then
  DEST="/usr/local/bin"
elif [ -w "$HOME/.local/bin" ] || mkdir -p "$HOME/.local/bin" 2>/dev/null; then
  DEST="$HOME/.local/bin"
else
  echo "ccthread: could not find a writable install dir" >&2
  exit 1
fi

# Locate the binary explicitly — the release tarball wraps it in a
# version-stamped dir today but that shape could change, and a glob like
# "$TMP"/*/ccthread silently breaks if it ever does.
BIN=$(find "$TMP" -type f -name ccthread -perm -u+x 2>/dev/null | head -n1)
if [ -z "$BIN" ] || [ ! -f "$BIN" ]; then
  echo "ccthread: couldn't find the ccthread binary in the downloaded archive" >&2
  exit 1
fi
mv "$BIN" "$DEST/ccthread"
chmod +x "$DEST/ccthread"

echo "Installed to $DEST/ccthread"
case ":$PATH:" in
  *":$DEST:"*) ;;
  *) echo "Note: $DEST is not on your PATH. Add it to your shell profile." ;;
esac
