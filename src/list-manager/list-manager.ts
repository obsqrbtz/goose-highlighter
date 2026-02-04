import { ListManagerController } from './ListManagerController.js';

document.addEventListener('DOMContentLoaded', async () => {
  const controller = new ListManagerController();
  await controller.initialize();
});
