terraform {
  required_version = ">= 1.7"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
  }
}

# No `token` attribute set here on purpose: the hcloud provider reads it
# from the HCLOUD_TOKEN environment variable automatically. Nothing
# token-shaped ever appears in a .tf file, a default, or a committed
# .tfvars — same "never baked into a committed file" bar as every other
# credential in this project (CLAUDE.md hard constraint #6).
provider "hcloud" {}
