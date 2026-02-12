#!/bin/sh
set -e

REPO="ozanturksever/agentfs"
BINARY="agentfs"
INSTALL_DIR="${AGENTFS_INSTALL_DIR:-/usr/local/bin}"

main() {
    need_cmd curl
    need_cmd tar
    need_cmd uname

    local _os _arch _target _tag _url _tmpdir

    _os="$(uname -s)"
    _arch="$(uname -m)"

    case "$_os" in
        Linux)
            case "$_arch" in
                x86_64)  _target="x86_64-unknown-linux-gnu" ;;
                aarch64) _target="aarch64-unknown-linux-gnu" ;;
                *)       err "Unsupported architecture: $_arch on Linux" ;;
            esac
            ;;
        Darwin)
            case "$_arch" in
                arm64)   _target="aarch64-apple-darwin" ;;
                *)       err "Unsupported architecture: $_arch on macOS" ;;
            esac
            ;;
        *)
            err "Unsupported OS: $_os"
            ;;
    esac

    say "Detected platform: $_target"

    # Fetch latest release tag
    _tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
        | grep '"tag_name"' | head -1 | sed 's/.*: *"//;s/".*//')"

    if [ -z "$_tag" ]; then
        err "Failed to determine latest release tag"
    fi

    say "Latest release: $_tag"

    _url="https://github.com/${REPO}/releases/download/${_tag}/${BINARY}-${_target}.tar.gz"

    _tmpdir="$(mktemp -d)"
    trap 'rm -rf "$_tmpdir"' EXIT

    say "Downloading ${_url}"
    curl -fsSL "$_url" -o "${_tmpdir}/${BINARY}.tar.gz"

    tar xzf "${_tmpdir}/${BINARY}.tar.gz" -C "$_tmpdir"

    # Install binary
    if [ -w "$INSTALL_DIR" ]; then
        mv "${_tmpdir}/${BINARY}" "${INSTALL_DIR}/${BINARY}"
    else
        say "Installing to ${INSTALL_DIR} (requires sudo)"
        sudo mv "${_tmpdir}/${BINARY}" "${INSTALL_DIR}/${BINARY}"
    fi

    chmod +x "${INSTALL_DIR}/${BINARY}"

    say "Installed ${BINARY} ${_tag} to ${INSTALL_DIR}/${BINARY}"
}

say() {
    printf 'agentfs-install: %s\n' "$1"
}

err() {
    say "ERROR: $1" >&2
    exit 1
}

need_cmd() {
    if ! command -v "$1" > /dev/null 2>&1; then
        err "need '$1' (command not found)"
    fi
}

main "$@"
