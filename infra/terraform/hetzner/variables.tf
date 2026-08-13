variable "server_name" {
  description = "Name of the Hetzner Cloud server."
  type        = string
  default     = "interview-insights-hetzner-01"
}

variable "server_type" {
  description = "Hetzner Cloud server type (spec). CX33 = 4 vCPU / 8 GB / 80 GB, Shared Resources / Cost-Optimized tier ($9.99/mo). NOTE: this tier is only available in EU/Singapore locations — US locations (ash/hil) only expose the pricier Regular Performance / General Purpose tiers, roughly 4x the cost for the same spec."
  type        = string
  default     = "cx33"
}

variable "location" {
  description = "Hetzner Cloud region. nbg1 = Nuremberg (eu-central) — chosen specifically because it carries Cost-Optimized pricing, unlike ash (Ashburn, US East) or hil (Hillsboro, US West). Switch to ash/hil deliberately if US latency/data-residency matters more than the ~4x cost difference for this box's current job (CI runner / provisioning pilot, not latency-sensitive end-user traffic)."
  type        = string
  default     = "nbg1"
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
