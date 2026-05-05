# QuietKeep: routers/threat_intel.py
# CISA Known Exploited Vulnerabilities (KEV) feed. Cached proxy with threat actor mapping.
# Fetches from CISA's public JSON feed, caches in memory, enriches with threat actor data.
# Author: QuietWire (Dennis Ayotte)

import logging
import time
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Query

from app.data.threat_actors import (
    THREAT_ACTOR_CVES,
    get_all_actor_names,
    search_actors,
    cve_to_actors,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/threat-intel", tags=["threat-intel"])

CISA_KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
# In-memory cache to avoid hammering CISA's server on every page load.
# KEV catalog updates ~weekly; 1 hour TTL is more than sufficient.
CACHE_TTL_SECONDS = 3600

_cache: dict = {
    "data": None,
    "fetched_at": 0.0,
}


async def _fetch_kev() -> dict:
    """Fetch the CISA KEV catalog, using an in-memory cache."""
    now = time.time()
    if _cache["data"] and (now - _cache["fetched_at"]) < CACHE_TTL_SECONDS:
        return _cache["data"]

    logger.info("Fetching CISA KEV catalog...")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(CISA_KEV_URL)
        resp.raise_for_status()
        payload = resp.json()

    _cache["data"] = payload
    _cache["fetched_at"] = now
    logger.info(
        "CISA KEV catalog cached: %d vulnerabilities",
        len(payload.get("vulnerabilities", [])),
    )
    return payload


def _enrich_with_actors(vulns: list[dict]) -> list[dict]:
    """Add 'threat_actors' field to each vulnerability."""
    for v in vulns:
        actors = cve_to_actors(v.get("cveID", ""))
        v["threat_actors"] = actors
    return vulns


@router.get("/kev")
async def get_kev_catalog(
    days: Optional[int] = Query(None, description="Only return CVEs added in the last N days"),
    vendor: Optional[str] = Query(None, description="Filter by vendor (case-insensitive substring)"),
    product: Optional[str] = Query(None, description="Filter by product (case-insensitive substring)"),
    search: Optional[str] = Query(None, description="Search CVE ID, vendor, product, description, or threat actor name"),
    ransomware_only: bool = Query(False, description="Only return CVEs linked to ransomware campaigns"),
    actor: Optional[str] = Query(None, description="Filter by threat actor name (e.g. Akira, LockBit)"),
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    """Return the CISA KEV catalog with optional filters."""
    try:
        catalog = await _fetch_kev()
    except Exception as e:
        logger.error("Failed to fetch CISA KEV: %s", e)
        return {"error": str(e), "vulnerabilities": [], "total": 0, "catalog_version": None, "date_released": None}

    vulns = list(catalog.get("vulnerabilities", []))

    # --- Filters ---
    if days is not None:
        cutoff = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        cutoff = cutoff - timedelta(days=days)
        cutoff_str = cutoff.strftime("%Y-%m-%d")
        vulns = [v for v in vulns if v.get("dateAdded", "") >= cutoff_str]

    if vendor:
        vl = vendor.lower()
        vulns = [v for v in vulns if vl in v.get("vendorProject", "").lower()]

    if product:
        pl = product.lower()
        vulns = [v for v in vulns if pl in v.get("product", "").lower()]

    if ransomware_only:
        vulns = [v for v in vulns if v.get("knownRansomwareCampaignUse", "").lower() == "known"]

    if actor:
        # Find CVEs associated with the actor
        matched_actors = search_actors(actor)
        actor_cve_set = set()
        for data in matched_actors.values():
            actor_cve_set.update(c.upper() for c in data["cves"])
        if actor_cve_set:
            vulns = [v for v in vulns if v.get("cveID", "").upper() in actor_cve_set]
        else:
            vulns = []

    if search:
        sl = search.lower()
        # Also check if search matches a threat actor name
        matched_actor_cves: set[str] = set()
        for actor_name, data in THREAT_ACTOR_CVES.items():
            if sl in actor_name.lower() or sl in data["description"].lower():
                matched_actor_cves.update(c.upper() for c in data["cves"])

        vulns = [
            v for v in vulns
            if sl in v.get("cveID", "").lower()
            or sl in v.get("vendorProject", "").lower()
            or sl in v.get("product", "").lower()
            or sl in v.get("shortDescription", "").lower()
            or sl in v.get("vulnerabilityName", "").lower()
            or v.get("cveID", "").upper() in matched_actor_cves
        ]

    # Sort newest first
    vulns.sort(key=lambda v: v.get("dateAdded", ""), reverse=True)

    total = len(vulns)
    page = vulns[offset: offset + limit]

    # Enrich with actor tags
    page = _enrich_with_actors(page)

    return {
        "vulnerabilities": page,
        "total": total,
        "catalog_version": catalog.get("catalogVersion"),
        "date_released": catalog.get("dateReleased"),
    }


@router.get("/actors")
async def get_threat_actors():
    """Return list of all tracked threat actors with their CVEs and descriptions."""
    return {
        "actors": [
            {
                "name": name,
                "description": data["description"],
                "cve_count": len(data["cves"]),
                "cves": data["cves"],
            }
            for name, data in sorted(THREAT_ACTOR_CVES.items())
        ]
    }


@router.get("/kev/summary")
async def get_kev_summary():
    """Quick summary stats for the KEV catalog."""
    try:
        catalog = await _fetch_kev()
    except Exception as e:
        logger.error("Failed to fetch CISA KEV: %s", e)
        return {"error": str(e)}

    vulns = catalog.get("vulnerabilities", [])

    from datetime import timedelta
    now = datetime.utcnow()
    week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    month_ago = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    today_str = now.strftime("%Y-%m-%d")

    added_this_week = sum(1 for v in vulns if v.get("dateAdded", "") >= week_ago)
    added_this_month = sum(1 for v in vulns if v.get("dateAdded", "") >= month_ago)
    ransomware_linked = sum(
        1 for v in vulns if v.get("knownRansomwareCampaignUse", "").lower() == "known"
    )

    # Top vendors
    vendor_counts: dict[str, int] = {}
    for v in vulns:
        vp = v.get("vendorProject", "Unknown")
        vendor_counts[vp] = vendor_counts.get(vp, 0) + 1
    top_vendors = sorted(vendor_counts.items(), key=lambda x: -x[1])[:10]

    return {
        "total": len(vulns),
        "added_this_week": added_this_week,
        "added_this_month": added_this_month,
        "ransomware_linked": ransomware_linked,
        "top_vendors": [{"vendor": v, "count": c} for v, c in top_vendors],
        "catalog_version": catalog.get("catalogVersion"),
        "date_released": catalog.get("dateReleased"),
    }
