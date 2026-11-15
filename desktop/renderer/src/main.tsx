import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChartNoAxesCombined,
  CircleAlert,
  Copy,
  Database,
  Globe2,
  House,
  Layers3,
  Link2,
  LoaderCircle,
  Send,
  Monitor,
  Palette,
  Power,
  Settings2,
  X,
} from "lucide-react";
import "@fontsource-variable/noto-sans-sc";
import "./style.css";

type View = "home" | "requests" | "tokens" | "quota" | "settings";
type Theme = "claude" | "github" | "google" | "forest";
type PushChannel = "wechat" | "qq";
type State = {
  ready: boolean;
  error: string;
  active: View;
  address: string;
  sharing: boolean;
  shareError: string;
  startup: boolean;
  startupError: string;
  autoShare: boolean;
  push: { bound: boolean; channels: PushChannel[]; automatic: boolean };
  pushResult: string;
  pushBusy: boolean;
  version: string;
  records: number;
  sourceReady: boolean;
};
declare global {
  interface Window {
    borad: {
      state(): Promise<State>;
      open(view: View): Promise<void>;
      share(enabled: boolean): Promise<State>;
      startup(enabled: boolean): Promise<State>;
      autoShare(enabled: boolean): Promise<State>;
      configurePush(options: { token: string; channels: PushChannel[]; automatic: boolean }): Promise<State>;
      clearPush(): Promise<State>;
      sendLink(): Promise<State>;
      copy(): Promise<void>;
      theme(theme: Theme): Promise<void>;
      subscribe(listener: (state: State) => void): () => void;
    };
  }
}
const initial: State = {
  ready: false,
  error: "",
  active: "home",
  address: "",
  sharing: false,
  shareError: "",
  startup: false,
  startupError: "",
  autoShare: false,
  push: { bound: false, channels: [], automatic: false },
  pushResult: "",
  pushBusy: false,
  version: "1.1.0",
  records: 0,
  sourceReady: false,
};
const sections = [
  {
    view: "requests",
    icon: Activity,
    title: "请求流水",
    description: "查看调用状态、耗时和实际使用的供应商。",
    tag: "查看请求",
  },
  {
    view: "tokens",
    icon: ChartNoAxesCombined,
    title: "Token 用量",
    description: "查看输入、输出数量与参考费用。",
    tag: "查看用量",
  },
  {
    view: "quota",
    icon: Layers3,
    title: "剩余额度",
    description: "在一处查看不同供应商的额度。",
    tag: "查看额度",
  },
] as const;

function App() {
  const [state, setState] = useState<State>(initial);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("borad-desktop-theme");
      if (saved === "github" || saved === "google" || saved === "forest")
        return saved;
    } catch {}
    return "claude";
  });
  useEffect(() => {
    let mounted = true;
    const update = (next: State) => {
      if (mounted) setState(next);
    };
    window.borad
      .state()
      .then(update)
      .catch(() => { setNoticeError(true); setNotice("无法连接桌面服务，请重新打开 Borad。"); });
    const unsubscribe = window.borad.subscribe(update);
    const timer = setInterval(() => {
      window.borad
        .state()
        .then(update)
        .catch(() => {});
    }, 5000);
    return () => {
      mounted = false;
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("borad-desktop-theme", theme);
    } catch {}
    window.borad.theme(theme).catch(() => {});
  }, [theme]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setNotice("");
    setNoticeError(false);
    try {
      await action();
    } catch (error) {
      setNoticeError(true);
      setNotice(
        error instanceof Error
          ? error.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : "操作未完成，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  function open(view: View) {
    void run(() => window.borad.open(view));
  }
  const error = state.error || state.shareError;
  return (
    <>
      <header className="titlebar">
        <button
          className="brand"
          onClick={() => open("home")}
        >
          <span className="brand-mark" aria-hidden="true">
            b<span>·</span>
          </span>
          <span>
            Borad<span className="brand-period">.</span>
          </span>
          <span className="sr-only">返回首页</span>
        </button>
        <nav aria-label="工作台导航">
          <button
            className={state.active === "home" ? "selected" : ""}
            onClick={() => open("home")}
            aria-label="首页"
            aria-current={state.active === "home" ? "page" : undefined}
          >
            <House size={16} />
            <span className="nav-label">首页</span>
          </button>
          {sections.map(({ view, title, icon: Icon }) => (
            <button
              key={view}
              disabled={!state.ready || busy}
              onClick={() => open(view)}
              className={state.active === view ? "selected" : ""}
              aria-label={title}
              aria-current={state.active === view ? "page" : undefined}
            >
              <Icon size={16} />
              <span className="nav-label">{title}</span>
            </button>
          ))}
        </nav>
        <label className="theme-select titlebar-theme" htmlFor="appearance">
          <Palette size={15} aria-hidden="true" />
          <span className="sr-only">界面主题</span>
          <select id="appearance" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            <option value="claude">Claude</option>
            <option value="github">GitHub</option>
            <option value="google">Google</option>
            <option value="forest">森林</option>
          </select>
        </label>
        <button
          className="settings-button"
          disabled={!state.ready || busy}
          onClick={() => open("settings")}
          aria-label="口令与显示设置"
        >
          <Settings2 size={18} />
          <span>设置</span>
        </button>
      </header>
      <main>
        <div className="page-top">
          <span className="eyebrow">工作台概览</span>
        </div>
        <section className="hero" aria-labelledby="welcome-title">
          <div className="hero-copy">
            <h1 id="welcome-title">
              用量工作台
            </h1>
            <p className="hero-description">
              查看请求记录、Token 用量和供应商额度。
            </p>
            <button
              className="primary-button"
              disabled={!state.ready || busy}
              onClick={() => open("requests")}
            >
              进入工作台 <ArrowUpRight size={19} />
            </button>
          </div>
          <aside className="overview" aria-label="当前运行状态">
            <div className="overview-heading">
              <h2>当前状态</h2>
              <span
                className={
                  state.ready ? "overview-badge ready" : "overview-badge"
                }
              >
                <span
                  className={state.ready ? "status-dot live" : "status-dot"}
                />
                {state.ready
                  ? "本机工作台已就绪"
                  : state.error
                    ? "服务需要处理"
                    : "正在准备"}
              </span>
            </div>
            <div className="overview-row">
              <div className="overview-icon">
                <Monitor size={18} />
              </div>
              <div>
                <strong>看板服务</strong>
                <span>在此设备上运行</span>
              </div>
              <b>{state.ready ? "运行中" : "未就绪"}</b>
            </div>
            <div className="overview-row">
              <div className="overview-icon">
                <Database size={18} />
              </div>
              <div>
                <strong>Magpie 数据</strong>
                <span>请求历史和用量</span>
              </div>
              <b>
                {state.sourceReady
                  ? `${state.records.toLocaleString("zh-CN")} 条记录`
                  : "尚未读取"}
              </b>
            </div>
            <div className="overview-row">
              <div className="overview-icon">
                <Globe2 size={18} />
              </div>
              <div>
                <strong>公网分享</strong>
                <span>通过临时链接访问</span>
              </div>
              <b>
                {state.address
                  ? "已开启"
                  : state.sharing
                    ? "正在连接"
                    : "未开启"}
              </b>
            </div>
          </aside>
        </section>
        <section
          className="workspace-section"
          aria-labelledby="workspace-title"
        >
          <div className="section-heading">
            <h2 id="workspace-title">你的数据</h2>
            <span>选择要查看的内容</span>
          </div>
          <div className="workspace-grid">
            {sections.map(({ view, icon: Icon, title, description, tag }) => (
              <button
                className="workspace-card"
                key={view}
                disabled={!state.ready || busy}
                onClick={() => open(view)}
              >
                <div className={`card-icon ${view}`}>
                  <Icon size={22} strokeWidth={1.7} />
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
                <span className="card-bottom">
                  <span>{tag}</span>
                  <ArrowUpRight size={18} />
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="utilities" aria-label="连接和启动偏好">
          <div className="utility share-panel">
            <div className="utility-heading">
              <div className="utility-icon">
                <Globe2 size={20} />
              </div>
              <div>
                <h2>公网分享</h2>
                <p>按需开启公网访问，用口令保护你的看板。</p>
              </div>
            </div>
            <div className="share-controls">
              <div className="share-value">
                <Link2 size={14} />
                <label className="sr-only" htmlFor="share-address">
                  公网访问地址
                </label>
                <input
                  id="share-address"
                  readOnly
                  value={state.address}
                  placeholder={
                    state.sharing ? "正在建立连接…" : "目前仅在这台电脑上访问"
                  }
                />
                <button
                  className="copy-button"
                  disabled={!state.address || busy}
                  aria-label={copied ? "地址已复制" : "复制公网地址"}
                  onClick={() =>
                    void run(async () => {
                      await window.borad.copy();
                      setCopied(true);
                      setNotice("公网地址已复制。");
                      setTimeout(() => setCopied(false), 2500);
                    })
                  }
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <button
                className={`share-button ${state.sharing ? "enabled" : ""}`}
                disabled={!state.ready || busy}
                onClick={() =>
                  void run(async () => {
                    setState(await window.borad.share(!state.sharing));
                  })
                }
              >
                {state.sharing && !state.address ? (
                  <LoaderCircle className="spin" size={14} />
                ) : null}
                {state.sharing
                  ? state.address
                    ? "关闭分享"
                    : "取消连接"
                  : "开启分享"}
              </button>
            </div>
            <p className="share-help">
              临时地址会在重新连接后变化；关闭应用也会结束分享。
            </p>
            <label className="startup-control" htmlFor="auto-share">
              <span>打开 Borad 时自动开启公网分享</span>
              <input type="checkbox" role="switch" id="auto-share" checked={state.autoShare} disabled={busy} onChange={(event) => {
                const enabled = event.target.checked;
                void run(async () => { setState(await window.borad.autoShare(enabled)); });
              }} />
            </label>
          </div>
          <div className="utility startup-panel">
            <div className="utility-heading">
              <div className="utility-icon">
                <Power size={20} />
              </div>
              <div>
                <h2>开机启动</h2>
                <p>登录 Windows 时，自动打开 Borad。</p>
              </div>
            </div>
            <label className="startup-control" htmlFor="startup">
              <span>
                登录 Windows 时启动 Borad
                <small>
                  {state.startup
                    ? "下次登录 Windows 时生效"
                    : "随时可以在这里关闭"}
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                id="startup"
                checked={state.startup}
                disabled={busy}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  void run(async () => {
                    setState(await window.borad.startup(enabled));
                    setNotice(
                      enabled ? "已开启开机启动。" : "已关闭开机启动。",
                    );
                  });
                }}
              />
            </label>
            {state.startupError && <p className="service-error" role="alert">{state.startupError}</p>}
          </div>
          <details className="utility push-panel">
            <summary><Send size={18} aria-hidden="true" /> 公网链接推送 <span>{state.push.bound ? (state.push.automatic ? "自动推送已开启" : "已配置") : "未配置"}</span></summary>
            <p className="share-help">先在 PushPlus 关注微信服务号或完成 QQ 机器人绑定，再填入 Token。推送内容只包含临时地址，访问仍需口令。</p>
            <form className="push-form" key={JSON.stringify(state.push)} onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const fields = new FormData(form);
              const channels = (["wechat", "qq"] as const).filter(channel => fields.has(channel));
              void run(async () => {
                setState(await window.borad.configurePush({ token: String(fields.get("token") ?? "").trim(), channels, automatic: fields.has("automatic") }));
                form.reset();
                setNotice("推送设置已保存。");
              });
            }}>
              <label htmlFor="push-token">PushPlus Token {state.push.bound ? "（留空保留原 Token）" : ""}</label>
              <input id="push-token" name="token" type="password" autoComplete="off" spellCheck={false} required={!state.push.bound} maxLength={128} />
              <fieldset>
                <legend>接收渠道</legend>
                <label><input type="checkbox" name="wechat" defaultChecked={state.push.channels.includes("wechat")} /> 微信服务号</label>
                <label><input type="checkbox" name="qq" defaultChecked={state.push.channels.includes("qq")} /> QQ 机器人</label>
              </fieldset>
              <label className="startup-control" htmlFor="auto-push">
                <span>每次公网分享就绪后自动推送</span>
                <input type="checkbox" role="switch" id="auto-push" name="automatic" defaultChecked={state.push.automatic} />
              </label>
              <div className="push-actions">
                <button className="share-button" type="submit" disabled={busy || state.pushBusy}>保存推送设置</button>
                <button className="share-button enabled" type="button" disabled={!state.push.bound || !state.address || busy || state.pushBusy} onClick={() => void run(async () => setState(await window.borad.sendLink()))}>立即推送</button>
                {state.push.bound && <button className="share-button enabled" type="button" disabled={busy || state.pushBusy} onClick={() => void run(async () => setState(await window.borad.clearPush()))}>解除绑定</button>}
              </div>
            </form>
            <p className="share-help" role="status">{state.pushResult || (state.address ? "" : "开启公网分享后可立即推送。")}</p>
          </details>
        </section>
        {error && (
          <p className="service-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <span>本机处理 · 账号脱敏</span>
          <span>
            Borad 桌面版 <span className="version">v{state.version}</span>
          </span>
        </footer>
        <p className="data-note">
          Borad 展示本机 Magpie 已有的用量数据；新电脑需要先安装并使用
          Magpie。桌面应用已内置运行环境和分享组件。
        </p>
      </main>
    <div className="toast" role={noticeError ? 'alert' : 'status'} data-kind={noticeError ? 'error' : 'success'} hidden={!notice}>
      {noticeError ? <CircleAlert size={16} /> : <Check size={16} />}
        <span>{notice}</span>
        <button onClick={() => setNotice("")} aria-label="关闭提示">
          <X size={15} />
        </button>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
