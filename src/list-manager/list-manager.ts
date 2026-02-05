import { ListManagerController } from './ListManagerController.js';

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
  document.documentElement.classList.add('light');
} else {
  document.documentElement.classList.add('dark');
}

document.addEventListener('DOMContentLoaded', async () => {
  const controller = new ListManagerController();
  await controller.initialize();
});
