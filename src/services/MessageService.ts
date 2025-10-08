import { MessageData } from '../types.js';

export class MessageService {
  static sendToAllTabs(message: MessageData): void {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {
            // Ignore errors for tabs that can't receive messages
          });
        }
      });
    });
  }

  static sendToTab(tabId: number, message: MessageData): void {
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // Ignore errors for tabs that can't receive messages
    });
  }

  static onMessage(callback: (message: MessageData) => void): void {
    chrome.runtime.onMessage.addListener(callback);
  }
}