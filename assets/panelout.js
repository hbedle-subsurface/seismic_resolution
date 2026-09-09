/* ===========================================================================
   panelout.js — open the module's control panel in a second, live window
   Heather Bedle and April Moreno-Ward / AASPI / University of Oklahoma

   The same file is used unchanged by every teaching repository.

   Why this exists: the controls sit at the top of the page and the result of
   moving them sits further down. On a laptop the two are rarely on screen at
   once, so a student drags a slider, scrolls down, forgets which way they
   dragged it, and scrolls back. Moving the panel into its own window puts the
   sliders beside the panels they drive.

   The companion popout, which opens the exercises, is static, because exercise
   text does not change. This one is live: the second window holds a working
   copy of the controls, and every move in it drives the module in the first
   window. The header canvases are mirrored back, so the second window also
   shows the thumbnail it is changing.

   WHAT IT DOES: clones markup that is already on the page into a second
   window and forwards events between the two. Nothing is fetched, nothing is
   sent, nothing is stored. It works from a file:// copy with no network.

   HOW IT WORKS, and why it needs no change to any module:

     · The clone's inputs are not the module's inputs. When one of them moves,
       its value is copied onto the real input in the first window and an
       ordinary `input` event is fired there. Every module already listens for
       that event, so the module cannot tell the difference between a slider
       moved in its own window and one moved in this one.
     · Buttons in the clone call click() on their counterpart.
     · A pointer press on a cloned canvas is forwarded to the real canvas at
       the same fractional position, so a module that lets a line be dragged
       across a map still works from the second window.
     · A timer copies text, classes, canvas bitmaps and the hidden, disabled
       and selected states back from the real panel to the clone, so the clone
       shows whatever the module drew and whatever it switched on or off.

   TWO PANEL LAYOUTS: some sets keep the controls in a sticky `.labhead` block
   with a thumbnail beside them; others use a plain `section.controls` band
   under the module title. Both are handled. Where the panel has a `.cap`
   caption line, the button is placed at the end of it; where it has none, a
   short row is built directly above the panel to hold it.

   HOW TO INSTALL: one script tag per module, after the module's own scripts.
   No markup change and no stylesheet change. If this file is missing the
   button does not appear and the panel behaves exactly as it always did.

   License: CC BY-SA 4.0. Free to use, adapt and share with credit; any
   adaptation must be released under the same license.
   =========================================================================== */

(function () {
  'use strict';

  var TICK_MS = 120;
  var LABEL = 'Open the controls in a second window';

  var panel = null;      // the real panel, still in this document
  var holder = null;     // the zero-height wrapper it hides inside
  var bar = null;        // the line left behind in its place
  var ownRow = null;     // the row built to hold the button, where needed
  var win = null;        // the second window
  var clone = null;      // the working copy inside it
  var timer = null;
  var openBtn = null;

  /* The sticky lab head if the set uses one, otherwise the control band under
     the title. Document order settles it either way: in a set that has both,
     the band is inside the lab head, and the lab head is asked for first. */
  function findPanel() {
    return document.querySelector('.labhead') ||
           document.querySelector('section.controls') ||
           document.querySelector('.controls');
  }

  function windowName() {
    var p = (location.pathname || 'module').replace(/[^A-Za-z0-9]+/g, '_');
    return 'controls_' + p;
  }

  function moduleTitle() {
    var h1 = document.querySelector('.mod-head h1') || document.querySelector('h1');
    return h1 ? h1.textContent.trim() : (document.title || 'Controls');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Everything this page links in its head, by absolute URL so it resolves
     from about:blank and from file:// as well. */
  function headLinks() {
    var out = '';
    var links = document.querySelectorAll('head link[rel="stylesheet"], head link[rel="preconnect"]');
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      out += '<link rel="' + l.rel + '" href="' + l.href + '"' +
             (l.crossOrigin ? ' crossorigin' : '') + '>\n';
    }
    return out;
  }

  /* The second window's own layout. The site stylesheet does the rest, except
     that the panel is no longer sticky and no longer sits in a two-column
     grid: in a narrow window the thumbnail goes above the sliders. */
  var OWN_CSS = [
    'body { margin:0; padding:16px; background:var(--paper,#fff); }',
    '.po-head { display:flex; align-items:baseline; justify-content:space-between;',
    '  gap:14px; margin:0 0 14px; padding-bottom:10px;',
    '  border-bottom:1px solid var(--rule,#d8d8d8); }',
    '.po-head h1 { font-family:var(--display,Archivo,sans-serif); font-size:16px;',
    '  margin:0; color:var(--ink,#16191C); }',
    '.po-head .po-note { font-family:var(--mono,monospace); font-size:10.5px;',
    '  letter-spacing:.08em; text-transform:uppercase; color:var(--slate,#5C6670); }',
    '.labhead { position:static !important; margin:0 !important; box-shadow:none !important; }',
    '.labhead .labgrid { grid-template-columns:minmax(0,1fr) !important; }',
    '.labhead canvas { width:100% !important; height:auto !important; }',
    /* The control band is a grid that fits as many columns as the width
       allows, so in a narrow window its columns wrap onto a second row. On
       the page they never do, and the row gap set there is too small to
       separate a wrapped column heading from the control above it. */
    '#poWrap > .controls { position:static !important; margin:0 !important;',
    '  row-gap:22px !important; }',
    '.controls canvas { width:100% !important; height:auto !important; }',
    '.po-foot { margin-top:16px; font-size:12px; line-height:1.6;',
    '  color:var(--slate,#5C6670); }',
    '.po-stale { display:none; font-size:12px; color:var(--crimson,#841617); }'
  ].join('\n');

  function buildDocument() {
    var title = moduleTitle();
    return '<!doctype html>\n<html lang="en">\n<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>Controls \u2014 ' + escapeHtml(title) + '</title>\n' +
      headLinks() +
      '<style>\n' + OWN_CSS + '\n</style>\n' +
      '</head>\n<body>\n' +
      '<div class="po-head">' +
        '<h1>' + escapeHtml(title) + '</h1>' +
        '<span class="po-note">Controls</span>' +
      '</div>\n' +
      '<div id="poWrap"></div>\n' +
      '<p class="po-foot">Moving anything here changes the module in the other ' +
      'window, and the thumbnail above follows what it draws. Closing this ' +
      'window puts the controls back where they were.</p>\n' +
      '<p class="po-stale" id="poStale">The module window has closed. These ' +
      'controls no longer drive anything.</p>\n' +
      '</body>\n</html>';
  }

  /* --------------------------------------------------------------- bridge */

  /* Every element in the panel, in document order, and the matching element
     in the clone. The clone is a deep copy made in one call, so the two
     sequences correspond one to one for as long as neither is edited. */
  function pairs() {
    var a = [panel], b = [clone];
    var qa = panel.getElementsByTagName('*'), qb = clone.getElementsByTagName('*');
    if (qa.length !== qb.length) {
      /* The two are matched by position, so a difference in length means the
         pairing cannot be trusted and nothing should be wired to it. A live
         window with dead controls is worse than no window, so say so where the
         reader is looking. */
      warn('These controls are not connected to the module. The panel and its ' +
           'copy do not match (' + qa.length + ' against ' + qb.length +
           ' elements). Close this window and use the controls on the page.');
      return null;
    }
    for (var i = 0; i < qa.length; i++) { a.push(qa[i]); b.push(qb[i]); }
    return { real: a, copy: b };
  }

  function warn(text) {
    if (!win || win.closed) return;
    try {
      var d = win.document.createElement('p');
      d.setAttribute('style', 'margin:0 0 14px;padding:10px 12px;' +
        'background:#841617;color:#fff;font:12.5px/1.6 ui-sans-serif,system-ui,sans-serif');
      d.textContent = text;
      var wrap = win.document.getElementById('poWrap');
      if (wrap) wrap.insertBefore(d, wrap.firstChild);
    } catch (e) { /* nothing further to do */ }
  }

  var LINK = null;

  function fire(el, type) {
    try { el.dispatchEvent(new Event(type, { bubbles: true })); }
    catch (e) { /* the module simply does not see this one */ }
  }

  /* A control moved in the second window. Copy the value across and let the
     module's own listener do the rest. */
  function pushValue(real, copy) {
    if (real.type === 'checkbox' || real.type === 'radio') real.checked = copy.checked;
    else real.value = copy.value;
    fire(real, 'input');
    fire(real, 'change');
  }

  /* A press on a cloned canvas. Modules that accept a drag on a map read
     offsetX and offsetY, so the press is reproduced at the same fraction of
     the real canvas however differently the two are scaled. */
  function forwardPointer(real, copy, ev) {
    var rc = copy.getBoundingClientRect();
    if (!rc.width || !rc.height) return;
    var fx = (ev.clientX - rc.left) / rc.width;
    var fy = (ev.clientY - rc.top) / rc.height;
    var rr = real.getBoundingClientRect();
    var type = ev.type === 'pointerdown' ? 'mousedown'
             : ev.type === 'pointerup' ? 'mouseup' : 'mousemove';
    var init = {
      bubbles: true, cancelable: true, buttons: ev.buttons,
      clientX: rr.left + fx * rr.width,
      clientY: rr.top + fy * rr.height
    };
    try { real.dispatchEvent(new MouseEvent(type, init)); }
    catch (e) { /* nothing further to do */ }
  }

  function wire() {
    LINK = pairs();
    if (!LINK) return;
    for (var i = 0; i < LINK.copy.length; i++) {
      (function (real, copy) {
        var tag = copy.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
          copy.addEventListener('input', function () { pushValue(real, copy); });
          copy.addEventListener('change', function () { pushValue(real, copy); });
        } else if (tag === 'BUTTON') {
          copy.addEventListener('click', function (ev) {
            ev.preventDefault();
            real.click();
          });
        } else if (tag === 'CANVAS') {
          copy.style.touchAction = 'none';
          ['pointerdown', 'pointermove', 'pointerup'].forEach(function (t) {
            copy.addEventListener(t, function (ev) { forwardPointer(real, copy, ev); });
          });
        }
      })(LINK.real[i], LINK.copy[i]);
    }
  }

  /* --------------------------------------------------------------- mirror */

  function mirrorCanvas(real, copy) {
    if (!real.width || !real.height) return;
    if (copy.width !== real.width || copy.height !== real.height) {
      copy.width = real.width;
      copy.height = real.height;
    }
    var ctx = copy.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, copy.width, copy.height);
    try { ctx.drawImage(real, 0, 0); } catch (e) { /* nothing drawn yet */ }
  }

  var repaired = false;
  function mirror() {
    if (!win || win.closed) { restore(); return; }
    if (!LINK) {
      /* One retry: a module that adds a node to the panel after load would
         have been paired before that node existed. */
      if (repaired) return;
      repaired = true;
      LINK = pairs();
      if (!LINK) return;
    }
    var focused = win.document.activeElement;
    for (var i = 0; i < LINK.real.length; i++) {
      var r = LINK.real[i], c = LINK.copy[i];
      if (c.tagName === 'CANVAS') { mirrorCanvas(r, c); continue; }
      if (c.className !== r.className) c.className = r.className;
      /* A module that swaps one set of controls for another does it with the
         hidden property, which leaves no trace in the class list. Without
         this the clone shows the Ricker sliders and the Ormsby sliders at
         once, and the pair the module is ignoring still appears live. */
      if (c.hidden !== r.hidden) c.hidden = r.hidden;
      if (c.disabled !== r.disabled) c.disabled = r.disabled;
      var ap = r.getAttribute('aria-pressed');
      if (ap !== null && c.getAttribute('aria-pressed') !== ap) c.setAttribute('aria-pressed', ap);
      if (c.tagName === 'INPUT') {
        if (c !== focused && c.value !== r.value) c.value = r.value;
        if (c.checked !== r.checked) c.checked = r.checked;
        continue;
      }
      /* A menu carries its state as a property, not as an attribute, so the
         deep copy starts on whichever option the markup marked as selected
         however long ago the reader changed it. Copying the value here also
         covers a menu the module sets for itself, such as a preset dropped
         back to Custom once a layer is edited by hand. */
      if (c.tagName === 'SELECT' || c.tagName === 'TEXTAREA') {
        if (c !== focused && c.value !== r.value) c.value = r.value;
        continue;
      }
      /* Leaf text only: a readout, a label, a value. Anything with element
         children is a container and its own children are handled below it. */
      if (!c.firstElementChild && c.textContent !== r.textContent) {
        c.textContent = r.textContent;
      }
    }
    /* A step that does not use the panel hides it. Say so rather than leaving
       a stale copy that appears to be live. */
    var off = !!panel.hidden;
    if (clone.style.opacity !== (off ? '0.35' : '1')) {
      clone.style.opacity = off ? '0.35' : '1';
    }
  }

  /* ---------------------------------------------------------- open, close */

  function makeBar() {
    var d = document.createElement('div');
    d.setAttribute('style',
      'display:flex;align-items:center;justify-content:space-between;gap:14px;' +
      'margin:16px 0 0;padding:8px 14px;background:var(--panel,#F4F6F7);' +
      'border:1px solid var(--rule,#C9CDD2);font-size:12.5px;' +
      'color:var(--slate,#5C6670)');
    var msg = document.createElement('span');
    msg.textContent = 'The controls are open in a separate window. Everything below still follows them.';
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn ghost small';
    back.textContent = 'Bring them back';
    back.addEventListener('click', restore);
    d.appendChild(msg);
    d.appendChild(back);
    return d;
  }

  function open() {
    if (win && !win.closed) { win.focus(); return; }

    try {
      win = window.open('', windowName(),
        'width=560,height=720,scrollbars=yes,resizable=yes');
    } catch (e) { win = null; }

    if (!win) {
      openBtn.textContent = 'Pop-up blocked \u2014 allow pop-ups for this page';
      openBtn.disabled = true;
      setTimeout(function () {
        openBtn.textContent = LABEL;
        openBtn.disabled = false;
      }, 4000);
      return;
    }

    try {
      win.document.open();
      win.document.write(buildDocument());
      win.document.close();
    } catch (e) {
      try { win.close(); } catch (e2) { /* nothing further */ }
      win = null;
      openBtn.textContent = 'Could not open \u2014 try again';
      setTimeout(function () { openBtn.textContent = LABEL; }, 4000);
      return;
    }

    clone = win.document.importNode(panel, true);
    /* Where the button sits inside the panel, the clone's copy of it is
       hidden rather than removed. Removing it made the clone one element
       shorter than the original, and the two sequences pairs() walks are
       matched by position, so every pair after the button was off by one and
       the length check then rejected the whole set. The result was a second
       window whose controls did nothing and whose canvases were never
       mirrored. Hiding keeps the structures identical. */
    var own = clone.querySelector('.po-panel-open');
    if (own) { own.style.display = 'none'; own.disabled = true; }
    win.document.getElementById('poWrap').appendChild(clone);

    /* The button's own state is set before the first mirror rather than after
       it. The mirror copies the disabled state of every control from the panel
       onto its copy, so a button still marked as available here would be
       copied over the copy that was just switched off. */
    openBtn.textContent = 'Controls are in the other window';
    openBtn.disabled = true;

    wire();
    mirror();

    /* Hide the real panel without taking it out of the layout: the module
       measures its canvases from their parent's width, and an element that is
       display:none has no width to measure. A zero-height wrapper keeps every
       measurement the module makes correct while freeing the screen. */
    holder = document.createElement('div');
    holder.setAttribute('style', 'height:0;overflow:hidden');
    panel.parentNode.insertBefore(holder, panel);
    holder.appendChild(panel);

    bar = makeBar();
    holder.parentNode.insertBefore(bar, holder);

    /* Where the button sits in a row of its own above the panel, that row
       goes with the panel. Leaving it up would put a dead button directly
       above the line that already says the same thing. */
    if (ownRow) ownRow.style.display = 'none';

    timer = setInterval(mirror, TICK_MS);
    win.addEventListener('unload', function () { setTimeout(restore, 60); });
    win.focus();
  }

  function restore() {
    if (timer) { clearInterval(timer); timer = null; }
    LINK = null;
    clone = null;
    if (win && !win.closed) { try { win.close(); } catch (e) { /* already gone */ } }
    win = null;
    if (holder && holder.parentNode) {
      holder.parentNode.insertBefore(panel, holder);
      holder.parentNode.removeChild(holder);
    }
    holder = null;
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    bar = null;
    if (ownRow) ownRow.style.display = 'flex';
    if (openBtn) {
      openBtn.textContent = LABEL;
      openBtn.disabled = false;
    }
    /* The panel has just been moved back into the flow at whatever width the
       page now has. Ask the module to redraw at that width. */
    try { window.dispatchEvent(new Event('resize')); } catch (e) { /* no redraw */ }
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    panel = findPanel();
    if (!panel) return;

    openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn ghost small po-panel-open';
    openBtn.textContent = LABEL;
    openBtn.title = 'Put these controls in a second window so they stay beside the panels they drive';
    openBtn.addEventListener('click', open);

    var caps = panel.querySelectorAll('.cap');
    if (caps.length) {
      /* The panel's own stylesheet hides buttons inside it, because the long
         explanations and the save buttons belong in the step rather than the
         header. This one is set inline so it survives that rule without the
         stylesheet having to know about it. */
      var host = caps[caps.length - 1];
      host.style.display = 'flex';
      host.style.alignItems = 'baseline';
      host.style.justifyContent = 'space-between';
      host.style.gap = '10px';
      openBtn.style.display = 'inline-flex';
      openBtn.style.flex = '0 0 auto';
      host.appendChild(openBtn);
    } else {
      /* A control band has no caption line to hang the button from, and it is
         a grid, so a button dropped inside it would become a grid cell of its
         own beside the control columns. A row above the band keeps the grid
         as the module laid it out. */
      ownRow = document.createElement('div');
      ownRow.setAttribute('style',
        'display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:18px 0 0');
      var hint = document.createElement('span');
      hint.setAttribute('style', 'font-size:12.5px;color:var(--slate,#5C6670)');
      hint.textContent = 'The copy stays live: everything on this page follows it.';
      ownRow.appendChild(openBtn);
      ownRow.appendChild(hint);
      panel.parentNode.insertBefore(ownRow, panel);
    }

    window.addEventListener('beforeunload', function () {
      if (win && !win.closed) {
        try { win.document.getElementById('poStale').style.display = 'block'; }
        catch (e) { /* nothing further */ }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
