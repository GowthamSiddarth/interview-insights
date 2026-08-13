resource "hcloud_ssh_key" "deploy" {
  name       = "${var.server_name}-deploy-key"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

# Inbound: SSH only. Nothing else is exposed until a real workload
# (e.g. an ingress) explicitly needs it — same "don't provision what
# nothing needs yet" instinct as D9.
resource "hcloud_firewall" "ssh_only" {
  name = "${var.server_name}-fw"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
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
