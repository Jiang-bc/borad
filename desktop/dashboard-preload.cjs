const { ipcRenderer } = require('electron');

window.addEventListener('keydown', event => {
  if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    ipcRenderer.send('borad:dashboard-home');
  }
});
