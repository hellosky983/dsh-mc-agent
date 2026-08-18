// dsh-mc-agent — Client half (formal bundle)
// Full-screen Minecraft launcher UI rendered into the `root` slot: the shell's
// own AppFrame is shadowed, so this DSH instance *is* the launcher page.
// Talks to the host half over /api/mc/* (same-origin fetch).
window.__ModuleLoader__.load({
  id: "dsh-mc-agent",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    var appCtx = null;
    var appMode = "tab"; // 'tab' | 'fullscreen' — set once before mount

    var THEMES = {
      default: { bg: "radial-gradient(1200px 700px at 30% 0%,#3a5a40 0%,#1c2a24 35%,#0d1318 75%,#070b0f 100%)", accent: "#7ce38b" },
      light: { bg: "linear-gradient(160deg,#4a5a66 0%,#3a4a55 45%,#2e3c46 100%)", accent: "#6fd6a0" },
      ocean: { bg: "radial-gradient(1200px 700px at 30% 0%,#1e3a5f 0%,#12233d 40%,#0a1626 100%)", accent: "#5ab0ff" },
      end: { bg: "radial-gradient(1200px 700px at 30% 0%,#2b1b3d 0%,#1a1030 45%,#0b0616 100%)", accent: "#c07cff" },
      lava: { bg: "radial-gradient(1200px 700px at 30% 0%,#5f2a1a 0%,#3d1d12 40%,#1a0c08 100%)", accent: "#ff9a5a" },
    };

    // ---------------------------------------------------------------- css ---
    var CSS = [
      ".dshmc{position:fixed;inset:0;background:radial-gradient(1200px 700px at 30% 0%,#3a5a40 0%,#1c2a24 35%,#0d1318 75%,#070b0f 100%);color:#e8e8e8;font-family:'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden;user-select:none}",
      ".dshmc *{box-sizing:border-box}",
      ".dshmc-top{display:flex;align-items:center;justify-content:space-between;padding:10px 18px;background:rgba(8,12,16,.55);border-bottom:2px solid rgba(90,180,110,.35);gap:14px;flex-wrap:wrap}",
      ".dshmc-brand{display:flex;align-items:baseline;gap:10px}",
      ".dshmc-logo{font-weight:900;font-size:22px;letter-spacing:2px;color:var(--mc-accent,#7ce38b);text-shadow:3px 3px 0 #17351f,6px 6px 0 rgba(0,0,0,.55);line-height:1}",
      ".dshmc-logo-sub{font-size:11px;color:#8fb896;letter-spacing:3px;text-transform:uppercase}",
      ".dshmc-top-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      ".dshmc-chip{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:6px 12px;font-size:12px}",
      ".dshmc-chip .dot{width:8px;height:8px;border-radius:50%;display:inline-block}",
      ".dshmc-chip .dot.green{background:#4ade80}.dshmc-chip .dot.red{background:#f87171}.dshmc-chip .dot.yellow{background:#fbbf24}.dshmc-chip .dot.gray{background:#64748b}",
      ".dshmc-body{flex:1;display:flex;min-height:0}",
      ".dshmc-left{width:300px;min-width:240px;display:flex;flex-direction:column;background:rgba(10,15,12,.6);border-right:1px solid rgba(90,180,110,.22)}",
      ".dshmc-left-head{padding:12px 14px 8px;font-size:12px;font-weight:700;letter-spacing:1px;color:#9ad8a5;text-transform:uppercase}",
      ".dshmc-versions{flex:1;overflow-y:auto;padding:2px 8px 12px}",
      ".dshmc-vgroup{margin-top:10px}",
      ".dshmc-vgroup-title{font-size:11px;color:#7a8f80;padding:2px 8px;letter-spacing:1px;text-transform:uppercase}",
      ".dshmc-v{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:transparent;border:none;color:#d7e2d9;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600}",
      ".dshmc-v:hover{background:rgba(255,255,255,.07)}",
      ".dshmc-v.sel{background:rgba(76,175,80,.22);box-shadow:inset 3px 0 0 #4caf50}",
      ".dshmc-v .tag{font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.1);color:#aebfb4;letter-spacing:.5px;text-transform:uppercase;margin-left:auto}",
      ".dshmc-v .tag.inst{background:rgba(76,175,80,.25);color:#7ce38b}",
      ".dshmc-v .tag.snapshot{background:rgba(251,191,36,.2);color:#fbbf24}",
      ".dshmc-v .tag.old{background:rgba(148,163,184,.18);color:#94a3b8}",
      ".dshmc-main{flex:1;display:flex;flex-direction:column;min-width:0;padding:22px 28px}",
      ".dshmc-hero{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center}",
      ".dshmc-hero-title{font-size:38px;font-weight:900;letter-spacing:3px;color:#fff;text-shadow:4px 4px 0 #2f6b3a,8px 8px 0 rgba(0,0,0,.6);line-height:1.1}",
      ".dshmc-hero-sub{font-size:13px;color:#93a89a;letter-spacing:2px;text-transform:uppercase}",
      ".dshmc-version-card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:18px 26px;max-width:480px;width:100%}",
      ".dshmc-version-card .row{display:flex;justify-content:space-between;font-size:13px;padding:5px 0;color:#b9c9bd}",
      ".dshmc-version-card .row b{color:#eef6f0}",
      ".dshmc-play{position:relative;width:260px;padding:16px 0;border:none;border-radius:12px;font-size:22px;font-weight:900;letter-spacing:6px;color:#fff;cursor:pointer;text-shadow:2px 2px 0 rgba(0,0,0,.45);box-shadow:0 8px 0 #1d5c26,0 14px 28px rgba(0,0,0,.5);transition:transform .06s,box-shadow .06s;text-indent:6px}",
      ".dshmc-play:hover{filter:brightness(1.08)}",
      ".dshmc-play:active{transform:translateY(6px);box-shadow:0 2px 0 #1d5c26,0 8px 16px rgba(0,0,0,.5)}",
      ".dshmc-play.green{background:linear-gradient(180deg,var(--mc-accent,#6fdc7c),#3fae4e 60%,#2f8f3d)}",
      ".dshmc-play.gray{background:linear-gradient(180deg,#8d97a3,#66707c 60%,#525c68);box-shadow:0 8px 0 #39424d,0 14px 28px rgba(0,0,0,.5)}",
      ".dshmc-play:disabled{cursor:not-allowed;opacity:.75}",
      ".dshmc-progress{width:100%;max-width:460px}",
      ".dshmc-progress .bar{height:14px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.15);border-radius:7px;overflow:hidden}",
      ".dshmc-progress .fill{height:100%;background:linear-gradient(90deg,var(--mc-accent,#4ade80),#2f9e4b);transition:width .25s}",
      ".dshmc-progress .lbl{display:flex;justify-content:space-between;font-size:11px;color:#9fb5a6;margin-top:6px}",
      ".dshmc-btns{display:flex;gap:10px}",
      ".dshmc-btn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);color:#e8e8e8;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}",
      ".dshmc-btn:hover{background:rgba(255,255,255,.18)}",
      ".dshmc-btn.danger:hover{background:rgba(248,113,113,.25);border-color:rgba(248,113,113,.5)}",
      ".dshmc-btn.green{background:rgba(76,175,80,.3);border-color:rgba(76,175,80,.5)}",
      ".dshmc-log{height:200px;border-top:2px solid rgba(90,180,110,.35);background:rgba(5,8,10,.85);display:flex;flex-direction:column}",
      ".dshmc-log-head{display:flex;align-items:center;justify-content:space-between;padding:6px 16px;font-size:11px;color:#8fb896;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.07)}",
      ".dshmc-log-body{flex:1;overflow-y:auto;padding:8px 16px;font-family:Consolas,'Courier New',monospace;font-size:11.5px;line-height:1.5;color:#a8c3ae;white-space:pre-wrap;word-break:break-all}",
      ".dshmc-modal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100}",
      ".dshmc-modal-card{background:#141b16;border:2px solid #3fae4e;border-radius:14px;padding:26px 30px;width:460px;max-width:92vw;box-shadow:0 24px 70px rgba(0,0,0,.7)}",
      ".dshmc-modal-title{font-size:18px;font-weight:800;color:#fff;margin-bottom:14px;letter-spacing:1px}",
      ".dshmc-field{margin-bottom:14px}",
      ".dshmc-field label{display:block;font-size:11px;color:#9fb5a6;letter-spacing:1px;text-transform:uppercase;margin-bottom:5px}",
      ".dshmc-field input{width:100%;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:8px;padding:9px 12px;font-size:13px;outline:none}",
      ".dshmc-field input:focus{border-color:#4caf50}",
      ".dshmc-code{background:#0a0f0c;border:1px dashed #4caf50;border-radius:10px;padding:16px;text-align:center;margin:14px 0}",
      ".dshmc-code .big{font-size:34px;font-weight:900;letter-spacing:8px;color:#7ce38b;font-family:Consolas,monospace;text-indent:8px}",
      ".dshmc-code .url{font-size:12px;color:#a8c3ae;margin-top:8px;word-break:break-all}",
      ".dshmc-hint{font-size:12px;color:#8fa598;line-height:1.6;margin-bottom:8px}",
      ".dshmc-modal-row{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}",
      ".dshmc-err{color:#fca5a5;font-size:12px;margin-top:6px}",
      ".dshmc-ok{color:#86efac;font-size:12px;margin-top:6px;font-weight:700}",
      ".dshmc-log-empty{color:#4c5f52;text-align:center;margin-top:20px;font-size:12px}",
      ".dshmc-scroll::-webkit-scrollbar{width:8px}.dshmc-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:4px}",
      ".dshmc-foot{padding:10px 18px;display:flex;align-items:center;gap:14px;background:rgba(8,12,16,.55);border-top:2px solid rgba(90,180,110,.35);font-size:11px;color:#6f8a78;flex-wrap:wrap}",
      ".dshmc-foot b{color:#9ad8a5;font-weight:600}",
      ".dshmc-java-ok{color:#86efac}.dshmc-java-bad{color:#fca5a5}",
      ".dshmc-account{padding:6px 14px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:1px solid;background:rgba(255,255,255,.08);color:#e8e8e8;border-color:rgba(255,255,255,.18)}",
      ".dshmc-account.in{background:rgba(76,175,80,.22);border-color:var(--mc-accent,#4caf50);color:var(--mc-accent,#7ce38b)}",
      ".dshmc-tab{position:relative;inset:auto;width:100%;height:100%;border-radius:0}",
      ".dshmc-vselect{width:100%;max-width:420px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:10px;padding:11px 14px;font-size:15px;font-weight:700;outline:none;cursor:pointer}",
      ".dshmc-vselect:focus{border-color:#4caf50}",
      ".dshmc-vselect optgroup{background:#141b16;color:#9ad8a5;font-weight:700}",
      ".dshmc-vselect option{background:#141b16;color:#e8e8e8;font-weight:500}",
      ".dshmc-login-banner{display:flex;align-items:center;gap:12px;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.45);border-radius:12px;padding:12px 18px;max-width:520px;width:100%;text-align:left}",
      ".dshmc-login-banner .msg{flex:1;font-size:13px;color:#fecaca;line-height:1.5}",
      ".dshmc-login-banner .btn{background:linear-gradient(180deg,#f87171,#dc2626);color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap}",
      ".dshmc-login-banner .btn:hover{filter:brightness(1.08)}",
      ".dshmc-mapwrap{width:360px;min-width:260px;display:flex;flex-direction:column;background:rgba(10,15,12,.5);border-left:1px solid rgba(90,180,110,.2);padding:10px}",
      ".dshmc-maphead{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 8px;font-size:12px;font-weight:700;color:#9ad8a5;letter-spacing:1px}",
      ".dshmc-mlegend{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;color:#b9c9bd}",
      ".dshmc-mlegend i{width:9px;height:9px;border-radius:50%;display:inline-block}",
      ".dshmc-map{width:100%;border:1px solid rgba(255,255,255,.12);border-radius:10px;image-rendering:pixelated}",
      ".dshmc-mapempty{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:#5f7a68;font-size:12px;padding:20px;border:1px dashed rgba(255,255,255,.12);border-radius:10px}",
    ].join("\n");

    // ------------------------------------------------------------ helpers ---
    function api(path, opts) {
      return fetch("/api/mc" + path, opts).then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || ("HTTP " + r.status)); });
        return r.json();
      });
    }

    // -------------------------------------------------------------- state ---
    var VMETA = {}; // version id -> manifest entry
    var VINST = {}; // version id -> installed
    var listeners = [];
    var notify = function () { listeners.forEach(function (f) { try { f(); } catch (e) {} }); };
    function setCatalog(versions, installed) {
      VMETA = {};
      versions.forEach(function (v) { VMETA[v.id] = v; });
      VINST = {};
      installed.forEach(function (v) { VINST[v.id] = v; });
      notify();
    }
    function useCatalog() {
      var force = React.useState(0)[1];
      React.useEffect(function () {
        var b = function () { force(function (x) { return x + 1; }); };
        listeners.push(b);
        return function () { listeners = listeners.filter(function (f) { return f !== b; }); };
      }, []);
      return { meta: VMETA, inst: VINST };
    }

    // ------------------------------------------------------- main component --
    function LauncherApp(props) {
      var catalog = useCatalog();
      var stState = React.useState({ load: true });
      var st = stState[0], setSt = stState[1];
      var stateRef = React.useRef(null);
      var selectedState = React.useState(null);
      var selected = selectedState[0], setSelected = selectedState[1];
      var logState = React.useState([]);
      var logs = logState[0], setLogs = logState[1];
      var logSinceRef = React.useRef(0);
      var logRef = React.useRef(null);
      var modalState = React.useState(null);
      var modal = modalState[0], setModal = modalState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var justInstalledRef = React.useRef(null);
      var eulaRef = React.useRef(null);
      var themeRef = React.useRef(null);
      var tickState = React.useState(0);
      var setTick = tickState[1];

      // boot: fetch catalog + state once
      React.useEffect(function () {
        var dead = false;
        api("/versions").then(function (d) {
          if (dead) return;
          setCatalog(d.versions, d.installed);
          api("/state").then(function (s) {
            if (dead) return;
            stateRef.current = s;
            if (s.selected && catalogRef.current.meta[s.selected]) setSelected(s.selected);
            else if (s.selected) setSelected(s.selected);
            else {
              var first = installedFirst(d);
              if (first) setSelected(first);
            }
            setSt({ load: false });
          }).catch(function (e) { if (!dead) setSt({ load: false, error: String(e) }); });
        }).catch(function (e) { if (!dead) setSt({ load: false, error: String(e) }); });
        return function () { dead = true; };
      }, []);

      var catalogRef = React.useRef(catalog);
      catalogRef.current = catalog;

      function installedFirst(d) {
        var inst = d.installed.map(function (v) { return v.id; });
        var sel = null;
        for (var i = 0; i < inst.length; i++) {
          var m = d.versions.find(function (v) { return v.id === inst[i]; });
          if (m && (m.type === "release" || m.type === "snapshot")) { sel = inst[i]; break; }
        }
        if (!sel && inst.length) sel = inst[0];
        if (!sel && d.versions.length) sel = d.versions.find(function (v) { return v.type === "release"; }).id;
        return sel;
      }

      // poll state + logs
      React.useEffect(function () {
        return appCtx.interval(function () {
          api("/state").then(function (s) {
            stateRef.current = s;
            var eulaNow = !!(s.settings && s.settings.eulaAccepted);
            if (eulaRef.current === null) eulaRef.current = eulaNow;
            else if (eulaRef.current !== eulaNow) {
              eulaRef.current = eulaNow;
              setTick(function (x) { return x + 1; });
            }
            // live theme change (settings saved from the modal)
            var themeNow = JSON.stringify((s.settings && s.settings.theme) || {});
            if (themeRef.current === null) themeRef.current = themeNow;
            else if (themeRef.current !== themeNow) {
              themeRef.current = themeNow;
              setTick(function (x) { return x + 1; });
            }
            if (s.selected && s.selected !== selectedRef.current && catalogRef.current.meta[s.selected]) {
              setSelected(s.selected);
            }
            // refresh catalog after install finished
            var dl = s.download;
            if (dl && dl.stage === "done" && dl.version !== justInstalledRef.current) {
              justInstalledRef.current = dl.version;
              api("/versions").then(function (d) {
                setCatalog(d.versions, d.installed);
                if (!s.selected) setSelected(dl.version);
              });
            }
          }).catch(function () {});
          api("/logs?since=" + logSinceRef.current).then(function (d) {
            if (d.lines && d.lines.length) {
              setLogs(function (prev) { return prev.concat(d.lines).slice(-1200); });
              logSinceRef.current = d.next;
              setTimeout(function () {
                if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
              }, 30);
            }
          }).catch(function () {});
        }, 1000);
      }, []);

      var selectedRef = React.useRef(selected);
      selectedRef.current = selected;
      var stRef = React.useRef(st);
      stRef.current = st;

      if (st.load) return React.createElement("div", { className: "dshmc" + (appMode === "tab" ? " dshmc-tab" : ""), style: { alignItems: "center", justifyContent: "center" } }, "Loading launcher...");
      if (st.error) return React.createElement("div", { className: "dshmc" + (appMode === "tab" ? " dshmc-tab" : ""), style: { alignItems: "center", justifyContent: "center" } }, String(st.error));

      var s = stateRef.current || { account: null, java: null, settings: {}, game: {}, download: null, login: null };
      var isInstalled = selected ? !!catalog.inst[selected] : false;
      var downloading = s.download && (s.download.stage === "downloading" || s.download.stage === "extracting" || s.download.stage === "preparing");
      var gameRunning = !!(s.game && s.game.running);

      function onSelect(id) {
        setSelected(id);
        api("/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id }) }).catch(function () {});
      }

      function onPlay() {
        if (!selected || busy) return;
        if (!s.account) { setModal("login"); pushLocal("\u8bf7\u5148\u767b\u5f55\u5fae\u8f6f\u8d26\u53f7\u3002"); return; }
        setBusy(true);
        var act = isInstalled ? "launch" : "install";
        api("/" + act, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected }) })
          .then(function (r) {
            if (act === "launch") { pushLocal("Launching " + selected + " ..."); }
            else { pushLocal("Installing " + selected + " ..."); }
          })
          .catch(function (e) { pushLocal("Error: " + e.message); })
          .finally(function () { setBusy(false); });
      }

      function pushLocal(line) {
        setLogs(function (prev) { return prev.concat(["[launcher] " + line]).slice(-1200); });
        setTimeout(function () { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 30);
      }

      var meta = selected ? catalog.meta[selected] : null;

      var th = (s.settings && s.settings.theme) || {};
      var thPreset = THEMES[th.preset] || THEMES.default;
      var accent = th.accent || thPreset.accent;
      var rootStyle = { background: thPreset.bg, "--mc-accent": accent };

      return React.createElement("div", { className: "dshmc" + (appMode === "tab" ? " dshmc-tab" : ""), style: rootStyle },
        TopBar({
          account: s.account,
          java: s.java,
          gameRunning: gameRunning,
          onLogin: function () { setModal("login"); },
          onLogout: function () {
            api("/logout", { method: "POST" }).then(function () { pushLocal("Signed out."); });
          },
          onSettings: function () { setModal("settings"); },
          onKill: function () { api("/kill", { method: "POST" }); },
        }),
        React.createElement("div", { className: "dshmc-body" },
          MainPanel({
            selected: selected,
            meta: meta,
            isInstalled: isInstalled,
            catalog: catalog,
            download: s.download,
            gameRunning: gameRunning,
            account: s.account,
            onSelect: onSelect,
            onPlay: onPlay,
            onLogin: function () { setModal("login"); },
            onOpenDir: function () { window.open("file://" + (s.settings && s.settings.gameDir || ""), "_blank"); },
          }),
          React.createElement(MapPanel)
        ),
        LogPanel({ logs: logs, logRef: logRef, onClear: function () { setLogs([]); } }),
        React.createElement("div", { className: "dshmc-foot" },
          React.createElement("span", null, "\u6e38\u620f\u76ee\u5f55: ", React.createElement("b", null, s.settings && s.settings.gameDir || "")),
          React.createElement("span", null, "Java: ", s.java
            ? React.createElement("span", { className: "dshmc-java-ok" }, s.java.version)
            : React.createElement("span", { className: "dshmc-java-bad" }, "NOT FOUND")),
          React.createElement("span", null, "\u5185\u5b58: ", React.createElement("b", null, (s.settings && s.settings.memoryMb || 0) + " MB")),
          React.createElement("span", { style: { marginLeft: "auto", opacity: .7 } }, "Powered by DeepSeek Harness"),
        ),
        modal === "login" ? React.createElement(LoginModal, {
          onClose: function () { setModal(null); },
          pushLocal: pushLocal,
          onDone: function (name) { setModal(null); pushLocal("Signed in as " + name); },
        }) : null,
        modal === "settings" ? React.createElement(SettingsModal, {
          settings: s.settings || {},
          onClose: function () { setModal(null); },
          pushLocal: pushLocal,
        }) : null,
        !(s.settings && s.settings.eulaAccepted) ? React.createElement(EulaModal, {
          onAccept: function () {
            api("/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eulaAccepted: true }) })
              .then(function () { pushLocal("Minecraft EULA accepted."); })
              .catch(function (e) { pushLocal("EULA error: " + e.message); });
          },
        }) : null,
        (s.settings && s.settings.eulaAccepted) && !(s.settings.onboarded) ? React.createElement(OnboardModal, {
          onDone: function () {
            api("/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboarded: true }) })
              .then(function () { pushLocal("\u65b0\u624b\u5f15\u5bfc\u5df2\u5b8c\u6210\u3002"); })
              .catch(function () {});
          },
        }) : null
      );
    }

    // --------------------------------------------------------------- eula ---
    function EulaModal(props) {
      return React.createElement("div", { className: "dshmc-modal" },
        React.createElement("div", { className: "dshmc-modal-card" },
          React.createElement("div", { className: "dshmc-modal-title" }, "Minecraft EULA & Legal Notice"),
          React.createElement("div", { className: "dshmc-hint" },
            "This is an UNOFFICIAL open-source launcher, not affiliated with Mojang Studios or Microsoft. " +
            "It downloads Minecraft only from Mojang\u2019s official servers, and playing requires a legitimately purchased Minecraft account " +
            "(offline mode is not provided; playing requires a valid, legitimately purchased Minecraft account). " +
            "By continuing you agree to the Minecraft End User License Agreement: https://www.minecraft.net/eula"
          ),
          React.createElement("div", { className: "dshmc-modal-row" },
            React.createElement("a", { className: "dshmc-btn", href: "https://www.minecraft.net/eula", target: "_blank", rel: "noreferrer", style: { textDecoration: "none" } }, "Read EULA"),
            React.createElement("button", { className: "dshmc-btn green", onClick: props.onAccept }, "I agree \u2014 continue")
          )
        )
      );
    }

    // ----------------------------------------------------------- onboarding ---
    function OnboardModal(props) {
      var stepState = React.useState(0);
      var step = stepState[0], setStep = stepState[1];
      var steps = [
        { t: "\u6b22\u8fce\u4f7f\u7528 DSH Minecraft \u542f\u52a8\u5668\uff01", d: "\u8fd9\u662f\u4e00\u4e2a\u57fa\u4e8e DeepSeek Harness \u7684\u975e\u5b98\u65b9\u542f\u52a8\u5668\u3002\u4e0b\u9762\u56db\u6b65\u5373\u53ef\u5f00\u59cb\u6e38\u73a9\u3002\u4f60\u4e5f\u53ef\u4ee5\u5728\u5de6\u4fa7\u804a\u5929\u91cc\u8ba9 AI \u7528 mc_* \u5de5\u5177\u5e2e\u4f60\u64cd\u4f5c\u3002" },
        {
          t: "\u2460 \u6ce8\u518c Azure client id\uff08\u767b\u5f55\u5fc5\u9700\uff0c\u4e00\u6b21\u6027\uff09",
          d: "\u2460 \u7528\u4f60\u7684\u6b63\u7248\u5fae\u8f6f\u8d26\u53f7\u767b\u5f55 portal.azure.com \u2192 \u641c\u7d22 App registrations \u2192 + New registration\u3002\u2461 \u8d26\u6237\u7c7b\u578b\u5fc5\u9009\u201c\u542b personal Microsoft accounts\u201d\uff1bRedirect URI \u7559\u7a7a\u3002\u2462 \u8fdb\u5165\u5e94\u7528 \u2192 Authentication \u2192 \u52fe\u9009 Allow public client flows \u2192 Save\u3002\u2463 \u590d\u5236 Application (client) ID\uff0c\u586b\u5230 \u8bbe\u7f6e \u2192 Microsoft client id\u3002",
          link: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
          linkText: "\u6253\u5f00 Azure \u95e8\u6237",
        },
        { t: "\u2461 \u767b\u5f55\u5fae\u8f6f\u8d26\u53f7", d: "\u70b9\u53f3\u4e0a\u89d2 \u201c\u767b\u5f55\u201d\uff0c\u6309\u63d0\u793a\u5b8c\u6210\u8bbe\u5907\u7801\u767b\u5f55\uff08\u5fc5\u987b\u662f\u62e5\u6709 Minecraft Java \u7248\u7684\u8d26\u53f7\uff09\u3002" },
        { t: "\u2462 \u9009\u62e9\u7248\u672c \u2192 \u5b89\u88c5 \u2192 \u5f00\u59cb\u6e38\u620f", d: "\u5728\u7248\u672c\u9009\u62e9\u6846\u91cc\u6311\u4e00\u4e2a\u7248\u672c\uff0c\u70b9\u201c\u5b89\u88c5\u201d\u4e0b\u8f7d\uff0c\u5b89\u88c5\u5b8c\u540e\u70b9\u201c\u5f00\u59cb\u6e38\u620f\u201d\u3002\u5efa\u8bae\u7528\u7a97\u53e3\u6a21\u5f0f\u8fd0\u884c\uff0c\u65b9\u4fbf AI \u622a\u56fe\u4e0e\u64cd\u4f5c\u3002" },
      ];
      var s = steps[step];
      return React.createElement("div", { className: "dshmc-modal" },
        React.createElement("div", { className: "dshmc-modal-card" },
          React.createElement("div", { className: "dshmc-modal-title" }, "\u65b0\u624b\u5f15\u5bfc"),
          React.createElement("div", { style: { fontSize: 16, fontWeight: 800, color: "#fff", margin: "10px 0 8px" } }, s.t),
          React.createElement("div", { className: "dshmc-hint", style: { minHeight: 80, whiteSpace: "pre-wrap" } }, s.d),
          s.link ? React.createElement("div", { style: { margin: "8px 0" } },
            React.createElement("a", { className: "dshmc-btn green", href: s.link, target: "_blank", rel: "noreferrer", style: { textDecoration: "none", display: "inline-block" } }, s.linkText + " \u2197")
          ) : null,
          React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "center", marginTop: 6 } },
            steps.map(function (_, i) {
              return React.createElement("span", { key: i, style: { width: 8, height: 8, borderRadius: "50%", background: i === step ? "var(--mc-accent,#4caf50)" : "rgba(255,255,255,.2)" } });
            })
          ),
          React.createElement("div", { className: "dshmc-modal-row" },
            step > 0 ? React.createElement("button", { className: "dshmc-btn", onClick: function () { setStep(step - 1); } }, "\u4e0a\u4e00\u6b65") : null,
            step < steps.length - 1
              ? React.createElement("button", { className: "dshmc-btn green", onClick: function () { setStep(step + 1); } }, "\u4e0b\u4e00\u6b65")
              : React.createElement("button", { className: "dshmc-btn green", onClick: props.onDone }, "\u5f00\u59cb\u4f7f\u7528"),
            React.createElement("button", { className: "dshmc-btn", onClick: props.onDone }, "\u8df3\u8fc7")
          )
        )
      );
    }

    // ---------------------------------------------------------------- top ---
    function TopBar(props) {
      return React.createElement("div", { className: "dshmc-top" },
        React.createElement("div", { className: "dshmc-brand" },
          React.createElement("span", { className: "dshmc-logo" }, "MINECRAFT"),
          React.createElement("span", { className: "dshmc-logo-sub" }, "UNOFFICIAL \u00b7 DSH LAUNCHER"),
        ),
        React.createElement("div", { className: "dshmc-top-right" },
          React.createElement("span", { className: "dshmc-chip" },
            React.createElement("span", { className: "dot " + (props.gameRunning ? "green" : "gray") }),
            props.gameRunning ? "\u6e38\u620f\u8fd0\u884c\u4e2d" : "\u7a7a\u95f2",
          ),
          props.account
            ? React.createElement("button", { className: "dshmc-account in", title: props.account.uuid, onClick: props.onLogout },
                "\u25cf " + props.account.name + " \u00b7 \u9000\u51fa\u767b\u5f55")
            : React.createElement("button", { className: "dshmc-account", onClick: props.onLogin }, "\u767b\u5f55"),
          props.gameRunning
            ? React.createElement("button", { className: "dshmc-btn danger", onClick: props.onKill }, "\u505c\u6b62\u6e38\u620f")
            : null,
          React.createElement("button", { className: "dshmc-btn", onClick: props.onSettings }, "\u2699 \u8bbe\u7f6e"),
        )
      );
    }

    // --------------------------------------------------------------- left ---
    function VersionPicker(props) {
      var catalog = props.catalog;
      var meta = catalog.meta, inst = catalog.inst;
      var keys = Object.keys(meta);
      var release = [], snapshot = [], old = [];
      keys.forEach(function (k) {
        var v = meta[k];
        if (v.type === "release") release.push(v);
        else if (v.type === "snapshot") snapshot.push(v);
        else old.push(v);
      });
      var sort = function (a, b) { return b.id.localeCompare(a.id, undefined, { numeric: true }); };
      release.sort(sort); snapshot.sort(sort); old.sort(sort);
      var installed = keys.map(function (k) { return meta[k]; }).filter(function (v) { return inst[v.id]; });

      function opts(list) {
        return list.map(function (v) {
          return React.createElement("option", { key: v.id, value: v.id }, (inst[v.id] ? "\u2713 " : "") + v.id);
        });
      }
      return React.createElement("select", {
        className: "dshmc-vselect",
        value: props.selected || "",
        onChange: function (e) { props.onSelect(e.target.value); },
        title: "\u9009\u62e9 Minecraft \u7248\u672c",
      },
        installed.length ? React.createElement("optgroup", { label: "\u5df2\u5b89\u88c5" }, opts(installed)) : null,
        React.createElement("optgroup", { label: "\u6b63\u5f0f\u7248 Release" }, opts(release)),
        React.createElement("optgroup", { label: "\u5feb\u7167 Snapshot" }, opts(snapshot)),
        React.createElement("optgroup", { label: "Old" }, opts(old))
      );
    }

    // --------------------------------------------------------------- main ---
    function MainPanel(props) {
      var download = props.download;
      var dlActive = download && (download.stage === "downloading" || download.stage === "extracting" || download.stage === "preparing");
      var dlDone = download && download.stage === "done";
      var dlFailed = download && download.error;

      var pct = 0;
      if (dlActive && download.filesTotal) {
        pct = Math.round(download.filesDone / download.filesTotal * 100);
      }

      var cur = download && download.current;
      var curPct = cur && cur.total ? Math.round(cur.done / cur.total * 100) : 0;

      var btnLabel = props.isInstalled ? "\u5f00\u59cb\u6e38\u620f" : (dlActive ? "\u5b89\u88c5\u4e2d..." : "\u5b89\u88c5");
      var btnClass = props.isInstalled ? "green" : "gray";
      var disabled = dlActive || props.gameRunning || !props.selected;

      var loginBanner = !props.account ? React.createElement("div", { className: "dshmc-login-banner" },
        React.createElement("div", { className: "msg" },
          React.createElement("b", null, "\u8bf7\u5148\u767b\u5f55\u6b63\u7248\u8d26\u53f7\u3002"),
          "\u6e38\u73a9 Minecraft \u9700\u8981\u5408\u6cd5\u8d2d\u4e70\u7684\u5fae\u8f6f\u8d26\u53f7\u3002\u767b\u5f55\u540e\u624d\u80fd\u5b89\u88c5\u548c\u542f\u52a8\u6e38\u620f\u3002"
        ),
        React.createElement("button", { className: "btn", onClick: props.onLogin }, "\u767b\u5f55")
      ) : null;

      var detail = props.meta ? React.createElement("div", { className: "dshmc-version-card" },
        React.createElement("div", { className: "row" }, React.createElement("span", null, "\u7248\u672c"), React.createElement("b", null, props.meta.id)),
        React.createElement("div", { className: "row" }, React.createElement("span", null, "\u7c7b\u578b"), React.createElement("b", null, props.meta.type)),
        React.createElement("div", { className: "row" }, React.createElement("span", null, "\u53d1\u5e03\u65e5\u671f"), React.createElement("b", null, (props.meta.releaseTime || "").slice(0, 10))),
        React.createElement("div", { className: "row" }, React.createElement("span", null, "\u72b6\u6001"), React.createElement("b", null, props.isInstalled ? "\u2713 \u5df2\u5b89\u88c5" : "\u2013 \u672a\u5b89\u88c5")),
      ) : null;

      return React.createElement("div", { className: "dshmc-main" },
        React.createElement("div", { className: "dshmc-hero" },
          React.createElement("div", { className: "dshmc-hero-sub" }, "\u9009\u62e9\u7248\u672c"),
          React.createElement(VersionPicker, { catalog: props.catalog, selected: props.selected, onSelect: props.onSelect }),
          loginBanner,
          detail,
          React.createElement("button", { className: "dshmc-play " + btnClass, disabled: disabled, onClick: props.onPlay }, btnLabel),
          dlActive ? React.createElement("div", { className: "dshmc-progress" },
            React.createElement("div", { className: "bar" }, React.createElement("div", { className: "fill", style: { width: pct + "%" } })),
            React.createElement("div", { className: "lbl" },
              React.createElement("span", null, download.stage === "extracting" ? "Extracting natives\u2026" : (download.filesDone + " / " + download.filesTotal + " files")),
              React.createElement("span", null, download.current ? (download.current.name + " " + curPct + "%") : (pct + "%"))
            )
          ) : null,
          dlDone ? React.createElement("div", { className: "dshmc-ok" }, "\u2713 " + download.version + " installed successfully") : null,
          dlFailed ? React.createElement("div", { className: "dshmc-err" }, "\u2717 " + download.error) : null,
        )
      );
    }

    // ---------------------------------------------------------------- map ---
    function MapPanel() {
      var mapState = React.useState(null);
      var map = mapState[0], setMap = mapState[1];
      var canvasRef = React.useRef(null);

      React.useEffect(function () {
        return appCtx.interval(function () {
          api("/map").then(function (d) { if (d && d.ok) setMap(d); }).catch(function () {});
        }, 1000);
      }, []);

      React.useEffect(function () {
        if (map && canvasRef.current) drawMap(canvasRef.current, map);
      }, [map]);

      var hasBot = map && map.botPos;
      return React.createElement("div", { className: "dshmc-mapwrap" },
        React.createElement("div", { className: "dshmc-maphead" },
          React.createElement("span", null, "\u5b9e\u65f6\u5730\u56fe"),
          React.createElement("span", { style: { display: "flex", gap: 8, alignItems: "center" } },
            React.createElement("span", { className: "dshmc-mlegend" }, React.createElement("i", { style: { background: "#5ab0ff" } }), " AI"),
            React.createElement("span", { className: "dshmc-mlegend" }, React.createElement("i", { style: { background: "#4ade80" } }), "\u73a9\u5bb6")
          )
        ),
        hasBot ? React.createElement("canvas", { ref: canvasRef, width: 340, height: 340, className: "dshmc-map" })
          : React.createElement("div", { className: "dshmc-mapempty" }, "AI \u672a\u8fde\u63a5\uff0c\u8fde\u63a5\u540e\u663e\u793a\u5b9e\u65f6\u4f4d\u7f6e")
      );
    }

    function drawMap(canvas, map) {
      var ctx = canvas.getContext("2d");
      var CELL = 20, CX = 170, CY = 170;
      var colors = {
        grass_block: "#4d8a3f", dirt: "#8a6a45", stone: "#7a7a7a", water: "#3a6ea5",
        sand: "#d9c58a", oak_log: "#6b4a2f", birch_log: "#c9c2a8", coal_ore: "#5a5a5a",
        leaves: "#3f6e2f", oak_leaves: "#3f6e2f", snow: "#e8eef2", gravel: "#9a948a",
      };
      ctx.fillStyle = "#0b100d";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      (map.ground || []).forEach(function (g) {
        ctx.fillStyle = colors[g.name] || "#39403a";
        ctx.fillRect(CX + g.dx * CELL - CELL / 2, CY + g.dz * CELL - CELL / 2, CELL, CELL);
      });
      // grid
      ctx.strokeStyle = "rgba(255,255,255,.05)";
      for (var i = 0; i <= 17; i++) {
        ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, 340); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(340, i * CELL); ctx.stroke();
      }
      // players
      (map.players || []).forEach(function (p) {
        var x = CX + (p.x - map.botPos.x) * CELL;
        var z = CY + (p.z - map.botPos.z) * CELL;
        ctx.fillStyle = p.isBot ? "#5ab0ff" : "#4ade80";
        ctx.beginPath(); ctx.arc(x, z, 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
        // facing indicator
        if (p.yaw !== undefined) {
          var yaw = p.yaw;
          var fx = x + Math.sin(yaw) * 14;
          var fz = z + Math.cos(yaw) * 14;
          ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, z); ctx.lineTo(fx, fz); ctx.stroke();
        }
      });
      // center crosshair on bot
      ctx.strokeStyle = "rgba(90,176,255,.5)";
      ctx.beginPath(); ctx.moveTo(CX - 10, CY); ctx.lineTo(CX + 10, CY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(CX, CY - 10); ctx.lineTo(CX, CY + 10); ctx.stroke();
    }

    // ---------------------------------------------------------------- log ---
    function LogPanel(props) {
      var body = null;
      if (props.logs.length) {
        body = props.logs.map(function (l, i) { return React.createElement("div", { key: i }, l); });
      } else {
        body = React.createElement("div", { className: "dshmc-log-empty" }, "Log output appears here \u2014 install progress, launcher messages, game console.");
      }
      return React.createElement("div", { className: "dshmc-log" },
        React.createElement("div", { className: "dshmc-log-head" },
          React.createElement("span", null, "\u63a7\u5236\u53f0"),
          React.createElement("button", { className: "dshmc-btn", style: { padding: "3px 10px", fontSize: 11 }, onClick: props.onClear }, "\u6e05\u7a7a")
        ),
        React.createElement("div", { className: "dshmc-log-body dshmc-scroll", ref: props.logRef }, body)
      );
    }

    // -------------------------------------------------------------- login ---
    function LoginModal(props) {
      var modeState = React.useState("device");
      var mode = modeState[0], setMode = modeState[1];
      var phaseState = React.useState("idle");
      var phase = phaseState[0], setPhase = phaseState[1];
      var infoState = React.useState(null);
      var info = infoState[0], setInfo = infoState[1];
      var errState = React.useState(null);
      var err = errState[0], setErr = errState[1];
      var intervalRef = React.useRef(5);
      var copiedState = React.useState(false);
      var copied = copiedState[0], setCopied = copiedState[1];

      function startOauth() {
        setPhase("wait");
        setErr(null);
        api("/oauth/start").then(function (d) {
          window.open(d.authorizeUrl, "_blank");
        }).catch(function (e) { setErr(String(e)); setPhase("err"); });
      }

      function startDevice() {
        setPhase("wait");
        setErr(null);
        setInfo(null);
        api("/login-start", { method: "POST" })
          .then(function (d) {
            setInfo(d);
            intervalRef.current = d.interval || 5;
            // auto-copy the code so the user can just paste it after opening the link
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(d.userCode).then(function () { setCopied(true); }).catch(function () {});
              }
            } catch (e) { /* clipboard unavailable */ }
          })
          .catch(function (e) { setErr(String(e)); setPhase("err"); });
      }

      // 打开弹窗即开始设备码流程
      React.useEffect(function () {
        if (phase === "idle" && mode === "device") startDevice();
      }, []);

      // poll: oauth waits for account to appear; device waits for login-poll result
      React.useEffect(function () {
        if (phase !== "wait") return;
        return appCtx.interval(function () {
          if (mode === "oauth") {
            api("/state").then(function (s) {
              if (s.account) { setPhase("ok"); props.onDone(s.account.name); }
            }).catch(function () {});
          } else {
            api("/login-poll").then(function (d) {
              intervalRef.current = d.interval || intervalRef.current;
              if (d.status === "ok") { setPhase("ok"); props.onDone(d.account && d.account.name || "player"); }
              else if (d.status === "error") { setErr(d.error || "登录失败"); setPhase("err"); }
            }).catch(function (e) { setErr(String(e)); setPhase("err"); });
          }
        }, 1000);
      }, [phase, mode]);

      function copyCode() {
        try {
          navigator.clipboard.writeText(info.userCode);
          setCopied(true);
          setTimeout(function () { setCopied(false); }, 2000);
        } catch (e) { /* ignore */ }
      }

      return React.createElement("div", { className: "dshmc-modal" },
        React.createElement("div", { className: "dshmc-modal-card" },
          React.createElement("div", { className: "dshmc-modal-title" }, "\u5fae\u8f6f\u8d26\u53f7\u767b\u5f55"),
          phase === "wait" && mode === "device" ? React.createElement("div", null,
            React.createElement("div", { className: "dshmc-hint" },
              "\u2460 \u70b9\u51fb\u201c\u6253\u5f00\u6d4f\u89c8\u5668\u201d\uff0c\u5e76\u5728\u9875\u9762\u91cc\u8f93\u5165\u4e0b\u9762\u7684\u4ee3\u7801\uff08\u5df2\u4e3a\u4f60\u590d\u5236\uff09\uff1a"
            ),
            info ? React.createElement("div", { className: "dshmc-code" },
              React.createElement("div", { className: "url" }, info.verificationUri),
              React.createElement("div", { className: "big" }, info.userCode),
              React.createElement("div", { className: "hint", style: { marginTop: 8 } }, "\u2461 \u4f7f\u7528\u62e5\u6709 Minecraft Java \u7248\u7684\u5fae\u8f6f\u8d26\u53f7\u767b\u5f55\u5e76\u6279\u51c6\uff0c\u7b49\u5f85\u81ea\u52a8\u5b8c\u6210\u2026")
            ) : React.createElement("div", { className: "dshmc-hint" }, "\u6b63\u5728\u8fde\u63a5\u5fae\u8f6f\u2026"),
            React.createElement("div", { className: "dshmc-modal-row", style: { justifyContent: "flex-start", flexWrap: "wrap" } },
              React.createElement("button", { className: "dshmc-btn green", onClick: function () { window.open(info && info.verificationUri, "_blank"); } }, "\u6253\u5f00\u6d4f\u89c8\u5668"),
              React.createElement("button", { className: "dshmc-btn", onClick: copyCode }, copied ? "\u2713 \u5df2\u590d\u5236" : "\u590d\u5236\u4ee3\u7801"),
              React.createElement("button", { className: "dshmc-btn", onClick: function () { setMode("oauth"); setPhase("idle"); } }, "\u522b\u7684\u65b9\u5f0f\u767b\u5f55")
            )
          ) : null,
          phase === "idle" && mode === "oauth" ? React.createElement("div", null,
            React.createElement("div", { className: "dshmc-hint" },
              "\u4f7f\u7528\u6d4f\u89c8\u5668\u8df3\u8f6c\u767b\u5f55\uff08\u9ad8\u7ea7\uff09\u3002\u6b64\u65b9\u5f0f\u9700\u8981\u4f60\u5728 Azure \u5e94\u7528\u91cc\u914d\u7f6e\u56de\u8c03\u5730\u5740 redirect_uri = http://127.0.0.1:<\u7aef\u53e3>/api/mc/oauth/callback\u3002\u5efa\u8bae\u4f18\u5148\u4f7f\u7528\u4e0a\u65b9\u7684\u8bbe\u5907\u7801\u767b\u5f55\u3002"
            ),
            React.createElement("div", { className: "dshmc-modal-row" },
              React.createElement("button", { className: "dshmc-btn green", onClick: startOauth }, "\u8df3\u8f6c\u5230\u5fae\u8f6f\u767b\u5f55\u9875"),
              React.createElement("button", { className: "dshmc-btn", onClick: function () { setMode("device"); setPhase("idle"); startDevice(); } }, "\u8fd4\u56de\u8bbe\u5907\u7801")
            )
          ) : null,
          phase === "wait" && mode === "oauth" ? React.createElement("div", { className: "dshmc-hint" },
            "\u5e94\u8be5\u5df2\u5728\u65b0\u6807\u7b7e\u6253\u5f00\u5fae\u8f6f\u767b\u5f55\u9875\uff0c\u5b8c\u6210\u540e\u6b64\u7a97\u53e3\u4f1a\u81ea\u52a8\u66f4\u65b0\u3002"
          ) : null,
          phase === "ok" ? React.createElement("div", { className: "dshmc-ok" }, "\u2713 \u767b\u5f55\u6210\u529f") : null,
          phase === "err" ? React.createElement("div", { className: "dshmc-err" }, err) : null,
          React.createElement("div", { className: "dshmc-modal-row", style: { justifyContent: "flex-end" } },
            React.createElement("button", { className: "dshmc-btn", onClick: props.onClose }, "\u5173\u95ed")
          )
        )
      );
    }

    // ------------------------------------------------------------ settings ---
    function SettingsModal(props) {
      var fState = React.useState({ ...props.settings });
      var f = fState[0], setF = fState[1];
      var msgState = React.useState(null);
      var msg = msgState[0], setMsg = msgState[1];

      function upd(key) {
        return function (e) { setF({ ...f, [key]: e.target.value }); };
      }

      function save() {
        api("/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameDir: f.gameDir,
            javaPath: f.javaPath || "",
            memoryMb: Number(f.memoryMb) || 2048,
            clientId: f.clientId,
            width: f.width ? Number(f.width) : null,
            height: f.height ? Number(f.height) : null,
            uiMode: f.uiMode || "tab",
            showTab: f.showTab !== false,
            theme: { preset: (f.theme && f.theme.preset) || "default", accent: (f.theme && f.theme.accent) || "" },
          }),
        }).then(function () {
          setMsg("saved");
          props.pushLocal("Settings saved.");
          setTimeout(props.onClose, 600);
        }).catch(function (e) { setMsg(String(e)); });
      }

      return React.createElement("div", { className: "dshmc-modal" },
        React.createElement("div", { className: "dshmc-modal-card" },
          React.createElement("div", { className: "dshmc-modal-title" }, "设置"),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "游戏目录"),
            React.createElement("input", { value: f.gameDir, onChange: upd("gameDir"), placeholder: "~/.minecraft" }),
            React.createElement("div", { className: "dshmc-hint" }, "与官方启动器同目录结构，已有存档/版本直接复用。")
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "运行时 Java 路径（留空自动检测）"),
            React.createElement("input", { value: f.javaPath, onChange: upd("javaPath"), placeholder: "auto-detect" })
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "界面模式（重启生效）"),
            React.createElement("select", {
              value: f.uiMode || "tab",
              onChange: function (e) { setF({ ...f, uiMode: e.target.value }); },
              style: { width: "100%", background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.18)", color: "#fff", borderRadius: 8, padding: "9px 12px", fontSize: 13, outline: "none" },
            },
              React.createElement("option", { value: "tab" }, "Tab \u2014 launcher lives beside the AI chat (recommended)"),
              React.createElement("option", { value: "fullscreen" }, "Fullscreen \u2014 launcher replaces the whole page")
            ),
            React.createElement("div", { className: "dshmc-hint" }, "Tab mode keeps the DSH AI chat; use it to control the launcher by conversation (mc_* tools) while still being able to open the launcher UI.")
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "在会话中显示 Minecraft 标签"),
            React.createElement("label", { style: { display: "flex", gap: 8, alignItems: "center", cursor: "pointer" } },
              React.createElement("input", { type: "checkbox", checked: f.showTab !== false, onChange: function (e) { setF({ ...f, showTab: e.target.checked }); } }),
              React.createElement("span", { style: { fontSize: 13, color: "#e8e8e8" } }, "Show the Minecraft launcher tab (restart to apply)")
            ),
            React.createElement("div", { className: "dshmc-hint" }, "When off, the launcher stays tools-only: you can still control it via mc_* tools in the chat, but no tab is shown.")
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "主题"),
            React.createElement("div", { style: { display: "flex", gap: 8 } },
              React.createElement("select", {
                value: (f.theme && f.theme.preset) || "default",
                onChange: function (e) { setF({ ...f, theme: { ...(f.theme || {}), preset: e.target.value } }); },
                style: { flex: 1, background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.18)", color: "#fff", borderRadius: 8, padding: "9px 12px", fontSize: 13, outline: "none" },
              },
                React.createElement("option", { value: "default" }, "Default (forest)"),
                React.createElement("option", { value: "light" }, "Light (slate)"),
                React.createElement("option", { value: "ocean" }, "Ocean"),
                React.createElement("option", { value: "end" }, "End"),
                React.createElement("option", { value: "lava" }, "Lava")
              ),
              React.createElement("input", {
                value: (f.theme && f.theme.accent) || "",
                onChange: function (e) { setF({ ...f, theme: { ...(f.theme || {}), accent: e.target.value } }); },
                placeholder: "#accent",
                style: { flex: 1, minWidth: 110, background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.18)", color: "#fff", borderRadius: 8, padding: "9px 12px", fontSize: 13, outline: "none" },
              })
            ),
            React.createElement("div", { className: "dshmc-hint" }, "Pick a preset and/or enter a custom accent color (hex, e.g. #ff6b6b). Applied instantly.")
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "内存 (MB)"),
            React.createElement("input", { value: f.memoryMb, onChange: upd("memoryMb"), type: "number" })
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "Microsoft client id（高级）"),
            React.createElement("input", { value: f.clientId, onChange: upd("clientId") }),
            React.createElement("div", { className: "dshmc-hint" },
              "\u5fae\u8f6f\u767b\u5f55\u7684 Azure \u5e94\u7528 ID\u3002",
              React.createElement("a", { href: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade", target: "_blank", rel: "noreferrer", style: { color: "var(--mc-accent,#7ce38b)", marginLeft: 4 } }, "\u5982\u4f55\u6ce8\u518c\uff1f\u6253\u5f00 Azure \u95e8\u6237 \u2197")
            )
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "窗口宽×高（可选）"),
            React.createElement("div", { style: { display: "flex", gap: 8 } },
              React.createElement("input", { value: f.width || "", onChange: upd("width"), placeholder: "854", style: { flex: 1 } }),
              React.createElement("input", { value: f.height || "", onChange: upd("height"), placeholder: "480", style: { flex: 1 } })
            )
          ),
          msg ? React.createElement("div", { className: msg === "saved" ? "dshmc-ok" : "dshmc-err" }, msg) : null,
          React.createElement("div", { className: "dshmc-modal-row" },
            React.createElement("button", { className: "dshmc-btn", onClick: props.onClose }, "取消"),
            React.createElement("button", { className: "dshmc-btn green", onClick: save }, "保存")
          )
        )
      );
    }

    // ---------------------------------------------------------------- apply --
    var Catch = (function () {
      function Catch(props) { this.state = { err: null }; }
      Catch.prototype = Object.create(React.Component.prototype);
      Catch.prototype.constructor = Catch;
      Catch.getDerivedStateFromError = function (e) { return { err: e }; };
      Catch.prototype.componentDidCatch = function (e) { /* silent */ };
      Catch.prototype.render = function () {
        if (this.state.err) return React.createElement("div", { style: { padding: 40, fontFamily: "monospace", whiteSpace: "pre-wrap", color: "#fca5a5" } }, "LauncherApp crashed: " + String(this.state.err && this.state.err.stack || this.state.err));
        return this.props.children;
      };
      return Catch;
    })();

    exports.inject = ["slots", "timer"];
    exports.apply = function (ctx) {
      appCtx = ctx;
      var styleTag = document.createElement("style");
      styleTag.setAttribute("data-plugin", "dsh-mc-agent");
      styleTag.textContent = CSS;
      (document.head || document.documentElement).appendChild(styleTag);

      var slots = appCtx.slots;

      // Decide the mount mode from the host settings: 'tab' puts the launcher
      // inside a "Minecraft" tab of the normal DSH chat UI (unless showTab is
      // off, which leaves it tools-only); 'fullscreen' takes over the whole page.
      var settled = false;
      function mount(cfg) {
        if (settled) return;
        settled = true;
        appMode = cfg.uiMode === "fullscreen" ? "fullscreen" : "tab";
        if (appMode === "fullscreen") {
          var disposeReg = slots.register({ name: "root", id: "dsh-mc-agent", priority: -1 }, function () {
            return React.createElement(Catch, null, React.createElement(LauncherApp));
          });
          appCtx.effect(function () { return disposeReg; });
        } else if (cfg.showTab !== false) {
          var disposeView = slots.inject("conversation.view", function () {
            return slots.register(
              { name: "conversation.view", id: "mc-launcher", order: 5, label: function () { return "Minecraft"; } },
              function () { return React.createElement(Catch, null, React.createElement(LauncherApp)); }
            );
          });
          appCtx.effect(function () { return disposeView; });
        }
        // else: tab mode with showTab off → tools-only (no launcher UI)
      }
      fetch("/api/mc/state")
        .then(function (r) { return r.json(); })
        .then(function (s) { mount({ uiMode: s.settings && s.settings.uiMode, showTab: s.settings && s.settings.showTab }); })
        .catch(function () { mount({ uiMode: "tab", showTab: true }); });

      appCtx.effect(function () {
        return function () { if (styleTag.parentNode) styleTag.parentNode.removeChild(styleTag); };
      });
    };
    return module.exports;
  }
});
