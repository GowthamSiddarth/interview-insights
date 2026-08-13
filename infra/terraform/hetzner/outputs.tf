output "server_ipv4" {
  description = "Public IPv4 address of the provisioned server."
  value       = hcloud_server.this.ipv4_address
}

output "server_id" {
  description = "Hetzner Cloud server ID."
  value       = hcloud_server.this.id
}

output "ssh_command" {
  description = "Ready-to-run SSH command using the dedicated non-root user."
  value       = "ssh ${var.admin_username}@${hcloud_server.this.ipv4_address}"
}
