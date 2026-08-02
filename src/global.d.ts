export {};

declare global {
  interface Window {
    api: {
      send: (channel: string, data?: any) => void;
      invoke: (channel: string, data?: any) => Promise<any>;
      on: (channel: string, callback: (event: any, ...args: any[]) => void) => void;
    };
  }
}
