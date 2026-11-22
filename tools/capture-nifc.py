#!/usr/bin/env python3
"""Snapshot of NIFC WFIGS current wildfire incidents and perimeters, as fixtures in the services' own GeoJSON shape.

Sources (National Interagency Fire Center, Wildland Fire Interagency Geospatial Services):
  WFIGS_Incident_Locations_Current      points: wildfires (WF), complexes (CX) and prescribed fires (RX) not declared
                                        contained, controlled or out; stale records fall off by size (3, 8, 14 days)
  WFIGS_Interagency_Perimeters_Current  polygons for the subset of those incidents that have an approved public perimeter
The same field list and simplification as assets/threats-feeds.js (NIFC_*_URL) asks for live.
Usage: python3 tools/capture-nifc.py OUT_PREFIX     -> OUT_PREFIX-incidents.geojson, OUT_PREFIX-perimeters.geojson"""
import json, sys, time, urllib.parse, urllib.request
BASE = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
INC_FIELDS = "IrwinID,UniqueFireIdentifier,IncidentName,IncidentTypeCategory,IncidentSize,PercentContained,FireDiscoveryDateTime,ModifiedOnDateTime_dt,ContainmentDateTime,ControlDateTime,FireOutDateTime,POOState,POOCounty,POOProtectingUnit,IncidentManagementOrganization,TotalIncidentPersonnel,FireCause"
PER_FIELDS = "attr_IrwinID,poly_IncidentName,poly_GISAcres,poly_PolygonDateTime,poly_DateCurrent,poly_MapMethod,attr_IncidentTypeCategory,attr_PercentContained,attr_ModifiedOnDateTime_dt"
UA = {"User-Agent": "(forecast-ops, github.com/WxMan33/forecast-ops)"}
def q(service, params):
    u = BASE + service + "/FeatureServer/0/query?" + urllib.parse.urlencode(params)
    return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120)), u
prefix = sys.argv[1]; at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
inc, u1 = q("WFIGS_Incident_Locations_Current", {"where": "IncidentTypeCategory IN ('WF','CX','RX')", "outFields": INC_FIELDS, "outSR": 4326, "resultRecordCount": 4000, "f": "geojson"})
per, u2 = q("WFIGS_Interagency_Perimeters_Current", {"where": "1=1", "outFields": PER_FIELDS, "outSR": 4326, "maxAllowableOffset": 0.002, "geometryPrecision": 4, "resultRecordCount": 2000, "f": "geojson"})
for d, u, name in ((inc, u1, "incidents"), (per, u2, "perimeters")):
    if d.get("properties", {}).get("exceededTransferLimit"): raise SystemExit(name + ": transfer limit exceeded")
    d["_capture"] = {"captured": at, "source": u.split("?")[0]}
    json.dump(d, open(f"{prefix}-{name}.geojson", "w"), separators=(",", ":"))
    print(name, len(d["features"]), file=sys.stderr)
