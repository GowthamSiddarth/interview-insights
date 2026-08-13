#cloud-config
# Hardening on first boot: dedicated non-root user, SSH key-only auth,
# automatic security updates. Same bar as issue #501's Oracle VM.

users:
  - name: ${admin_username}
    groups: sudo
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    ssh_authorized_keys:
      - ${ssh_public_key}

package_update: true
package_upgrade: true
packages:
  - unattended-upgrades
  - fail2ban

write_files:
  - path: /etc/apt/apt.conf.d/20auto-upgrades
    content: |
      APT::Periodic::Update-Package-Lists "1";
      APT::Periodic::Unattended-Upgrade "1";

runcmd:
  # SSH key-only, no root login — the deploy user above already has the
  # same key, so this doesn't lock anyone out.
  - sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  - sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
  - systemctl restart ssh
  - systemctl enable --now unattended-upgrades
  - systemctl enable --now fail2ban
