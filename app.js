(function(){
  "use strict";
  var doc = document, root = doc.documentElement, body = doc.body;
  function id(x){ return doc.getElementById(x); }

  var empty     = id("empty");
  var preview   = id("preview");
  var codeView  = id("codeView");
  var codeInner = id("codeInner");
  var gutter    = id("gutter");
  var fileInput = id("fileInput");
  var overlay   = id("dropOverlay");
  var toastEl   = id("toast");
  var docTitle  = id("docTitle");
  var hoverZone = id("hoverZone");
  var bgPicker  = id("bgPicker");
  var themeColor= id("themeColor");
  var btnView   = id("btnView");
  var btnFormat = id("btnFormat");
  var iconCode  = id("viewIconCode");
  var iconEye   = id("viewIconEye");
  var footerEl  = id("footer");
  var topbar    = doc.querySelector(".topbar");
  var brandIcon = id("brandIcon");

  // Reuse the favicon (single source of truth) for the header brand icon.
  var favLink = doc.querySelector('link[rel="icon"]');
  if (brandIcon && favLink) brandIcon.src = favLink.href;

  var BASE_TITLE = "HTML Viewer";
  var MAX_HIGHLIGHT = 400000;   // skip highlighting past ~400 KB to stay snappy

  var rawText = "";
  var currentName = "";
  var previewable = false;
  var mode = "code";            // "preview" | "code"
  var codeBuiltFor = null;      // cache key: which (text + beautified) the code view was built from
  var toastTimer = null;
  var beautified = false;       // Format toggle for the source view
  var beautifyCache = null;     // { src, out } cache of the beautified source
  var MAX_BEAUTIFY = 3000000;   // don't try to beautify beyond ~3 MB

  // Accepted file types for the HTML viewer. Other file types (Markdown, data
  // formats, EPUB, PDF, …) are handled by the sibling viewers, so they're
  // rejected here. Validation is by extension, plus a few exact filenames.
  var ACCEPT_EXT = {
    html:1, htm:1, xhtml:1, xht:1, shtml:1, shtm:1, stm:1, hta:1, mhtml:1, mht:1,
    css:1, scss:1, sass:1, less:1, styl:1, pcss:1, postcss:1,
    js:1, mjs:1, cjs:1, jsx:1, ts:1, mts:1, cts:1, tsx:1, coffee:1,
    htaccess:1, htpasswd:1, env:1, ini:1, conf:1, webmanifest:1, map:1,
    php:1, phtml:1, asp:1, aspx:1, ascx:1, cshtml:1, vbhtml:1, jsp:1, jspx:1, cfm:1,
    erb:1, rhtml:1, ejs:1, hbs:1, handlebars:1, mustache:1, njk:1, liquid:1,
    jinja:1, j2:1, twig:1, pug:1, jade:1, haml:1, slim:1, vue:1, svelte:1, astro:1
  };
  var ACCEPT_NAME = { "robots.txt":1, ".htaccess":1, ".htpasswd":1, ".env":1 };

  // Extension -> highlight.js language (only languages bundled in this build;
  // unknown-but-accepted types fall back to automatic detection).
  var EXT_LANG = {
    html:"xml", htm:"xml", xhtml:"xml", xht:"xml", shtml:"xml", shtm:"xml", stm:"xml",
    hta:"xml", mhtml:"xml", mht:"xml",
    css:"css", styl:"css", pcss:"css", postcss:"css", scss:"scss", sass:"scss", less:"less",
    js:"javascript", mjs:"javascript", cjs:"javascript", jsx:"javascript",
    ts:"typescript", mts:"typescript", cts:"typescript", tsx:"typescript",
    php:"php", phtml:"php",
    env:"ini", ini:"ini", conf:"ini",
    webmanifest:"json", map:"json",
    vue:"xml", svelte:"xml", astro:"xml", twig:"xml", liquid:"xml", njk:"xml",
    jinja:"xml", j2:"xml", hbs:"xml", handlebars:"xml", mustache:"xml", ejs:"xml",
    erb:"xml", rhtml:"xml", asp:"xml", aspx:"xml", ascx:"xml", cshtml:"xml",
    vbhtml:"xml", jsp:"xml", jspx:"xml", cfm:"xml"
  };
  // Files rendered in the sandboxed iframe (everything else opens as source).
  var PREVIEW_EXT = { html:1, htm:1, xhtml:1, xht:1, shtml:1, shtm:1, stm:1, hta:1 };

  // Which js-beautify formatter (if any) to use per extension. Types not listed
  // (indentation-based syntaxes, configs, etc.) are shown verbatim only.
  var BEAUTIFY_KIND = {
    css:"css", scss:"css", sass:"css", less:"css", styl:"css", pcss:"css", postcss:"css",
    js:"js", mjs:"js", cjs:"js", jsx:"js", ts:"js", mts:"js", cts:"js", tsx:"js",
    json:"js", json5:"js", jsonc:"js", map:"js", webmanifest:"js",
    html:"html", htm:"html", xhtml:"html", xht:"html", shtml:"html", shtm:"html", stm:"html",
    hta:"html", mhtml:"html", mht:"html", vue:"html", svelte:"html", astro:"html",
    php:"html", phtml:"html", erb:"html", rhtml:"html", ejs:"html", hbs:"html",
    handlebars:"html", mustache:"html", njk:"html", liquid:"html", jinja:"html",
    j2:"html", twig:"html", asp:"html", aspx:"html", ascx:"html", cshtml:"html",
    vbhtml:"html", jsp:"html", jspx:"html", cfm:"html"
  };

  function extOf(name){ var m = /\.([a-z0-9_]+)$/i.exec(name || ""); return m ? m[1].toLowerCase() : ""; }
  function langFor(ext){ return EXT_LANG[ext] || ""; }
  function isAccepted(name){
    if (!name) return true;                       // pasted/dropped text has no filename to check
    var base = String(name).toLowerCase().split("/").pop().split("\\").pop();
    return ACCEPT_NAME[base] === 1 || ACCEPT_EXT[extOf(base)] === 1;
  }

  function sniffHtml(text){
    var t = String(text || "").replace(/^\uFEFF/, "").replace(/^\s+/, "").slice(0, 200).toLowerCase();
    return t.indexOf("<!doctype html") === 0 || t.indexOf("<html") === 0;
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>]/g, function(c){
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  function toast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove("show"); }, 1900);
  }

  // Reflect the loaded file's name into the URL (?name=), so a bookmarked or
  // shared link says what was being viewed. history.replaceState only, and
  // URLSearchParams does its own percent-encoding — this never touches the
  // DOM, so it carries no XSS risk on its own. The value becomes untrusted
  // input again the moment it is read back (see the on-load block near the
  // bottom of this script), and that path must stay textContent-only.
  function syncQueryName(name){
    var url = new URL(location.href);
    if (name) url.searchParams.set("name", name);
    else url.searchParams.delete("name");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function show(text, name){
    rawText = text;
    currentName = name || "";
    syncQueryName(currentName);
    var ext = extOf(name);
    previewable = !!PREVIEW_EXT[ext] || ((!ext || !EXT_LANG[ext]) && sniffHtml(text));
    codeBuiltFor = null;
    beautified = false;           // each file opens as raw source
    beautifyCache = null;

    empty.hidden = true;
    docTitle.textContent = name || BASE_TITLE;
    doc.title = name ? name + " — " + BASE_TITLE : BASE_TITLE;
    body.classList.add("viewing");

    btnView.hidden = !previewable;
    if (previewable) preview.srcdoc = text;
    setMode(previewable ? "preview" : "code");   // preview starts with the header hidden
    window.scrollTo(0, 0);
  }

  function setMode(m){
    mode = m;
    clearTimeout(hdrIdleTimer);
    lastPos.win = lastPos.code = lastPos.frame = 0;   // reset scroll baseline on a view switch
    if (m === "preview"){
      codeView.hidden = true;
      preview.hidden = false;
      revealHeader();        // rendered view: header shows, then collapses to the handle after 3s
    } else {
      buildCode();
      preview.hidden = true;
      codeView.hidden = false;
      codeView.scrollTop = 0;
      codeView.scrollLeft = 0;
      showHeader(); clearTimeout(hdrIdleTimer);   // source view: header stays (content sits below it)
    }
    updateViewBtn();
    updateFormatBtn();
  }

  function updateViewBtn(){
    var toCode = (mode === "preview");   // button switches to the OTHER view
    iconCode.hidden = !toCode;
    iconEye.hidden = toCode;
    var label = toCode ? "View source" : "View rendered";
    btnView.setAttribute("data-tip", label);
    btnView.setAttribute("aria-label", toCode ? "View source code" : "View rendered HTML");
  }

  function doBeautify(text, ext){
    var kind = BEAUTIFY_KIND[ext];
    if (!kind || !window.beautifier) return text;
    var opts = { indent_size: 2, end_with_newline: false, preserve_newlines: true, max_preserve_newlines: 2 };
    if (kind === "css")  return beautifier.css(text, opts);
    if (kind === "html") return beautifier.html(text, opts);
    return beautifier.js(text, opts);
  }
  // The text the source view currently shows (raw, or the cached beautified version).
  function displayText(){
    if (beautified && beautifyCache && beautifyCache.src === rawText) return beautifyCache.out;
    return rawText;
  }
  function canBeautifyCurrent(){
    return mode === "code" && !!window.beautifier && !!BEAUTIFY_KIND[extOf(currentName)];
  }
  function updateFormatBtn(){
    btnFormat.hidden = !canBeautifyCurrent();
    btnFormat.classList.toggle("active", beautified);
    btnFormat.setAttribute("aria-pressed", beautified ? "true" : "false");
    btnFormat.setAttribute("data-tip", beautified ? "Show raw source" : "Format / beautify");
  }

  function buildCode(){
    var key = rawText + " " + beautified;
    if (codeBuiltFor === key) return;
    var text = String(displayText()).replace(/\n$/, "");   // drop one trailing newline for tidy display
    var ext = extOf(currentName);
    var lang = langFor(ext);
    var htmlOut, usedLang = "";

    if (window.hljs && text.length <= MAX_HIGHLIGHT){
      try {
        if (lang && hljs.getLanguage(lang)){
          htmlOut = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
          usedLang = lang;
        } else {
          var auto = hljs.highlightAuto(text);
          htmlOut = auto.value;
          usedLang = auto.language || "";
        }
      } catch (e){
        htmlOut = escapeHtml(text);
      }
    } else {
      htmlOut = escapeHtml(text);
    }

    codeInner.innerHTML = htmlOut;
    codeInner.className = "hljs" + (usedLang ? " language-" + usedLang : "");

    var n = text.length ? text.split("\n").length : 1;
    var g = "";
    for (var i = 1; i <= n; i++) g += i + "\n";
    gutter.textContent = g;
    codeBuiltFor = rawText + " " + beautified;
  }

  function clearAll(){
    rawText = ""; currentName = ""; previewable = false; codeBuiltFor = null;
    syncQueryName("");
    beautified = false; beautifyCache = null;
    preview.hidden = true; preview.removeAttribute("srcdoc");
    codeView.hidden = true;
    codeInner.textContent = ""; codeInner.className = "hljs"; gutter.textContent = "";
    btnView.hidden = true; btnFormat.hidden = true;
    empty.hidden = false;
    docTitle.textContent = BASE_TITLE;
    doc.title = BASE_TITLE;
    body.classList.remove("viewing", "hdr-hidden");
    clearTimeout(hdrIdleTimer);
  }

  function readFile(file){
    if (!file) return;
    if (!isAccepted(file.name)){
      if (!familyRoute(file)) toast("“" + file.name + "” isn’t a supported file type");
      return;
    }
    var reader = new FileReader();
    reader.onload  = function(e){ show(String(e.target.result || ""), file.name); };
    reader.onerror = function(){ toast("Could not read that file"); };
    reader.readAsText(file);
  }

  function openDialog(){ fileInput.click(); }

  fileInput.addEventListener("change", function(e){
    var f = e.target.files && e.target.files[0];
    if (f) readFile(f);
    fileInput.value = "";
  });

  // View toggle: rendered <-> source
  btnView.addEventListener("click", function(){
    if (!previewable) return;
    setMode(mode === "preview" ? "code" : "preview");
  });

  // Format toggle: pretty-print (beautify) the source <-> show it raw
  btnFormat.addEventListener("click", function(){
    if (!canBeautifyCurrent()) return;
    if (!beautified){
      if (rawText.length > MAX_BEAUTIFY){ toast("File too large to format"); return; }
      var out;
      try { out = doBeautify(rawText, extOf(currentName)); }
      catch (e){ toast("Couldn’t format this file"); return; }
      beautifyCache = { src: rawText, out: out };
      beautified = true;
      toast("Formatted");
    } else {
      beautified = false;
      toast("Showing raw source");
    }
    codeBuiltFor = null;
    buildCode();
    codeView.scrollTop = 0; codeView.scrollLeft = 0;
    updateFormatBtn();
  });

  // Copy the source (beautified if the Format toggle is on)
  id("btnCopy").addEventListener("click", function(){
    if (!rawText){ toast("Nothing to copy yet"); return; }
    var toCopy = displayText();
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(toCopy).then(
        function(){ toast("Source copied"); },
        function(){ fallbackCopy(toCopy); }
      );
    } else {
      fallbackCopy(toCopy);
    }
  });

  function fallbackCopy(text){
    var ta = doc.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    doc.body.appendChild(ta); ta.select();
    try { doc.execCommand("copy"); toast("Source copied"); }
    catch (err){ toast("Copy not supported"); }
    doc.body.removeChild(ta);
  }

  id("btnClear").addEventListener("click", clearAll);

  // Empty-state acts as an open button (great on mobile)
  empty.addEventListener("click", openDialog);
  empty.addEventListener("keydown", function(e){
    if (e.key === "Enter" || e.key === " "){ e.preventDefault(); openDialog(); }
  });

  // ---------- Header: while viewing the rendered file it auto-hides after 3s, ----------
  // ---------- collapsing to a thick handle; hover / touch / scroll-up brings it back. --
  var HDR_IDLE_MS = 3000, HDR_THRESH = 6;
  var hdrIdleTimer = null;
  var lastPos = { win:0, code:0, frame:0 };

  function showHeader(){ body.classList.remove("hdr-hidden"); }
  // only the rendered (preview) view auto-hides; the source view keeps the header (its content sits below it)
  function hideHeader(){ if (body.classList.contains("viewing") && mode === "preview") body.classList.add("hdr-hidden"); }
  function armIdleHide(){ clearTimeout(hdrIdleTimer); hdrIdleTimer = setTimeout(hideHeader, HDR_IDLE_MS); }
  function revealHeader(){ showHeader(); armIdleHide(); }

  function onScroll(key, pos){
    if (!body.classList.contains("viewing")) return;
    var delta = pos - lastPos[key];
    lastPos[key] = pos;
    if (delta > HDR_THRESH){ hideHeader(); }            // scroll down -> collapse to the handle
    else if (delta < -HDR_THRESH){ revealHeader(); }    // scroll up   -> reveal, then auto-hide after 3s
  }

  window.addEventListener("scroll", function(){ onScroll("win", window.pageYOffset || root.scrollTop || 0); }, { passive:true });
  codeView.addEventListener("scroll", function(){ onScroll("code", codeView.scrollTop); }, { passive:true });

  // The preview iframe is sandbox="allow-same-origin" (scripts stay blocked), so the
  // parent can observe its scroll and its drops. Without this, a file dropped onto the
  // rendered page would fall through to the browser (which opens it in a new tab)
  // instead of replacing the current file.
  preview.addEventListener("load", function(){
    lastPos.frame = 0;
    try {
      var w = preview.contentWindow, pd = preview.contentDocument || (w && w.document);
      if (w) w.addEventListener("scroll", function(){
        var d = w.document && (w.document.scrollingElement || w.document.documentElement || w.document.body);
        onScroll("frame", w.pageYOffset || (d && d.scrollTop) || 0);
      }, { passive:true });
      if (pd){
        pd.addEventListener("dragenter", function(e){ if (hasFiles(e)){ e.preventDefault(); showOverlay(true); } }, false);
        pd.addEventListener("dragover", function(e){ if (hasFiles(e)){ e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } }, false);
        pd.addEventListener("dragleave", function(e){ e.preventDefault(); showOverlay(false); }, false);
        pd.addEventListener("drop", function(e){
          e.preventDefault(); showOverlay(false);
          var dt = e.dataTransfer; if (!dt) return;
          if (dt.files && dt.files.length){ readFile(dt.files[0]); return; }
          var t = dt.getData && dt.getData("text"); if (t) show(t, "");
        }, false);
      }
    } catch (e){}
  });
  function hasFiles(e){ return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1; }

  // Reveal by moving the pointer onto the top strip / handle (desktop) or tapping it (mobile).
  hoverZone.addEventListener("mouseenter", revealHeader);
  hoverZone.addEventListener("click", revealHeader);
  hoverZone.addEventListener("touchstart", function(){ revealHeader(); }, { passive:true });
  // keep the header up while the pointer is over it; re-arm the 3s auto-hide when it leaves
  topbar.addEventListener("mouseenter", function(){ showHeader(); clearTimeout(hdrIdleTimer); });
  topbar.addEventListener("mouseleave", function(){ armIdleHide(); });

  // Measure the header so the source view can clear the fixed bar.
  function measureHeader(){ root.style.setProperty("--hdr-h", (topbar ? topbar.offsetHeight : 56) + "px"); }
  measureHeader();
  window.addEventListener("resize", measureHeader);

  // Footer: the close button hides the footer for this session (returns on reload).
  id("btnHideFooter").addEventListener("click", function(){ if (footerEl) footerEl.hidden = true; });

  // ---------- Hamburger flyout nav ----------
  var btnMenu = id("btnMenu"), navBackdrop = id("navBackdrop");
  function setNav(open){ body.classList.toggle("nav-open", open); btnMenu.setAttribute("aria-expanded", open ? "true" : "false"); }
  btnMenu.addEventListener("click", function(){ setNav(!body.classList.contains("nav-open")); });
  navBackdrop.addEventListener("click", function(){ setNav(false); });
  doc.addEventListener("keydown", function(e){
    if (!id("routeCard").hidden){                     // §6.10 offer card is modal
      if (e.key === "Escape"){ hideRouteCard(); return; }
      if (e.key === "Tab"){                           // two-button focus wrap (aria-modal)
        e.preventDefault();
        var go = id("routeGo"), no = id("routeDismiss");
        (doc.activeElement === go || go.disabled ? no : go).focus();
        return;
      }
    }
    if (e.key === "Escape") setNav(false);
  });

  // ---------- Background color (chosen by the user, remembered in a cookie) ----------
  function setCookie(name, val){
    doc.cookie = name + "=" + encodeURIComponent(val) + "; max-age=31536000; path=/; SameSite=Lax";
  }
  function getCookie(name){
    var m = doc.cookie.match("(?:^|; )" + name.replace(/([.*+?^${}()|[\]\\])/g, "\\$1") + "=([^;]*)");
    return m ? decodeURIComponent(m[1]) : null;
  }
  function hexToRgb(h){
    h = h.replace("#", "");
    if (h.length === 3) h = h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2);
    var n = parseInt(h, 16);
    return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
  }
  function srgb(c){ c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  function luminance(rgb){ return 0.2126*srgb(rgb.r) + 0.7152*srgb(rgb.g) + 0.0722*srgb(rgb.b); }
  function mix(a, b, t){
    return "rgb(" + Math.round(a.r+(b.r-a.r)*t) + "," + Math.round(a.g+(b.g-a.g)*t) + "," + Math.round(a.b+(b.b-a.b)*t) + ")";
  }
  function rgbStr(c){ return "rgb(" + c.r + "," + c.g + "," + c.b + ")"; }

  // Syntax palettes: dark tokens for light backgrounds, light tokens for dark backgrounds.
  var HL_LIGHT = { comment:"#6e7781", keyword:"#cf222e", tag:"#116329", attr:"#0550ae", string:"#0a3069", number:"#0550ae", title:"#8250df", built:"#953800" };
  var HL_DARK  = { comment:"#8b949e", keyword:"#ff7b72", tag:"#7ee787", attr:"#79c0ff", string:"#a5d6ff", number:"#79c0ff", title:"#d2a8ff", built:"#ffa657" };

  function applyColor(hex){
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) hex = "#ffffff";
    var bg = hexToRgb(hex);
    // Pick black or white text by whichever contrasts better (crossover ~0.179).
    var lightText = luminance(bg) <= 0.179;          // dark background -> light text
    var text = lightText ? { r:240, g:243, b:246 } : { r:31, g:35, b:40 };
    var accentHex = lightText ? "#8b93ff" : "#4f46e5";
    var ac = hexToRgb(accentHex);
    var hl = lightText ? HL_DARK : HL_LIGHT;
    var s = root.style;
    s.setProperty("--bg", hex);
    s.setProperty("--surface", hex);
    s.setProperty("--text", rgbStr(text));
    s.setProperty("--code-text", rgbStr(text));
    s.setProperty("--muted", mix(bg, text, 0.45));
    s.setProperty("--border", mix(bg, text, 0.24));
    s.setProperty("--border-soft", mix(bg, text, 0.13));
    s.setProperty("--code-bg", mix(bg, text, 0.07));
    s.setProperty("--hover", mix(bg, text, 0.10));
    s.setProperty("--accent", accentHex);
    s.setProperty("--accent-contrast", lightText ? "#0d1117" : "#ffffff");
    s.setProperty("--overlay", "rgba(" + ac.r + "," + ac.g + "," + ac.b + ",0.12)");
    s.setProperty("--shadow", lightText ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.12)");
    s.setProperty("--header-bg", "rgba(" + bg.r + "," + bg.g + "," + bg.b + ",0.9)");
    s.setProperty("--hl-comment", hl.comment);
    s.setProperty("--hl-keyword", hl.keyword);
    s.setProperty("--hl-tag", hl.tag);
    s.setProperty("--hl-attr", hl.attr);
    s.setProperty("--hl-string", hl.string);
    s.setProperty("--hl-number", hl.number);
    s.setProperty("--hl-title", hl.title);
    s.setProperty("--hl-built", hl.built);
    s.colorScheme = lightText ? "dark" : "light";
    themeColor.setAttribute("content", hex);
  }

  function isHex6(v){ return /^#([0-9a-f]{6})$/i.test(v || ""); }
  function saveColor(val){
    setCookie("mykk-bg", val);                                  // primary
    try { localStorage.setItem("mykk-bg", val); } catch (e) {}  // fallback (e.g. file://)
  }
  function loadColor(){
    var v = getCookie("mykk-bg");
    if (!isHex6(v)) { try { v = localStorage.getItem("mykk-bg"); } catch (e) { v = null; } }
    return isHex6(v) ? v : ((window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "#0d1117" : "#ffffff");
  }

  var saved = loadColor();
  bgPicker.value = saved;
  applyColor(saved);
  bgPicker.addEventListener("input", function(){
    applyColor(bgPicker.value);
    saveColor(bgPicker.value);
    syncThemeToggle();
  });

  var themeToggle=document.getElementById("themeToggle"),themeIconSun=document.getElementById("themeIconSun"),themeIconMoon=document.getElementById("themeIconMoon");
  function isDarkBg(){ try { return luminance(hexToRgb(bgPicker.value)) <= 0.179; } catch(e){ return false; } }
  function syncThemeToggle(){ if(!themeToggle) return; var dark=isDarkBg(); themeToggle.setAttribute("aria-pressed", dark?"true":"false"); themeToggle.setAttribute("aria-label", dark?"Switch to light theme":"Switch to dark theme"); if(themeIconSun){ if(dark) themeIconSun.setAttribute("hidden",""); else themeIconSun.removeAttribute("hidden"); } if(themeIconMoon){ if(dark) themeIconMoon.removeAttribute("hidden"); else themeIconMoon.setAttribute("hidden",""); } }
  if(themeToggle){ themeToggle.addEventListener("click", function(){ var next=isDarkBg()?"#ffffff":"#0d1117"; bgPicker.value=next; applyColor(next); saveColor(next); syncThemeToggle(); }); }
  syncThemeToggle();

  // ---------- Drag & drop (anywhere) ----------
  var dragDepth = 0;
  function showOverlay(s){ overlay.classList.toggle("show", s); }
  window.addEventListener("dragenter", function(e){
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") === -1) return;
    e.preventDefault(); dragDepth++; showOverlay(true);
  });
  window.addEventListener("dragover", function(e){
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", function(e){
    e.preventDefault(); dragDepth--; if (dragDepth <= 0){ dragDepth = 0; showOverlay(false); }
  });
  window.addEventListener("drop", function(e){
    e.preventDefault(); dragDepth = 0; showOverlay(false);
    var dt = e.dataTransfer; if (!dt) return;
    if (dt.files && dt.files.length){ readFile(dt.files[0]); return; }
    var txt = dt.getData && dt.getData("text");
    if (txt) show(txt, "");
  });

  // ---------- Paste to view ----------
  window.addEventListener("paste", function(e){
    var cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    if (cd.files && cd.files.length){ e.preventDefault(); readFile(cd.files[0]); return; }
    var txt = cd.getData && cd.getData("text");
    if (txt){ e.preventDefault(); show(txt, ""); }
  });

  // ---------- Family router (§6.10): wrong-viewer redirect offer + hand-off ----------
        /* FV-MAP-START — generated from family-map.json (canonical); deep-equality enforced by the harness */
    var FAMILY = {
      audio:    { domain:"audio-viewer.us"     , label:"Audio Viewer"     , kind:"an audio file" },
      cert:     { domain:"cert-viewer.us"      , label:"Cert Viewer"      , kind:"a certificate" },
      data:     { domain:"data-viewer.us"      , label:"Data Viewer"      , kind:"a data file" },
      docx:     { domain:"docx-viewer.us"      , label:"DOCX Viewer"      , kind:"a Word document" },
      eml:      { domain:"eml-viewer.us"       , label:"EML Viewer"       , kind:"an email file" },
      epub:     { domain:"epub-viewer.us"      , label:"EPUB Viewer"      , kind:"an e-book" },
      html:     { domain:"html-viewer.us"      , label:"HTML Viewer"      , kind:"a web or source-code file" },
      image:    { domain:"image-viewer.us"     , label:"Image Viewer"     , kind:"an image" },
      log:      { domain:"log-viewer.us"       , label:"Log Viewer"       , kind:"a log file" },
      markdown: { domain:"markdown-viewer.us"  , label:"Markdown Viewer"  , kind:"a Markdown or text file" },
      pdf:      { domain:"pdf-viewer.us"       , label:"PDF Viewer"       , kind:"a PDF" },
      pptx:     { domain:"pptx-viewer.us"      , label:"PPTX Viewer"      , kind:"a presentation" },
      pub:      { domain:"pub-viewer.us"       , label:"PUB Viewer"       , kind:"a Publisher file" },
      sheets:   { domain:"sheets-viewer.us"    , label:"Sheets Viewer"    , kind:"a spreadsheet" },
      video:    { domain:"video-viewer.us"     , label:"Video Viewer"     , kind:"a video" }
    };
    var FAMILY_HUB = "file-viewer.us";
    var FAMILY_NAMES = {"robots.txt":"html"};
    var FAMILY_MAP = {
      // sheets
      "123":"sheets", xlsx:"sheets", xlsm:"sheets", xlsb:"sheets", xls:"sheets", xlt:"sheets", xltx:"sheets", xltm:"sheets",
      xlam:"sheets", ods:"sheets", fods:"sheets", dif:"sheets", prn:"sheets", dbf:"sheets", numbers:"sheets", xlml:"sheets",
      wk1:"sheets", wk3:"sheets", wks:"sheets", et:"sheets", uos:"sheets",
      // cert
      pem:"cert", crt:"cert", cer:"cert", der:"cert", csr:"cert", cert:"cert", p7b:"cert", p12:"cert",
      pfx:"cert",
      // data
      json:"data", jsonc:"data", json5:"data", jsonld:"data", ndjson:"data", yaml:"data", yml:"data", toml:"data",
      csv:"data", tsv:"data", xml:"data", rss:"data", atom:"data", graphql:"data", gql:"data",
      // docx
      docx:"docx", docm:"docx", dotx:"docx", dotm:"docx", doc:"docx", dot:"docx", rtf:"docx", odt:"docx",
      // eml
      eml:"eml", mbox:"eml", emlx:"eml", msg:"eml",
      // epub
      epub:"epub",
      // html
      html:"html", htm:"html", xhtml:"html", xht:"html", shtml:"html", shtm:"html", stm:"html", hta:"html",
      mhtml:"html", mht:"html", css:"html", scss:"html", sass:"html", less:"html", styl:"html", pcss:"html",
      postcss:"html", js:"html", mjs:"html", cjs:"html", jsx:"html", ts:"html", mts:"html", cts:"html",
      tsx:"html", coffee:"html", htaccess:"html", htpasswd:"html", env:"html", ini:"html", conf:"html", webmanifest:"html",
      map:"html", php:"html", phtml:"html", asp:"html", aspx:"html", ascx:"html", cshtml:"html", vbhtml:"html",
      jsp:"html", jspx:"html", cfm:"html", erb:"html", rhtml:"html", ejs:"html", hbs:"html", handlebars:"html",
      mustache:"html", njk:"html", liquid:"html", jinja:"html", j2:"html", twig:"html", pug:"html", jade:"html",
      haml:"html", slim:"html", vue:"html", svelte:"html", astro:"html",
      // image
      png:"image", jpg:"image", jpeg:"image", jpe:"image", jfif:"image", gif:"image", webp:"image", avif:"image",
      svg:"image", svgz:"image", bmp:"image", dib:"image", ico:"image", cur:"image", tif:"image", tiff:"image",
      tga:"image", targa:"image", icb:"image", vda:"image", vst:"image", qoi:"image", pcx:"image", ppm:"image",
      pgm:"image", pbm:"image", pnm:"image", pam:"image", ff:"image", dds:"image", heic:"image", heif:"image",
      jxl:"image", psd:"image",
      // log
      log:"log", out:"log", err:"log", trace:"log", syslog:"log",
      // markdown
      md:"markdown", markdown:"markdown", mdx:"markdown", txt:"markdown", rst:"markdown", adoc:"markdown",
      // pdf
      pdf:"pdf",
      // pptx
      pptx:"pptx", pptm:"pptx", ppsx:"pptx", ppsm:"pptx", potx:"pptx", potm:"pptx", ppt:"pptx",
      // pub
      pub:"pub",
      // audio
      mp3:"audio", wav:"audio", flac:"audio", m4a:"audio", aac:"audio", ogg:"audio", oga:"audio", opus:"audio",
      weba:"audio", mka:"audio", aif:"audio", aiff:"audio", wma:"audio", mid:"audio", midi:"audio",
      // video
      webm:"video", mp4:"video", m4v:"video", ogv:"video", mov:"video", mkv:"video", avi:"video", wmv:"video"
    };
    /* FV-MAP-END */
    var FAMILY_ORIGINS = Object.keys(FAMILY).map(function (k) { return "https://" + FAMILY[k].domain; })
      .concat("https://" + FAMILY_HUB);
  var DOMAIN = "html-viewer.us";

  var routeFile = null, routeKey = "", routePrevFocus = null, handoff = null;
  function cancelHandoff(){                    // tear down a pending hand-off (sender below)
    if (!handoff) return;
    window.removeEventListener("message", handoff.onMsg);
    clearTimeout(handoff.timer);
    handoff = null;
  }
  function showRouteCard(file, key){
    cancelHandoff();                           // a new offer aborts any pending hand-off
    if (id("routeCard").hidden) routePrevFocus = document.activeElement;  // don't capture our own button
    routeFile = file; routeKey = key;
    var t = FAMILY[key];
    // ⁨…⁩ (FSI…PDI) bidi-isolate the untrusted name so U+202E-style
    // overrides can't visually reorder the sentence.
    id("routeMsg").textContent = "“⁨" + file.name + "⁩” looks like " + t.kind + " — it belongs to " + t.label + ".";
    id("routeGo").textContent = "Open " + t.domain + " ↗";
    id("routeSub").textContent = "Your file stays on this device — nothing is uploaded.";
    id("routeGo").disabled = false;
    id("routeBackdrop").hidden = false; id("routeCard").hidden = false;
    id("routeGo").focus();
  }
  function hideRouteCard(){
    cancelHandoff();                           // dismissal aborts a pending hand-off
    id("routeBackdrop").hidden = true; id("routeCard").hidden = true;
    routeFile = null; routeKey = "";
    if (routePrevFocus && routePrevFocus.focus) routePrevFocus.focus();
  }
  function familyRoute(file){
    var n = String(file && file.name || "").toLowerCase();
    var key = FAMILY_NAMES[n];
    if (!key){
      var i = n.lastIndexOf(".");
      var ext = i >= 0 ? n.slice(i + 1) : "";
      key = FAMILY_MAP[ext];
    }
    if (!key || FAMILY[key].domain === DOMAIN) return false;  // unknown type, or our own → caller keeps its toast
    showRouteCard(file, key);
    return true;
  }

  // Sender — routeGo is a real user gesture, so no popup blocker. Keep the window
  // handle: it is the message channel (no `noopener` on this one window.open).
  id("routeGo").addEventListener("click", function(){
    if (!routeFile || id("routeGo").disabled) return;               // no double-fire
    cancelHandoff();
    var t = FAMILY[routeKey], origin = "https://" + t.domain, file = routeFile;
    var w = window.open(origin + "/#fvh=" + encodeURIComponent(file.name));
    if (!w){ id("routeSub").textContent = "Couldn’t open the tab — allow pop-ups for this site and try again."; return; }
    id("routeGo").disabled = true;
    var h = {};
    h.onMsg = function(e){
      if (e.source !== w || e.origin !== origin || !e.data) return;
      if (e.data.type === "fv-ready") w.postMessage({ type:"fv-file", file:file }, origin);
      else if (e.data.type === "fv-ack"){ hideRouteCard(); toast("Sent to " + t.label); }  // hideRouteCard tears the handshake down
    };
    h.timer = setTimeout(function(){
      if (handoff !== h) return;
      cancelHandoff();
      id("routeSub").textContent = "Tab opened — drop the file there.";   // Level-1 fallback
    }, 10000);
    handoff = h;
    window.addEventListener("message", h.onMsg);
  });
  id("routeDismiss").addEventListener("click", hideRouteCard);
  id("routeBackdrop").addEventListener("click", hideRouteCard);

  // Receiver — accept a File handed over from a sibling family tab (§6.10).
  window.addEventListener("message", function(e){
    if (FAMILY_ORIGINS.indexOf(e.origin) === -1) return;      // family origins only
    var d = e.data;
    if (d && d.type === "fv-file" && d.file instanceof File){ // clone re-creates a real File in this realm
      readFile(d.file);
      e.source.postMessage({ type:"fv-ack" }, e.origin);      // ack = received and handed to the loader
    }
  });
  var fvh = /[#&]fvh=([^&]*)/.exec(location.hash);
  if (fvh){
    var fvhName = fvh[1];                                   // ⚠️ stranger-controlled — textContent only
    try { fvhName = decodeURIComponent(fvhName); } catch (_) {}  // malformed %-escapes must not abort the receiver
    history.replaceState(null, "", location.pathname + location.search);  // always clear, opener or not
    if (window.opener){
      try { window.opener.postMessage({ type:"fv-ready" }, "*"); } catch(_){}
      window.opener = null;    // sever the reverse-navigation channel once the ping is out
      var emptySub = doc.querySelector(".empty-sub");         // hand-off pending: say so in the empty state
      if (emptySub){
        var emptySubCopy = emptySub.textContent;
        emptySub.textContent = "Receiving “⁨" + fvhName + "⁩”…";  // FSI…PDI isolate the untrusted name
        setTimeout(function(){ emptySub.textContent = emptySubCopy; }, 10000);  // revert if nothing arrives
      }
    }
  }

  // A bookmarked or shared link can carry the name of the file last viewed
  // (?name=, set by syncQueryName above). No content is ever recoverable
  // from a name alone — this only labels the empty state, and it never
  // fetches or renders anything on the strength of it. Skipped when an
  // #fvh hand-off is already customizing the same element.
  if (!fvh && !currentName){
    var qName = new URLSearchParams(location.search).get("name");
    if (qName){
      var lastSub = doc.querySelector(".empty-sub");
      if (lastSub){
        // Display-only, and it must stay that way: this string is read
        // straight from the URL, so it is exactly as stranger-controlled as
        // fvhName above. No fact is asserted about whether anyone actually
        // viewed it — only that the link names it.
        lastSub.textContent = "This link was shared for “⁨" + qName + "⁩”.";
      }
    }
  }
})();
