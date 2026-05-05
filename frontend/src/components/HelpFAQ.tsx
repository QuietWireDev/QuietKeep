// QuietKeep: HelpFAQ.tsx
// Searchable FAQ accordion with keyboard navigation (arrow keys, Home/End).
// Search highlights matching text in both questions and answers.
// FAQ content is statically defined. No backend calls needed.
// Author: QuietWire (Dennis Ayotte)

import { ChevronDown, Search, ExternalLink, Bug, Lightbulb } from 'lucide-react';
import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';

interface FAQItem {
  q: string;
  a: string;
}

const sections: { title: string; items: FAQItem[] }[] = [
  {
    title: 'System Patches',
    items: [
      {
        q: 'Does QuietKeep upgrade my OS to a new major version?',
        a: 'No. It runs apt-get upgrade, which only applies security patches and package updates within your current release. If you\'re on Ubuntu 22.04, you\'ll stay on 22.04. QuietKeep will never move you to a new major version.',
      },
      {
        q: 'Why do I see updates listed but nothing gets installed?',
        a: 'This is usually due to phasing. Ubuntu and Debian roll out updates gradually, so not every machine gets the same update at the same time. Your host might see the update in the list, but apt won\'t actually install it until the rollout reaches your machine. This is normal. Just scan again later and it will either install or drop off the list.',
      },
      {
        q: 'Why does Kali use dist-upgrade instead of upgrade?',
        a: 'Kali is a rolling release. Regular upgrade skips packages that need new dependencies (kept-back packages). dist-upgrade handles those correctly, which is the recommended way to keep a Kali system current.',
      },
      {
        q: 'Will patching overwrite my config files?',
        a: 'No. QuietKeep passes --force-confdef and --force-confold to apt, which tells it to keep your existing config files. If a package ships a new config, the default behavior is to leave yours alone. It also uses --fix-missing so a partial install can still proceed if a mirror is temporarily down.',
      },
      {
        q: 'What does "partial" mean in the patch history?',
        a: 'It means some packages installed fine but apt hit an error along the way, like a mirror being unreachable. Open the log output to see exactly what happened. You can re-run the patch to pick up anything that was missed.',
      },
      {
        q: 'Why does a host show "reboot required"?',
        a: 'A core package was updated (kernel, libc, systemd, etc.) and the host is still running the old version in memory. You need to reboot for the changes to take effect. QuietKeep will never reboot a host on its own. You have to click the reboot button and confirm.',
      },
      {
        q: 'Can I hold back specific packages from being updated?',
        a: 'Not from the QuietKeep UI directly. SSH into the host and run "apt-mark hold <package>" to prevent it from being upgraded. QuietKeep respects held packages.',
      },
      {
        q: 'What does "MONITOR ONLY" mean?',
        a: 'The QuietKeep server itself is included in the host list for monitoring, so you can see its patch status on the dashboard. But you can\'t patch or reboot it from the UI. That would be like pulling the rug out from under yourself. Update the QuietKeep server manually via SSH.',
      },
    ],
  },
  {
    title: 'Docker Management',
    items: [
      {
        q: 'Does scanning actually pull new images?',
        a: 'No. Scanning only compares digests. It checks what you have locally against what the registry has, without downloading anything. Your running containers are completely untouched during a scan.',
      },
      {
        q: 'What does "pinned" mean next to an image?',
        a: 'It means the compose file locks that image to a specific digest using @sha256:... notation. The image won\'t change unless someone edits the compose file. This is common for databases like PostgreSQL and Redis where you don\'t want surprise major version upgrades.',
      },
      {
        q: 'What happens when I click Update?',
        a: 'QuietKeep runs "docker compose pull" to download any new images, then "docker compose up -d" to recreate only the containers that changed. If a container\'s image didn\'t change, it\'s left alone. The full output is saved in the update history.',
      },
      {
        q: 'Will updating a database container wipe my data?',
        a: 'No. Your data lives in Docker volumes, which persist across container recreates. Updating the container just swaps out the software, not the data. Think of it like updating an app without touching your documents.',
      },
      {
        q: 'How do I know if a Docker update is safe before applying it?',
        a: 'Click the link icon next to the image name. It takes you to the project\'s release notes (GitHub, Docker Hub, etc.). For database containers, minor version bumps (like postgres 16.12 to 16.13) are bug and security fixes. They\'re almost always safe. A major version jump would require changing the tag in your compose file, which QuietKeep doesn\'t do.',
      },
      {
        q: 'Can I patch system packages from the Docker tab?',
        a: 'No. System patches and Docker stacks are separate. The System Patches tab handles OS-level packages (apt, pacman). The Docker Stacks tab handles container images. They run independently.',
      },
    ],
  },
  {
    title: 'Setup & Configuration',
    items: [
      {
        q: 'How do I add new hosts?',
        a: 'Go to Settings > Hosts and click "Add Host". Fill in the hostname, IP address, SSH username, OS type, and whether it runs Docker. You can also bulk-import hosts from a CSV file by clicking "Import CSV".',
      },
      {
        q: 'How do I create a CSV file for importing hosts?',
        a: 'Create a plain text file with a .csv extension. The first line must be the header: hostname,ip_address,username,os_type,is_patch_target,has_docker. Each following line is one host. Required columns: hostname (unique name), ip_address (IPv4), username (SSH user), os_type (apt, kali, pacman, or proxmox). Optional columns: is_patch_target (true/false, default true), has_docker (true/false, default false). You can also click "Template" in Settings > Hosts to download a pre-filled example.',
      },
      {
        q: 'What SSH setup do managed hosts need?',
        a: 'Go to Settings > SSH, paste your private key into the Load SSH Private Key field, and click Load Key. Then expand Deploy SSH Key to Hosts, enter the password for each host (or one password for all), and click Deploy. QuietKeep will add its public key to each host automatically. The only manual step is setting up passwordless sudo for scan and patch commands on each host. Proxmox hosts using the root account only need the key deployed.',
      },
      {
        q: 'How do I fix "Permission denied" SSH errors?',
        a: 'Go to Settings > SSH and use Deploy SSH Key to Hosts to push the key again. If that fails, verify the password is correct. You can also manually add the public key (shown in Settings > SSH) to ~/.ssh/authorized_keys on the host. After fixing, click the SSH test button in Settings > Hosts to verify.',
      },
      {
        q: 'How often does QuietKeep scan automatically?',
        a: 'Every 6 hours by default, for both system patches and Docker stacks. You can change the interval in Settings > Scanning, or disable auto-scan entirely. Manual scans can be triggered anytime from either dashboard.',
      },
      {
        q: 'Do I need to install anything on the managed hosts?',
        a: 'No. QuietKeep connects over SSH and runs standard system commands (apt, pacman, docker). There are no agents, daemons, or packages to install on the hosts you manage.',
      },
    ],
  },
  {
    title: 'System Requirements',
    items: [
      {
        q: 'What are the minimum server requirements for QuietKeep?',
        a: 'Minimum: 2 CPU cores, 2 GB RAM, 10 GB disk. Recommended: 4 cores, 4 GB RAM, 20 GB+ disk. QuietKeep is lightweight - it runs a FastAPI backend with SQLite, so it doesn\'t need much. Most of the work happens over SSH on the managed hosts.',
      },
      {
        q: 'Which operating systems can QuietKeep manage?',
        a: 'Debian/Ubuntu (apt), Kali Linux (apt with dist-upgrade), Arch Linux/CachyOS/Manjaro (pacman), and Proxmox VE 7.x/8.x (apt). All hosts need SSH key access and passwordless sudo for package management commands.',
      },
      {
        q: 'What Python and Node.js versions are needed?',
        a: 'Python 3.11+ (3.12 recommended) for the backend. Node.js 18+ (20 recommended) for building the frontend. The server OS should be Ubuntu 22.04+ or Debian 12+.',
      },
      {
        q: 'What Docker version is required for Docker features?',
        a: 'Docker Engine 20.10+ and Docker Compose v2 (the plugin version, "docker compose", not the standalone "docker-compose"). Only hosts marked with has_docker=true are scanned for Docker stacks. Docker is optional. QuietKeep works fine without it for system patch management.',
      },
    ],
  },
  {
    title: 'Troubleshooting',
    items: [
      {
        q: 'A host shows as offline but I can SSH into it fine.',
        a: 'QuietKeep uses the same SSH key and username configured in config.py. Double-check that the key path and username match. Also make sure the host accepts connections from the QuietKeep server\'s IP. Run a manual scan to retry.',
      },
      {
        q: 'My firewall flagged QuietKeep as a port scanner.',
        a: 'When QuietKeep scans all hosts, it opens SSH connections to multiple machines in quick succession. Some intrusion prevention systems (like UniFi\'s IPS) see this as suspicious. Add QuietKeep\'s IP to your IPS allowlist to prevent it from being blocked.',
      },
      {
        q: 'Containers keep doubling after each Docker scan.',
        a: 'This was a known issue caused by SQLite not enforcing foreign key cascades by default. It has been fixed. If you see duplicates, restart the QuietKeep service and run a fresh scan. The old records will be cleaned up.',
      },
      {
        q: 'Can I manage Windows hosts?',
        a: 'No. QuietKeep is built for Linux. It supports Debian/Ubuntu (apt), Arch/CachyOS (pacman), and Proxmox.',
      },
      {
        q: 'Can I get notified when updates are available?',
        a: 'Not yet. Email and webhook notifications are planned for a future release. For now, check the dashboard or let the scheduled scans keep things current.',
      },
      {
        q: 'What happens if the QuietKeep server goes down?',
        a: 'Nothing bad. Your hosts keep running normally. QuietKeep is only needed when you want to scan, patch, or update containers from the dashboard. It doesn\'t run anything on your hosts in the background.',
      },
    ],
  },
];

// Wraps matched substrings in <mark> tags for visual search highlighting.
function highlightMatch(text: string, query: string): ReactNode {
  if (!query.trim()) return text;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(needle, cursor);
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={idx} className="bg-blue-500/30 text-blue-200 rounded-sm px-0.5">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    cursor = idx + needle.length;
    idx = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 0 ? parts : text;
}

interface AccordionProps {
  item: FAQItem;
  query: string;
  forceOpen: boolean;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onNav: (dir: 'up' | 'down' | 'home' | 'end') => void;
}

function Accordion({ item, query, forceOpen, buttonRef, onNav }: AccordionProps) {
  const [open, setOpen] = useState(false);
  const isOpen = open || forceOpen;
  return (
    <div className="border-b border-gray-800/50 last:border-0">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); onNav('down'); }
          if (e.key === 'ArrowUp') { e.preventDefault(); onNav('up'); }
          if (e.key === 'Home') { e.preventDefault(); onNav('home'); }
          if (e.key === 'End') { e.preventDefault(); onNav('end'); }
        }}
        className="w-full flex items-center justify-between py-4 text-left group"
        aria-expanded={isOpen}
      >
        <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">{highlightMatch(item.q, query)}</span>
        <ChevronDown className={`h-4 w-4 text-gray-500 shrink-0 ml-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <p className="text-sm text-gray-400 pb-4 leading-relaxed">{highlightMatch(item.a, query)}</p>
      )}
    </div>
  );
}

export default function HelpFAQ() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const refIndex = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return sections;
    const q = debouncedSearch.toLowerCase();
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (i) => i.q.toLowerCase().includes(q) || i.a.toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [debouncedSearch]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Help & FAQ</h2>
        <p className="text-xs text-gray-500 mt-1">Common questions about using QuietKeep. Use arrow keys to navigate between questions.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
        <input
          type="text"
          placeholder="Search questions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSearch('');
            if (e.key === 'ArrowDown') { e.preventDefault(); buttonRefs.current[0]?.focus(); }
          }}
          className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
        />
      </div>

      <div className="grid gap-6">
        {(() => { refIndex.current = 0; buttonRefs.current = []; return null; })()}
        {filtered.length === 0 && (
          <p className="text-gray-600 text-sm">No results for "{search}"</p>
        )}
        {filtered.length > 0 && debouncedSearch && (
          <p className="text-gray-500 text-xs">
            {filtered.reduce((acc, s) => acc + s.items.length, 0)} result{filtered.reduce((acc, s) => acc + s.items.length, 0) !== 1 ? 's' : ''} found
          </p>
        )}
        {filtered.map((section) => (
          <div key={section.title} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{section.title}</h3>
            <div className="divide-y divide-gray-800/50">
              {section.items.map((item) => {
                const idx = refIndex.current++;
                return (
                  <Accordion
                    key={item.q}
                    item={item}
                    query={debouncedSearch}
                    forceOpen={!!debouncedSearch}
                    buttonRef={(el) => { buttonRefs.current[idx] = el; }}
                    onNav={(dir) => {
                      // TODO: If FAQ grows past ~50 items, consider disabling wrap-around
                      const total = buttonRefs.current.length;
                      let next: number;
                      if (dir === 'home') next = 0;
                      else if (dir === 'end') next = total - 1;
                      else if (dir === 'down') next = (idx + 1) % total;
                      else next = (idx - 1 + total) % total;
                      buttonRefs.current[next]?.focus();
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Report a Bug / Feature Request */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-3">
            <Bug className="h-4 w-4 text-red-400" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Report a Bug</span>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            Found something that doesn't work as expected? Let us know so we can fix it.
          </p>
          <a
            href="https://github.com/quietwire-dev/quietkeep/issues/new?template=bug_report.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors text-sm font-medium"
          >
            <ExternalLink className="h-4 w-4" />
            Report Bug
          </a>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Feature Request</span>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            Have an idea for a new feature or improvement? We'd love to hear it.
          </p>
          <a
            href="https://github.com/quietwire-dev/quietkeep/issues/new?template=feature_request.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 transition-colors text-sm font-medium"
          >
            <ExternalLink className="h-4 w-4" />
            Request Feature
          </a>
        </div>
      </div>

      {/* Known Issues */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Known Issues</span>
        <div className="space-y-3 text-sm">
          <p className="text-gray-500">No known issues at this time.</p>
        </div>
      </div>
    </div>
  );
}
