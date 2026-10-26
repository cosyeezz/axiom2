import { Application, ApplicationLifecycle } from '@celljs/core';
import { RestOperations } from '@celljs/http';
import { ProductManager } from '@genie/product';
import { CustomHeadersProvider } from './custom-headers-provider';
/**
 * 把 CODEBUDDY_CUSTOM_HEADERS 注入到打向平台 endpoint 的 RestOperations 请求。
 * 覆盖 imagegen / videogen 以及其它走 axios 单例的平台接口。
 */
export declare class CustomHeaderHttpInterceptor implements ApplicationLifecycle<Application> {
    protected readonly restOperations: RestOperations;
    protected readonly productManager: ProductManager;
    protected readonly customHeadersProvider: CustomHeadersProvider;
    initialize(): void;
}
