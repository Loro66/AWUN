package com.loro66.awun;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class MainActivity extends Activity {
    private FrameLayout root;
    private WebView webView;
    private ProgressBar progress;
    private View splash;
    private View errorView;
    private String[] endpoints;
    private int endpointIndex;
    private boolean pageLoaded;
    private boolean mainFrameFailed;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private OnBackInvokedCallback backInvokedCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(getColor(R.color.awun_background));
        getWindow().setNavigationBarColor(getColor(R.color.awun_background_deep));

        endpoints = validEndpoints();
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.awun_background_deep));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(
                    insets.getSystemWindowInsetLeft(),
                    insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(),
                    insets.getSystemWindowInsetBottom()
            );
            return insets;
        });
        webView = createWebView();
        progress = createProgressBar();
        splash = createSplash();

        root.addView(webView, matchParent());
        root.addView(splash, matchParent());
        root.addView(progress, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(3),
                Gravity.TOP
        ));
        setContentView(root);

        registerNetworkCallback();
        registerBackNavigation();
        if (!hasNetwork()) {
            Toast.makeText(this, R.string.no_network, Toast.LENGTH_LONG).show();
        }
        loadCurrentEndpoint();
    }

    private WebView createWebView() {
        WebView view = new WebView(this);
        view.setBackgroundColor(getColor(R.color.awun_background));

        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setUserAgentString(settings.getUserAgentString() + " AWUN-Android/" + BuildConfig.VERSION_NAME);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        view.setWebViewClient(new AwunWebViewClient());
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView current, int value) {
                progress.setProgress(value);
                progress.setVisibility(value >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        return view;
    }

    private ProgressBar createProgressBar() {
        ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.getProgressDrawable().setTint(getColor(R.color.awun_acid));
        return bar;
    }

    private View createSplash() {
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(getColor(R.color.awun_background_deep));

        ImageView mark = new ImageView(this);
        mark.setImageResource(R.mipmap.ic_launcher);
        mark.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        mark.setContentDescription(getString(R.string.app_icon_description));
        FrameLayout.LayoutParams markParams = new FrameLayout.LayoutParams(dp(148), dp(148), Gravity.CENTER);
        container.addView(mark, markParams);

        TextView loading = new TextView(this);
        loading.setText(R.string.loading);
        loading.setTextColor(getColor(R.color.awun_muted));
        loading.setTextSize(11);
        loading.setGravity(Gravity.CENTER);
        loading.setLetterSpacing(0.12f);
        FrameLayout.LayoutParams loadingParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER_HORIZONTAL | Gravity.BOTTOM
        );
        loadingParams.bottomMargin = dp(64);
        container.addView(loading, loadingParams);
        return container;
    }

    private void loadCurrentEndpoint() {
        if (endpoints.length == 0) {
            showError(getString(R.string.web_error));
            return;
        }
        pageLoaded = false;
        mainFrameFailed = false;
        removeError();
        progress.setVisibility(View.VISIBLE);
        webView.loadUrl(appUrl(endpoints[endpointIndex]));
    }

    private String appUrl(String endpoint) {
        String language = Locale.getDefault().getLanguage().equals("ru") ? "ru" : "en";
        return Uri.parse(endpoint).buildUpon()
                .appendQueryParameter("platform", BuildConfig.AWUN_CLIENT_ID)
                .appendQueryParameter("lang", language)
                .build()
                .toString();
    }

    private String[] validEndpoints() {
        List<String> result = new ArrayList<>();
        addHttpsEndpoint(result, BuildConfig.AWUN_PRIMARY_URL);
        addHttpsEndpoint(result, BuildConfig.AWUN_MIRROR_URL);
        return result.toArray(new String[0]);
    }

    private void addHttpsEndpoint(List<String> result, String candidate) {
        if (candidate == null || candidate.trim().isEmpty()) return;
        Uri uri = Uri.parse(candidate.trim());
        if ("https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && !result.contains(candidate.trim())) {
            result.add(candidate.trim());
        }
    }

    private boolean isTrusted(Uri uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return false;
        for (String endpoint : endpoints) {
            String host = Uri.parse(endpoint).getHost();
            if (host != null && host.equalsIgnoreCase(uri.getHost())) return true;
        }
        return false;
    }

    private boolean fallbackOrShow(String message) {
        if (endpointIndex + 1 < endpoints.length) {
            endpointIndex += 1;
            Toast.makeText(this, R.string.mirror_selected, Toast.LENGTH_SHORT).show();
            loadCurrentEndpoint();
            return true;
        }
        showError(message);
        return false;
    }

    private void showError(String message) {
        removeSplash();
        removeError();
        errorView = createErrorView(message);
        root.addView(errorView, matchParent());
        progress.setVisibility(View.GONE);
    }

    private View createErrorView(String message) {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(32), dp(32), dp(32), dp(32));
        panel.setBackgroundColor(getColor(R.color.awun_background_deep));

        ImageView mark = new ImageView(this);
        mark.setImageResource(R.mipmap.ic_launcher);
        mark.setContentDescription(getString(R.string.app_icon_description));
        panel.addView(mark, new LinearLayout.LayoutParams(dp(92), dp(92)));

        TextView title = new TextView(this);
        title.setText(R.string.offline_title);
        title.setTextColor(getColor(R.color.awun_text));
        title.setTextSize(25);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = wrapContent();
        titleParams.topMargin = dp(26);
        panel.addView(title, titleParams);

        TextView body = new TextView(this);
        body.setText(message.trim().isEmpty() ? getString(R.string.offline_message) : message + "\n\n" + getString(R.string.offline_message));
        body.setTextColor(getColor(R.color.awun_muted));
        body.setTextSize(15);
        body.setGravity(Gravity.CENTER);
        body.setLineSpacing(0, 1.25f);
        LinearLayout.LayoutParams bodyParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        bodyParams.topMargin = dp(16);
        panel.addView(body, bodyParams);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setTextColor(Color.BLACK);
        retry.setBackgroundColor(getColor(R.color.awun_acid));
        retry.setOnClickListener(ignored -> {
            endpointIndex = 0;
            loadCurrentEndpoint();
        });
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(52)
        );
        retryParams.topMargin = dp(28);
        panel.addView(retry, retryParams);

        Button privacy = new Button(this);
        privacy.setText(R.string.privacy);
        privacy.setTextColor(getColor(R.color.awun_text));
        privacy.setBackgroundColor(Color.TRANSPARENT);
        privacy.setOnClickListener(ignored -> openExternal(privacyUrl()));
        LinearLayout.LayoutParams privacyParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48)
        );
        privacyParams.topMargin = dp(8);
        panel.addView(privacy, privacyParams);
        return panel;
    }

    private Uri privacyUrl() {
        if (endpoints.length == 0) return Uri.parse("https://github.com/Loro66/AWUN");
        return Uri.parse(endpoints[0]).buildUpon().path("/privacy").clearQuery().build();
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme) && !"mailto".equalsIgnoreCase(scheme)) {
            Toast.makeText(this, R.string.unsafe_link, Toast.LENGTH_LONG).show();
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, R.string.external_link_error, Toast.LENGTH_LONG).show();
        }
    }

    private void removeSplash() {
        if (splash != null) {
            root.removeView(splash);
            splash = null;
        }
    }

    private void removeError() {
        if (errorView != null) {
            root.removeView(errorView);
            errorView = null;
        }
    }

    private boolean hasNetwork() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        Network network = manager.getActiveNetwork();
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    private void registerNetworkCallback() {
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> {
                    if (errorView != null && !pageLoaded) {
                        endpointIndex = 0;
                        loadCurrentEndpoint();
                    }
                });
            }
        };
        connectivityManager.registerDefaultNetworkCallback(networkCallback);
    }

    private FrameLayout.LayoutParams matchParent() {
        return new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        );
    }

    private LinearLayout.LayoutParams wrapContent() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void handleBackNavigation() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            finishAfterTransition();
        }
    }

    private void registerBackNavigation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backInvokedCallback = this::handleBackNavigation;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    backInvokedCallback
            );
        }
    }

    @SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBackNavigation();
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.evaluateJavascript("window.awunApp?.pausePlayback?.()", null);
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backInvokedCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
            backInvokedCallback = null;
        }
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (IllegalArgumentException ignored) {
                // Callback was already unregistered by the system.
            }
        }
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.clearHistory();
            webView.removeAllViews();
            webView.destroy();
        }
        super.onDestroy();
    }

    private final class AwunWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isTrusted(uri)) return false;
            openExternal(uri);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!mainFrameFailed && errorView == null) {
                pageLoaded = true;
            }
            removeSplash();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                mainFrameFailed = true;
                fallbackOrShow(getString(R.string.web_error));
            }
        }

        @Override
        public void onReceivedHttpError(
                WebView view,
                WebResourceRequest request,
                WebResourceResponse response
        ) {
            if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                mainFrameFailed = true;
                fallbackOrShow(getString(R.string.server_error, response.getStatusCode()));
            }
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            mainFrameFailed = true;
            fallbackOrShow(getString(R.string.unsafe_link));
        }

    }
}
