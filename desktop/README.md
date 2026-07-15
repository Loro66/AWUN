# AWUN Desktop

The desktop shell opens the hosted AWUN beta in a dedicated Windows window and
keeps its browser session between launches. It uses the Microsoft Edge WebView2
runtime included with current Windows 10 and Windows 11 installations.

On Windows, run `build-windows.bat`. The generated executable is written to
`dist\\AWUN.exe`.

The included GitHub Actions workflow can produce the same executable and a
SHA256 checksum on a Windows runner from **Actions → Windows desktop build →
Run workflow**. Version tags (`v*`) publish both files to GitHub Releases.

The default hosted URL is `https://awun-api1.onrender.com`. Set
`AWUN_DESKTOP_URL` before building to target a different deployment.
