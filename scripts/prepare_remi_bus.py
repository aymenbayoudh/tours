#!/usr/bin/env python3
"""Prepare the user's KML selection from its official, archived Rémi GTFS."""
import hashlib
import json
import xml.etree.ElementTree as ET
import prepare_local_bus_gtfs as gtfs


def main():
    gtfs.SOURCES = gtfs.DATA / 'remi-2026-10-05'
    gtfs.LABELS['remi'] = 'Cars Rémi'
    ns = {'k': 'http://www.opengis.net/kml/2.2'}
    root = ET.parse(gtfs.SOURCES / 'selection.kml')
    selected = [p.findtext('k:styleUrl', namespaces=ns).removeprefix('#route_').replace('_', ':')
                for p in root.findall('.//k:Placemark', ns) if p.find('.//k:LineString', ns) is not None]
    data = gtfs.prepare({'id': 'remi', 'originalFile': 'REMI.zip',
        'sha256': hashlib.sha256((gtfs.SOURCES / 'REMI.zip').read_bytes()).hexdigest(),
        'routeDecisions': [{'routeId': r, 'decision': 'candidate'} for r in selected],
        'url': 'https://data.centrevaldeloire.fr/explore/dataset/offre-theorique-mobilite-remi/',
        'license': 'ODbL', 'maxSpeedKmh': 100})
    source = data.pop('source')
    source['regularCoursePolicy'] = 'KML selection; reference-week daytime non-reservation courses; real complete timing vectors'
    source['excludedSelectedRoutes'] = sorted(set(selected) - {r['gtfsRouteId'] for r in data['routes'].values()})
    data['sources'] = [source]
    (gtfs.DATA / 'remi_bus.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    print(len(data['routes']), 'routes;', len(data['stops']), 'physical stops;', len(data['patterns']), 'profiles')


if __name__ == '__main__':
    main()
