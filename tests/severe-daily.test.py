import importlib.util
from datetime import datetime,timezone
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('daily',Path(__file__).resolve().parents[1]/'tools/severe/daily.py')
daily=importlib.util.module_from_spec(spec);spec.loader.exec_module(daily)

class DailyContract(unittest.TestCase):
 def setUp(self):self.windows=daily.windows(datetime(2026,11,6,12,tzinfo=timezone.utc))
 def test_complete_windows(self):
  one,two=self.windows
  self.assertEqual(one['valid_end'],two['valid_start'])
  self.assertEqual(one['first_forecast_hour'],0)
  self.assertEqual(two['last_forecast_hour'],48)
  self.assertEqual(two['valid_end'],'2026-11-08T12:00:00+00:00')
 def test_endpoints(self):
  first=daily.required_fields(self.windows[0]);second=daily.required_fields(self.windows[1])
  self.assertNotIn('uh25',first[0]);self.assertIn('uh25',first[24]);self.assertNotIn('sbcape',first[24])
  self.assertNotIn('uh25',second[24]);self.assertIn('uh25',second[48]);self.assertNotIn('sbcape',second[48])
 def test_reject_wrong_cycle(self):
  with self.assertRaises(ValueError):daily.windows(datetime(2026,11,6,6,tzinfo=timezone.utc))
  with self.assertRaises(ValueError):daily.windows(datetime(2026,11,6,12))
 def test_reject_day3(self):
  with self.assertRaises(ValueError):daily.required_fields({'first_forecast_hour':48,'last_forecast_hour':72})
 def test_reject_existing_four_hour_model(self):
  with self.assertRaises(ValueError):daily.require_daily_model({'feature_schema':'hrrr-four-hour-v2-interval-aligned','config':{'window_hours':4}},self.windows[0])
 def test_lead_specific_model(self):
  manifest={'feature_schema':daily.SCHEMA,'hazards_fitted':['tornado','wind','hail'],'config':{'window_hours':24,'radius_km':40.2336,'model_version':'hrrr-v4','cycle_hour_utc':12,'first_forecast_hour':0}}
  self.assertTrue(daily.require_daily_model(manifest,self.windows[0]))
  with self.assertRaises(ValueError):daily.require_daily_model(manifest,self.windows[1])
 def test_index_must_be_unambiguous_and_bounded(self):
  index='1:0:d=2026110612:CAPE:surface:0 hour fcst:\n2:50:d=2026110612:CIN:surface:0 hour fcst:\n'
  self.assertEqual(daily.select_ranges(index,{'cape':('CAPE','surface')})['cape']['end'],49)
  with self.assertRaises(ValueError):daily.select_ranges(index,{'cin':('CIN','surface')})
  with self.assertRaises(ValueError):daily.select_ranges(index,{'cape':('CAPE','missing')})

if __name__=='__main__':unittest.main()
