import { Subject } from 'rxjs';
export declare const NavigationManager: unique symbol;
export interface InitialRoute {
    currentPath: string;
    params?: {
        escapeExit: string;
        skipAuth: string;
    };
}
export interface initialRender {
    component: React.ComponentType<any>;
    props: Record<string, unknown>;
}
export interface NavigationManager {
    navigateSubject: Subject<string>;
    initialRoute?: InitialRoute;
    initialRender?: initialRender;
    setInitialRender: (renderer: initialRender) => void;
    to: (path: string) => Promise<void>;
    setInitialRoute: (route: InitialRoute) => void;
    clearInitialRoute: () => void;
    clearInitialRender: () => void;
}
