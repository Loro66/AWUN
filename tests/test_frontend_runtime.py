import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


MEMORY_STORAGE = """
class MemoryStorage {
  constructor(){ this.values=new Map(); this.fail=false; }
  get length(){ return this.values.size; }
  key(index){ return [...this.values.keys()][index] ?? null; }
  getItem(key){ return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key,value){ if(this.fail) throw new Error('quota exceeded'); this.values.set(String(key),String(value)); }
  removeItem(key){ this.values.delete(String(key)); }
}
global.localStorage=new MemoryStorage();
global.dispatchEvent=()=>{};
global.addEventListener=()=>{};
global.CustomEvent=class CustomEvent { constructor(type,init={}){this.type=type;this.detail=init.detail;} };
"""


def run_node(script: str) -> object:
    completed = subprocess.run(
        ["node", "-e", MEMORY_STORAGE + script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_storage_migrates_queue_and_round_trips_export() -> None:
    result = run_node(
        """
        (async()=>{
          localStorage.setItem('awun-queue-v1',JSON.stringify([{id:'one'}]));
          const storage=require('./frontend/storage.js');
          storage.migrate();
          storage.writeJSON('awun-library',[{id:'saved'}]);
          const backup=storage.exportState();
          storage.writeJSON('awun-library',[]);
          await storage.importState(backup);
          process.stdout.write(JSON.stringify({
            queue:storage.readJSON('awun-queue-v1',{}),
            library:storage.readJSON('awun-library',[]),
            schema:storage.info().schema
          }));
        })().catch(error=>{console.error(error);process.exit(1)});
        """
    )
    assert result["queue"] == {"version": 1, "mode": "manual", "items": [{"id": "one"}]}
    assert result["library"] == [{"id": "saved"}]
    assert result["schema"] == 2


def test_storage_reports_quota_failure_without_throwing() -> None:
    result = run_node(
        """
        const storage=require('./frontend/storage.js');
        localStorage.fail=true;
        const saved=storage.writeJSON('awun-library',[{id:'track'}]);
        process.stdout.write(JSON.stringify({saved,error:storage.info().last_error}));
        """
    )
    assert result["saved"] is False
    assert result["error"]["operation"] == "write"
    assert result["error"]["key"] == "awun-library"


def test_runtime_log_redacts_secrets_and_url_queries() -> None:
    result = run_node(
        """
        const storage=require('./frontend/storage.js');global.awunStorage=storage;
        const log=require('./frontend/runtime-log.js');
        log.log('provider.failed',{token:'secret',url:'https://example.com/audio?signature=private',nested:{api_key:'hidden'}});
        process.stdout.write(JSON.stringify(log.report(1)[0]));
        """
    )
    assert result["details"]["token"] == "[redacted]"
    assert result["details"]["nested"]["api_key"] == "[redacted]"
    assert result["details"]["url"] == "https://example.com/audio"


def test_update_checker_compares_semantic_versions_and_parses_release() -> None:
    result = run_node(
        """
        (async()=>{
          const updates=require('./frontend/update-checker.js');
          const fetcher=async()=>({ok:true,status:200,json:async()=>({tag_name:'v1.11.0',html_url:'https://github.com/Loro66/AWUN/releases/tag/v1.11.0'})});
          const checked=await updates.check('1.10.2',fetcher);
          process.stdout.write(JSON.stringify({checked,older:updates.compare('1.9.9','1.10.0')}));
        })().catch(error=>{console.error(error);process.exit(1)});
        """
    )
    assert result["checked"]["available"] is True
    assert result["checked"]["latest"] == "1.11.0"
    assert result["older"] == -1


def test_invalid_backups_leave_existing_library_untouched() -> None:
    result = run_node(
        """
        (async()=>{
          const storage=require('./frontend/storage.js');
          storage.writeJSON('awun-library',[{id:'keep-me'}]);
          const invalid=[
            {app:'AWUN',schema:99,data:{}},
            {app:'AWUN',schema:2,data:{'awun-library':[]}},
            {app:'AWUN',schema:2,data:{'awun-library':'{broken'}},
            {app:'AWUN',schema:2,data:{'awun-library':'[null]'}},
            {app:'AWUN',schema:2,data:{'awun-queue-v1':'{"items":null}'}},
            {app:'AWUN',schema:2,data:{'awun-visual':'[]'}},
            {app:'AWUN',schema:2,data:{'unrelated':'do not import'}},
            {app:'AWUN',schema:2,data:{'awun-runtime-log-v1':'[]'}}
          ];
          const outcomes=[];
          for(const backup of invalid){
            let rejected=false;
            try{await storage.importState(backup)}catch{rejected=true}
            outcomes.push({rejected,library:storage.readJSON('awun-library',[])});
          }
          process.stdout.write(JSON.stringify(outcomes));
        })().catch(error=>{console.error(error);process.exit(1)});
        """
    )
    assert len(result) == 8
    assert all(item == {"rejected": True, "library": [{"id": "keep-me"}]} for item in result)


def test_import_rolls_back_after_partial_write_failure() -> None:
    result = run_node(
        """
        (async()=>{
          const storage=require('./frontend/storage.js');
          storage.writeJSON('awun-library',[{id:'original'}]);
          storage.writeText('awun-language','ru');
          const original=localStorage.setItem.bind(localStorage);
          let failOnce=true;
          localStorage.setItem=(key,value)=>{
            if(key==='awun-queue-v1'&&failOnce){failOnce=false;throw new Error('quota exceeded')}
            original(key,value);
          };
          let rejected=false;
          try{await storage.importState({app:'AWUN',schema:2,data:{
            'awun-library':'[{"id":"replacement"}]','awun-queue-v1':'[]'
          }})}catch{rejected=true}
          process.stdout.write(JSON.stringify({rejected,library:storage.readJSON('awun-library',[]),language:storage.readText('awun-language'),queue:storage.readText('awun-queue-v1')}));
        })().catch(error=>{console.error(error);process.exit(1)});
        """
    )
    assert result == {"rejected": True, "library": [{"id": "original"}], "language": "ru", "queue": None}


def test_backup_preview_counts_tracks_without_changing_state() -> None:
    result = run_node(
        """
        const storage=require('./frontend/storage.js');
        storage.writeJSON('awun-library',[{id:'original'}]);
        const preview=storage.previewImport({app:'AWUN',schema:2,data:{
          'awun-library':'[{"id":"one"},{"id":"two"}]',
          'awun-queue-v1':'{"mode":"manual","items":[{"id":"next"}]}'
        }});
        delete global.localStorage;
        process.stdout.write(JSON.stringify({preview,fallback:storage.readText('awun-language','ru')}));
        """
    )
    assert result == {"preview": {"library_tracks": 2, "queue_tracks": 1}, "fallback": "ru"}


def test_import_rollback_removes_keys_created_by_failed_migration() -> None:
    result = run_node(
        """
        (async()=>{
          const storage=require('./frontend/storage.js');
          storage.writeJSON('awun-library',[{id:'original'}]);
          const before=storage.snapshot();
          const original=localStorage.setItem.bind(localStorage);
          let failOnce=true;
          localStorage.setItem=(key,value)=>{
            if(key==='awun-storage-meta-v2'&&failOnce){failOnce=false;throw new Error('quota exceeded')}
            original(key,value);
          };
          let rejected=false;
          try{await storage.importState({app:'AWUN',schema:1,data:{'awun-flow-profile-v1':'{"likes":{}}'}})}catch{rejected=true}
          process.stdout.write(JSON.stringify({rejected,before,after:storage.snapshot()}));
        })().catch(error=>{console.error(error);process.exit(1)});
        """
    )
    assert result["rejected"] is True
    assert result["after"] == result["before"]


def test_runtime_log_redacts_embedded_credentials_and_old_entries() -> None:
    result = run_node(
        """
        global.awunStorage=require('./frontend/storage.js');
        awunStorage.writeJSON('awun-runtime-log-v1',[{event:'old',details:{message:'GET https://user:pass@example.com/audio?signature=old-secret failed'}}]);
        const log=require('./frontend/runtime-log.js');
        log.log('failed',{message:'Request https://example.com/audio?token=url-secret failed; Bearer bearer-secret; api_key=key-secret',header:'Cookie: session=cookie-secret; other=other-secret'});
        process.stdout.write(JSON.stringify(log.report()));
        """
    )
    output = json.dumps(result)
    for secret in ["user:pass", "old-secret", "url-secret", "bearer-secret", "key-secret", "cookie-secret", "other-secret"]:
        assert secret not in output
    assert "https://example.com/audio" in output


def test_update_check_times_out_during_request_or_response_body() -> None:
    result = run_node(
        """
        (async()=>{
          const updates=require('./frontend/update-checker.js');
          const outcomes=[];
          for(const bodyStalls of [false,true]){
            let signal;
            const fetcher=async(_url,options)=>{
              signal=options.signal;
              if(!bodyStalls)return new Promise(()=>{});
              return {ok:true,status:200,json:()=>new Promise(()=>{})};
            };
            try{await updates.check('1.10.2',fetcher,{timeoutMs:15})}
            catch(error){outcomes.push({code:error.code,aborted:signal.aborted})}
          }
          process.stdout.write(JSON.stringify(outcomes));
        })().catch(error=>{console.error(error);process.exit(1)});
        """
    )
    assert result == [{"code": "UPDATE_TIMEOUT", "aborted": True}] * 2


def test_update_check_validates_versions_and_release_destination() -> None:
    result = run_node(
        """
        (async()=>{
          const updates=require('./frontend/update-checker.js');
          const response=tag=>async()=>({ok:true,status:200,json:async()=>({tag_name:tag,html_url:'javascript:alert(1)'})});
          const safe=await updates.check('1.10.2',response('v1.10.3'));
          let rejected=false;
          try{await updates.check('1.10.2',response('not-a-version'))}catch{rejected=true}
          process.stdout.write(JSON.stringify({safe,rejected,stable:updates.compare('1.10.3','1.10.3-beta.1'),numeric:updates.compare('1.10.3-beta.10','1.10.3-beta.2')}));
        })().catch(error=>{console.error(error);process.exit(1)});
        """
    )
    assert result["safe"]["url"] == "https://github.com/Loro66/AWUN/releases"
    assert result["safe"]["available"] is True
    assert result["rejected"] is True
    assert result["stable"] == 1
    assert result["numeric"] == 1
