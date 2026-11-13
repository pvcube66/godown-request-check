import { describe, expect, it } from 'vitest';
import { platformMetaApp } from './whatsapp.js';

describe('the Meta app set once on the server', () => {
  it('is used only when the App ID, App secret and configuration ID are all set', () => {
    expect(platformMetaApp({})).toBeNull();
    expect(platformMetaApp({ WHATSAPP_META_APP_ID: '123456', WHATSAPP_META_APP_SECRET: 's3cret' })).toBeNull();
    expect(platformMetaApp({ WHATSAPP_META_APP_ID: '123456', WHATSAPP_META_APP_SECRET: '  ', WHATSAPP_EMBEDDED_CONFIG_ID: '789012' })).toBeNull();
  });
  it('trims the values and returns them together', () => {
    expect(platformMetaApp({ WHATSAPP_META_APP_ID: ' 123456 ', WHATSAPP_META_APP_SECRET: ' s3cret ', WHATSAPP_EMBEDDED_CONFIG_ID: ' 789012 ' }))
      .toEqual({ appId: '123456', appSecret: 's3cret', configId: '789012' });
  });
});
