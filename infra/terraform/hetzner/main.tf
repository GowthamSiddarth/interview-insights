resource "hcloud_ssh_key" "deploy" {
  name       = "${var.server_name}-deploy-key"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

# Inbound: SSH, plus HTTP/HTTPS once ingress-nginx (#661) and cert-manager
# (#662) actually need them to make the pilot reachable — see D103/#659.
# Nothing beyond these three ports is exposed. Resource address kept as
# "ssh_only" (now a stale name) rather than renamed, so `terraform apply`
# is an in-place rule addition, not a destroy/recreate of the firewall.
resource "hcloud_firewall" "ssh_only" {
  name = "${var.server_name}-fw"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "this" {
  name        = var.server_name
  server_type = var.server_type
  location    = var.location
  image       = var.image
  ssh_keys    = [hcloud_ssh_key.deploy.id]
  firewall_ids = [hcloud_firewall.ssh_only.id]

  user_data = templatefile("${path.module}/cloud-init.yaml.tpl", {
    admin_username  = var.admin_username
    ssh_public_key  = trimspace(file(pathexpand(var.ssh_public_key_path)))
  })

  labels = {
    project = "interview-insights"
    purpose = "provisioning-pilot"
  }
}
