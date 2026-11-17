<img src="assets/icon.svg" width="64" height="64" alt="Borad">

# Borad

一款用于查看本机 Magpie 请求、Token 用量和供应商额度的 Windows 桌面应用。

## 下载安装

从项目的 GitHub Releases 页面下载 Windows x64 版本：

- **安装版** `Borad-1.1.1-win-x64.exe`：双击安装，再从桌面或开始菜单打开 Borad。
- **免安装版** `Borad-1.1.1-win-x64.zip`：完整解压后，双击其中的 `Borad.exe`。请保留整个文件夹。

应用已内置 Electron，无需另装 Node.js、PowerShell 或浏览器。首次开启公网分享时会按需下载并校验 `cloudflared`，本地看板不依赖此下载。桌面窗口直接打开请求记录，无需输入口令。公网访问的初始口令为 `jbc`；如果你以前修改过口令，请使用修改后的口令。可在设置中修改公网口令并选择要隐藏的额度账号。

窗口顶部可切换 Claude、GitHub、Google 和森林四种主题；首页可以设置开机启动、启动时自动分享和关闭窗口后继续在后台运行。公网分享就绪后，可直接复制地址；地址在重新连接时变化。退出应用会结束分享和本机服务。

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

打包脚本会准备并校验 Cloudflare `cloudflared` 的许可文件；公网组件由应用在首次分享时下载并校验。输出位于 `release/`，安装包不会包含本机配置、口令文件或用户数据。Electron 45、React 19、TypeScript 7 和 Vite 8 的具体版本锁定在 `package-lock.json` 中。

运行测试：

```powershell
node --test tests/*.test.cjs
```

桌面窗口测试需要先执行 `npm run build`。开发者也可用 `node server.cjs` 启动本机网页服务，默认监听 `127.0.0.1:8790`；桌面应用使用独立的 `127.0.0.1:18790`。

源码位于根目录、`desktop/` 和 `public/`，构建与打包脚本位于 `scripts/`，测试位于 `tests/`。`desktop/ui/`、`dist/` 和 `release/` 是构建输出或本地缓存，不纳入版本管理。桌面设置升级时会自动清理已废弃的字段和推送凭据。
