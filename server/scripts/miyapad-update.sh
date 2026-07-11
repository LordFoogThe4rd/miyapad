#!/bin/sh
set -e

REPO="lordfoogthe4rd/miyapad"
API="https://api.github.com/repos/$REPO/releases/latest"

case "$(uname -s)" in
	Darwin) OS="macos" ;;
	Linux)  OS="linux" ;;
	*)      echo "Unsupported operating system." >&2; exit 1 ;;
esac
case "$(uname -m)" in
	arm64|aarch64) ARCH="arm64" ;;
	x86_64|amd64)  ARCH="x64" ;;
	*)             echo "Unsupported architecture." >&2; exit 1 ;;
esac
PLATFORM="$OS-$ARCH"

echo "Detected platform: $PLATFORM"
echo "Fetching latest release..."

JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API")"

ASSET_URL="$(printf '%s\n' "$JSON" \
	| grep '"browser_download_url"' \
	| sed -E 's/.*"(https:[^"]+)".*/\1/' \
	| grep "$PLATFORM" \
	| head -n1)"

RELEASE_URL="$(printf '%s\n' "$JSON" | grep '"html_url"' | head -n1 | sed -E 's/.*"(https:[^"]+)".*/\1/')"

if [ -z "$ASSET_URL" ]; then
	echo "No matching asset found for $PLATFORM."
	echo "Download manually from: ${RELEASE_URL:-https://github.com/$REPO/releases/latest}"
	exit 1
fi

ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/miyapad-update.XXXXXX")"
trap 'rm -f "$ARCHIVE"' EXIT
echo "Downloading $ASSET_URL"
curl -fSL "$ASSET_URL" -o "$ARCHIVE"

if [ ! -s "$ARCHIVE" ]; then
	echo "Downloaded file is empty. Aborting."
	exit 1
fi

DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
echo "Extracting into $DIR"
tar -xzf "$ARCHIVE" -C "$DIR"

echo "Update complete. Restart miyapad to apply."
