import { browserAPI } from '../utils/browser.js';
import { MessageData } from '../types.js';

export class MessageService {
  static sendToAllTabs(message: MessageData): void {
    browserAPI.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          browserAPI.tabs.sendMessage(tab.id, message).catch(() => {
            // Ignore errors for tabs that can't receive messages
          });
        }
      });
    });
  }

  static sendToTab(tabId: number, message: MessageData): void {
    browserAPI.tabs.sendMessage(tabId, message).catch(() => {
      // Ignore errors for tabs that can't receive messages
    });
  }

  static onMessage(callback: (message: MessageData, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => void | boolean): void {
    browserAPI.runtime.onMessage.addListener(callback);
  }

  static async sendToActiveTab(message: MessageData): Promise<unknown> {
    const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      return browserAPI.tabs.sendMessage(tab.id, message);
    }
    return null;
  }
}