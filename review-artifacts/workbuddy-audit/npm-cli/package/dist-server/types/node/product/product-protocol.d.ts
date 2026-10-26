export { ProductEnvService, ProductEnviroment } from '@genie/authentication';
export declare const ConfigWatchService: unique symbol;
export declare const McpWatchService: unique symbol;
export interface ConfigWatchService {
    initialize(): void;
}
export interface McpWatchService {
}
