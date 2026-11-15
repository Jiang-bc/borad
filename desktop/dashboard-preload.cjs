const { ipcRenderer } = require('electron');

ipcRenderer.on('borad:dashboard-theme', (_event, theme) => {
  if (!['claude', 'github', 'google', 'forest'].includes(theme)) return;
  document.documentElement.dataset.theme = theme;
  const select = document.getElementById('theme-select');
  if (select) select.value = theme;
});

window.addEventListener('keydown', event => {
  if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    ipcRenderer.send('borad:dashboard-home');
  }
});
