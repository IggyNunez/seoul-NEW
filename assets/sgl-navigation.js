/**
 * Seoul Glow Lab - Navigation Controller
 * Handles mobile drawer, submenu panels, and keyboard interactions.
 * Standalone vanilla JS — no Horizon Component dependency.
 */

(function () {
  'use strict';

  // ── Elements ──────────────────────────────────────────────────────
  const drawer = document.getElementById('sgl-drawer');
  const overlay = document.getElementById('sgl-drawer-overlay');
  const body = document.body;

  if (!drawer || !overlay) return;

  // ── Drawer Toggle ─────────────────────────────────────────────────
  function openDrawer() {
    drawer.classList.add('active');
    overlay.classList.add('active');
    body.style.overflow = 'hidden';
    // Focus first focusable element
    const firstFocusable = drawer.querySelector('button, a, [tabindex]');
    if (firstFocusable) firstFocusable.focus();
  }

  function closeDrawer() {
    // Close any open submenus first
    closeAllSubmenus();
    drawer.classList.remove('active');
    overlay.classList.remove('active');
    body.style.overflow = '';
    // Return focus to the toggle button
    const toggle = document.querySelector('.sgl-menu-toggle');
    if (toggle) toggle.focus();
  }

  function toggleDrawer() {
    if (drawer.classList.contains('active')) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  // ── Submenu Panels ────────────────────────────────────────────────
  function openSubmenu(id) {
    const panel = document.getElementById('sgl-submenu-' + id);
    if (panel) {
      panel.classList.add('active');
      // Focus the back button
      const backBtn = panel.querySelector('.sgl-submenu-back');
      if (backBtn) backBtn.focus();
    }
  }

  function closeSubmenu(id) {
    const panel = document.getElementById('sgl-submenu-' + id);
    if (panel) {
      panel.classList.remove('active');
    }
  }

  function closeAllSubmenus() {
    const panels = document.querySelectorAll('.sgl-submenu-panel.active');
    panels.forEach(function (panel) {
      panel.classList.remove('active');
    });
  }

  // ── Event Listeners ───────────────────────────────────────────────

  // Overlay click closes drawer
  overlay.addEventListener('click', closeDrawer);

  // Drawer toggle buttons
  document.querySelectorAll('[data-sgl-drawer-toggle]').forEach(function (btn) {
    btn.addEventListener('click', toggleDrawer);
  });

  // Drawer close buttons
  document.querySelectorAll('[data-sgl-drawer-close]').forEach(function (btn) {
    btn.addEventListener('click', closeDrawer);
  });

  // Submenu open triggers
  document.querySelectorAll('[data-sgl-submenu-open]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = this.getAttribute('data-sgl-submenu-open');
      openSubmenu(id);
    });
  });

  // Submenu close (back) buttons
  document.querySelectorAll('[data-sgl-submenu-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = this.getAttribute('data-sgl-submenu-close');
      closeSubmenu(id);
    });
  });

  // ── Keyboard Handling ─────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      // Close topmost open submenu first, then drawer
      var openPanel = document.querySelector('.sgl-submenu-panel.active');
      if (openPanel) {
        openPanel.classList.remove('active');
      } else if (drawer.classList.contains('active')) {
        closeDrawer();
      }
    }
  });

  // ── Expose globally for inline onclick handlers (optional) ───────
  window.SglNav = {
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    toggleDrawer: toggleDrawer,
    openSubmenu: openSubmenu,
    closeSubmenu: closeSubmenu,
  };
})();
