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
