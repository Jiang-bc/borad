<img src="assets/icon.svg" width="64" height="64" alt="">

# borad

Created in [T3 Code](https://t3.codes).

## Windows 启动与公网访问

安装 Node.js、PowerShell 7 和 Cloudflare `cloudflared`（`winget install --id Cloudflare.cloudflared --exact --scope user`）后，运行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install-dashboard.ps1
```

安装后 Windows 登录时会在后台启动看板与临时公网隧道。桌面上的 `Magpie - Start` 可手动启动，`Magpie - Copy Address` 和 `Magpie - Copy Password` 分别复制公网地址和访问口令。口令为 `jbc`。临时公网地址在隧道重新连接后可能变化，需重新复制。

本机地址为 http://127.0.0.1:8790。状态日志位于 `%LOCALAPPDATA%\MagpieDashboard\dashboard.log`。如需仅以前台方式启动本地看板，运行 `node server.cjs`。
