#!/bin/sh
set -eu

REPO="DaveZheng/mallex-code"
BINARY_NAME="mallex"
ASSET_NAME="mallex-darwin-arm64"

# Allow overriding version via environment variable
VERSION="${MALLEX_VERSION:-}"

info() { printf '%s\n' "$@"; }
error() { printf 'Error: %s\n' "$@" >&2; exit 1; }

# --- Platform checks ---
OS="$(uname -s)"
ARCH="$(uname -m)"

[ "$OS" = "Darwin" ] || error "mallex requires macOS (detected: $OS). MLX only runs on Apple Silicon."
[ "$ARCH" = "arm64" ] || error "mallex requires Apple Silicon / arm64 (detected: $ARCH)."

# --- Resolve version ---
if [ -z "$VERSION" ]; then
  info "Fetching latest release..."
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"//;s/".*//')"
  [ -n "$VERSION" ] || error "Could not determine latest release version."
fi

info "Installing ${BINARY_NAME} ${VERSION}..."

# --- Download binary + checksum ---
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}"
TMPDIR_INSTALL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_INSTALL"' EXIT

curl -fsSL -o "${TMPDIR_INSTALL}/${ASSET_NAME}" "${DOWNLOAD_URL}/${ASSET_NAME}" \
  || error "Failed to download binary. Does release ${VERSION} exist?"

curl -fsSL -o "${TMPDIR_INSTALL}/${ASSET_NAME}.sha256" "${DOWNLOAD_URL}/${ASSET_NAME}.sha256" \
  || error "Failed to download checksum."

# --- Verify checksum ---
info "Verifying checksum..."
(cd "$TMPDIR_INSTALL" && shasum -a 256 -c "${ASSET_NAME}.sha256") \
  || error "Checksum verification failed!"

chmod +x "${TMPDIR_INSTALL}/${ASSET_NAME}"

# --- Install to PATH ---
INSTALL_DIR=""

if [ -w "/usr/local/bin" ]; then
  INSTALL_DIR="/usr/local/bin"
elif command -v sudo >/dev/null 2>&1; then
  info "Installing to /usr/local/bin (requires sudo)..."
  sudo mkdir -p /usr/local/bin
  sudo cp "${TMPDIR_INSTALL}/${ASSET_NAME}" "/usr/local/bin/${BINARY_NAME}"
  sudo chmod +x "/usr/local/bin/${BINARY_NAME}"
  INSTALL_DIR="/usr/local/bin"
fi

if [ -z "$INSTALL_DIR" ]; then
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$INSTALL_DIR"
fi

# Copy if we didn't already install via sudo
if [ "$INSTALL_DIR" != "/usr/local/bin" ] || [ -w "/usr/local/bin" ]; then
  cp "${TMPDIR_INSTALL}/${ASSET_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
  chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
fi

info ""
info "Installed ${BINARY_NAME} to ${INSTALL_DIR}/${BINARY_NAME}"

# --- Check PATH ---
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    info ""
    info "WARNING: ${INSTALL_DIR} is not on your PATH."
    info "Add it to your shell profile:"
    info "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.zshrc"
    ;;
esac

info ""
info "Run '${BINARY_NAME}' to get started."
