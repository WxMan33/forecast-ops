import sys,unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/severe'))
from labels import utc,normalize,label_window,vector,segment_distance,slerp,source_year
UTC=timezone.utc

def row(**kwargs):
 result={'EVENT_ID':'1','EVENT_TYPE':'Hail','STATE':'KENTUCKY','BEGIN_DATE_TIME':'15-JAN-24 12:00:00','END_DATE_TIME':'15-JAN-24 12:00:00','CZ_TIMEZONE':'UTC0','BEGIN_LAT':'35','BEGIN_LON':'-90','END_LAT':'35','END_LON':'-90','MAGNITUDE':'1','MAGNITUDE_TYPE':'','EPISODE_ID':'1'}
 result.update(kwargs);return result

class Labels(unittest.TestCase):
 def setUp(self):self.start=datetime(2024,1,15,12,tzinfo=UTC);self.end=self.start+timedelta(hours=24);self.grid=np.array([[-90.,35.],[-88.,35.]])
 def test_local_standard_time(self):
  self.assertEqual(utc('15-JUL-24 12:00:00','CST-6'),datetime(2024,7,15,18,tzinfo=UTC))
  with self.assertRaises(ValueError):utc('15-JUL-24 12:00:00','CST')
 def test_half_open_window(self):
  events,_=normalize([row(),row(EVENT_ID='2',BEGIN_DATE_TIME='16-JAN-24 12:00:00',BEGIN_LON='-88')])
  labels,_=label_window(self.grid,events,self.start,self.end);np.testing.assert_array_equal(labels[:,2],[1,0])
 def test_hazard_thresholds(self):
  events,_=normalize([row(MAGNITUDE='.99'),row(EVENT_ID='2',EVENT_TYPE='Thunderstorm Wind',MAGNITUDE='49.9')]);self.assertEqual(len(events),0)
  events,_=normalize([row(),row(EVENT_ID='2',EVENT_TYPE='Thunderstorm Wind',MAGNITUDE='50')]);self.assertEqual(len(events),2)
 def test_missing_magnitude_is_unknown_not_zero(self):
  events,_=normalize([row(MAGNITUDE='')]);labels,_=label_window(self.grid,events,self.start,self.end);np.testing.assert_array_equal(labels[:,2],[255,0])
 def test_positive_evidence_overrides_uncertain(self):
  events,_=normalize([row(MAGNITUDE=''),row(EVENT_ID='2')]);labels,_=label_window(self.grid,events,self.start,self.end);self.assertEqual(labels[0,2],1)
 def test_missing_location_masks_instead_of_inventing_negatives(self):
  events,_=normalize([row(BEGIN_LAT='')]);labels,_=label_window(self.grid,events,self.start,self.end);self.assertTrue((labels[:,2]==255).all())
 def test_duplicate_ids(self):
  events,stats=normalize([row(),row()]);self.assertEqual(len(events),1);self.assertEqual(stats['duplicate_rows'],1)
  with self.assertRaises(ValueError):normalize([row(),row(MAGNITUDE='2')])
 def test_track_clips_at_window_start(self):
  event=row(EVENT_TYPE='Tornado',BEGIN_DATE_TIME='15-JAN-24 10:00:00',END_DATE_TIME='15-JAN-24 12:00:00',END_LON='-88')
  events,_=normalize([event]);start=self.start-timedelta(hours=1)
  labels,_=label_window(self.grid,events,start,start+timedelta(hours=24));np.testing.assert_array_equal(labels[:,0],[0,1])
 def test_track_geometry_against_dense_independent_sampling(self):
  a,b=vector(-90,35),vector(-88,36);sites=vector(np.array([-91,-90,-89,-88,-87]),np.array([35,35.5,35.5,36,36]))
  actual=segment_distance(sites,a,b);dense=np.array([slerp(a,b,t) for t in np.linspace(0,1,10001)])
  expected=np.arccos(np.clip(sites@dense.T,-1,1)).min(axis=1)*6371.0088
  self.assertTrue(np.all(actual<=expected+1e-5));self.assertLess(np.abs(actual-expected).max(),.02)
 def test_no_protected_year_fetch(self):
  class Client:
   def fetch(self,*args):raise AssertionError('must reject before accessing source')
  with self.assertRaises(ValueError):source_year(Client(),2025)
 def test_full_utc_window_required(self):
  with self.assertRaises(ValueError):label_window(self.grid,[],self.start,self.start+timedelta(hours=4))

if __name__=='__main__':unittest.main()
