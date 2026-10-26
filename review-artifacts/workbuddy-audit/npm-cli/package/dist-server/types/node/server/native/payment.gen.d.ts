import { Context, Effect, Layer } from 'effect';
import { type PaymentInterceptorImpl } from '../../payment/payment-interceptor';
import { type WeixinPayServiceImpl } from '../../payment/weixinpay-pay-service';
declare const WeixinPayServiceImplKey_base: Context.ServiceClass<WeixinPayServiceImplKey, "server/native/WeixinPayServiceImpl", WeixinPayServiceImpl>;
export declare class WeixinPayServiceImplKey extends WeixinPayServiceImplKey_base {
}
export declare const WeixinPayServiceImplLayer: Layer.Layer<WeixinPayServiceImplKey, never, never>;
declare const PaymentInterceptorImplKey_base: Context.ServiceClass<PaymentInterceptorImplKey, "server/native/PaymentInterceptorImpl", PaymentInterceptorImpl>;
export declare class PaymentInterceptorImplKey extends PaymentInterceptorImplKey_base {
}
export declare const PaymentInterceptorImplLayer: Layer.Layer<PaymentInterceptorImplKey, never, never>;
export declare const layer: Layer.Layer<WeixinPayServiceImplKey | PaymentInterceptorImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof WeixinPayServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof PaymentInterceptorImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, WeixinPayServiceImplKey | PaymentInterceptorImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
