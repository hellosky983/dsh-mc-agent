// dsh-mc-launcher — Client half (formal bundle)
// Full-screen Minecraft launcher UI rendered into the `root` slot: the shell's
// own AppFrame is shadowed, so this DSH instance *is* the launcher page.
// Talks to the host half over /api/mc/* (same-origin fetch).
window.__ModuleLoader__.load({
  id: "dsh-mc-launcher",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    var appCtx = null;

    // ---------------------------------------------------------------- css ---
    var CSS = [
      ".dshmc{position:fixed;inset:0;background:radial-gradient(1200px 700px at 30% 0%,#3a5a40 0%,#1c2a24 35%,#0d1318 75%,#070b0f 100%);color:#e8e8e8;font-family:'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden;user-select:none}",
      ".dshmc *{box-sizing:border-box}",
      ".dshmc-top{display:flex;align-items:center;justify-content:space-between;padding:10px 18px;background:rgba(8,12,16,.55);border-bottom:2px solid rgba(90,180,110,.35);gap:14px;flex-wrap:wrap}",
      ".dshmc-brand{display:flex;align-items:baseline;gap:10px}",
      ".dshmc-logo{font-weight:900;font-size:22px;letter-spacing:2px;color:#7ce38b;text-shadow:3px 3px 0 #17351f,6px 6px 0 rgba(0,0,0,.55);line-height:1}",
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
      ".dshmc-play.green{background:linear-gradient(180deg,#6fdc7c,#3fae4e 60%,#2f8f3d)}",
      ".dshmc-play.gray{background:linear-gradient(180deg,#8d97a3,#66707c 60%,#525c68);box-shadow:0 8px 0 #39424d,0 14px 28px rgba(0,0,0,.5)}",
      ".dshmc-play:disabled{cursor:not-allowed;opacity:.75}",
      ".dshmc-progress{width:100%;max-width:460px}",
      ".dshmc-progress .bar{height:14px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.15);border-radius:7px;overflow:hidden}",
      ".dshmc-progress .fill{height:100%;background:linear-gradient(90deg,#4ade80,#2f9e4b);transition:width .25s}",
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
      ".dshmc-account.in{background:rgba(76,175,80,.22);border-color:rgba(76,175,80,.55);color:#7ce38b}",
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

      if (st.load) return React.createElement("div", { className: "dshmc", style: { alignItems: "center", justifyContent: "center" } }, "Loading launcher...");
      if (st.error) return React.createElement("div", { className: "dshmc", style: { alignItems: "center", justifyContent: "center" } }, String(st.error));

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

      return React.createElement("div", { className: "dshmc" },
        TopBar({
          account: s.account,
          java: s.java,
          gameRunning: gameRunning,
          offlineMode: !!(s.settings && s.settings.offlineMode),
          offlineName: (s.settings && s.settings.offlineName) || "Player",
          onLogin: function () { setModal("login"); },
          onLogout: function () {
            api("/logout", { method: "POST" }).then(function () { pushLocal("Signed out."); });
          },
          onOffline: function () {
            api("/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offlineMode: true }) })
              .then(function () { pushLocal("Offline mode on \u2014 play as \u201c" + ((s.settings && s.settings.offlineName) || "Player") + "\u201d."); });
          },
          onSettings: function () { setModal("settings"); },
          onKill: function () { api("/kill", { method: "POST" }); },
        }),
        React.createElement("div", { className: "dshmc-body" },
          LeftPanel({ catalog: catalog, selected: selected, onSelect: onSelect }),
          MainPanel({
            selected: selected,
            meta: meta,
            isInstalled: isInstalled,
            download: s.download,
            gameRunning: gameRunning,
            account: s.account,
            offlineMode: !!(s.settings && s.settings.offlineMode),
            offlineName: (s.settings && s.settings.offlineName) || "Player",
            onPlay: onPlay,
            onOpenDir: function () { window.open("file://" + (s.settings && s.settings.gameDir || ""), "_blank"); },
          })
        ),
        LogPanel({ logs: logs, logRef: logRef, onClear: function () { setLogs([]); } }),
        React.createElement("div", { className: "dshmc-foot" },
          React.createElement("span", null, "Game dir: ", React.createElement("b", null, s.settings && s.settings.gameDir || "")),
          React.createElement("span", null, "Java: ", s.java
            ? React.createElement("span", { className: "dshmc-java-ok" }, s.java.version)
            : React.createElement("span", { className: "dshmc-java-bad" }, "NOT FOUND")),
          React.createElement("span", null, "Memory: ", React.createElement("b", null, (s.settings && s.settings.memoryMb || 0) + " MB")),
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
            "(offline mode is intended for owners of a legitimate copy who cannot or do not want to sign in). " +
            "By continuing you agree to the Minecraft End User License Agreement: https://www.minecraft.net/eula"
          ),
          React.createElement("div", { className: "dshmc-modal-row" },
            React.createElement("a", { className: "dshmc-btn", href: "https://www.minecraft.net/eula", target: "_blank", rel: "noreferrer", style: { textDecoration: "none" } }, "Read EULA"),
            React.createElement("button", { className: "dshmc-btn green", onClick: props.onAccept }, "I agree \u2014 continue")
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
            props.gameRunning ? "Game running" : "Idle",
          ),
          props.account
            ? React.createElement("button", { className: "dshmc-account in", title: props.account.uuid, onClick: props.onLogout },
                "\u25cf " + props.account.name + " \u00b7 Sign out")
            : React.createElement("div", { style: { display: "flex", gap: 8 } },
                React.createElement("button", { className: "dshmc-account", onClick: props.onLogin }, "Sign in"),
                React.createElement("button", {
                  className: "dshmc-account" + (props.offlineMode ? " in" : ""),
                  onClick: props.offlineMode ? function () {} : props.onOffline,
                  title: props.offlineMode ? "Offline mode on" : "Play without a Microsoft account",
                }, props.offlineMode ? "\u25cf Offline: " + props.offlineName : "Offline play"),
              ),
          props.gameRunning
            ? React.createElement("button", { className: "dshmc-btn danger", onClick: props.onKill }, "Stop game")
            : null,
          React.createElement("button", { className: "dshmc-btn", onClick: props.onSettings }, "\u2699 Settings"),
        )
      );
    }

    // --------------------------------------------------------------- left ---
    function VersionRow(props) {
      var v = props.v;
      var tag = props.installed ? "inst" : (v.type === "snapshot" ? "snapshot" : (v.type === "release" ? "release" : "old"));
      var tagLabel = props.installed ? "installed" : v.type;
      return React.createElement("button",
        { className: "dshmc-v" + (props.selected ? " sel" : ""), onClick: props.onClick },
        React.createElement("span", null, v.id),
        React.createElement("span", { className: "tag " + tag }, tagLabel)
      );
    }

    function LeftPanel(props) {
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
      release.sort(function (a, b) { return b.id.localeCompare(a.id, undefined, { numeric: true }); });
      snapshot.sort(function (a, b) { return b.id.localeCompare(a.id, undefined, { numeric: true }); });
      old.sort(function (a, b) { return b.id.localeCompare(a.id, undefined, { numeric: true }); });

      function group(title, list, show) {
        if (!list.length) return null;
        var rows = list.slice(0, show ? 999 : 30).map(function (v) {
          return React.createElement(VersionRow, {
            key: v.id, v: v,
            installed: !!inst[v.id],
            selected: props.selected === v.id,
            onClick: function () { props.onSelect(v.id); },
          });
        });
        var more = list.length > 30 && !show ? React.createElement("div", { style: { padding: "4px 8px", fontSize: 11, color: "#5f7a68" } }, list.length - 30 + " more \u2026") : null;
        return React.createElement("div", { className: "dshmc-vgroup" },
          React.createElement("div", { className: "dshmc-vgroup-title" }, title),
          rows, more);
      }

      return React.createElement("div", { className: "dshmc-left" },
        React.createElement("div", { className: "dshmc-left-head" }, "Versions"),
        React.createElement("div", { className: "dshmc-versions dshmc-scroll" },
          group("Installed", release.filter(function (v) { return inst[v.id]; }).concat(snapshot.filter(function (v) { return inst[v.id]; })), true),
          group("Release", release, false),
          group("Snapshot", snapshot, false),
          group("Old", old, false)
        )
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

      var btnLabel = props.isInstalled ? "PLAY" : (dlActive ? "INSTALLING..." : "INSTALL");
      var btnClass = props.isInstalled ? "green" : "gray";
      var disabled = dlActive || props.gameRunning || !props.selected;

      var detail = props.meta ? React.createElement("div", { className: "dshmc-version-card" },
        React.createElement("div", { className: "row" }, React.createElement("span", null, "Version"), React.createElement("b", null, props.meta.id)),
        React.createElement("div", { className: "row" }, React.createElement("span", null, "Type"), React.createElement("b", null, props.meta.type)),
        React.createElement("div", { className: "row" }, React.createElement("span", null, "Released"), React.createElement("b", null, (props.meta.releaseTime || "").slice(0, 10))),
        React.createElement("div", { className: "row" }, React.createElement("span", null, "Status"), React.createElement("b", null, props.isInstalled ? "\u2713 Installed" : "\u2013 Not installed")),
      ) : null;

      return React.createElement("div", { className: "dshmc-main" },
        React.createElement("div", { className: "dshmc-hero" },
          React.createElement("div", { className: "dshmc-hero-title" }, props.selected || "\u2014"),
          React.createElement("div", { className: "dshmc-hero-sub" }, "Minecraft \u00b7 DeepSeek Harness Launcher"),
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
          !props.account ? React.createElement("div", { className: "dshmc-hint" },
            props.offlineMode ? "Offline mode: playing as \u201c" + props.offlineName + "\u201d. For owners of a legitimately purchased copy only \u2014 offline sessions cannot join online servers or realms." : "Sign in with your Microsoft account, or enable offline mode, to play."
          ) : null,
        )
      );
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
          React.createElement("span", null, "Console"),
          React.createElement("button", { className: "dshmc-btn", style: { padding: "3px 10px", fontSize: 11 }, onClick: props.onClear }, "Clear")
        ),
        React.createElement("div", { className: "dshmc-log-body dshmc-scroll", ref: props.logRef }, body)
      );
    }

    // -------------------------------------------------------------- login ---
    function LoginModal(props) {
      var st = React.useState("start");
      var phase = st[0], setPhase = st[1];
      var infoState = React.useState(null);
      var info = infoState[0], setInfo = infoState[1];
      var errState = React.useState(null);
      var err = errState[0], setErr = errState[1];
      var tick = React.useState(0);
      var refresh = tick[1];
      var intervalRef = React.useRef(5);

      React.useEffect(function () {
        api("/login-start", { method: "POST" })
          .then(function (d) {
            setInfo(d);
            intervalRef.current = d.interval || 5;
            setPhase("wait");
          })
          .catch(function (e) { setErr(String(e)); });
      }, []);

      React.useEffect(function () {
        if (phase !== "wait") return;
        return appCtx.interval(function () {
          api("/login-poll").then(function (d) {
            intervalRef.current = d.interval || intervalRef.current;
            if (d.status === "ok") { setPhase("ok"); props.onDone(d.account && d.account.name || "player"); }
            else if (d.status === "error") { setErr(d.error || "login failed"); setPhase("err"); }
            else { refresh(function (x) { return x + 1; }); }
          }).catch(function (e) { setErr(String(e)); setPhase("err"); });
        }, Math.max(3, intervalRef.current) * 1000);
      }, [phase]);

      return React.createElement("div", { className: "dshmc-modal" },
        React.createElement("div", { className: "dshmc-modal-card" },
          React.createElement("div", { className: "dshmc-modal-title" }, "Sign in with Microsoft"),
          phase === "start" ? React.createElement("div", { className: "dshmc-hint" }, "Contacting Microsoft\u2026") : null,
          phase === "wait" && info ? React.createElement("div", null,
            React.createElement("div", { className: "dshmc-hint" },
              "1. Open this link in your browser:",
              React.createElement("div", { className: "dshmc-code" },
                React.createElement("div", { className: "url" }, info.verificationUri),
                React.createElement("div", { className: "big" }, info.userCode),
                React.createElement("div", { className: "hint", style: { marginTop: 8 } }, "2. Enter the code above. Waiting for approval\u2026")
              )
            )
          ) : null,
          phase === "ok" ? React.createElement("div", { className: "dshmc-ok" }, "\u2713 Signed in successfully") : null,
          phase === "err" ? React.createElement("div", { className: "dshmc-err" }, err) : null,
          React.createElement("div", { className: "dshmc-modal-row" },
            phase === "wait" ? React.createElement("button", { className: "dshmc-btn", onClick: function () { window.open(info.verificationUri, "_blank"); } }, "Open browser") : null,
            React.createElement("button", { className: "dshmc-btn", onClick: props.onClose }, "Close")
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
            offlineMode: !!f.offlineMode,
            offlineName: f.offlineName || "Player",
          }),
        }).then(function () {
          setMsg("saved");
          props.pushLocal("Settings saved.");
          setTimeout(props.onClose, 600);
        }).catch(function (e) { setMsg(String(e)); });
      }

      return React.createElement("div", { className: "dshmc-modal" },
        React.createElement("div", { className: "dshmc-modal-card" },
          React.createElement("div", { className: "dshmc-modal-title" }, "Settings"),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "Game directory"),
            React.createElement("input", { value: f.gameDir, onChange: upd("gameDir"), placeholder: "~/.minecraft" }),
            React.createElement("div", { className: "dshmc-hint" }, "Same layout as the official launcher; existing saves/versions are reused.")
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "Java path (leave empty for auto-detect)"),
            React.createElement("input", { value: f.javaPath, onChange: upd("javaPath"), placeholder: "auto-detect" })
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "Memory (MB)"),
            React.createElement("input", { value: f.memoryMb, onChange: upd("memoryMb"), type: "number" })
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "Microsoft client id (advanced)"),
            React.createElement("input", { value: f.clientId, onChange: upd("clientId") }),
            React.createElement("div", { className: "dshmc-hint" }, "Azure app id for Microsoft sign-in; register one at portal.azure.com (public client, device-code flow).")
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "Offline mode"),
            React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center" } },
              React.createElement("label", { style: { display: "flex", gap: 6, alignItems: "center", cursor: "pointer" } },
                React.createElement("input", { type: "checkbox", checked: !!f.offlineMode, onChange: function (e) { setF({ ...f, offlineMode: e.target.checked }); } }),
                React.createElement("span", { style: { fontSize: 13, color: "#e8e8e8" } }, "Play without a Microsoft account"),
              ),
              React.createElement("input", {
                value: f.offlineName || "",
                onChange: upd("offlineName"),
                placeholder: "Player name",
                style: { flex: 1, minWidth: 120 },
              })
            ),
            React.createElement("div", { className: "dshmc-hint" }, "Offline sessions cannot join online servers or realms.")
          ),
          React.createElement("div", { className: "dshmc-field" },
            React.createElement("label", null, "Window width \u00d7 height (optional)"),
            React.createElement("div", { style: { display: "flex", gap: 8 } },
              React.createElement("input", { value: f.width || "", onChange: upd("width"), placeholder: "854", style: { flex: 1 } }),
              React.createElement("input", { value: f.height || "", onChange: upd("height"), placeholder: "480", style: { flex: 1 } })
            )
          ),
          msg ? React.createElement("div", { className: msg === "saved" ? "dshmc-ok" : "dshmc-err" }, msg) : null,
          React.createElement("div", { className: "dshmc-modal-row" },
            React.createElement("button", { className: "dshmc-btn", onClick: props.onClose }, "Cancel"),
            React.createElement("button", { className: "dshmc-btn green", onClick: save }, "Save")
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
      styleTag.setAttribute("data-plugin", "dsh-mc-launcher");
      styleTag.textContent = CSS;
      (document.head || document.documentElement).appendChild(styleTag);

      var slots = appCtx.slots;
      var disposeReg = slots.register({ name: "root", id: "dsh-mc-launcher", priority: -1 }, function () {
        return React.createElement(Catch, null, React.createElement(LauncherApp));
      });
      appCtx.effect(function () { return disposeReg; });

      appCtx.effect(function () {
        return function () { if (styleTag.parentNode) styleTag.parentNode.removeChild(styleTag); };
      });
    };
    return module.exports;
  }
});
