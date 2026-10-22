"""Deliver pywebview 6.2 native replies without enabling eval in the page CSP."""


def configure_native_bridge(window) -> None:
    """Use the raw execution API for pywebview's generated reply expression.

    pywebview 6.2.1 wraps JS API replies in evaluate_js(), which uses eval().
    Its reply does not need last-expression evaluation or a Python return value.
    Keep the normal evaluator for unrelated callers and leave the page CSP intact.
    """
    evaluate = window.evaluate_js

    def reply_without_eval(script, callback=None):
        if callback is None and isinstance(script, str) and script.startswith(
            'window.pywebview._returnValuesCallbacks['
        ):
            return window.run_js(script)
        return evaluate(script, callback)

    window.evaluate_js = reply_without_eval
