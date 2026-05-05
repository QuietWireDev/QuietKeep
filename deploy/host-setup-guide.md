# QuietKeep Host Setup Guide

This guide walks through setting up a fresh server to run QuietKeep via Docker.
Tested on Ubuntu Server 24.04 LTS.

---

## Minimum Specifications

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disk | 10 GB | 20 GB |
| Network | LAN access to managed hosts | LAN access to managed hosts |

QuietKeep is lightweight. The minimum spec will run it fine. The recommended spec
gives comfortable headroom for Docker overhead and background scanning.

---

## Proxmox VM Settings (if applicable)

- **OS:** Ubuntu Server 24.04 LTS ISO
- **Network adapter:** VirtIO
- **Disk:** VirtIO SCSI
- **QEMU Guest Agent:** Enable (install `qemu-guest-agent` after OS setup)

---

## Step 1: Install and Patch the OS

After first boot, update the system fully before installing anything else.

```bash
sudo apt update && sudo apt upgrade -y
sudo apt autoremove -y
sudo reboot
```

After reboot, install the QEMU guest agent if running on Proxmox:

```bash
sudo apt install -y qemu-guest-agent
sudo systemctl enable --now qemu-guest-agent
```

---

## Step 2: Install Docker Engine

Use the official Docker apt repository. Do not use `apt install docker.io` or
the snap version. Both ship outdated builds.

```bash
# Install prerequisites
sudo apt install -y ca-certificates curl

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the Docker apt repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine, CLI, and Compose plugin
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

Add your user to the docker group so you do not need sudo for docker commands:

```bash
sudo usermod -aG docker $USER
```

**Log out and back in** for the group change to take effect.

Verify Docker is running:

```bash
docker run --rm hello-world
```

You should see "Hello from Docker!" confirming the install is working.

---

## Step 3: Configure the Firewall (UFW)

Lock the server down to your LAN only. Replace `YOUR_LAN_SUBNET` with your
actual subnet (e.g. `192.168.1.0/24`).

**Important:** Add the SSH rule before enabling UFW or you will lock yourself out.

```bash
# Set default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH from your LAN only
sudo ufw allow from YOUR_LAN_SUBNET to any port 22 proto tcp comment "SSH from LAN"

# Allow QuietKeep web UI from your LAN only
sudo ufw allow from YOUR_LAN_SUBNET to any port 80 proto tcp comment "QuietKeep HTTP"
sudo ufw allow from YOUR_LAN_SUBNET to any port 443 proto tcp comment "QuietKeep HTTPS"

# Enable UFW
sudo ufw enable

# Verify rules
sudo ufw status verbose
```

---

## Step 4: Install QuietKeep

Clone the repository and build:

```bash
git clone <repo-url> ~/quietkeep
cd ~/quietkeep
docker compose up -d --build
```

> Replace `<repo-url>` with the actual repository URL.

The first build takes a few minutes. Docker builds the image from source,
creates the volumes, and starts the container. QuietKeep auto-detects the
server IP at startup.

---

## Step 5: First Run

Open a browser and navigate to `https://YOUR_SERVER_IP`.

You will see a browser security warning on the first visit. This is expected.
QuietKeep uses a self-generated HTTPS certificate. The connection is encrypted.

- **Chrome / Brave / Edge:** Click Advanced, then "Proceed to [IP] (unsafe)"
- **Firefox:** Click Advanced, then "Accept the Risk and Continue"
- **Safari:** Click Show Details, then "visit this website"

You only need to do this once. The certificate is stored permanently.

The first-run wizard will guide you through the rest of the setup.

---

## Step 6: Load Your SSH Key

QuietKeep connects to your managed hosts over SSH. You can generate a
dedicated key or use an existing one.

To generate a new key on your **local machine** (not on the QuietKeep server):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_quietkeep -N ""
```

Using a separate key means your other SSH access is unaffected if this key
ever needs to be rotated or revoked.

In the QuietKeep web UI, go to **Settings > SSH** and paste the contents of
your private key file into the **Load SSH Private Key** field. Click **Load Key**.

QuietKeep writes the file directly into its key volume with correct permissions
and derives the public key automatically. No `docker cp` needed.

---

## Step 7: Deploy Key to Managed Hosts

After loading your key, expand **Deploy SSH Key to Hosts** in Settings > SSH.
Enter the SSH password for each host (or check "Use the same password for all
hosts" if they share one) and click **Deploy to All**.

QuietKeep will connect to each host using the password, add its public key to
`~/.ssh/authorized_keys`, and confirm success. After this, password
authentication is no longer needed.

You can verify each host connection from **Settings > Hosts** using the SSH
test button.

---

## Keeping QuietKeep Updated

To update to a newer version:

```bash
cd ~/quietkeep
git pull
docker compose up -d --build
```

This pulls the latest source code and rebuilds the image. Your data, settings,
and SSH keys are stored in named volumes and are not affected by rebuilds.
