"""HRRR CONUS 3 km native grid (Lambert conformal, spherical earth) without pyproj.

Parameters are the GRIB2 grid definition pinned in every v0.7 predictor manifest
(input_contract.native_grid). Returns lon/lat in degrees, shape (Nj, Ni)."""
import numpy as np

R = 6371229.0
GRID = {"Ni": 1799, "Nj": 1059, "dx": 3000.0, "lat0": 21.138123, "lon0": 237.280472 - 360,
        "lad": 38.5, "lov": 262.5 - 360, "latin": 38.5}


def _constants(g=GRID):
    phi1 = np.radians(g["latin"])
    n = np.sin(phi1)
    f = np.cos(phi1) * np.tan(np.pi / 4 + phi1 / 2) ** n / n
    rho0 = R * f / np.tan(np.pi / 4 + np.radians(g["lad"]) / 2) ** n
    return n, f, rho0


def forward(lon, lat, g=GRID):
    n, f, rho0 = _constants(g)
    rho = R * f / np.tan(np.pi / 4 + np.radians(lat) / 2) ** n
    theta = n * np.radians(np.asarray(lon) - g["lov"])
    return rho * np.sin(theta), rho0 - rho * np.cos(theta)


def lonlat(stride=1, g=GRID):
    n, f, rho0 = _constants(g)
    x0, y0 = forward(g["lon0"], g["lat0"], g)
    x = x0 + np.arange(0, g["Ni"], stride) * g["dx"]
    y = y0 + np.arange(0, g["Nj"], stride) * g["dx"]
    x, y = np.meshgrid(x, y)
    rho = np.sign(n) * np.hypot(x, rho0 - y)
    lat = np.degrees(2 * np.arctan((R * f / rho) ** (1 / n)) - np.pi / 2)
    lon = g["lov"] + np.degrees(np.arctan2(x, rho0 - y) / n)
    return lon, lat


def outline(g=GRID):
    """Domain boundary as a closed (lon, lat) polyline."""
    lon, lat = lonlat(1, g)
    edge = [(lon[0, :], lat[0, :]), (lon[:, -1], lat[:, -1]), (lon[-1, ::-1], lat[-1, ::-1]), (lon[::-1, 0], lat[::-1, 0])]
    return np.concatenate([e[0] for e in edge]), np.concatenate([e[1] for e in edge])
