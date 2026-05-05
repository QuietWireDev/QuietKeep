"""
Curated mapping of ransomware/threat actor groups to known exploited CVEs.

Sources: CISA advisories, Mandiant, CrowdStrike, Sophos, Microsoft threat reports.
This is a living document. Update as new intelligence becomes available.
Author: QuietWire (Dennis Ayotte)
"""

THREAT_ACTOR_CVES: dict[str, dict] = {
    "Akira": {
        "description": "Ransomware group active since March 2023, targets enterprise VPNs and network appliances.",
        "cves": [
            "CVE-2023-20269",  # Cisco ASA/FTD VPN
            "CVE-2024-40766",  # SonicWall SMA/SRA
            "CVE-2020-3259",   # Cisco ASA info disclosure
            "CVE-2023-48788",  # Fortinet FortiClient EMS SQLi
            "CVE-2024-37085",  # VMware ESXi AD auth bypass
            "CVE-2023-27532",  # Veeam Backup credential leak
        ],
    },
    "LockBit": {
        "description": "Prolific ransomware-as-a-service (RaaS) operation, one of the most active groups globally.",
        "cves": [
            "CVE-2023-4966",   # Citrix Bleed (NetScaler)
            "CVE-2023-0669",   # Fortra GoAnywhere MFT RCE
            "CVE-2021-22986",  # F5 BIG-IP iControl REST RCE
            "CVE-2023-27350",  # PaperCut NG/MF auth bypass
            "CVE-2021-44228",  # Log4Shell
            "CVE-2018-13379",  # Fortinet FortiOS path traversal
            "CVE-2021-34473",  # Microsoft Exchange ProxyShell
            "CVE-2021-26855",  # Microsoft Exchange ProxyLogon
        ],
    },
    "Cl0p": {
        "description": "Ransomware group known for mass exploitation of file transfer vulnerabilities.",
        "cves": [
            "CVE-2023-34362",  # MOVEit Transfer SQLi
            "CVE-2023-0669",   # Fortra GoAnywhere MFT
            "CVE-2021-27101",  # Accellion FTA SQLi
            "CVE-2021-27104",  # Accellion FTA OS command injection
            "CVE-2023-35036",  # MOVEit Transfer SQLi (2nd)
        ],
    },
    "BlackCat (ALPHV)": {
        "description": "Sophisticated RaaS using Rust-based malware, known for triple extortion.",
        "cves": [
            "CVE-2021-26855",  # Microsoft Exchange ProxyLogon
            "CVE-2021-34473",  # Microsoft Exchange ProxyShell
            "CVE-2023-22515",  # Atlassian Confluence auth bypass
            "CVE-2024-37085",  # VMware ESXi AD auth bypass
            "CVE-2023-4966",   # Citrix Bleed
            "CVE-2023-48788",  # Fortinet FortiClient EMS
        ],
    },
    "Black Basta": {
        "description": "RaaS group with ties to former Conti members, active since April 2022.",
        "cves": [
            "CVE-2024-1709",   # ConnectWise ScreenConnect auth bypass
            "CVE-2024-26169",  # Windows Error Reporting EoP
            "CVE-2024-37085",  # VMware ESXi AD auth bypass
            "CVE-2021-34527",  # PrintNightmare
            "CVE-2022-41040",  # Microsoft Exchange SSRF (ProxyNotShell)
        ],
    },
    "Play": {
        "description": "Ransomware group exploiting managed file transfer and Exchange vulnerabilities.",
        "cves": [
            "CVE-2022-41040",  # Microsoft Exchange ProxyNotShell
            "CVE-2022-41082",  # Microsoft Exchange ProxyNotShell RCE
            "CVE-2023-0669",   # Fortra GoAnywhere MFT
            "CVE-2018-13379",  # Fortinet FortiOS VPN
            "CVE-2020-12812",  # Fortinet FortiOS auth bypass
        ],
    },
    "Royal / BlackSuit": {
        "description": "Successor to Conti, rebranded as BlackSuit in mid-2023.",
        "cves": [
            "CVE-2023-4966",   # Citrix Bleed
            "CVE-2021-34527",  # PrintNightmare
            "CVE-2023-22515",  # Atlassian Confluence
            "CVE-2021-44228",  # Log4Shell
        ],
    },
    "Medusa": {
        "description": "RaaS group active since 2023, targets healthcare and education sectors.",
        "cves": [
            "CVE-2024-1709",   # ConnectWise ScreenConnect
            "CVE-2023-48788",  # Fortinet FortiClient EMS
            "CVE-2023-4966",   # Citrix Bleed
        ],
    },
    "Rhysida": {
        "description": "Ransomware group targeting healthcare and government, active since May 2023.",
        "cves": [
            "CVE-2023-4966",   # Citrix Bleed
            "CVE-2020-1472",   # Zerologon
            "CVE-2024-37085",  # VMware ESXi
        ],
    },
    "RansomHub": {
        "description": "Emerging RaaS platform absorbing affiliates from disrupted groups.",
        "cves": [
            "CVE-2024-3400",   # Palo Alto PAN-OS command injection
            "CVE-2023-3519",   # Citrix NetScaler RCE
            "CVE-2023-46805",  # Ivanti Connect Secure auth bypass
            "CVE-2024-21887",  # Ivanti Connect Secure command injection
        ],
    },
    "Scattered Spider": {
        "description": "Threat group using social engineering and identity attacks, linked to ALPHV/BlackCat.",
        "cves": [
            "CVE-2023-22515",  # Atlassian Confluence
            "CVE-2023-4966",   # Citrix Bleed
            "CVE-2021-35464",  # ForgeRock AM/OpenAM RCE
        ],
    },
    "Volt Typhoon": {
        "description": "Chinese state-sponsored APT targeting US critical infrastructure.",
        "cves": [
            "CVE-2024-3400",   # Palo Alto PAN-OS
            "CVE-2023-46805",  # Ivanti Connect Secure
            "CVE-2024-21887",  # Ivanti Connect Secure
            "CVE-2021-40539",  # Zoho ManageEngine ADSelfService Plus
            "CVE-2021-27860",  # FatPipe WARP/IPVPN/MPVPN
        ],
    },
}


def get_all_actor_names() -> list[str]:
    """Return sorted list of all threat actor names."""
    return sorted(THREAT_ACTOR_CVES.keys())


def get_actor_cves(actor_name: str) -> list[str]:
    """Return CVE list for a given actor (case-insensitive partial match)."""
    al = actor_name.lower()
    for name, data in THREAT_ACTOR_CVES.items():
        if al in name.lower():
            return data["cves"]
    return []


def search_actors(query: str) -> dict[str, dict]:
    """Return all actors matching a search query (partial, case-insensitive)."""
    ql = query.lower()
    return {
        name: data for name, data in THREAT_ACTOR_CVES.items()
        if ql in name.lower() or ql in data["description"].lower()
    }


def cve_to_actors(cve_id: str) -> list[str]:
    """Return list of actor names associated with a given CVE."""
    return [
        name for name, data in THREAT_ACTOR_CVES.items()
        if cve_id.upper() in [c.upper() for c in data["cves"]]
    ]
