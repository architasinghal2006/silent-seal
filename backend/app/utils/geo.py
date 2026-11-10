"""Distance on the Earth's surface. Mirrors frontend/src/geolocation/geofence.ts."""

from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_M = 6_371_000


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    h = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(h))


def inside_zone(lat: float, lng: float, zone_lat: float, zone_lng: float, radius_m: float) -> bool:
    return haversine_m(lat, lng, zone_lat, zone_lng) <= radius_m
