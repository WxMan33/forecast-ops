import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile
from datetime import datetime,timezone
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/severe'))
from extract import Aggregate,Client,disk_max_at_samples,validate_time

class DailyExtraction(unittest.TestCase):
 def test_daily_statistics_and_lead_separation(self):
  for start in [0,24]:
   agg=Aggregate()
   for hour in range(start,start+24):agg.add(hour,{'sbcape':np.array([hour,hour+100],dtype=np.float32)})
   columns,matrix=agg.finish(start)
   self.assertEqual(columns,['x_sbcape_max','x_sbcape_mean'])
   np.testing.assert_array_equal(matrix,[[start+23,start+11.5],[start+123,start+111.5]])
   self.assertEqual(matrix.dtype,np.float32)
 def test_complete_window_required(self):
  agg=Aggregate()
  for h in range(23):agg.add(h,{'sbcape':np.array([1.])})
  with self.assertRaises(ValueError):agg.finish(0)
  with self.assertRaises(ValueError):agg.add(0,{'sbcape':np.array([1.])})
 def test_missing_data_and_changed_grid(self):
  agg=Aggregate();agg.add(0,{'sbcape':np.array([1.])})
  with self.assertRaises(ValueError):agg.add(1,{'sbcape':np.array([np.nan])})
  with self.assertRaises(ValueError):agg.add(1,{'sbcape':np.array([1.,2.])})
  with self.assertRaises(ValueError):agg.add(1,{'other':np.array([1.])})
 def test_rejected_hour_does_not_mutate_statistics(self):
  agg=Aggregate();agg.add(0,{'a':np.array([1.]),'b':np.array([1.])})
  with self.assertRaises(ValueError):agg.add(1,{'a':np.array([100.]),'b':np.array([np.nan])})
  for hour in range(1,24):agg.add(hour,{'a':np.array([1.]),'b':np.array([1.])})
  _,matrix=agg.finish(0);np.testing.assert_array_equal(matrix,np.ones((1,4)))
 def test_disk_matches_brute_force(self):
  a=np.arange(1600,dtype=np.float32).reshape(40,40);rows=np.array([14,18,24]);cols=np.array([14,19,24])
  result=disk_max_at_samples(a,rows,cols)
  for i,(r,c) in enumerate(zip(rows,cols)):
   expected=max(a[r+y,c+x] for y in range(-13,14) for x in range(-13,14) if (x*x+y*y)*9<=40.2336**2)
   self.assertEqual(result[i],expected)
  with self.assertRaises(ValueError):disk_max_at_samples(a,np.array([1]),np.array([10]))
 def test_uh_intervals_and_wrong_cycle(self):
  issue=datetime(2026,11,6,12,tzinfo=timezone.utc)
  meta={'dataDate':20261106,'dataTime':1200,'startStep':23,'endStep':24,'stepType':'max','stepUnits':1}
  validate_time(meta,issue,24,'uh25')
  with self.assertRaises(ValueError):validate_time(meta,issue,24,'sbcape')
  with self.assertRaises(ValueError):validate_time({**meta,'startStep':24},issue,24,'uh25')
  with self.assertRaises(ValueError):validate_time({**meta,'dataTime':600},issue,24,'uh25')
  validate_time({**meta,'startStep':24,'stepType':'instant'},issue,24,'sbcape')
 def test_exact_ranges_and_verified_resume(self):
  class Response:
   status=206
   headers={'Content-Range':'bytes 0-3/10','ETag':'test'}
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read(self,n):return b'GRIB'[:n]
  with tempfile.TemporaryDirectory() as d:
   client=Client(d,1)
   with patch('extract.urllib.request.urlopen',return_value=Response()) as opener:
    path=client.fetch('https://example.invalid/field','field.grib2',0,3)
    self.assertEqual(client.used,4);self.assertEqual(path.read_bytes(),b'GRIB')
    client.fetch('https://example.invalid/field','field.grib2',0,3);self.assertEqual(opener.call_count,1)
   path.write_bytes(b'BAD!')
   with self.assertRaises(ValueError):client.fetch('https://example.invalid/field','field.grib2',0,3)
 def test_ignored_ranges_and_budget_are_rejected(self):
  class Response:
   status=200;headers={}
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read(self,n):return b'GRIB'[:n]
  with tempfile.TemporaryDirectory() as d:
   with patch('extract.urllib.request.urlopen',return_value=Response()):
    with self.assertRaises(ValueError):Client(d,1).fetch('https://example.invalid','bad',0,3)
   good=Response();good.status=206;good.headers={'Content-Range':'bytes 0-3/10'}
   with patch('extract.urllib.request.urlopen',return_value=good):
    with self.assertRaises(ValueError):Client(d,0).fetch('https://example.invalid','budget',0,3)
   self.assertFalse(Path(d,'bad').exists());self.assertFalse(Path(d,'budget').exists())
 def test_unverified_cached_file_is_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   Path(d,'input').write_bytes(b'unverified')
   with self.assertRaises(FileNotFoundError):Client(d,1).fetch('https://example.invalid','input')

if __name__=='__main__':unittest.main()
