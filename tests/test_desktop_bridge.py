from types import SimpleNamespace
import json
import subprocess

from desktop.csp_bridge import API_FACTORY, configure_native_bridge
from desktop.window_geometry import fit_window_size


def test_native_replies_bypass_eval_but_preserve_other_evaluation():
    calls = []
    window = SimpleNamespace(
        evaluate_js=lambda script, callback=None: calls.append(('evaluate', script, callback)),
        run_js=lambda script: calls.append(('raw', script)),
    )
    configure_native_bridge(window)
    reply = 'window.pywebview._returnValuesCallbacks["load_state"]["1"]({value: "{}"})'
    window.evaluate_js(reply)
    assert calls == [('raw', reply)]
    callback = lambda result: result
    window.evaluate_js('document.title', callback)
    assert calls[-1] == ('evaluate', 'document.title', callback)


def test_csp_factory_handles_nested_arguments_and_native_rejections_without_function():
    script = r'''
const vm = require('node:vm');
const replies = {};
const bridge = {api:{},_returnValuesCallbacks:{},
  _checkValue(name,resolve,reject,id) { replies[id]={resolve,reject}; },
  _jsApiCallback(name,args,id) { name==='nested.fail' ? replies[id].reject(new Error('denied')) : replies[id].resolve(args); },
};
const context = {window:{pywebview:bridge},Function:()=>{throw new Error('CSP forbids Function')},eval:()=>{throw new Error('CSP forbids eval')}};
vm.runInNewContext(SOURCE,context);
bridge._createApi([{func:'nested.echo',params:['value']},{func:'nested.fail',params:[]}]);
(async()=>{
  const values=await bridge.api.nested.echo('Привет',{value:42});let error='';
  try{await bridge.api.nested.fail()}catch(e){error=e.message}
  console.log(JSON.stringify({values,error}));
})().catch(error=>{console.error(error);process.exit(1)});
'''.replace('SOURCE', json.dumps(API_FACTORY))
    result = subprocess.run(['node','-e',script],check=True,capture_output=True,text=True,encoding='utf-8')
    assert json.loads(result.stdout) == {'values':['Привет',{'value':42}],'error':'denied'}


def test_startup_window_fits_common_small_work_areas():
    for width,height in [(1024,720),(1280,672),(1366,728),(1920,1040)]:
        app_width,app_height=fit_window_size(width,height)
        assert 440 <= app_width <= width-32
        assert 300 <= app_height <= height-32
