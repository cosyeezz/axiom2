import { Subject } from 'rxjs';
import { initialRender, InitialRoute, NavigationManager } from './navigation-protocol';
export declare class NavigationManagerImpl implements NavigationManager {
    navigateSubject: Subject<string>;
    initialRoute?: InitialRoute;
    initialRender?: initialRender;
    to(path: string): Promise<void>;
    setInitialRoute(route: InitialRoute): void;
    setInitialRender(renderer: initialRender): void;
    clearInitialRender(): void;
    clearInitialRoute(): void;
}
