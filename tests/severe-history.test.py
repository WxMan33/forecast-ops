import json,sys,tempfile,unittest
from pathlib import Path
from datetime import datetime,timedelta,timezone
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/severe'))
from protocol import future_window,validate,SCHEMA
from daily import required_fields
from history import join_case,run_case
from extract import digest,validate_time

class History(unittest.TestCase):
 def test_future_day1(self):
  w=future_window('2022-01-15',1)
  self.assertEqual(w['model_init_time'],'2022-01-15T06:00:00+00:00');self.assertEqual(w['valid_start'],'2022-01-15T12:00:00+00:00');self.assertEqual(w['valid_end'],'2022-01-16T12:00:00+00:00')
  self.assertEqual(w['assumed_issuance_time'],'2022-01-15T09:00:00+00:00')
  fields=required_fields(w);self.assertNotIn('uh25',fields[6]);self.assertIn('uh25',fields[30]);self.assertNotIn('sbcape',fields[30])
 def test_future_day2(self):
  w=future_window('2022-01-15',2)
  self.assertEqual(w['model_init_time'],'2022-01-15T12:00:00+00:00');self.assertEqual(w['valid_start'],'2022-01-16T12:00:00+00:00');self.assertEqual(w['last_forecast_hour'],48)
  self.assertFalse(w['historical_public_availability_verified'])
 def test_cycle_metadata_is_not_hardcoded_to_12z(self):
  issue=datetime(2022,1,15,6,tzinfo=timezone.utc);m={'dataDate':20220115,'dataTime':600,'startStep':6,'endStep':6,'stepType':'instant','stepUnits':1}
  validate_time(m,issue,6,'sbcape')
  with self.assertRaises(ValueError):validate_time({**m,'dataTime':1200},issue,6,'sbcape')
 def test_zero_lead_and_claimed_availability_rejected(self):
  w=future_window('2022-01-15',1)
  with self.assertRaises(ValueError):validate({**w,'first_forecast_hour':0})
  with self.assertRaises(ValueError):validate({**w,'historical_public_availability_verified':True})
  with self.assertRaises(ValueError):validate({**w,'assumed_issuance_time':w['valid_start']})
 def test_rollover(self):
  self.assertEqual(future_window('2024-12-31',2)['valid_end'],'2025-01-02T12:00:00+00:00')
 def test_protected_case_rejected_before_fetch(self):
  with self.assertRaises(ValueError):run_case('2025-01-15',Path(__file__).resolve().parents[1]/'research/severe/cohort-v05.json','unused','unused','unused')
 def fixture(self,root):
  coords=np.array([[-90.,35.],[-89.,36.]]);labels=root/'labels';labels.mkdir();truth=np.array([[[1,0,0],[0,1,0]],[[0,0,1],[1,0,0]]],dtype=np.uint8)
  np.savez_compressed(labels/'labels.npz',coordinates=coords,labels=truth,hazards=np.array(['tornado','wind','hail']))
  products=[];manifests=[]
  for i in [1,2]:
   w=future_window('2022-01-15',i);products.append({'index':i-1,'initialization_date':'2022-01-15','day':i,'valid_start':w['valid_start'],'valid_end':w['valid_end'],'split':'train'})
   folder=root/f'day{i}';folder.mkdir();np.savez_compressed(folder/'features.npz',coordinates=coords,features=np.full((2,34),i,dtype=np.float32),feature_names=np.array([f'x_{k}' for k in range(34)]))
   m={'feature_schema':SCHEMA,'products':[{**w,'file':'features.npz','sha256':digest(folder/'features.npz')}],'native_grid':{'gridType':'lambert'},'field_identities':{'sbcape':'test'}}
   (folder/'manifest.json').write_text(json.dumps(m));(folder/'raw-audit.json').write_text(json.dumps({'status':'passed','model_init_time':w['model_init_time'],'source_messages_checked':192}));manifests.append(folder/'manifest.json')
  (labels/'manifest.json').write_text(json.dumps({'artifact':{'file':'labels.npz','sha256':digest(labels/'labels.npz')},'products':products}));return labels,manifests
 def test_join_preserves_labels_and_day_order(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);labels,manifests=self.fixture(root);r=join_case('2022-01-15',manifests,labels,root);data=np.load(root/'joined.npz',allow_pickle=False)
   self.assertEqual(data['features'].shape,(2,2,34));self.assertEqual(data['features'][1,0,0],2);self.assertEqual(data['labels'][1,0,2],1);self.assertFalse(r['operational_forecast_eligible'])
 def test_reordered_grid_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);labels,manifests=self.fixture(root);f=root/'day2/features.npz';a=np.load(f,allow_pickle=False);np.savez_compressed(f,coordinates=a['coordinates'][::-1],features=a['features'],feature_names=a['feature_names']);m=json.loads(manifests[1].read_text());m['products'][0]['sha256']=digest(f);manifests[1].write_text(json.dumps(m))
   with self.assertRaises(ValueError):join_case('2022-01-15',manifests,labels,root)
 def test_predictor_corruption_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);labels,manifests=self.fixture(root);(root/'day1/features.npz').write_bytes(b'corrupt')
   with self.assertRaises(ValueError):join_case('2022-01-15',manifests,labels,root)
 def test_unmatched_raw_audit_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);labels,manifests=self.fixture(root);p=root/'day1/raw-audit.json';p.write_text(json.dumps({'status':'passed','model_init_time':'2022-01-15T12:00:00+00:00','source_messages_checked':192}))
   with self.assertRaises(ValueError):join_case('2022-01-15',manifests,labels,root)
 def test_wrong_label_window_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);labels,manifests=self.fixture(root);p=labels/'manifest.json';m=json.loads(p.read_text());m['products'][0]['valid_start']='2022-01-15T13:00:00+00:00';p.write_text(json.dumps(m))
   with self.assertRaises(ValueError):join_case('2022-01-15',manifests,labels,root)

if __name__=='__main__':unittest.main()
