"""Future-window replay protocol. Historical release times are an explicit assumption."""
from datetime import datetime,timedelta,timezone

SCHEMA='hrrr-daily-25mi-v2-future-window'
PROTOCOL='day1-06z-f06-30__day2-12z-f24-48-v1'


def future_window(date,day):
    if day not in [1,2]:raise ValueError('Day 1 or Day 2 required')
    base=datetime.strptime(date,'%Y-%m-%d').replace(tzinfo=timezone.utc)
    issue=base.replace(hour=6 if day==1 else 12)
    first=6 if day==1 else 24
    start=issue+timedelta(hours=first)
    cutoff=issue+timedelta(hours=3)
    result={'day':day,'model':'hrrr-v4','feature_schema':SCHEMA,'timing_protocol':PROTOCOL,
      'model_init_time':issue.isoformat(),'assumed_issuance_time':cutoff.isoformat(),
      'release_lag_assumption_hours':3,'historical_public_availability_verified':False,
      'valid_start':start.isoformat(),'valid_end':(start+timedelta(hours=24)).isoformat(),
      'radius_km':40.2336,'window_hours':24,'first_forecast_hour':first,'last_forecast_hour':first+24}
    validate(result);return result


def validate(w):
    issue,start,end,cutoff=(datetime.fromisoformat(w[k]) for k in ['model_init_time','valid_start','valid_end','assumed_issuance_time'])
    if any(t.tzinfo is None or t.utcoffset()!=timedelta(0) for t in [issue,start,end,cutoff]):raise ValueError('UTC times required')
    expected={1:(6,6,30),2:(12,24,48)}.get(w['day'])
    if expected is None or (issue.hour,w['first_forecast_hour'],w['last_forecast_hour'])!=expected:raise ValueError('Cycle/lead differs from frozen protocol')
    if w['feature_schema']!=SCHEMA or w['timing_protocol']!=PROTOCOL or w['window_hours']!=24 or w['radius_km']!=40.2336:raise ValueError('Incompatible daily protocol')
    if start!=issue+timedelta(hours=w['first_forecast_hour']) or end-start!=timedelta(hours=24) or start.hour!=12:raise ValueError('Target window mismatch')
    if cutoff!=issue+timedelta(hours=3) or cutoff>=start or w['historical_public_availability_verified'] is not False:raise ValueError('Invalid release assumption or retrospective availability claim')
    return w


# Bound decoder/platform roundoff to about 0.1 mm. Preserve source coordinates;
# never reorder points or resample labels to make a grid match.
GRID_TOLERANCE_DEGREES=1e-9

def check_grid(actual,expected):
    import numpy as np
    if actual.shape!=expected.shape or not np.isfinite(actual).all() or not np.isfinite(expected).all():raise ValueError('Grid shape or finite-coordinate mismatch')
    maximum=float(np.max(np.abs(actual-expected)))
    if maximum>GRID_TOLERANCE_DEGREES:raise ValueError(f'Grid coordinates/order differ: max_delta_degrees={maximum:.17g}')
    return {'exact':bool(np.array_equal(actual,expected)),'maximum_difference_degrees':maximum,'tolerance_degrees':GRID_TOLERANCE_DEGREES}
