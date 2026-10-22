from types import SimpleNamespace

from desktop.csp_bridge import configure_native_bridge


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
