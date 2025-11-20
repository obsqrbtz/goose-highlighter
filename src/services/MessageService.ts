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

  static onMessage(callback: (message: MessageData, sender: any, sendResponse: (response?: any) => void) => void | boolean): void {
    chrome.runtime.onMessage.addListener(callback);
  }

  static async sendToActiveTab(message: MessageData): Promise<any> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      return chrome.tabs.sendMessage(tab.id, message);
    }
    return null;
  }
}