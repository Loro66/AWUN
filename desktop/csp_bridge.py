"""Run the pywebview 6.2 native API without dynamic JavaScript compilation."""

API_FACTORY = r"""
window.pywebview._createApi = function (functions) {
  const bridge = window.pywebview;
  for (const descriptor of functions) {
    const name = descriptor.func, path = name.split('.'), method = path.pop();
    let target = bridge.api;
    for (const part of path) target = target[part] || (target[part] = {});
    bridge._returnValuesCallbacks[name] ||= {};
    target[method] = function (...args) {
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const result = new Promise((resolve, reject) => bridge._checkValue(name, resolve, reject, id));
      bridge._jsApiCallback(name, args, id);
      return result;
    };
  }
};
"""


def configure_native_bridge(window) -> None:
    """Use the raw execution API for pywebview's generated reply expression.

    pywebview 6.2.1 wraps JS API replies in evaluate_js(), which uses eval().
    Its reply does not need last-expression evaluation or a Python return value.
    Keep the normal evaluator for unrelated callers and leave the page CSP intact.
    """
    evaluate = window.evaluate_js
    run = window.run_js

    def create_without_function(script):
        if isinstance(script, str) and script.startswith('window.pywebview._createApi('):
            script = API_FACTORY + script
        return run(script)

    def reply_without_eval(script, callback=None):
        if callback is None and isinstance(script, str) and script.startswith(
            'window.pywebview._returnValuesCallbacks['
        ):
            return run(script)
        return evaluate(script, callback)

    window.evaluate_js = reply_without_eval
    window.run_js = create_without_function
