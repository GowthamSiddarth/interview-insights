variable "server_name" {
  description = "Name of the Hetzner Cloud server."
  type        = string
  default     = "interview-insights-hetzner-01"
}

variable "server_type" {
  description = "Hetzner Cloud server type (spec). CAX21 = 4 vCPU / 8 GB / 80 GB, Ampere ARM64 (~€12.49/mo in nbg1/fsn1/hel1) — switched from CX33 (x86_64, same spec, ~$9.99/mo) in Phase 46 (#708): the self-hosted CD runner (this project's own Mac, Apple Silicon/arm64) had no way to build the web image for x86_64 without cross-arch QEMU emulation, which reliably segfaulted on Next.js's SWC compiler (a native Rust binary) partway through `next build` — not fixable from the application side (tried CPU/thread-count tuning, a Babel fallback; the latter is blocked outright by `next/font` requiring SWC). Matching the VM's architecture to the runner's eliminates emulation entirely for every future deploy, not just this one. NOTE: CX33's own EU/Singapore-only Cost-Optimized-tier caveat doesn't apply here — CAX line pricing is uniform across fsn1/hel1/nbg1."
  type        = string
  default     = "cax21"
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
