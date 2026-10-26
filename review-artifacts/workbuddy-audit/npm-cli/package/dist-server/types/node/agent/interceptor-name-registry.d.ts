/** 解析拦截器的稳定名称，用于 trace span 命名，避免生产压缩后的乱码类名。 */
export declare function resolveInterceptorName(interceptor: {
    constructor: {
        name: string;
    };
}): string;
