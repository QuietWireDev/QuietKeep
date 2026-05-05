// QuietKeep: types/index.ts
// Shared TypeScript interfaces mirroring the backend Pydantic/SQLAlchemy models.
// These are the contract between the FastAPI backend and the React frontend.
// Author: QuietWire (Dennis Ayotte)

export interface Host {
  id: number;
  hostname: string;
  ip_address: string;
  username: string;
  os_type: string;
  is_online: boolean;
  last_scan: string | null;
  pending_updates: number;
  reboot_required: boolean;
  is_patch_target: boolean;
  has_docker: boolean;
  // null = never probed, true = NOPASSWD correct, false = missing/wrong rule.
  sudoers_ok: boolean | null;
  sudoers_last_checked: string | null;
  // Packages apt kept back on the last patch run (kernel metapackages and
  // similar). Empty array means nothing is deferred. Populated by the
  // backend after every patch; cleared when the user clicks Install
  // Held-Back Updates (which runs apt-get upgrade --with-new-pkgs).
  held_back_packages: string[];
  // Absolute UTC timestamp of the host's last boot, populated during each
  // scan. The UI computes live uptime as now - last_boot_at so the number
  // stays fresh between scans. Null when the host has never scanned or
  // the /proc/uptime probe did not return a usable value.
  last_boot_at: string | null;
  // Running kernel version from `uname -r`, e.g. "6.8.0-45-generic".
  // Null when the host has never been scanned or the probe failed.
  kernel_version: string | null;
  // Human-readable OS name from /etc/os-release PRETTY_NAME, e.g.
  // "Ubuntu 24.04.1 LTS". Null when not yet probed.
  os_pretty_name: string | null;
}

export interface SudoersFixResult {
  success: boolean;
  hostname: string;
  message: string;
  sudoers_ok: boolean | null;
}

export interface SudoersProbeResult {
  hostname: string;
  sudoers_ok: boolean;
}

export interface HostCreate {
  hostname: string;
  ip_address: string;
  username: string;
  os_type: string;
  is_patch_target: boolean;
  has_docker: boolean;
}

export interface HostUpdate {
  hostname?: string;
  ip_address?: string;
  username?: string;
  os_type?: string;
  is_patch_target?: boolean;
  has_docker?: boolean;
}

export interface SSHTestResult {
  success: boolean;
  hostname: string;
  message: string;
}

export interface CSVImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

export interface AppSettings {
  theme: string;
  ssh_key_path: string;
  ssh_timeout: number;
  scan_interval_hours: number;
  docker_scan_interval_hours: number;
  auto_scan_enabled: boolean;
  app_version: string;
}

export interface AppSettingsUpdate {
  theme?: string;
  ssh_key_path?: string;
  ssh_timeout?: number;
  scan_interval_hours?: number;
  docker_scan_interval_hours?: number;
  auto_scan_enabled?: boolean;
}

export interface Package {
  id: number;
  host_id: number;
  package_name: string;
  current_version: string | null;
  available_version: string | null;
  scan_timestamp: string | null;
}

export interface HostDetail extends Host {
  packages: Package[];
}

export interface PatchHistory {
  id: number;
  host_id: number;
  started_at: string | null;
  completed_at: string | null;
  status: string;
  packages_updated: number;
  log_output: string | null;
}

export interface DashboardSummary {
  total_hosts: number;
  hosts_online: number;
  hosts_with_updates: number;
  total_pending_packages: number;
  hosts_needing_reboot: number;
  last_scan: string | null;
}

export interface DockerStack {
  id: number;
  host_id: number;
  stack_name: string;
  compose_path: string | null;
  status: string;
  container_count: number;
  has_updates: boolean;
  last_scan: string | null;
  hostname: string | null;
  host_ip: string | null;
}

export interface DockerContainer {
  id: number;
  stack_id: number;
  container_name: string;
  image: string;
  current_digest: string | null;
  latest_digest: string | null;
  has_update: boolean;
  status: string;
}

export interface DockerStackDetail extends DockerStack {
  containers: DockerContainer[];
}

export interface DockerUpdateHistory {
  id: number;
  stack_id: number;
  started_at: string | null;
  completed_at: string | null;
  status: string;
  images_updated: number;
  log_output: string | null;
}

export interface DockerDashboardSummary {
  total_stacks: number;
  stacks_with_updates: number;
  total_containers: number;
  containers_with_updates: number;
  docker_hosts: number;
  last_scan: string | null;
}

// ─── Threat Intel (CISA KEV) ─────────────────────────────────────────────

export interface KEVVulnerability {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: string;
  notes: string;
  threat_actors?: string[];
}

export interface ThreatActor {
  name: string;
  description: string;
  cve_count: number;
  cves: string[];
}

export interface KEVCatalogResponse {
  vulnerabilities: KEVVulnerability[];
  total: number;
  catalog_version: string | null;
  date_released: string | null;
  error?: string;
}

export interface KEVSummary {
  total: number;
  added_this_week: number;
  added_this_month: number;
  ransomware_linked: number;
  top_vendors: { vendor: string; count: number }[];
  catalog_version: string | null;
  date_released: string | null;
  error?: string;
}
