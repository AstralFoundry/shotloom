import type { ProviderAdapter } from '../ProviderAdapter';

/** 声明式厂商只需要填写的元数据：身份展示与内置接口地址。 */
export type DeclarativeAdapterMeta = Pick<
  ProviderAdapter,
  'id' | 'name' | 'description' | 'iconId' | 'baseUrl' | 'baseUrlRequired'
>;
