<img src="assets/icon.svg" width="64" height="64" alt="Borad">

# Borad

一款用于查看本机 Magpie 请求、Token 用量和供应商额度的 Windows 桌面应用。

## 下载安装

从项目的 GitHub Releases 页面下载 Windows x64 版本：

- **安装版** `Borad-1.0.0-win-x64.exe`：双击安装，再从桌面或开始菜单打开 Borad。
- **免安装版** `Borad-1.0.0-win-x64.zip`：完整解压后，双击其中的 `Borad.exe`。请保留整个文件夹。

应用已内置 Electron 和 `cloudflared`，无需另装 Node.js、PowerShell 或浏览器。初始口令为 `jbc`；如果你以前修改过口令，请使用修改后的口令。登录后可在设置中修改口令并选择要隐藏的额度账号。

首页可切换 Claude、GitHub、Google 和森林四种主题，并可按需开启临时公网访问或设置开机启动。公网地址在重新连接时变化；关闭应用会结束分享和本机服务。

Borad 读取当前 Windows 用户的 Magpie 数据，默认位于 `%USERPROFILE%\.config\magpie`。新电脑需要先安装、配置并使用 Magpie 才会出现自己的请求和用量；额度查询还需要本机 Magpie 命令。Borad 不包含账号和 API 密钥。

更多说明见 [Release 使用说明](RELEASE-README.md)；配色、字体和交互设计依据见 [设计文档](docs/design.md)。当前构建未使用代码签名证书，Windows 可能显示未知发布者。下载后可使用 Release 附带的 `SHA256SUMS.txt` 核对文件。

## 本地开发

需要 Windows x64、Node.js 和 npm。安装依赖后构建并运行桌面程序：

```powershell
npm ci
npm start
```

构建安装版和免安装压缩包：

```powershell
npm run package:win
```

打包脚本会准备并校验固定版本的 Cloudflare `cloudflared`。输出位于 `release/`，安装包不会包含本机配置、口令文件或用户数据。Electron 45、React 19、TypeScript 7 和 Vite 8 的具体版本锁定在 `package-lock.json` 中。

旧版独立网页服务保留在源码中，开发者可用 `node server.cjs` 启动，默认监听 `127.0.0.1:8790`；桌面应用使用独立的 `127.0.0.1:18790`。
