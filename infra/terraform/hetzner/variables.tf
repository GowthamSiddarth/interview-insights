variable "server_name" {
  description = "Name of the Hetzner Cloud server."
  type        = string
  default     = "interview-insights-hetzner-01"
}

variable "server_type" {
  description = "Hetzner Cloud server type (spec). CX32 = 4 vCPU / 8 GB / 80 GB."
  type        = string
  default     = "cx32"
}

variable "location" {
  description = "Hetzner Cloud region. ash = Ashburn, VA (US East)."
  type        = string
  default     = "ash"
}

variable "image" {
  description = "Base OS image."
  type        = string
  default     = "ubuntu-24.04"
}

variable "ssh_public_key_path" {
  description = "Path to the public half of the SSH keypair used for access. The matching private key never touches this repo or Terraform state."
  type        = string
  default     = "~/.ssh/hetzner-vm.pub"
}

variable "admin_username" {
  description = "Dedicated non-root user created via cloud-init. Nothing runs as root or the default cloud-init user day to day."
  type        = string
  default     = "deploy"
}
