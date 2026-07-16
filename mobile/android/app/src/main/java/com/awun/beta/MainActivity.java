package com.awun.beta;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private WebView webView;
    private ImageView splash;
    private String[] endpoints;
    private int endpointIndex = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(16, 17, 14));
        getWindow().setNavigationBarColor(Color.rgb(8, 9, 6));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16, 17, 14));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(16, 17, 14));
        endpoints = BuildConfig.AWUN_MIRROR_URL.isEmpty()
                ? new String[]{BuildConfig.AWUN_PRIMARY_URL}
                : new String[]{BuildConfig.AWUN_PRIMARY_URL, BuildConfig.AWUN_MIRROR_URL};

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " AWUN-Android/1.7");

        ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.getProgressDrawable().setTint(Color.rgb(183, 255, 25));

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        splash = new ImageView(this);
        splash.setImageResource(com.awun.beta.R.mipmap.ic_launcher);
        splash.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        splash.setBackgroundColor(Color.rgb(5, 5, 5));
        int splashSize = Math.round(156 * getResources().getDisplayMetrics().density);
        FrameLayout.LayoutParams splashParams = new FrameLayout.LayoutParams(
                splashSize,
                splashSize,
                Gravity.CENTER
        );
        root.addView(splash, splashParams);
        root.addView(progress, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                5,
                Gravity.TOP
        ));
        setContentView(root);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (splash != null) {
                    ((ViewGroup) splash.getParent()).removeView(splash);
                    splash = null;
                }
            }

            @Override
            public void onReceivedError(WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame() && endpointIndex + 1 < endpoints.length) {
                    endpointIndex += 1;
                    view.loadUrl(endpoints[endpointIndex]);
                    Toast.makeText(MainActivity.this, "Switching to AWUN mirror", Toast.LENGTH_SHORT).show();
                    return;
                }
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400 && endpointIndex + 1 < endpoints.length) {
                    endpointIndex += 1;
                    view.loadUrl(endpoints[endpointIndex]);
                    Toast.makeText(MainActivity.this, "Switching to AWUN mirror", Toast.LENGTH_SHORT).show();
                    return;
                }
                super.onReceivedHttpError(view, request, response);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value >= 100 ? ProgressBar.GONE : ProgressBar.VISIBLE);
            }
        });
        webView.setDownloadListener(downloadListener());

        if (!hasNetwork()) {
            Toast.makeText(this, "AWUN will reconnect when the network is available", Toast.LENGTH_LONG).show();
        }
        webView.loadUrl(endpoints[endpointIndex]);
    }

    private DownloadListener downloadListener() {
        return (url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                request.addRequestHeader("User-Agent", userAgent);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setTitle(filename);
                request.setDescription("Downloaded by AWUN");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                manager.enqueue(request);
                Toast.makeText(this, "Download started", Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                Toast.makeText(this, "Download could not start", Toast.LENGTH_LONG).show();
            }
        };
    }

    private boolean hasNetwork() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        Network network = manager.getActiveNetwork();
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
