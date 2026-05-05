#!/bin/bash
# QuietKeep: setup-host.sh
# Prepares a managed host for QuietKeep: installs the SSH public key and
# creates a scoped sudoers file so the SSH user can run package management
# commands without a password. Root users skip the sudoers step entirely.
# Author: QuietWire (Dennis Ayotte)
#
# Usage:
#   1. Copy this script to the target host:
#      scp setup-host.sh user@host:~/
#
#   2. Run it with your QuietKeep server's public key:
#      ssh user@host "bash setup-host.sh 'ssh-ed25519 AAAA... comment'"
#
#   Or run interactively (it will prompt for the key):
#      ssh user@host
#      bash setup-host.sh

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!!]${NC} $1"; }
error() { echo -e "${RED}[ERR]${NC} $1"; }

echo ""
echo "========================================="
echo "  QuietKeep Host Setup"
echo "========================================="
echo ""

# Get the public key
PUBKEY="${1:-}"
if [ -z "$PUBKEY" ]; then
    echo "Paste your QuietKeep server's SSH public key below."
    echo "You can find this in QuietKeep: Settings > SSH > Public Key"
    echo ""
    read -rp "Public key: " PUBKEY
fi

if [ -z "$PUBKEY" ]; then
    error "No public key provided. Exiting."
    exit 1
fi

# Validate it looks like an SSH key
if ! echo "$PUBKEY" | grep -qE '^ssh-(ed25519|rsa|ecdsa)'; then
    error "That doesn't look like a valid SSH public key."
    error "It should start with ssh-ed25519, ssh-rsa, or ssh-ecdsa."
    exit 1
fi

CURRENT_USER=$(whoami)
echo ""
echo "Setting up QuietKeep access for user: $CURRENT_USER"
echo ""

# Step 1: Set up SSH authorized_keys
echo "Step 1: SSH Key"
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

if grep -qF "$PUBKEY" ~/.ssh/authorized_keys 2>/dev/null; then
    info "Public key already in authorized_keys"
else
    echo "$PUBKEY" >> ~/.ssh/authorized_keys
    info "Public key added to authorized_keys"
fi

# Step 2: Set up passwordless sudo (skip for root)
echo ""
echo "Step 2: Sudo Access"
if [ "$CURRENT_USER" = "root" ]; then
    info "Running as root. No sudo configuration needed"
else
    SUDOERS_FILE="/etc/sudoers.d/quietkeep-$CURRENT_USER"

    # Detect package manager and grant NOPASSWD only for the specific
    # binaries QuietKeep drives: the package manager and /usr/sbin/reboot.
    # We allow any arguments because the patcher uses complex argument
    # orderings (apt-get -y --fix-missing -o "Dpkg::Options::=..." upgrade)
    # that cannot be matched reliably with narrower sudoers glob patterns.
    # This is still least-privilege: only these binaries, no blanket ALL.
    if command -v apt &>/dev/null; then
        SUDO_CMDS="/usr/bin/apt *, /usr/bin/apt-get *, /usr/sbin/reboot"
    elif command -v pacman &>/dev/null; then
        SUDO_CMDS="/usr/bin/pacman *, /usr/sbin/reboot"
    else
        warn "Could not detect package manager (apt or pacman)"
        warn "You may need to configure sudo manually"
        SUDO_CMDS=""
    fi

    if [ -n "$SUDO_CMDS" ]; then
        SUDOERS_LINE="$CURRENT_USER ALL=(ALL) NOPASSWD: $SUDO_CMDS"

        if [ -f "$SUDOERS_FILE" ]; then
            info "Sudoers file already exists: $SUDOERS_FILE"
        else
            echo "This requires sudo to create $SUDOERS_FILE"
            echo "$SUDOERS_LINE" | sudo tee "$SUDOERS_FILE" > /dev/null
            sudo chmod 440 "$SUDOERS_FILE"
            info "Sudoers file created: $SUDOERS_FILE"
        fi
    fi
fi

# Step 3: Verify
echo ""
echo "Step 3: Verify"

# Check SSH key
if grep -qF "$PUBKEY" ~/.ssh/authorized_keys 2>/dev/null; then
    info "SSH key is configured"
else
    error "SSH key was NOT added. Check permissions on ~/.ssh"
fi

# Check sudo (skip for root)
if [ "$CURRENT_USER" != "root" ]; then
    if sudo -n true 2>/dev/null; then
        info "Passwordless sudo is working"
    else
        warn "Passwordless sudo may not be fully configured"
        warn "QuietKeep needs sudo for package update commands"
    fi
fi

echo ""
echo "========================================="
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Go to QuietKeep > Settings > Hosts"
echo "  2. Add this host (IP: $(hostname -I 2>/dev/null | awk '{print $1}' || echo 'unknown'))"
echo "  3. Click the SSH test button to verify"
echo "========================================="
echo ""
